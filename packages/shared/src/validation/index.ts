/**
 * Schémas de validation (zod) partagés entre l'API et l'interface.
 *
 * Règle : toute entrée externe (corps de requête, paramètres d'URL, fichiers)
 * est validée ici avant d'atteindre la couche métier. Les messages sont en
 * français ; l'interface peut les afficher tels quels.
 */

import { z } from "zod";

import { COURSE_LEVELS, COURSE_STATUSES, LESSON_TYPES } from "../domain/course";
import { ENROLLMENT_STATUSES } from "../domain/learning";
import { ATTEMPT_STATUSES, QUESTION_TYPES } from "../domain/assessment";
import { BILLING_INTERVALS } from "../domain/billing";
import { ORG_ROLES } from "../domain/identity";

export const LOCALES = ["fr", "ar", "en"] as const;
export const localeSchema = z.enum(LOCALES);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const uuidSchema = z.uuid("Identifiant invalide.");

export const emailSchema = z
  .email("Adresse e-mail invalide.")
  .max(254, "Adresse e-mail trop longue.")
  .transform((value) => value.trim().toLowerCase());

/** Mot de passe : 10 caractères minimum, au moins une lettre et un chiffre. */
/**
 * Politique de mot de passe (identique côté service : `checkPasswordPolicy`).
 * Trois catégories de caractères au minimum, pour rester prévisible tout en
 * bloquant les mots de passe triviaux.
 */
export const passwordSchema = z
  .string()
  .min(10, "Le mot de passe doit contenir au moins 10 caractères.")
  .max(200, "Le mot de passe est trop long.")
  .refine(
    (value) => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3,
    "Le mot de passe doit mélanger au moins trois types de caractères (minuscules, majuscules, chiffres, symboles).",
  )
  .refine((value) => !/^(.)\1+$/.test(value), "Le mot de passe ne peut pas être une répétition d'un seul caractère.");

export const nameSchema = z.string().trim().min(2, "Le nom est trop court.").max(120, "Le nom est trop long.");

export const urlSchema = z.url("URL invalide.").max(2048);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema.default("fr"),
  organizationName: z.string().trim().min(2).max(120).optional(),
  organizationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Identifiant d'organisation invalide.")
    .optional(),
  inviteToken: z.string().trim().min(10).max(200).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Le mot de passe est requis.").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(10).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().trim().min(10).max(200) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  locale: localeSchema.optional(),
  imageUrl: urlSchema.nullable().optional(),
});

// -----------------------------------------------------------------------------
// Organisations et membres
// -----------------------------------------------------------------------------

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2, "Le nom de l'organisation est trop court.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Identifiant d'organisation invalide.")
    .optional(),
  legalName: z.string().trim().max(160).optional(),
  billingEmail: emailSchema.optional(),
  country: z.string().trim().length(2).toUpperCase().default("TN"),
  currency: z.string().trim().length(3).toUpperCase().default("TND"),
  timezone: z.string().trim().min(3).max(64).default("Africa/Tunis"),
  locale: localeSchema.default("fr"),
  planCode: z.string().trim().min(2).max(40).default("free"),
});
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(160).nullable().optional(),
  billingEmail: emailSchema.nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  locale: localeSchema.optional(),
  logoUrl: urlSchema.nullable().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB.")
    .nullable()
    .optional(),
  settings: z
    .object({
      allowSelfRegistration: z.boolean().optional(),
      requireEmailVerification: z.boolean().optional(),
      defaultCourseVisibility: z.enum(["ORG", "PUBLIC"]).optional(),
      supportEmail: emailSchema.nullable().optional(),
      certificateIssuer: z.string().trim().max(160).nullable().optional(),
      jitsiDomain: z
        .string()
        .trim()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Domaine Jitsi invalide.")
        .nullable()
        .optional(),
      allowPublicCatalog: z.boolean().optional(),
    })
    .optional(),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

export const memberInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES),
  name: z.string().trim().min(2).max(120).optional(),
});
export type MemberInviteInput = z.infer<typeof memberInviteSchema>;

