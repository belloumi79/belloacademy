/** Formations : statuts, niveaux, types de leçon, sessions live. */

export const COURSE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  DRAFT: "Brouillon",
  PUBLISHED: "Publiée",
  ARCHIVED: "Archivée",
};

export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** Libellés des langues d'enseignement proposées. */
export const COURSE_LANGUAGE_LABELS: Record<string, string> = {
  fr: "Français",
  ar: "العربية",
  en: "English",
};

export const COURSE_LEVEL_LABELS: Record<CourseLevel, string> = {
  BEGINNER: "Débutant",
  INTERMEDIATE: "Intermédiaire",
  ADVANCED: "Avancé",
};

export const LESSON_TYPES = ["VIDEO", "DOCUMENT", "TEXT", "LINK", "FILE", "LIVE"] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  VIDEO: "Vidéo",
  DOCUMENT: "Document",
  TEXT: "Texte",
  LINK: "Lien externe",
  FILE: "Fichier téléchargeable",
  LIVE: "Classe virtuelle",
};

export const LANGUAGE_OPTIONS = [
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
] as const;

export interface CourseProgress {
  completedLessons: number;
  totalLessons: number;
  percent: number;
}

export function computeProgress(completedLessons: number, totalLessons: number): CourseProgress {
  if (totalLessons <= 0) return { completedLessons: 0, totalLessons: 0, percent: 0 };
  const percent = Math.min(100, Math.round((completedLessons / totalLessons) * 100));
  return { completedLessons, totalLessons, percent };
}

/** Un accès à une formation est gratuit si le prix est nul. */
export function isFreeCourse(priceCents: number): boolean {
  return priceCents <= 0;
}
