/**
 * Formations : catalogue public, espace formateur et programme pédagogique.
 *
 * Les lectures publiques (catalogue) sont faites via le client plateforme : une
 * organisation peut publier son catalogue à l'extérieur de son tenant. Toutes
 * les écritures passent par `withTenant`, donc soumises aux politiques RLS.
 */

import { Prisma } from "@/generated/prisma/client";
import { CourseStatus, LessonType } from "@/generated/prisma/enums";
import { prismaPlatform, withTenant } from "@/lib/db/prisma";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { slugify } from "@belloacademy/shared";
import { assertWithinPlan, incrementUsage } from "@/server/services/organizations";

const COURSE_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  description: true,
  imageUrl: true,
  level: true,
  language: true,
  priceCents: true,
  currency: true,
  durationMinutes: true,
  status: true,
  publishedAt: true,
  organizationId: true,
  category: { select: { id: true, name: true, slug: true } },
  instructor: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { enrollments: true, lessons: true } },
} satisfies Prisma.CourseSelect;

export type CatalogFilters = {
  organizationId?: string;
  search?: string;
  categoryId?: string;
  level?: string;
  language?: string;
  price?: "free" | "paid";
  sort?: "recent" | "popular" | "title";
  page?: number;
  pageSize?: number;
};

export type CatalogPage = {
  items: Awaited<ReturnType<typeof listCatalog>>["items"];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Catalogue public : uniquement les formations publiées. */
export async function listCatalog(filters: CatalogFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, filters.pageSize ?? 12));

  const where: Prisma.CourseWhereInput = {
    status: CourseStatus.PUBLISHED,
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.level ? { level: filters.level as never } : {}),
    ...(filters.language ? { language: filters.language } : {}),
    ...(filters.price === "free" ? { priceCents: 0 } : {}),
    ...(filters.price === "paid" ? { priceCents: { gt: 0 } } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search, mode: "insensitive" } },
            { subtitle: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.CourseOrderByWithRelationInput[] =
    filters.sort === "popular"
      ? [{ enrollments: { _count: "desc" } }, { publishedAt: "desc" }]
      : filters.sort === "title"
        ? [{ title: "asc" }]
        : [{ publishedAt: "desc" }];

  const [items, total] = await Promise.all([
    prismaPlatform.course.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: COURSE_CARD_SELECT,
    }),
    prismaPlatform.course.count({ where }),
  ]);

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listCatalogCategories(organizationId?: string) {
  return prismaPlatform.category.findMany({
    where: organizationId ? { organizationId } : {},
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, description: true, _count: { select: { courses: true } } },
  });
}

/** Fiche formation publique : programme + formateur, sans contenu réservé. */
export async function getCourseForLearner(organizationId: string, slug: string, userId?: string | null) {
  const course = await prismaPlatform.course.findFirst({
    where: { organizationId, slug, status: CourseStatus.PUBLISHED },
    select: {
      ...COURSE_CARD_SELECT,
      objectives: true,
      prerequisites: true,
      certificateEnabled: true,
      certificateMinScore: true,
      sections: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          summary: true,
          position: true,
          lessons: {
            where: { isPublished: true },
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              type: true,
              durationSeconds: true,
              position: true,
              isPreview: true,
            },
          },
        },
      },
      _count: { select: { enrollments: true, lessons: true, liveSessions: true } },
    },
  });
  if (!course) throw notFound("Formation introuvable.");

  let enrollment: { id: string; progressPercent: number; status: string } | null = null;
  if (userId) {
    const found = await withTenant(organizationId, (tx) =>
      tx.enrollment.findFirst({
        where: { courseId: course.id, userId },
        select: { id: true, progressPercent: true, status: true },
      }),
    );
    enrollment = found ?? null;
  }

  return { course, enrollment };
}

/**
 * Fiche d'une formation publiée, résolue par son slug public.
 *
 * Le slug n'est unique qu'au sein d'une organisation : on identifie d'abord
 * l'organisation propriétaire, puis on réutilise la lecture « apprenant ».
 */