export const memberUpdateSchema = z.object({
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  locale: localeSchema.optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  avatarUrl: urlSchema.nullable().optional(),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// -----------------------------------------------------------------------------
// Formations
// -----------------------------------------------------------------------------

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/)
    .optional(),
  description: z.string().trim().max(500).optional(),
  position: z.coerce.number().int().min(0).max(9999).default(0),
});

export const courseCreateSchema = z.object({
  title: z.string().trim().min(4, "Le titre est trop court.").max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/, "Identifiant de formation invalide.")
    .optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(20_000).default(""),
  imageUrl: urlSchema.nullable().optional(),
  categoryId: uuidSchema.nullable().optional(),
  level: z.enum(COURSE_LEVELS).default("BEGINNER"),
  language: z.enum(LOCALES).default("fr"),
  objectives: z.array(z.string().trim().min(2).max(300)).max(20).default([]),
  prerequisites: z.array(z.string().trim().min(2).max(300)).max(20).default([]),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("TND"),
  certificateEnabled: z.boolean().default(true),
  certificateMinScore: z.coerce.number().int().min(0).max(100).default(70),
  durationMinutes: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  status: z.enum(COURSE_STATUSES).default("DRAFT"),
});
export type CourseCreateInput = z.infer<typeof courseCreateSchema>;

/**
 * Mise à jour partielle d'une formation.
 *
 * Écrite explicitement, et non dérivée de `courseCreateSchema.partial()` : un
 * schéma partiel conserve les valeurs par défaut de ses champs, si bien qu'une
 * requête ne contenant que `title` renvoyait `description: ""`, `level:
 * "BEGINNER"`, `objectives: []`, `priceCents: 0` et surtout `status: "DRAFT"`.
 * Le service appliquait ces valeurs : corriger un titre repassait une formation
 * publiée en brouillon et effaçait son prix, ses objectifs et ses prérequis.
 * Ici, un champ absent n'est jamais transmis et ne peut donc rien écraser.
 *
 * `slug` et `status` sont volontairement exclus : ils sont gérés par les
 * opérations dédiées (publication, archivage) et non par une mise à jour libre.
 */
export const courseUpdateSchema = z.object({
  title: z.string().trim().min(4, "Le titre est trop court.").max(160).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(20_000).optional(),
  imageUrl: urlSchema.nullable().optional(),
  categoryId: uuidSchema.nullable().optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  language: z.enum(LOCALES).optional(),
  objectives: z.array(z.string().trim().min(2).max(300)).max(20).optional(),
  prerequisites: z.array(z.string().trim().min(2).max(300)).max(20).optional(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  certificateEnabled: z.boolean().optional(),
  certificateMinScore: z.coerce.number().int().min(0).max(100).optional(),
  durationMinutes: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  instructorId: uuidSchema.optional(),
});
export type CourseUpdateInput = z.infer<typeof courseUpdateSchema>;

export const courseFilterSchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  categoryId: uuidSchema.optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  language: z.enum(LOCALES).optional(),
  price: z.enum(["free", "paid"]).optional(),
  status: z.enum(COURSE_STATUSES).optional(),
  sort: z.enum(["recent", "popular", "title"]).default("recent"),
});
export type CourseFilterInput = z.infer<typeof courseFilterSchema>;

export const sectionCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(1000).nullable().optional(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
});

export const sectionUpdateSchema = sectionCreateSchema.partial();

export const lessonCreateSchema = z.object({
  sectionId: uuidSchema,
  title: z.string().trim().min(2).max(200),
  type: z.enum(LESSON_TYPES).default("VIDEO"),
  contentMd: z.string().max(200_000).default(""),
  videoUrl: urlSchema.nullable().optional(),
  durationSeconds: z.coerce.number().int().min(0).max(360_000).default(0),
  isPreview: z.boolean().default(false),
  position: z.coerce.number().int().min(0).max(9999).optional(),
  assetId: uuidSchema.nullable().optional(),
});

