/**
 * Évaluations : quiz, tentatives, correction automatique et manuelle.
 *
 * Toutes les opérations sont exécutées dans un contexte de tenant (`withTenant`)
 * afin que les politiques RLS garantissent qu'aucune donnée d'une autre
 * organisation ne peut être lue ou modifiée, même en cas d'erreur d'appel.
 */

import { gradeAnswer, summarizeAttempt, toPercent, type QuestionAnswerInput } from "@belloacademy/shared";

import { prisma, withTenant } from "@/lib/db/prisma";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { notify } from "@/lib/notifications";

export type QuizQuestionInput = {
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  prompt: string;
  explanation?: string | null;
  points: number;
  acceptedAnswers?: string[];
  options?: { label: string; isCorrect: boolean }[];
};

export type CreateQuizInput = {
  organizationId: string;
  courseId: string;
  lessonId?: string | null;
  actorUserId: string;
  title: string;
  description?: string | null;
  passingScore?: number;
  maxAttempts?: number | null;
  timeLimitMinutes?: number | null;
  shuffleQuestions?: boolean;
  questions?: QuizQuestionInput[];
};

function validateQuestion(input: QuizQuestionInput): void {
  const needsOptions = input.type === "SINGLE_CHOICE" || input.type === "MULTIPLE_CHOICE";
  if (needsOptions) {
    const options = input.options ?? [];
    if (options.length < 2) {
      throw conflict("Une question à choix doit proposer au moins deux réponses.");
    }
    if (!options.some((option) => option.isCorrect)) {
      throw conflict("Une question à choix doit comporter au moins une bonne réponse.");
    }
    if (input.type === "SINGLE_CHOICE" && options.filter((option) => option.isCorrect).length > 1) {
      throw conflict("Une question à choix unique ne peut avoir qu'une seule bonne réponse.");
    }
  }
  if (input.type === "SHORT_ANSWER" && (input.acceptedAnswers ?? []).length === 0) {
    // Autorisé : la correction sera manuelle (voir `gradeAnswer`).
    logger.warn("question à réponse courte sans réponse acceptée : correction manuelle", {
      prompt: input.prompt.slice(0, 60),
    });
  }
}

export async function createQuiz(input: CreateQuizInput) {
  const questions = input.questions ?? [];
  questions.forEach(validateQuestion);

  return withTenant(input.organizationId, async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true, organizationId: true },
    });
    if (!course || course.organizationId !== input.organizationId) {
      throw notFound("Formation introuvable.");
    }

    const quiz = await tx.quiz.create({
      data: {
        organizationId: input.organizationId,
        courseId: input.courseId,
        lessonId: input.lessonId ?? null,
        title: input.title,
        description: input.description ?? null,
        passingScore: input.passingScore ?? 70,
        maxAttempts: input.maxAttempts ?? null,
        timeLimitMinutes: input.timeLimitMinutes ?? null,
        shuffleQuestions: input.shuffleQuestions ?? false,
        questions: {
          create: questions.map((question, index) => ({
            organizationId: input.organizationId,
            type: question.type,
            prompt: question.prompt,
            explanation: question.explanation ?? null,
            points: question.points,
            position: index,
            acceptedAnswers: question.acceptedAnswers ?? [],
            options: {
              create: (question.options ?? []).map((option, optionIndex) => ({
                organizationId: input.organizationId,
                label: option.label,
                isCorrect: option.isCorrect,
                position: optionIndex,
              })),
            },
          })),
        },
      },
      select: { id: true, title: true },
    });

    await recordAudit(
      {
        action: "assessment.created",
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: "Quiz",
        entityId: quiz.id,
        metadata: { courseId: input.courseId, questions: questions.length },
      },
      tx,
    );

    return quiz;
  });
}

