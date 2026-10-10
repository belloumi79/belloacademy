/**
 * Inscriptions et progression des apprenants.
 *
 * La progression est dérivée des leçons terminées : `lesson_progress` est la
 * source de vérité, `enrollments.progressPercent` un cache recalculé à chaque
 * marquage. Un apprenant ne peut marquer que les leçons d'une formation à
 * laquelle il est réellement inscrit.
 */

import { Prisma } from "@/generated/prisma/client";
import { CourseStatus, EnrollmentStatus } from "@/generated/prisma/enums";
import { withTenant } from "@/lib/db/prisma";
import { badRequest, conflict, forbidden, notFound, planLimitReached } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { computeProgress, isFreeCourse } from "@belloacademy/shared";
import { assertWithinPlan, incrementUsage } from "@/server/services/organizations";

export type EnrollmentSummary = {
  id: string;
  status: EnrollmentStatus;
  progressPercent: number;
  enrolledAt: Date;
  lastAccessedAt: Date | null;
  completedAt: Date | null;
  course: {
    id: string;
    slug: string;
    title: string;
    imageUrl: string | null;
    priceCents: number;
    currency: string;
    level: string;
  };
};

const ENROLLMENT_COURSE_SELECT = {
  id: true,
  slug: true,
  title: true,
  imageUrl: true,
  priceCents: true,
  currency: true,
  level: true,
} satisfies Prisma.CourseSelect;

export type EnrollInput = {
  organizationId: string;
  courseId: string;
  userId: string;
  /** Origine de l'inscription : `self`, `invite`, `admin`, `purchase`. */
  source?: string;
  /** Identifiant de facture lorsqu'un paiement a été confirmé. */
  invoiceId?: string | null;
  /** Vrai lorsque l'appelant (administrateur) peut inscrire sans payer. */
  bypassPayment?: boolean;
};

/**
 * Inscrit un utilisateur à une formation.
 *
 * Une formation payante exige soit un paiement confirmé (`invoiceId`), soit un
 * droit explicite (`bypassPayment`). Aucun contournement par prix côté client.
 */
export async function enrollUser(input: EnrollInput) {
  const source = input.source ?? "self";

  return withTenant(input.organizationId, async (tx) => {
    const course = await tx.course.findFirst({
      where: { id: input.courseId },
      select: { id: true, title: true, slug: true, priceCents: true, status: true, instructorId: true, certificateEnabled: true },
    });
    if (!course) throw notFound("Formation introuvable.");
    if (course.status !== CourseStatus.PUBLISHED && !input.bypassPayment) {
      throw conflict("Cette formation n'est pas encore publiée.");
    }

    const existing = await tx.enrollment.findFirst({
      where: { courseId: input.courseId, userId: input.userId },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === EnrollmentStatus.CANCELLED || existing.status === EnrollmentStatus.EXPIRED) {
        return tx.enrollment.update({
          where: { id: existing.id },
          data: { status: EnrollmentStatus.ACTIVE, enrolledAt: new Date(), lastAccessedAt: new Date() },
        });
      }
      throw conflict("Vous êtes déjà inscrit à cette formation.");
    }

    if (!isFreeCourse(course.priceCents) && !input.invoiceId && !input.bypassPayment) {
      throw planLimitReached("Cette formation est payante : finalisez le paiement pour vous inscrire.", {
        priceCents: course.priceCents,
        courseId: course.id,
      });
    }

    const enrollment = await tx.enrollment.create({
      data: {
        organizationId: input.organizationId,
        courseId: input.courseId,
        userId: input.userId,
        status: EnrollmentStatus.ACTIVE,
        progressPercent: 0,
        source,
        invoiceId: input.invoiceId ?? null,
        enrolledAt: new Date(),
        lastAccessedAt: new Date(),
      },
    });

    await notify(
      {
        userId: input.userId,
        organizationId: input.organizationId,
        type: "ENROLLMENT",
        title: "Inscription confirmée",
        body: `Vous êtes inscrit à « ${course.title} ».`,
        href: `/app/courses/${course.slug}`,
        data: { courseId: course.id, enrollmentId: enrollment.id },
      },
      tx,
    );

    return enrollment;
  });
}

/** Inscription avec contrôle du forfait (compteur `enrollments`). */
export async function enrollWithPlanCheck(input: EnrollInput) {
  await assertWithinPlan(input.organizationId, "enrollments");
  const enrollment = await enrollUser(input);
  await incrementUsage(input.organizationId, "enrollments");
  await recordAudit({
    action: "enrollment.created",
    organizationId: input.organizationId,
    actorUserId: input.userId,
    entityType: "enrollment",
    entityId: enrollment.id,
    metadata: { courseId: input.courseId, source: input.source ?? "self" },
  });
  return enrollment;
}

export async function listEnrollments(organizationId: string, userId: string): Promise<EnrollmentSummary[]> {
  return withTenant(organizationId, (tx) =>
    tx.enrollment.findMany({
      where: { userId, status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] } },
      orderBy: [{ lastAccessedAt: "desc" }, { enrolledAt: "desc" }],
      select: {
        id: true,
        status: true,
        progressPercent: true,
        enrolledAt: true,
        lastAccessedAt: true,
        completedAt: true,
        course: { select: ENROLLMENT_COURSE_SELECT },
      },
    }),
  );
}

export async function getEnrollment(organizationId: string, courseId: string, userId: string) {
  return withTenant(organizationId, (tx) =>
    tx.enrollment.findFirst({
      where: { courseId, userId },
      select: {
        id: true,
        status: true,
        progressPercent: true,
        enrolledAt: true,
        lastAccessedAt: true,
        completedAt: true,
      },
    }),
  );
}