/**
 * Mise à jour partielle d'une leçon.
 *
 * Écrite explicitement, et non dérivée de `lessonCreateSchema.partial()` : ce
 * dernier conserve `type: "VIDEO"`, `contentMd: ""`, `durationSeconds: 0` et
 * `isPreview: false` comme valeurs par défaut. Un PATCH ne portant que sur le
 * titre renvoyait donc ces valeurs, et le service écrasait silencieusement le
 * contenu de la leçon. Ici, un champ absent n'est jamais transmis.
 *
 * `isPublished` est indispensable : la publication d'une formation exige au
 * moins une leçon publiée, et aucune autre route ne permet de la publier.
 */
export const lessonUpdateSchema = z.object({
  sectionId: uuidSchema.optional(),
  title: z.string().trim().min(2).max(200).optional(),
  type: z.enum(LESSON_TYPES).optional(),
  contentMd: z.string().max(200_000).optional(),
  videoUrl: urlSchema.nullable().optional(),
  durationSeconds: z.coerce.number().int().min(0).max(360_000).optional(),
  isPreview: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
});

export const lessonResourceSchema = z.object({
  assetId: uuidSchema,
  title: z.string().trim().min(2).max(200),
  position: z.coerce.number().int().min(0).max(9999).default(0),
});

export const reorderSchema = z.object({
  items: z
    .array(z.object({ id: uuidSchema, position: z.coerce.number().int().min(0).max(9999) }))
    .min(1)
    .max(500),
});

// -----------------------------------------------------------------------------
// Inscriptions et progression
// -----------------------------------------------------------------------------

export const enrollmentCreateSchema = z.object({
  courseId: uuidSchema,
  source: z.enum(["SELF", "INVITE", "ADMIN", "PURCHASE", "PLAN"]).default("SELF"),
});
export type EnrollmentCreateInput = z.infer<typeof enrollmentCreateSchema>;

export const enrollmentUpdateSchema = z.object({
  status: z.enum(ENROLLMENT_STATUSES),
});

export const progressUpdateSchema = z.object({
  lessonId: uuidSchema,
  completed: z.boolean().default(true),
  positionSeconds: z.coerce.number().int().min(0).max(360_000).default(0),
});
export type ProgressUpdateInput = z.infer<typeof progressUpdateSchema>;

// -----------------------------------------------------------------------------
// Évaluations
// -----------------------------------------------------------------------------

export const questionInputSchema = z
  .object({
    id: uuidSchema.optional(),
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().trim().min(3, "L'énoncé est trop court.").max(2000),
    explanation: z.string().trim().max(2000).nullable().optional(),
    points: z.coerce.number().int().min(1).max(100).default(1),
    position: z.coerce.number().int().min(0).max(999).default(0),
    acceptedAnswers: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    options: z
      .array(
        z.object({
          id: uuidSchema.optional(),
          label: z.string().trim().min(1).max(500),
          isCorrect: z.boolean().default(false),
          position: z.coerce.number().int().min(0).max(999).default(0),
        }),
      )
      .max(20)
      .default([]),
  })
  .superRefine((question, ctx) => {
    if (question.type === "SHORT_ANSWER") return;
    const correct = question.options.filter((option) => option.isCorrect);
    if (question.options.length < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Au moins deux réponses sont requises." });
      return;
    }
    if (correct.length === 0) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Une réponse correcte est requise." });
    }
    if (question.type === "SINGLE_CHOICE" || question.type === "TRUE_FALSE") {
      if (correct.length !== 1) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Une seule réponse correcte est attendue." });
      }
      if (question.type === "TRUE_FALSE" && question.options.length !== 2) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Vrai/Faux doit proposer exactement deux réponses." });
      }
    }
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const quizSchema = z.object({
  courseId: uuidSchema,
  lessonId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).default(""),
  passingScore: z.coerce.number().int().min(0).max(100).default(60),
  maxAttempts: z.coerce.number().int().min(1).max(50).nullable().optional(),
  timeLimitMinutes: z.coerce.number().int().min(1).max(600).nullable().optional(),
  shuffleQuestions: z.boolean().default(false),
  isPublished: z.boolean().default(false),
  questions: z.array(questionInputSchema).max(200).default([]),
});
export type QuizInput = z.infer<typeof quizSchema>;