export async function getPublicCourseBySlug(slug: string, userId?: string | null) {
  const owner = await prismaPlatform.course.findFirst({
    where: { slug, status: CourseStatus.PUBLISHED },
    select: { organizationId: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!owner) throw notFound("Formation introuvable.");
  return getCourseForLearner(owner.organizationId, slug, userId);
}

/**
 * Résout l'organisation propriétaire d'une formation publiée.
 *
 * Utilisé par les pages publiques : la fiche d'une formation est accessible sans
 * session, mais toutes les lectures liées à l'apprenant (inscription, progression)
 * restent filtrées par organisation via `withTenant`.
 */
export async function resolveCourseOwner(slug: string): Promise<{ courseId: string; organizationId: string }> {
  const found = await prismaPlatform.course.findFirst({
    where: { slug, status: CourseStatus.PUBLISHED },
    orderBy: { publishedAt: "desc" },
    select: { id: true, organizationId: true },
  });
  if (!found) throw notFound("Formation introuvable.");
  return { courseId: found.id, organizationId: found.organizationId };
}

export async function getCourseById(organizationId: string, courseId: string) {
  const course = await withTenant(organizationId, (tx) =>
    tx.course.findUnique({ where: { id: courseId }, select: COURSE_CARD_SELECT }),
  );
  if (!course) throw notFound("Formation introuvable.");
  return course;
}

/** Programme complet (édition) : sections, leçons et ressources. */
export async function getCourseCurriculum(organizationId: string, courseId: string) {
  return withTenant(organizationId, async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, slug: true, status: true, instructorId: true },
    });
    if (!course) throw notFound("Formation introuvable.");

    const sections = await tx.section.findMany({
      where: { courseId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        summary: true,
        position: true,
        lessons: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            type: true,
            isPreview: true,
            isPublished: true,
            durationSeconds: true,
            position: true,
            contentMd: true,
            videoUrl: true,
            externalUrl: true,
            resources: {
              orderBy: { position: "asc" },
              select: { id: true, title: true, assetId: true, asset: { select: { filename: true, mimeType: true, sizeBytes: true } } },
            },
          },
        },
      },
    });

    return { course, sections };
  });
}

/** Leçon affichée à un apprenant, avec contrôle d'accès au contenu. */
export async function getLessonForLearner(input: {
  organizationId: string;
  lessonId: string;
  userId: string;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const lesson = await tx.lesson.findUnique({
      where: { id: input.lessonId },
      select: {
        id: true,
        title: true,
        type: true,
        contentMd: true,
        videoUrl: true,
        videoProvider: true,
        externalUrl: true,
        durationSeconds: true,
        isPreview: true,
        isPublished: true,
        courseId: true,
        sectionId: true,
        course: { select: { id: true, slug: true, title: true, status: true } },
        resources: {
          orderBy: { position: "asc" },
          select: { id: true, title: true, assetId: true, asset: { select: { filename: true, mimeType: true, sizeBytes: true } } },
        },
      },
    });
    if (!lesson || !lesson.isPublished) throw notFound("Leçon introuvable.");

    const enrollment = await tx.enrollment.findFirst({
      where: { courseId: lesson.courseId, userId: input.userId },
      select: { id: true, status: true },
    });

    const isFreePreview = lesson.isPreview;
    if (!enrollment && !isFreePreview) {
      throw conflict("Inscrivez-vous à cette formation pour accéder à cette leçon.", {
        reason: "enrollment_required",
        courseSlug: lesson.course.slug,
      });
    }

    // Le contenu réservé n'est jamais envoyé au client sans inscription.
    const resources = enrollment
      ? lesson.resources
      : lesson.resources.map((resource) => ({ ...resource, assetId: null as unknown as string }));

    return {
      lesson: { ...lesson, resources, videoUrl: enrollment || isFreePreview ? lesson.videoUrl : null },
      enrollment,
      locked: !enrollment,
    };
  });
}

export type CourseInput = {
  organizationId: string;
  instructorId: string;
  actorUserId: string;
  title: string;
  subtitle?: string | null;
  description: string;
  level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  language?: string;
  categoryId?: string | null;
  imageUrl?: string | null;
  objectives?: string[];
  prerequisites?: string[];
  durationMinutes?: number | null;
  priceCents?: number;
  currency?: string;
  certificateEnabled?: boolean;
  certificateMinScore?: number;
};

