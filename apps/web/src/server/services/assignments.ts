/**
 * Devoirs : création, dépôt par l'apprenant, correction par le formateur.
 *
 * Les fichiers déposés sont des `Asset` (stockage objet) reliés à la soumission
 * par `SubmissionFile` : aucune URL de stockage n'est exposée directement, le
 * téléchargement passe par une route qui vérifie les droits.
 */

import { prisma, withTenant } from "@/lib/db/prisma";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { notify, notifyWithEmail } from "@/lib/notifications";

export type CreateAssignmentInput = {
  organizationId: string;
  courseId: string;
  actorUserId: string;
  title: string;
  instructionsMd: string;
  lessonId?: string | null;
  maxScore?: number;
  dueAt?: Date | null;
  allowLate?: boolean;
  isPublished?: boolean;
};

export async function createAssignment(input: CreateAssignmentInput) {
  const assignment = await withTenant(input.organizationId, async (tx) => {
    const course = await tx.course.findFirst({
      where: { id: input.courseId, organizationId: input.organizationId },
      select: { id: true, title: true, instructorId: true },
    });
    if (!course) throw notFound("Formation introuvable.");

    if (input.lessonId) {
      const lesson = await tx.lesson.findFirst({
        where: { id: input.lessonId, courseId: course.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!lesson) throw badRequest("La leçon indiquée n'appartient pas à cette formation.");
    }

    return tx.assignment.create({
      data: {
        organizationId: input.organizationId,
        courseId: course.id,
        lessonId: input.lessonId ?? null,
        title: input.title,
        instructionsMd: input.instructionsMd,
        maxScore: Math.max(1, Math.min(1000, input.maxScore ?? 100)),
        dueAt: input.dueAt ?? null,
        allowLate: input.allowLate ?? false,
        isPublished: input.isPublished ?? false,
      },
      select: { id: true, title: true, isPublished: true, courseId: true, dueAt: true },
    });
  });

  await recordAudit({
    action: "assessment.created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Assignment",
    entityId: assignment.id,
    metadata: { courseId: input.courseId, title: assignment.title },
  });

  if (assignment.isPublished) {
    await notifyCourseLearners({
      organizationId: input.organizationId,
      courseId: input.courseId,
      title: "Nouveau devoir disponible",
      body: assignment.title,
      href: `/tableau-de-bord/devoirs/${assignment.id}`,
      type: "ASSIGNMENT_POSTED",
    });
  }

  return assignment;
}

async function notifyCourseLearners(input: {
  organizationId: string;
  courseId: string;
  title: string;
  body: string;
  href: string;
  type: "ASSIGNMENT_POSTED" | "COURSE_PUBLISHED" | "LESSON_AVAILABLE";
}): Promise<void> {
  const enrollments = await withTenant(input.organizationId, (tx) =>
    tx.enrollment.findMany({
      where: { courseId: input.courseId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { userId: true },
      take: 1000,
    }),
  );
  await Promise.all(
    enrollments.map((enrollment) =>
      notify({
        userId: enrollment.userId,
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
      }),
    ),
  );
}

export async function updateAssignment(input: {
  organizationId: string;
  assignmentId: string;
  actorUserId: string;
  patch: Partial<{
    title: string;
    instructionsMd: string;
    maxScore: number;
    dueAt: Date | null;
    allowLate: boolean;
    isPublished: boolean;
  }>;
}) {
  const updated = await withTenant(input.organizationId, async (tx) => {
    const current = await tx.assignment.findFirst({
      where: { id: input.assignmentId, organizationId: input.organizationId },
      select: { id: true, courseId: true, isPublished: true, title: true },
    });
    if (!current) throw notFound("Devoir introuvable.");

    return tx.assignment.update({
      where: { id: current.id },
      data: {
        ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
        ...(input.patch.instructionsMd !== undefined ? { instructionsMd: input.patch.instructionsMd } : {}),
        ...(input.patch.maxScore !== undefined
          ? { maxScore: Math.max(1, Math.min(1000, input.patch.maxScore)) }
          : {}),
        ...(input.patch.dueAt !== undefined ? { dueAt: input.patch.dueAt } : {}),
        ...(input.patch.allowLate !== undefined ? { allowLate: input.patch.allowLate } : {}),
        ...(input.patch.isPublished !== undefined ? { isPublished: input.patch.isPublished } : {}),
      },
      select: { id: true, title: true, isPublished: true, courseId: true, dueAt: true, maxScore: true },
    });
  });

  await recordAudit({
    action: "assessment.created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Assignment",
    entityId: updated.id,
    metadata: { updated: true },
  });

  return updated;
}

export async function deleteAssignment(input: {
  organizationId: string;
  assignmentId: string;
  actorUserId: string;
}): Promise<void> {
  await withTenant(input.organizationId, async (tx) => {
    const current = await tx.assignment.findFirst({
      where: { id: input.assignmentId, organizationId: input.organizationId },
      select: { id: true, courseId: true, title: true },
    });
    if (!current) throw notFound("Devoir introuvable.");
    await tx.assignment.delete({ where: { id: current.id } });
  });

  await recordAudit({
    action: "assessment.created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Assignment",
    entityId: input.assignmentId,
    metadata: { deleted: true },
  });
}

export async function listCourseAssignments(organizationId: string, courseId: string) {
  return withTenant(organizationId, (tx) =>
    tx.assignment.findMany({
      where: { courseId, organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        instructionsMd: true,
        maxScore: true,
        dueAt: true,
        allowLate: true,
        isPublished: true,
        lessonId: true,
        createdAt: true,
        _count: { select: { submissions: true } },
      },
    }),
  );
}

/** Vue apprenant : le devoir et, le cas échéant, sa propre soumission. */
export async function getAssignmentForLearner(input: {
  organizationId: string;
  assignmentId: string;
  userId: string;
}) {
  const assignment = await withTenant(input.organizationId, (tx) =>
    tx.assignment.findFirst({
      where: { id: input.assignmentId, organizationId: input.organizationId },
      select: {
        id: true,
        title: true,
        instructionsMd: true,
        maxScore: true,
        dueAt: true,
        allowLate: true,
        isPublished: true,
        courseId: true,
        course: { select: { id: true, title: true, slug: true } },
        submissions: {
          where: { userId: input.userId },
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            isLate: true,
            score: true,
            feedback: true,
            submittedAt: true,
            gradedAt: true,
            textContent: true,
            files: { select: { id: true, filename: true, assetId: true } },
          },
        },
      },
    }),
  );
  if (!assignment) throw notFound("Devoir introuvable.");

  const submission = assignment.submissions[0] ?? null;
  return {
    ...assignment,
    submission,
    /**
     * L'échéance est calculée ici, une fois : les pages ne doivent pas lire
     * l'horloge pendant le rendu (résultat instable entre deux rendus) et les
     * deux vues apprenant s'appuient ainsi sur la même règle.
     */
    isOverdue: assignment.dueAt !== null && assignment.dueAt.getTime() <= Date.now(),
    canSubmit:
      assignment.isPublished &&
      (!assignment.dueAt || assignment.allowLate || assignment.dueAt.getTime() > Date.now()) &&
      submission?.status !== "GRADED",
  };
}

export type SubmitAssignmentInput = {
  organizationId: string;
  assignmentId: string;
  userId: string;
  textContent?: string | null;
  assetIds?: string[];
};

export async function submitAssignment(input: SubmitAssignmentInput) {
  const assetIds = [...new Set(input.assetIds ?? [])];
  if (assetIds.length > 10) throw badRequest("10 fichiers maximum par dépôt.");
  const text = (input.textContent ?? "").trim();
  if (text.length === 0 && assetIds.length === 0) {
    throw badRequest("Ajoutez un texte ou au moins un fichier.");
  }

  const result = await withTenant(input.organizationId, async (tx) => {
    const assignment = await tx.assignment.findFirst({
      where: { id: input.assignmentId, organizationId: input.organizationId },
      select: {
        id: true,
        title: true,
        courseId: true,
        dueAt: true,
        allowLate: true,
        isPublished: true,
        course: { select: { instructorId: true } },
      },
    });
    if (!assignment) throw notFound("Devoir introuvable.");
    if (!assignment.isPublished) throw conflict("Ce devoir n'est pas encore ouvert.");

    const enrollment = await tx.enrollment.findFirst({
      where: { courseId: assignment.courseId, userId: input.userId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { id: true },
    });
    if (!enrollment) throw forbidden("Vous n'êtes pas inscrit à cette formation.");

    const existing = await tx.assignmentSubmission.findFirst({
      where: { assignmentId: assignment.id, userId: input.userId },
      orderBy: { submittedAt: "desc" },
      select: { id: true, status: true },
    });
    if (existing?.status === "GRADED") throw conflict("Ce devoir a déjà été corrigé.");

    if (assetIds.length > 0) {
      const owned = await tx.asset.count({
        where: { id: { in: assetIds }, organizationId: input.organizationId, uploaderId: input.userId },
      });
      if (owned !== assetIds.length) throw forbidden("Fichier non autorisé.");
    }

    const submittedAt = new Date();
    const isLate = Boolean(assignment.dueAt && submittedAt.getTime() > assignment.dueAt.getTime());
    if (isLate && !assignment.allowLate) {
      throw conflict("La date limite est dépassée et les dépôts tardifs sont désactivés.");
    }

    const submission = existing
      ? await tx.assignmentSubmission.update({
          where: { id: existing.id },
          data: { textContent: text || null, status: "SUBMITTED", isLate, submittedAt },
          select: { id: true, status: true, isLate: true, submittedAt: true },
        })
      : await tx.assignmentSubmission.create({
          data: {
            assignmentId: assignment.id,
            organizationId: input.organizationId,
            userId: input.userId,
            textContent: text || null,
            status: "SUBMITTED",
            isLate,
            submittedAt,
          },
          select: { id: true, status: true, isLate: true, submittedAt: true },
        });

    await tx.submissionFile.deleteMany({ where: { submissionId: submission.id } });
    if (assetIds.length > 0) {
      const assets = await tx.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, filename: true },
      });
      await tx.submissionFile.createMany({
        data: assets.map((asset) => ({
          organizationId: input.organizationId,
          submissionId: submission.id,
          assetId: asset.id,
          filename: asset.filename,
        })),
      });
    }

    return { submission, assignment };
  });

  await recordAudit({
    action: "assignment.submitted",
    organizationId: input.organizationId,
    actorUserId: input.userId,
    entityType: "AssignmentSubmission",
    entityId: result.submission.id,
    metadata: { assignmentId: result.assignment.id, late: result.submission.isLate },
  });

  const instructor = await prisma.user.findUnique({
    where: { id: result.assignment.course.instructorId },
    select: { email: true, name: true },
  });
  if (instructor) {
    await notifyWithEmail(
      {
        userId: result.assignment.course.instructorId,
        organizationId: input.organizationId,
        type: "ASSIGNMENT_POSTED",
        title: "Nouveau dépôt à corriger",
        body: result.assignment.title,
        href: "/tableau-de-bord/evaluations/corrections",
      },
      {
        to: instructor.email,
        template: "assignment_posted",
        context: { assignmentTitle: result.assignment.title, studentName: input.userId },
        dedupeKey: `assignment.submitted:${result.submission.id}`,
      },
    );
  }

  return result.submission;
}