export async function updateQuiz(input: {
  organizationId: string;
  quizId: string;
  actorUserId: string;
  title?: string;
  description?: string | null;
  passingScore?: number;
  maxAttempts?: number | null;
  timeLimitMinutes?: number | null;
  shuffleQuestions?: boolean;
  isPublished?: boolean;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const existing = await tx.quiz.findUnique({ where: { id: input.quizId }, select: { id: true } });
    if (!existing) throw notFound("Quiz introuvable.");

    const quiz = await tx.quiz.update({
      where: { id: input.quizId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.timeLimitMinutes !== undefined ? { timeLimitMinutes: input.timeLimitMinutes } : {}),
        ...(input.shuffleQuestions !== undefined ? { shuffleQuestions: input.shuffleQuestions } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      },
      select: { id: true, title: true, isPublished: true },
    });

    await recordAudit(
      {
        action: "assessment.created",
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: "Quiz",
        entityId: quiz.id,
        metadata: { operation: "update" },
      },
      tx,
    );

    return quiz;
  });
}

export async function addQuestion(input: {
  organizationId: string;
  quizId: string;
  actorUserId: string;
  question: QuizQuestionInput;
}) {
  validateQuestion(input.question);
  return withTenant(input.organizationId, async (tx) => {
    const quiz = await tx.quiz.findUnique({
      where: { id: input.quizId },
      select: { id: true, _count: { select: { questions: true } } },
    });
    if (!quiz) throw notFound("Quiz introuvable.");

    return tx.question.create({
      data: {
        organizationId: input.organizationId,
        quizId: input.quizId,
        type: input.question.type,
        prompt: input.question.prompt,
        explanation: input.question.explanation ?? null,
        points: input.question.points,
        position: quiz._count.questions,
        acceptedAnswers: input.question.acceptedAnswers ?? [],
        options: {
          create: (input.question.options ?? []).map((option, index) => ({
            organizationId: input.organizationId,
            label: option.label,
            isCorrect: option.isCorrect,
            position: index,
          })),
        },
      },
      select: { id: true },
    });
  });
}

export async function deleteQuestion(input: { organizationId: string; questionId: string }) {
  return withTenant(input.organizationId, async (tx) => {
    await tx.question.delete({ where: { id: input.questionId } });
  });
}

/** Quiz complet pour l'édition (bonnes réponses incluses). Réservé au staff. */
export async function getQuizForEditing(organizationId: string, quizId: string) {
  return withTenant(organizationId, async (tx) => {
    const quiz = await tx.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          orderBy: { position: "asc" },
          include: { options: { orderBy: { position: "asc" } } },
        },
        lesson: { select: { id: true, title: true } },
        course: { select: { id: true, title: true, slug: true } },
        _count: { select: { attempts: true } },
      },
    });
    if (!quiz) throw notFound("Quiz introuvable.");
    return quiz;
  });
}

/** Quiz destiné à l'apprenant : aucune bonne réponse n'est exposée. */
export async function getQuizForLearner(input: {
  organizationId: string;
  quizId: string;
  userId: string;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const quiz = await tx.quiz.findUnique({
      where: { id: input.quizId },
      include: {
        questions: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            type: true,
            prompt: true,
            points: true,
            position: true,
            options: { orderBy: { position: "asc" }, select: { id: true, label: true } },
          },
        },
        course: { select: { id: true, slug: true, title: true } },
      },
    });
    if (!quiz || !quiz.isPublished) throw notFound("Quiz introuvable.");

    const attempts = await tx.quizAttempt.findMany({
      where: { quizId: input.quizId, userId: input.userId },
      orderBy: { attemptNumber: "desc" },
      select: {
        id: true,
        attemptNumber: true,
        status: true,
        score: true,
        maxScore: true,
        passed: true,
        startedAt: true,
        submittedAt: true,
      },
    });

    const openAttempt = attempts.find((attempt) => attempt.status === "IN_PROGRESS") ?? null;
    const remaining =
      quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - attempts.length);

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        passingScore: quiz.passingScore,
        maxAttempts: quiz.maxAttempts,
        timeLimitMinutes: quiz.timeLimitMinutes,
        questions: quiz.questions,
        course: quiz.course,
      },
      attempts,
      openAttempt,
      remainingAttempts: remaining,
      canStart: remaining === null || remaining > 0 || Boolean(openAttempt),
    };
  });
}

