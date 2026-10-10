/** Évaluations : quiz, devoirs, certificats. */

export const QUESTION_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Choix unique",
  MULTIPLE_CHOICE: "Choix multiple",
  TRUE_FALSE: "Vrai / Faux",
  SHORT_ANSWER: "Réponse courte",
};

export const ATTEMPT_STATUSES = ["IN_PROGRESS", "SUBMITTED", "GRADED", "EXPIRED"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  IN_PROGRESS: "En cours",
  SUBMITTED: "Soumise",
  GRADED: "Corrigée",
  EXPIRED: "Expirée",
};

export const SUBMISSION_STATUSES = ["SUBMITTED", "GRADED", "RETURNED"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  SUBMITTED: "Déposé",
  GRADED: "Corrigé",
  RETURNED: "Renvoyé",
};

/** Normalise une réponse courte pour comparaison tolérante. */
export function normalizeShortAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type QuestionGradeInput = {
  type: QuestionType;
  points: number;
  acceptedAnswers?: string[];
  correctOptionIds?: string[];
};

export type QuestionAnswerInput = {
  selectedOptionIds?: string[];
  answerText?: string | null;
};

export type QuestionGradeResult = {
  isCorrect: boolean;
  pointsAwarded: number;
  /** Vrai lorsque la réponse ne peut pas être corrigée automatiquement (devoir manuel). */
  requiresManualGrading: boolean;
};

/**
 * Correction automatique d'une réponse. Les questions à réponse courte sont
 * comparées de façon normalisée (casse, accents et ponctuation ignorés) ; si
 * aucune réponse acceptée n'est déclarée, la correction est renvoyée au formateur.
 */
export function gradeAnswer(question: QuestionGradeInput, answer: QuestionAnswerInput): QuestionGradeResult {
  const points = Math.max(0, Math.trunc(question.points));

  switch (question.type) {
    case "SINGLE_CHOICE":
    case "TRUE_FALSE": {
      const correct = question.correctOptionIds?.[0];
      const given = answer.selectedOptionIds?.[0];
      const isCorrect = Boolean(correct) && given === correct;
      return { isCorrect, pointsAwarded: isCorrect ? points : 0, requiresManualGrading: false };
    }
    case "MULTIPLE_CHOICE": {
      const correct = [...(question.correctOptionIds ?? [])].sort();
      const given = [...(answer.selectedOptionIds ?? [])].sort();
      const isCorrect =
        correct.length > 0 && correct.length === given.length && correct.every((id, index) => id === given[index]);
      return { isCorrect, pointsAwarded: isCorrect ? points : 0, requiresManualGrading: false };
    }
    case "SHORT_ANSWER": {
      const accepted = (question.acceptedAnswers ?? []).map(normalizeShortAnswer).filter(Boolean);
      if (accepted.length === 0) {
        return { isCorrect: false, pointsAwarded: 0, requiresManualGrading: true };
      }
      const given = normalizeShortAnswer(answer.answerText ?? "");
      const isCorrect = given.length > 0 && accepted.includes(given);
      return { isCorrect, pointsAwarded: isCorrect ? points : 0, requiresManualGrading: false };
    }
    default:
      return { isCorrect: false, pointsAwarded: 0, requiresManualGrading: true };
  }
}

/** Résultat global d'une tentative : score, note maximale et réussite. */
export function summarizeAttempt(
  results: QuestionGradeResult[],
  maxScore: number,
  passingScore: number,
): { score: number; maxScore: number; passed: boolean; pendingManualGrading: boolean } {
  const score = results.reduce((total, result) => total + result.pointsAwarded, 0);
  const pendingManualGrading = results.some((result) => result.requiresManualGrading);
  return {
    score,
    maxScore,
    passed: !pendingManualGrading && score >= passingScore,
    pendingManualGrading,
  };
}

export const CERTIFICATE_PREFIX = "BA";