/** Correction d'une soumission (formateur). */
export async function gradeSubmission(input: {
  organizationId: string;
  submissionId: string;
  graderUserId: string;
  score: number;
  feedback?: string | null;
  returnToStudent?: boolean;
}) {
  const graded = await withTenant(input.organizationId, async (tx) => {
    const submission = await tx.assignmentSubmission.findFirst({
      where: { id: input.submissionId, organizationId: input.organizationId },
      select: {
        id: true,
        userId: true,
        assignmentId: true,
        assignment: { select: { title: true, maxScore: true, courseId: true } },
      },
    });
    if (!submission) throw notFound("Dépôt introuvable.");
    if (input.score < 0 || input.score > submission.assignment.maxScore) {
      throw badRequest(`La note doit être comprise entre 0 et ${submission.assignment.maxScore}.`);
    }

    return tx.assignmentSubmission.update({
      where: { id: submission.id },
      data: {
        score: Math.round(input.score),
        feedback: input.feedback?.trim() || null,
        status: input.returnToStudent ? "RETURNED" : "GRADED",
        gradedAt: new Date(),
        gradedById: input.graderUserId,
      },
      select: {
        id: true,
        userId: true,
        score: true,
        status: true,
        assignmentId: true,
        assignment: { select: { title: true, courseId: true, maxScore: true } },
      },
    });
  });

  await recordAudit({
    action: "assignment.graded",
    organizationId: input.organizationId,
    actorUserId: input.graderUserId,
    entityType: "AssignmentSubmission",
    entityId: graded.id,
    metadata: { score: graded.score, maxScore: graded.assignment.maxScore },
  });

  const learner = await prisma.user.findUnique({
    where: { id: graded.userId },
    select: { email: true, name: true },
  });
  await notifyWithEmail(
    {
      userId: graded.userId,
      organizationId: input.organizationId,
      type: "ASSIGNMENT_GRADED",
      title: "Votre devoir a été corrigé",
      body: `${graded.assignment.title} — ${graded.score}/${graded.assignment.maxScore}`,
      href: `/tableau-de-bord/devoirs/${graded.assignmentId}`,
    },
    {
      to: learner?.email ?? "",
      template: "assignment_graded",
      context: {
        studentName: learner?.name ?? "Étudiant",
        assignmentTitle: graded.assignment.title,
        score: graded.score,
        maxScore: graded.assignment.maxScore,
      },
      dedupeKey: `assignment.graded:${graded.id}`,
    },
  );

  return graded;
}