export async function startAttempt(input: {
  organizationId: string;
  quizId: string;
  userId: string;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const quiz = await tx.quiz.findUnique({
      where: { id: input.quizId },
      select: {
        id: true,
        courseId: true,
        isPublished: true,
        maxAttempts: true,
        timeLimitMinutes: true,
        organizationId: true,
      },
    });
    if (!quiz || !quiz.isPublished) throw notFound("Quiz introuvable.");

    const enrollment = await tx.enrollment.findUnique({
      where: { courseId_userId: { courseId: quiz.courseId, userId: input.userId } },
      select: { id: true, status: true },
    });
    if (!enrollment || enrollment.status === "CANCELLED" || enrollment.status === "EXPIRED") {
      throw forbidden("Vous devez être inscrit à cette formation pour passer le quiz.");
    }

    const open = await tx.quizAttempt.findFirst({
      where: { quizId: input.quizId, userId: input.userId, status: "IN_PROGRESS" },
      select: { id: true, startedAt: true, expiresAt: true },
    });
    if (open) {
      // Une tentative expirée est close avant d'en ouvrir une nouvelle.
      if (open.expiresAt && open.expiresAt.getTime() < Date.now()) {
        await tx.quizAttempt.update({
          where: { id: open.id },
          data: { status: "EXPIRED", submittedAt: new Date() },
        });
      } else {
        return { attemptId: open.id, resumed: true, expiresAt: open.expiresAt };
      }
    }

    if (quiz.maxAttempts !== null) {
      const used = await tx.quizAttempt.count({
        where: { quizId: input.quizId, userId: input.userId, status: { not: "IN_PROGRESS" } },
      });
      if (used >= quiz.maxAttempts) {
        throw conflict("Nombre maximal de tentatives atteint.");
      }
    }

    const attemptNumber =
      (await tx.quizAttempt.count({ where: { quizId: input.quizId, userId: input.userId } })) + 1;
    const expiresAt =
      quiz.timeLimitMinutes === null
        ? null
        : new Date(Date.now() + quiz.timeLimitMinutes * 60 * 1000);

    const attempt = await tx.quizAttempt.create({
      data: {
        quizId: input.quizId,
        organizationId: input.organizationId,
        userId: input.userId,
        enrollmentId: enrollment.id,
        attemptNumber,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        expiresAt,
      },
      select: { id: true, attemptNumber: true, expiresAt: true },
    });

    return { attemptId: attempt.id, resumed: false, attemptNumber: attempt.attemptNumber, expiresAt: attempt.expiresAt };
  });
}

export type SubmittedAnswer = {
  questionId: string;
  selectedOptionIds?: string[];
  answerText?: string | null;
};

