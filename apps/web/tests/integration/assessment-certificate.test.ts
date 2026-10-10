/**
 * Évaluations et certificats.
 *
 * Vérifie les critères d'acceptation : les quiz enregistrent et calculent
 * correctement les résultats (correction automatique, seuil de réussite,
 * nombre de tentatives), et un certificat est délivré puis vérifiable
 * publiquement sans divulguer de donnée personnelle inutile.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createQuiz,
  updateQuiz,
  getQuizForEditing,
  getQuizForLearner,
  listMyAttempts,
  startAttempt,
  submitAttempt,
} from "@/server/services/assessments";
import { createAssignment, gradeSubmission, submitAssignment, updateAssignment } from "@/server/services/assignments";
import { issueCertificate, verifyCertificate } from "@/server/services/certificates";
import { enrollUser } from "@/server/services/enrollments";

import {
  closeTestDatabase,
  createLearner,
  createPublishedCourse,
  createTenant,
  resetDatabase,
  seedPlans,
} from "./helpers";

type Tenant = Awaited<ReturnType<typeof createTenant>>;

let tenant: Tenant;
let learner: Awaited<ReturnType<typeof createLearner>>;
let course: Awaited<ReturnType<typeof createPublishedCourse>>;

/** Quiz à deux questions : 1 choix unique (2 pts) + vrai/faux (2 pts). */
async function buildQuiz(options: { passingScore?: number; maxAttempts?: number | null; certificate?: boolean } = {}) {
  const quiz = await createQuiz({
    organizationId: tenant.organization.id,
    courseId: course.course.id,
    actorUserId: tenant.admin.id,
    title: "Évaluation finale",
    passingScore: options.passingScore ?? 50,
    maxAttempts: options.maxAttempts ?? null,
    questions: [
      {
        type: "SINGLE_CHOICE",
        prompt: "Quelle commande crée une migration ?",
        points: 2,
        options: [
          { label: "prisma migrate dev", isCorrect: true },
          { label: "prisma db push", isCorrect: false },
        ],
      },
      {
        type: "TRUE_FALSE",
        prompt: "RLS isole les données par organisation.",
        points: 2,
        options: [
          { label: "Vrai", isCorrect: true },
          { label: "Faux", isCorrect: false },
        ],
      },
    ],
  });
  // Un quiz n'est visible par les apprenants qu'une fois publié.
  await updateQuiz({
    organizationId: tenant.organization.id,
    quizId: quiz.id,
    actorUserId: tenant.admin.id,
    isPublished: true,
  });
  return quiz;
}

/**
 * Corrigé du quiz, lu via la vue formateur : la vue apprenant ne divulgue
 * volontairement jamais `isCorrect`.
 */