/** Suivi des dépôts pour le formateur. */
export async function listSubmissions(organizationId: string, assignmentId: string) {
  return withTenant(organizationId, (tx) =>
    tx.assignmentSubmission.findMany({
      where: { assignmentId, organizationId },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        status: true,
        isLate: true,
        score: true,
        feedback: true,
        submittedAt: true,
        gradedAt: true,
        user: { select: { id: true, name: true, email: true } },
        files: { select: { id: true, filename: true, assetId: true } },
      },
    }),
  );
}

/** Liste des devoirs d'un apprenant, tous cours confondus. */
export async function listMyAssignments(input: { organizationId: string; userId: string }) {
  const enrollments = await withTenant(input.organizationId, (tx) =>
    tx.enrollment.findMany({
      where: { userId: input.userId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { courseId: true },
    }),
  );
  const courseIds = enrollments.map((enrollment) => enrollment.courseId);
  if (courseIds.length === 0) return [];

  const assignments = await withTenant(input.organizationId, (tx) =>
    tx.assignment.findMany({
      where: { courseId: { in: courseIds }, isPublished: true, organizationId: input.organizationId },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        dueAt: true,
        allowLate: true,
        maxScore: true,
        course: { select: { id: true, title: true } },
        submissions: {
          where: { userId: input.userId },
          select: { id: true, status: true, score: true, submittedAt: true },
          take: 1,
        },
      },
    }),
  );

  // Le retard est calculé ici : les pages n'ont ainsi jamais à lire l'horloge
  // pendant leur rendu, et la règle reste identique partout.
  const now = Date.now();
  return assignments.map((assignment) => {
    const submission = assignment.submissions[0] ?? null;
    return {
      ...assignment,
      submission,
      isOverdue: Boolean(assignment.dueAt && assignment.dueAt.getTime() < now),
      isLateSubmission: Boolean(submission?.submittedAt && assignment.dueAt && submission.submittedAt > assignment.dueAt),
    };
  });
}