export async function submitAttempt(input: {
  organizationId: string;
  attemptId: string;
  userId: string;
  answers: SubmittedAnswer[];
}) {
  const outcome = await withTenant(input.organizationId, async (tx) => {
    const attempt = await tx.quizAttempt.findUnique({
      where: { id: input.attemptId },
      include: {
        quiz: {
          include: {
            course: { select: { id: true, slug: true, title: true, certificateEnabled: true, certificateMinScore: true } },
            questions: {
              orderBy: { position: "asc" },
              include: { options: { orderBy: { position: "asc" } } },
            },
          },
        },
      },
    });
    if (!attempt || attempt.organizationId !== input.organizationId) {
      throw notFound("Tentative introuvable.");
    }
    if (attempt.userId !== input.userId) throw forbidden("Cette tentative ne vous appartient pas.");
    if (attempt.status !== "IN_PROGRESS") throw conflict("Cette tentative est déjà soumise.");

    const expired = attempt.expiresAt !== null && attempt.expiresAt.getTime() < Date.now();
    const answersByQuestion = new Map(input.answers.map((answer) => [answer.questionId, answer]));

    const graded = attempt.quiz.questions.map((question) => {
      const answer: QuestionAnswerInput = answersByQuestion.get(question.id) ?? {};
      const result = gradeAnswer(
        {
          type: question.type,
          points: question.points,
          acceptedAnswers: question.acceptedAnswers,
          correctOptionIds: question.options.filter((option) => option.isCorrect).map((option) => option.id),
        },
        answer,
      );
      return { question, answer, result };
    });

    const maxScore = attempt.quiz.questions.reduce((total, question) => total + question.points, 0);
    const summary = summarizeAttempt(
      graded.map((entry) => entry.result),
      maxScore,
      attempt.quiz.passingScore,
    );

    // Les réponses précédentes (reprise) sont remplacées, jamais dupliquées.
    await tx.quizAnswer.deleteMany({ where: { attemptId: attempt.id } });
    await tx.quizAnswer.createMany({
      data: graded.map((entry) => ({
        organizationId: input.organizationId,
        attemptId: attempt.id,
        questionId: entry.question.id,
        selectedOptionIds: entry.answer.selectedOptionIds ?? [],
        answerText: entry.answer.answerText ?? null,
        isCorrect: entry.result.isCorrect,
        pointsAwarded: entry.result.pointsAwarded,
      })),
    });

    const status = summary.pendingManualGrading ? "SUBMITTED" : "GRADED";
    const updated = await tx.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        score: summary.score,
        maxScore: summary.maxScore,
        passed: summary.pendingManualGrading ? null : summary.passed,
        submittedAt: new Date(),
        gradedAt: summary.pendingManualGrading ? null : new Date(),
      },
      select: { id: true, score: true, maxScore: true, passed: true, status: true, attemptNumber: true },
    });

    await recordAudit(
      {
        action: "assessment.submitted",
        organizationId: input.organizationId,
        actorUserId: input.userId,
        entityType: "QuizAttempt",
        entityId: attempt.id,
        metadata: {
          quizId: attempt.quizId,
          score: summary.score,
          maxScore: summary.maxScore,
          expired,
          pendingManualGrading: summary.pendingManualGrading,
        },
      },
      tx,
    );

    return {
      attempt: updated,
      quizTitle: attempt.quiz.title,
      courseId: attempt.quiz.course.id,
      courseSlug: attempt.quiz.course.slug,
      courseTitle: attempt.quiz.course.title,
      certificateEnabled: attempt.quiz.course.certificateEnabled,
      certificateMinScore: attempt.quiz.course.certificateMinScore,
      expired,
    };
  });

  await notify({
    userId: input.userId,
    organizationId: input.organizationId,
    type: "QUIZ_RESULT",
    title: `Résultat du quiz « ${outcome.quizTitle} »`,
    body:
      outcome.attempt.passed === null
        ? `Score provisoire : ${outcome.attempt.score}/${outcome.attempt.maxScore} — correction en attente.`
        : `${outcome.attempt.score}/${outcome.attempt.maxScore} — ${outcome.attempt.passed ? "réussi" : "non réussi"}.`,
    href: `/courses/${outcome.courseSlug}`,
  });

  if (outcome.attempt.passed && outcome.certificateEnabled) {
    if (outcome.attempt.score >= outcome.certificateMinScore) {
      await enqueue(
        "certificate.issue",
        {
          organizationId: input.organizationId,
          courseId: outcome.courseId,
          userId: input.userId,
          finalScore: outcome.attempt.score,
        },
        { dedupeKey: `certificate:${outcome.courseId}:${input.userId}` },
      );
    }
  }

  return outcome.attempt;
}