export async function createCourse(input: CourseInput) {
  await assertWithinPlan(input.organizationId, "courses");

  const course = await withTenant(input.organizationId, async (tx) => {
    const base = slugify(input.title) || "formation";
    let slug = base;
    for (let attempt = 1; attempt < 20; attempt += 1) {
      const taken = await tx.course.findFirst({
        where: { slug },
        select: { id: true },
      });
      if (!taken) break;
      slug = `${base}-${attempt + 1}`;
    }

    return tx.course.create({
      data: {
        organizationId: input.organizationId,
        slug,
        title: input.title,
        subtitle: input.subtitle ?? null,
        description: input.description,
        level: (input.level ?? "BEGINNER") as never,
        language: input.language ?? "fr",
        categoryId: input.categoryId ?? null,
        imageUrl: input.imageUrl ?? null,
        objectives: input.objectives ?? [],
        prerequisites: input.prerequisites ?? [],
        durationMinutes: input.durationMinutes ?? null,
        priceCents: input.priceCents ?? 0,
        currency: input.currency ?? "TND",
        instructorId: input.instructorId,
        createdById: input.actorUserId,
        status: CourseStatus.DRAFT,
        certificateEnabled: input.certificateEnabled ?? true,
        certificateMinScore: input.certificateMinScore ?? 70,
      },
      select: { id: true, slug: true, title: true, status: true },
    });
  });

  await incrementUsage(input.organizationId, "courses");
  await recordAudit({
    action: "course.created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "course",
    entityId: course.id,
    metadata: { title: course.title },
  });

  return course;
}

export async function updateCourse(input: {
  organizationId: string;
  courseId: string;
  actorUserId: string;
  data: Partial<Omit<CourseInput, "organizationId" | "instructorId" | "actorUserId" | "title">> & {
    title?: string;
    instructorId?: string;
  };
}) {
  const updated = await withTenant(input.organizationId, async (tx) => {
    const existing = await tx.course.findUnique({ where: { id: input.courseId }, select: { id: true, status: true } });
    if (!existing) throw notFound("Formation introuvable.");
    const { data } = input;
    return tx.course.update({
      where: { id: input.courseId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.level !== undefined ? { level: data.level as never } : {}),
        ...(data.language !== undefined ? { language: data.language } : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        ...(data.objectives !== undefined ? { objectives: data.objectives } : {}),
        ...(data.prerequisites !== undefined ? { prerequisites: data.prerequisites } : {}),
        ...(data.durationMinutes !== undefined ? { durationMinutes: data.durationMinutes } : {}),
        ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.certificateEnabled !== undefined ? { certificateEnabled: data.certificateEnabled } : {}),
        ...(data.certificateMinScore !== undefined ? { certificateMinScore: data.certificateMinScore } : {}),
        ...(data.instructorId !== undefined ? { instructorId: data.instructorId } : {}),
      },
      select: { id: true, slug: true, title: true, status: true },
    });
  });

  await recordAudit({
    action: "course.updated",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "course",
    entityId: updated.id,
  });

  return updated;
}

/**
 * Publie une formation. Une formation sans leçon publiée ne peut pas être
 * publiée : le catalogue ne doit jamais exposer un cours vide.
 */
export async function publishCourse(input: { organizationId: string; courseId: string; actorUserId: string }) {
  const result = await withTenant(input.organizationId, async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, status: true, title: true },
    });
    if (!course) throw notFound("Formation introuvable.");

    const publishedLessons = await tx.lesson.count({ where: { courseId: course.id, isPublished: true } });
    if (publishedLessons === 0) {
      throw badRequest("Impossible de publier une formation sans leçon publiée.");
    }

    return tx.course.update({
      where: { id: course.id },
      data: { status: CourseStatus.PUBLISHED, publishedAt: new Date(), archivedAt: null },
      select: { id: true, slug: true, title: true, status: true },
    });
  });

  await recordAudit({
    action: "course.published",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "course",
    entityId: result.id,
    metadata: { title: result.title },
  });

  return result;
}

export async function archiveCourse(input: { organizationId: string; courseId: string; actorUserId: string }) {
  const result = await withTenant(input.organizationId, (tx) =>
    tx.course.update({
      where: { id: input.courseId },
      data: { status: CourseStatus.ARCHIVED, archivedAt: new Date() },
      select: { id: true, slug: true, title: true, status: true },
    }),
  );
  await recordAudit({
    action: "course.archived",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "course",
    entityId: result.id,
  });
  return result;
}