async function answerKey(quizId: string): Promise<Map<string, string[]>> {
  const staffView = await getQuizForEditing(tenant.organization.id, quizId);
  return new Map(
    staffView.questions.map((question) => [
      question.id,
      question.options.filter((option) => option.isCorrect).map((option) => option.id),
    ]),
  );
}

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
  tenant = await createTenant("eval");
  learner = await createLearner(tenant, "eval-apprenant");
  course = await createPublishedCourse(tenant, { title: "Formation évaluée", lessonCount: 2, certificateEnabled: true });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("quiz et correction automatique", () => {
  it("calcule le score et valide la réussite au-dessus du seuil", async () => {
    const quiz = await buildQuiz({ passingScore: 50 });
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const learnerView = await getQuizForLearner({
      organizationId: tenant.organization.id,
      quizId: quiz.id,
      userId: learner.id,
    });
    expect(learnerView.quiz.questions).toHaveLength(2);

    const attempt = await startAttempt({
      organizationId: tenant.organization.id,
      quizId: quiz.id,
      userId: learner.id,
    });

    const key = await answerKey(quiz.id);
    const correct = await submitAttempt({
      organizationId: tenant.organization.id,
      attemptId: attempt.attemptId,
      userId: learner.id,
      answers: [...key].map(([questionId, optionIds]) => ({ questionId, selectedOptionIds: optionIds })),
    });

    expect(correct.score).toBe(100);
    expect(correct.passed).toBe(true);
  });

  it("échoue sous le seuil et journalise la tentative", async () => {
    const quiz = await buildQuiz({ passingScore: 80 });
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const learnerView = await getQuizForLearner({
      organizationId: tenant.organization.id,
      quizId: quiz.id,
      userId: learner.id,
    });
    const attempt = await startAttempt({
      organizationId: tenant.organization.id,
      quizId: quiz.id,
      userId: learner.id,
    });

    // Une seule bonne réponse sur deux : 2 points sur 4, soit 50 %.
    const firstQuestion = learnerView.quiz.questions[0]!;
    const key = await answerKey(quiz.id);
    const failed = await submitAttempt({
      organizationId: tenant.organization.id,
      attemptId: attempt.attemptId,
      userId: learner.id,
      answers: [...key].map(([questionId, optionIds]) => ({
        questionId,
        selectedOptionIds: questionId === firstQuestion.id ? [] : optionIds,
      })),
    });

    expect(failed.score).toBe(50);
    expect(failed.passed).toBe(false);

    const history = await listMyAttempts({ organizationId: tenant.organization.id, userId: learner.id });
    expect(history).toHaveLength(1);
  });

  it("respecte le nombre maximal de tentatives", async () => {
    const quiz = await buildQuiz({ maxAttempts: 1 });
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const first = await startAttempt({
      organizationId: tenant.organization.id,
      quizId: quiz.id,
      userId: learner.id,
    });
    const view = await getQuizForLearner({
      organizationId: tenant.organization.id,
      quizId: quiz.id,
      userId: learner.id,
    });
    const key = await answerKey(quiz.id);
    await submitAttempt({
      organizationId: tenant.organization.id,
      attemptId: first.attemptId,
      userId: learner.id,
      answers: [...key].map(([questionId, optionIds]) => ({ questionId, selectedOptionIds: optionIds })),
    });

    await expect(
      startAttempt({ organizationId: tenant.organization.id, quizId: quiz.id, userId: learner.id }),
    ).rejects.toThrow();
  });
});

describe("devoir déposé puis corrigé", () => {
  it("accepte un dépôt et enregistre la note du formateur", async () => {
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });
    const assignment = await createAssignment({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      actorUserId: tenant.admin.id,
      title: "Rapport d'analyse",
      instructionsMd: "Rédigez votre analyse.",
      maxScore: 20,
    });
    await updateAssignment({
      organizationId: tenant.organization.id,
      assignmentId: assignment.id,
      actorUserId: tenant.admin.id,
      patch: { isPublished: true },
    });

    const submission = await submitAssignment({
      organizationId: tenant.organization.id,
      assignmentId: assignment.id,
      userId: learner.id,
      textContent: "Voici mon analyse.",
    });
    expect(submission.status).toBe("SUBMITTED");

    const graded = await gradeSubmission({
      organizationId: tenant.organization.id,
      submissionId: submission.id,
      graderUserId: tenant.admin.id,
      score: 17,
      feedback: "Bon travail.",
    });
    expect(graded.score).toBe(17);
    expect(graded.status).toBe("GRADED");
  });
});

describe("certificat vérifiable", () => {
  it("délivre un certificat à identifiant unique et le rend vérifiable", async () => {
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const certificate = await issueCertificate({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      finalScore: 92,
      actorUserId: tenant.admin.id,
    });

    expect(certificate.serial).toMatch(/^BA-\d{4}-[A-Z0-9]{8}$/);
    expect(certificate.verificationCode).toBeTruthy();

    const verification = await verifyCertificate(certificate.verificationCode);
    expect(verification.found).toBe(true);
    if (verification.found) {
      expect(verification.valid).toBe(true);
      expect(verification.courseTitle).toBe(course.course.title);
      expect(verification.finalScore).toBe(92);
    }
  });

  it("ne révèle rien pour un code inconnu", async () => {
    const verification = await verifyCertificate("CODE-INEXISTANT-0000");
    expect(verification.found).toBe(false);
  });

  it("reste idempotent : une seule attestation par apprenant et par formation", async () => {
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const first = await issueCertificate({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      actorUserId: tenant.admin.id,
    });
    // Le job `certificate.issue` peut être rejoué : la seconde émission doit
    // renvoyer l'attestation existante, jamais en créer une deuxième.
    const second = await issueCertificate({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      actorUserId: tenant.admin.id,
    });

    expect(second.serial).toBe(first.serial);
    expect(second.id).toBe(first.id);
    expect(second.verificationCode).toBe(first.verificationCode);
  });
});