/** Correction manuelle d'une réponse (réponse courte sans réponse acceptée). */
export async function gradeAnswerManually(input: {
  organizationId: string;
  answerId: string;
  actorUserId: string;
  pointsAwarded: number;
  feedback?: string | null;
  isCorrect?: boolean;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const answer = await tx.quizAnswer.findUnique({
      where: { id: input.answerId },
      include: { question: { select: { points: true } }, attempt: { select: { id: true, userId: true, quizId: true } } },
    });
    if (!answer) throw notFound("Réponse introuvable.");

    const points = Math.min(Math.max(0, Math.trunc(input.pointsAwarded)), answer.question.points);
    await tx.quizAnswer.update({
      where: { id: input.answerId },
      data: {
        pointsAwarded: points,
        feedback: input.feedback ?? null,
        isCorrect: input.isCorrect ?? points > 0,
      },
    });

    // Recalcule le total de la tentative.
    const answers = await tx.quizAnswer.findMany({
      where: { attemptId: answer.attemptId },
      select: { pointsAwarded: true },
    });
    const quiz = await tx.quiz.findUnique({
      where: { id: answer.attempt.quizId },
      select: { passingScore: true, questions: { select: { points: true } } },
    });
    const rawScore = answers.reduce((total, entry) => total + entry.pointsAwarded, 0);
    const rawMaxScore = (quiz?.questions ?? []).reduce((total, question) => total + question.points, 0);
    // Le seuil est un pourcentage : le score est normalisé sur 100 avant comparaison.
    const score = toPercent(rawScore, rawMaxScore);
    const passed = score >= (quiz?.passingScore ?? 0);

    const attempt = await tx.quizAttempt.update({
      where: { id: answer.attemptId },
      data: { score, maxScore: 100, passed, status: "GRADED", gradedAt: new Date() },
      select: { id: true, userId: true, score: true, maxScore: true, passed: true },
    });

    await recordAudit(
      {
        action: "assessment.graded",
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: "QuizAttempt",
        entityId: attempt.id,
        metadata: { score, maxScore: 100, passed },
      },
      tx,
    );

    return attempt;
  });
}

/** Suivi des tentatives pour un formateur. */
export async function listAttemptsForQuiz(organizationId: string, quizId: string) {
  return withTenant(organizationId, async (tx) =>
    tx.quizAttempt.findMany({
      where: { quizId },
      orderBy: [{ submittedAt: "desc" }, { startedAt: "desc" }],
      select: {
        id: true,
        attemptNumber: true,
        status: true,
        score: true,
        maxScore: true,
        passed: true,
        startedAt: true,
        submittedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  );
}

export async function listMyAttempts(input: { organizationId: string; userId: string }) {
  return withTenant(input.organizationId, async (tx) =>
    tx.quizAttempt.findMany({
      where: { userId: input.userId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        attemptNumber: true,
        status: true,
        score: true,
        maxScore: true,
        passed: true,
        startedAt: true,
        submittedAt: true,
        quiz: { select: { id: true, title: true, course: { select: { slug: true, title: true } } } },
      },
    }),
  );
}

/** Détail d'une tentative : réponses et corrections (le formateur voit tout). */
export async function getAttemptDetail(input: {
  organizationId: string;
  attemptId: string;
  viewer: { userId: string; canReview: boolean };
}) {
  return withTenant(input.organizationId, async (tx) => {
    const attempt = await tx.quizAttempt.findUnique({
      where: { id: input.attemptId },
      include: {
        quiz: { select: { id: true, title: true, passingScore: true } },
        user: { select: { id: true, name: true } },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                prompt: true,
                type: true,
                points: true,
                explanation: true,
                options: { select: { id: true, label: true, isCorrect: true } },
              },
            },
          },
        },
      },
    });
    if (!attempt) throw notFound("Tentative introuvable.");
    if (attempt.userId !== input.viewer.userId && !input.viewer.canReview) {
      throw forbidden("Vous n'avez pas accès à cette tentative.");
    }

    const revealCorrections = input.viewer.canReview || attempt.status === "GRADED";
    return {
      ...attempt,
      answers: attempt.answers.map((answer) => ({
        ...answer,
        question: {
          ...answer.question,
          options: answer.question.options.map((option) => ({
            id: option.id,
            label: option.label,
            ...(revealCorrections ? { isCorrect: option.isCorrect } : {}),
          })),
        },
      })),
    };
  });
}

export async function expireStaleAttempts(organizationId?: string): Promise<number> {
  const client = organizationId ? undefined : prisma;
  if (client) {
    const result = await client.quizAttempt.updateMany({
      where: { status: "IN_PROGRESS", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED", submittedAt: new Date() },
    });
    return result.count;
  }
  return withTenant(organizationId as string, async (tx) => {
    const result = await tx.quizAttempt.updateMany({
      where: { status: "IN_PROGRESS", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED", submittedAt: new Date() },
    });
    return result.count;
  });
}