export const quizSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: uuidSchema,
        selectedOptionIds: z.array(uuidSchema).max(20).default([]),
        answerText: z.string().max(5000).optional(),
      }),
    )
    .min(1, "Aucune réponse fournie.")
    .max(500),
});
export type QuizSubmitInput = z.infer<typeof quizSubmitSchema>;

export const attemptFilterSchema = paginationSchema.extend({
  status: z.enum(ATTEMPT_STATUSES).optional(),
  quizId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
});

export const assignmentSchema = z.object({
  courseId: uuidSchema,
  lessonId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(3).max(200),
  instructionsMd: z.string().max(20_000).default(""),
  maxScore: z.coerce.number().int().min(1).max(1000).default(100),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  allowLate: z.boolean().default(true),
  isPublished: z.boolean().default(false),
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;

export const submissionSchema = z.object({
  assignmentId: uuidSchema,
  textContent: z.string().max(20_000).default(""),
  assetIds: z.array(uuidSchema).max(10).default([]),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const gradeSubmissionSchema = z.object({
  score: z.coerce.number().int().min(0).max(1000),
  feedback: z.string().max(5000).default(""),
  status: z.enum(["GRADED", "RETURNED"]).default("GRADED"),
});
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;

// -----------------------------------------------------------------------------
// Classes virtuelles (Jitsi Meet)
// -----------------------------------------------------------------------------

export const liveSessionCreateSchema = z
  .object({
    courseId: uuidSchema,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).default(""),
    scheduledStart: z.iso.datetime({ offset: true }),
    durationMinutes: z.coerce.number().int().min(5).max(600).default(60),
    timezone: z.string().trim().min(3).max(64).default("Africa/Tunis"),
    jitsiDomain: z.string().trim().max(120).nullable().optional(),
    hostUserId: uuidSchema.nullable().optional(),
  })
  .refine((value) => new Date(value.scheduledStart).getTime() > Date.now() - 60_000, {
    path: ["scheduledStart"],
    message: "La session doit être planifiée dans le futur.",
  });
export type LiveSessionCreateInput = z.infer<typeof liveSessionCreateSchema>;

export const liveSessionUpdateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  scheduledStart: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(600).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  status: z.enum(["SCHEDULED", "LIVE", "ENDED", "CANCELLED"]).optional(),
  hostUserId: uuidSchema.nullable().optional(),
});
export type LiveSessionUpdateInput = z.infer<typeof liveSessionUpdateSchema>;

export const liveJoinSchema = z.object({
  sessionId: uuidSchema.optional(),
  /** Nom affiché dans la réunion (par défaut : nom du compte). */
  displayName: z.string().trim().min(1).max(80).optional(),
});

// -----------------------------------------------------------------------------
// Facturation
// -----------------------------------------------------------------------------

export const checkoutSchema = z.object({
  planCode: z.string().trim().min(2).max(40),
  interval: z.enum(BILLING_INTERVALS).default("MONTHLY"),
  provider: z.enum(["MOCK", "STRIPE"]).default("MOCK"),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const subscriptionUpdateSchema = z.object({
  planCode: z.string().trim().min(2).max(40).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

// -----------------------------------------------------------------------------
// Fichiers
// -----------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 Mo

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "text/plain",
  "text/csv",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
] as const;

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export const uploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .trim()
    .max(160)
    .refine(
      (value) => (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(value),
      "Type de fichier non autorisé.",
    ),
  sizeBytes: z.coerce.number().int().min(1).max(MAX_UPLOAD_BYTES),
  visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE"),
  organizationId: uuidSchema.optional(),
});
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

export const notificationReadSchema = z.object({
  ids: z.array(uuidSchema).max(200).optional(),
  all: z.boolean().default(false),
});