async function recomputeProgress(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<{ percent: number; completed: boolean }> {
  const enrollment = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { courseId: true, status: true },
  });
  if (!enrollment) throw notFound("Inscription introuvable.");

  const [totalLessons, completedLessons] = await Promise.all([
    tx.lesson.count({ where: { courseId: enrollment.courseId, isPublished: true } }),
    tx.lessonProgress.count({
      where: { enrollmentId, completedAt: { not: null }, lesson: { isPublished: true } },
    }),
  ]);

  const progress = computeProgress(completedLessons, totalLessons);
  const completed = progress.totalLessons > 0 && progress.completedLessons >= progress.totalLessons;

  await tx.enrollment.update({
    where: { id: enrollmentId },
    data: {
      progressPercent: progress.percent,
      lastAccessedAt: new Date(),
      ...(completed && enrollment.status !== EnrollmentStatus.COMPLETED
        ? { status: EnrollmentStatus.COMPLETED, completedAt: new Date() }
        : {}),
    },
  });

  return { percent: progress.percent, completed };
}

/** Marque une leçon comme terminée (ou met à jour la position de lecture). */
export async function markLessonProgress(input: {
  organizationId: string;
  enrollmentId: string;
  lessonId: string;
  userId: string;
  positionSeconds?: number;
  completed?: boolean;
}) {
  const result = await withTenant(input.organizationId, async (tx) => {
    const enrollment = await tx.enrollment.findFirst({
      where: { id: input.enrollmentId, userId: input.userId },
      select: { id: true, courseId: true, status: true },
    });
    if (!enrollment) throw forbidden("Inscription introuvable pour cet utilisateur.");
    if (enrollment.status === EnrollmentStatus.CANCELLED) {
      throw forbidden("Cette inscription est annulée.");
    }

    const lesson = await tx.lesson.findFirst({
      where: { id: input.lessonId, courseId: enrollment.courseId },
      select: { id: true },
    });
    if (!lesson) throw badRequest("Cette leçon n'appartient pas à la formation suivie.");

    const shouldComplete = input.completed ?? true;

    await tx.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: input.lessonId } },
      create: {
        organizationId: input.organizationId,
        enrollmentId: enrollment.id,
        lessonId: input.lessonId,
        userId: input.userId,
        positionSeconds: input.positionSeconds ?? 0,
        completedAt: shouldComplete ? new Date() : null,
      },
      update: {
        ...(input.positionSeconds !== undefined ? { positionSeconds: input.positionSeconds } : {}),
        ...(shouldComplete ? { completedAt: new Date() } : {}),
      },
    });

    const progress = await recomputeProgress(tx, enrollment.id);
    return { enrollmentId: enrollment.id, courseId: enrollment.courseId, ...progress };
  });

  if (result.completed) {
    await recordAudit({
      action: "enrollment.completed",
      organizationId: input.organizationId,
      actorUserId: input.userId,
      entityType: "enrollment",
      entityId: result.enrollmentId,
    });
  }

  return result;
}

export type ProgressView = {
  completedLessonIds: string[];
  lastLessonId: string | null;
  percent: number;
};

/** Progression détaillée, utilisée pour reprendre un cours où il s'est arrêté. */
export async function getProgressView(
  organizationId: string,
  enrollmentId: string,
): Promise<ProgressView> {
  return withTenant(organizationId, async (tx) => {
    const rows = await tx.lessonProgress.findMany({
      where: { enrollmentId },
      orderBy: { updatedAt: "desc" },
      select: { lessonId: true, completedAt: true, updatedAt: true },
    });
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { progressPercent: true },
    });
    return {
      completedLessonIds: rows.filter((row) => row.completedAt).map((row) => row.lessonId),
      lastLessonId: rows[0]?.lessonId ?? null,
      percent: enrollment?.progressPercent ?? 0,
    };
  });
}

/** Prochaine leçon non terminée, dans l'ordre du programme. */
export async function nextLesson(organizationId: string, enrollmentId: string) {
  return withTenant(organizationId, async (tx) => {
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { courseId: true },
    });
    if (!enrollment) throw notFound("Inscription introuvable.");

    const lessons = await tx.lesson.findMany({
      where: { courseId: enrollment.courseId, isPublished: true },
      orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
      select: { id: true, title: true, sectionId: true },
    });
    const completed = await tx.lessonProgress.findMany({
      where: { enrollmentId, completedAt: { not: null } },
      select: { lessonId: true },
    });
    const done = new Set(completed.map((row) => row.lessonId));
    return lessons.find((lesson) => !done.has(lesson.id)) ?? null;
  });
}

export async function listCourseEnrollments(
  organizationId: string,
  courseId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  return withTenant(organizationId, async (tx) => {
    const where: Prisma.EnrollmentWhereInput = { courseId };
    const [items, total] = await Promise.all([
      tx.enrollment.findMany({
        where,
        orderBy: { enrolledAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          progressPercent: true,
          enrolledAt: true,
          lastAccessedAt: true,
          completedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      tx.enrollment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });
}

/** Annule une inscription (l'apprenant lui-même ou un administrateur). */
export async function cancelEnrollment(organizationId: string, enrollmentId: string) {
  return withTenant(organizationId, async (tx) => {
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true },
    });
    if (!enrollment) throw notFound("Inscription introuvable.");
    return tx.enrollment.update({
      where: { id: enrollmentId },
      data: { status: EnrollmentStatus.CANCELLED },
    });
  });
}
