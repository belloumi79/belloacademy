/** Inscriptions et progression d'apprentissage. */

export const ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  ACTIVE: "En cours",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
};

export const ENROLLMENT_SOURCES = ["SELF", "INVITE", "ADMIN", "PURCHASE", "PLAN"] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

/** Règle d'accès à une formation. */
export const COURSE_ACCESS_MODES = ["OPEN", "ENROLLMENT_REQUIRED"] as const;
export type CourseAccessMode = (typeof COURSE_ACCESS_MODES)[number];

/**
 * Progression en pourcentage (arrondi), bornée à [0, 100].
 * Une formation sans leçon est considérée comme non commencée.
 */
export function computeProgressPercent(completedLessons: number, totalLessons: number): number {
  if (totalLessons <= 0) return 0;
  const ratio = completedLessons / totalLessons;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export type EnrollmentSummary = {
  id: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  courseImageUrl: string | null;
  status: EnrollmentStatus;
  progressPercent: number;
  enrolledAt: string;
  completedAt: string | null;
  lastAccessedAt: string | null;
};

export function isEnrollmentActive(status: EnrollmentStatus): boolean {
  return status === "ACTIVE" || status === "COMPLETED";
}