export async function listInstructorCourses(organizationId: string, instructorId?: string) {
  return withTenant(organizationId, (tx) =>
    tx.course.findMany({
      where: instructorId ? { instructorId } : {},
      orderBy: { updatedAt: "desc" },
      select: {
        ...COURSE_CARD_SELECT,
        updatedAt: true,
        instructor: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Programme : sections et leçons                                      */
/* ------------------------------------------------------------------ */

export async function createSection(input: {
  organizationId: string;
  courseId: string;
  title: string;
  summary?: string | null;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const last = await tx.section.aggregate({
      where: { courseId: input.courseId },
      _max: { position: true },
    });
    return tx.section.create({
      data: {
        organizationId: input.organizationId,
        courseId: input.courseId,
        title: input.title,
        summary: input.summary ?? null,
        position: (last._max.position ?? 0) + 1,
      },
      select: { id: true, title: true, position: true },
    });
  });
}

export async function updateSection(input: {
  organizationId: string;
  sectionId: string;
  title?: string;
  summary?: string | null;
}) {
  return withTenant(input.organizationId, (tx) =>
    tx.section.update({
      where: { id: input.sectionId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      },
      select: { id: true, title: true, position: true },
    }),
  );
}

export async function deleteSection(input: { organizationId: string; sectionId: string }) {
  return withTenant(input.organizationId, async (tx) => {
    const lessons = await tx.lesson.count({ where: { sectionId: input.sectionId } });
    if (lessons > 0) {
      throw conflict("Supprimez ou déplacez d'abord les leçons de cette section.");
    }
    await tx.section.delete({ where: { id: input.sectionId } });
    return { id: input.sectionId };
  });
}

/** Réordonne les sections selon la liste d'identifiants fournie. */
export async function reorderSections(input: { organizationId: string; courseId: string; orderedIds: string[] }) {
  return withTenant(input.organizationId, async (tx) => {
    const sections = await tx.section.findMany({ where: { courseId: input.courseId }, select: { id: true } });
    const known = new Set(sections.map((section) => section.id));
    const ordered = input.orderedIds.filter((id) => known.has(id));
    if (ordered.length !== sections.length) {
      throw badRequest("La liste de réordonnancement doit contenir toutes les sections de la formation.");
    }
    await Promise.all(
      ordered.map((id, index) =>
        tx.section.update({ where: { id }, data: { position: index + 1 } }),
      ),
    );
    return { count: ordered.length };
  });
}

export type LessonInput = {
  organizationId: string;
  courseId: string;
  sectionId: string;
  title: string;
  type?: LessonType;
  contentMd?: string | null;
  videoUrl?: string | null;
  videoProvider?: string | null;
  externalUrl?: string | null;
  durationSeconds?: number | null;
  isPreview?: boolean;
};

export async function createLesson(input: LessonInput) {
  return withTenant(input.organizationId, async (tx) => {
    const section = await tx.section.findFirst({
      where: { id: input.sectionId, courseId: input.courseId },
      select: { id: true },
    });
    if (!section) throw badRequest("Section invalide pour cette formation.");

    const last = await tx.lesson.aggregate({ where: { sectionId: input.sectionId }, _max: { position: true } });
    return tx.lesson.create({
      data: {
        organizationId: input.organizationId,
        courseId: input.courseId,
        sectionId: input.sectionId,
        title: input.title,
        type: input.type ?? LessonType.VIDEO,
        contentMd: input.contentMd ?? null,
        videoUrl: input.videoUrl ?? null,
        videoProvider: input.videoProvider ?? null,
        externalUrl: input.externalUrl ?? null,
        durationSeconds: input.durationSeconds ?? null,
        isPreview: input.isPreview ?? false,
        isPublished: false,
        position: (last._max.position ?? 0) + 1,
      },
      select: { id: true, title: true, position: true, isPublished: true },
    });
  });
}

export async function updateLesson(input: {
  organizationId: string;
  lessonId: string;
  data: Partial<Omit<LessonInput, "organizationId" | "courseId" | "sectionId" | "title">> & {
    title?: string;
    sectionId?: string;
    isPublished?: boolean;
  };
}) {
  return withTenant(input.organizationId, (tx) =>
    tx.lesson.update({
      where: { id: input.lessonId },
      data: {
        ...(input.data.title !== undefined ? { title: input.data.title } : {}),
        ...(input.data.sectionId !== undefined ? { sectionId: input.data.sectionId } : {}),
        ...(input.data.type !== undefined ? { type: input.data.type } : {}),
        ...(input.data.contentMd !== undefined ? { contentMd: input.data.contentMd } : {}),
        ...(input.data.videoUrl !== undefined ? { videoUrl: input.data.videoUrl } : {}),
        ...(input.data.videoProvider !== undefined ? { videoProvider: input.data.videoProvider } : {}),
        ...(input.data.externalUrl !== undefined ? { externalUrl: input.data.externalUrl } : {}),
        ...(input.data.durationSeconds !== undefined ? { durationSeconds: input.data.durationSeconds } : {}),
        ...(input.data.isPreview !== undefined ? { isPreview: input.data.isPreview } : {}),
        ...(input.data.isPublished !== undefined ? { isPublished: input.data.isPublished } : {}),
      },
      select: { id: true, title: true, position: true, isPublished: true, sectionId: true },
    }),
  );
}

export async function deleteLesson(input: { organizationId: string; lessonId: string }) {
  return withTenant(input.organizationId, async (tx) => {
    await tx.lesson.delete({ where: { id: input.lessonId } });
    return { id: input.lessonId };
  });
}

export async function reorderLessons(input: {
  organizationId: string;
  sectionId: string;
  orderedIds: string[];
}) {
  return withTenant(input.organizationId, async (tx) => {
    const lessons = await tx.lesson.findMany({ where: { sectionId: input.sectionId }, select: { id: true } });
    const known = new Set(lessons.map((lesson) => lesson.id));
    const ordered = input.orderedIds.filter((id) => known.has(id));
    if (ordered.length !== lessons.length) {
      throw badRequest("La liste de réordonnancement doit contenir toutes les leçons de la section.");
    }
    await Promise.all(
      ordered.map((id, index) => tx.lesson.update({ where: { id }, data: { position: index + 1 } })),
    );
    return { count: ordered.length };
  });
}

export async function createCategory(input: {
  organizationId: string;
  name: string;
  description?: string | null;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const slug = slugify(input.name) || "categorie";
    const exists = await tx.category.findFirst({ where: { slug }, select: { id: true } });
    if (exists) throw conflict("Une catégorie porte déjà ce nom.");
    const last = await tx.category.aggregate({ where: {}, _max: { position: true } });
    return tx.category.create({
      data: {
        organizationId: input.organizationId,
        slug,
        name: input.name,
        description: input.description ?? null,
        position: (last._max.position ?? 0) + 1,
      },
      select: { id: true, name: true, slug: true },
    });
  });
}

/** Compte les leçons publiées d'une formation (utilisé avant publication). */
export async function countPublishedLessons(organizationId: string, courseId: string): Promise<number> {
  return withTenant(organizationId, (tx) =>
    tx.lesson.count({ where: { courseId, isPublished: true } }),
  );
}

/* -------------------------------------------------------------------------- */
/* Ressources téléchargeables attachées à une leçon                            */
/* -------------------------------------------------------------------------- */

export type LessonResourceInput = {
  organizationId: string;
  lessonId: string;
  assetId: string;
  title: string;
  actorUserId?: string;
};

/**
 * Attache une ressource téléchargeable à une leçon.
 *
 * L'objet et la leçon doivent appartenir à la même organisation : sans ce
 * contrôle, un formateur pourrait référencer le fichier privé d'un autre tenant
 * et le rendre téléchargeable à ses propres apprenants.
 */
export async function createLessonResource(input: LessonResourceInput) {
  return withTenant(input.organizationId, async (tx) => {
    const lesson = await tx.lesson.findFirst({
      where: { id: input.lessonId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!lesson) throw notFound("Leçon introuvable.");

    const asset = await tx.asset.findFirst({
      where: { id: input.assetId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!asset) throw badRequest("Le fichier indiqué n'appartient pas à cette organisation.");

    const last = await tx.lessonResource.aggregate({
      where: { lessonId: input.lessonId },
      _max: { position: true },
    });

    return tx.lessonResource.create({
      data: {
        organizationId: input.organizationId,
        lessonId: input.lessonId,
        assetId: input.assetId,
        title: input.title,
        position: (last._max.position ?? 0) + 1,
      },
      select: { id: true, title: true, assetId: true, position: true },
    });
  });
}

export async function deleteLessonResource(input: {
  organizationId: string;
  resourceId: string;
}): Promise<{ id: string }> {
  return withTenant(input.organizationId, async (tx) => {
    const resource = await tx.lessonResource.findFirst({
      where: { id: input.resourceId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!resource) throw notFound("Ressource introuvable.");
    await tx.lessonResource.delete({ where: { id: resource.id } });
    return { id: resource.id };
  });
}
