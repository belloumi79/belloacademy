/** Quiz et tentatives : /api/assessments/[...path] */

import {
  attemptFilterSchema,
  quizSchema,
  quizSubmitSchema,
  questionInputSchema,
  uuidSchema,
} from "@belloacademy/shared";

import { jsonCreated, jsonOk, parseBody, searchParams, validate } from "@/lib/http/api";
import { createDispatcher } from "@/lib/http/dispatch";
import { orgScope } from "@/lib/http/tenant";
import { z } from "zod";
import {
  addQuestion,
  createQuiz,
  deleteQuestion,
  getAttemptDetail,
  getQuizForEditing,
  getQuizForLearner,
  gradeAnswerManually,
  listAttemptsForQuiz,
  listMyAttempts,
  startAttempt,
  submitAttempt,
  updateQuiz,
} from "@/server/services/assessments";

export const runtime = "nodejs";

const gradeSchema = z.object({
  pointsAwarded: z.coerce.number().int().min(0).max(1000),
  feedback: z.string().trim().max(2000).nullable().optional(),
});

const dispatch = createDispatcher([
  {
    method: "POST",
    pattern: "quizzes",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "assessment:manage");
      const input = await parseBody(request, quizSchema);
      const quiz = await createQuiz({
        organizationId: scope.organizationId,
        courseId: input.courseId,
        actorUserId: scope.userId,
        title: input.title,
        description: input.description ?? null,
        passingScore: input.passingScore,
        maxAttempts: input.maxAttempts ?? null,
        timeLimitMinutes: input.timeLimitMinutes ?? null,
        shuffleQuestions: input.shuffleQuestions,
        questions: input.questions ?? [],
      });
      return jsonCreated({ quiz });
    },
  },
  {
    method: "GET",
    pattern: "quizzes/:quizId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const quizId = validate(uuidSchema, params.quizId);
      const quiz = await getQuizForEditing(scope.organizationId, quizId);
      return jsonOk({ quiz });
    },
  },
  {
    method: "PATCH",
    pattern: "quizzes/:quizId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:manage");
      const quizId = validate(uuidSchema, params.quizId);
      const input = await parseBody(request, quizSchema.partial());
      const quiz = await updateQuiz({
        organizationId: scope.organizationId,
        quizId,
        actorUserId: scope.userId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts ?? null } : {}),
        ...(input.timeLimitMinutes !== undefined ? { timeLimitMinutes: input.timeLimitMinutes ?? null } : {}),
        ...(input.shuffleQuestions !== undefined ? { shuffleQuestions: input.shuffleQuestions } : {}),
      });
      return jsonOk({ quiz });
    },
  },
  {
    method: "POST",
    pattern: "quizzes/:quizId/questions",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:manage");
      const quizId = validate(uuidSchema, params.quizId);
      const input = await parseBody(request, questionInputSchema);
      const question = await addQuestion({
        organizationId: scope.organizationId,
        quizId,
        actorUserId: scope.userId,
        question: input,
      });
      return jsonCreated({ question });
    },
  },
  {
    method: "DELETE",
    pattern: "questions/:questionId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:manage");
      const questionId = validate(uuidSchema, params.questionId);
      const result = await deleteQuestion({ organizationId: scope.organizationId, questionId });
      return jsonOk(result);
    },
  },
  {
    method: "GET",
    pattern: "quizzes/:quizId/learner",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const quizId = validate(uuidSchema, params.quizId);
      const quiz = await getQuizForLearner({ organizationId: scope.organizationId, quizId, userId: scope.userId });
      return jsonOk({ quiz });
    },
  },
  {
    method: "GET",
    pattern: "quizzes/:quizId/attempts",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:grade");
      const quizId = validate(uuidSchema, params.quizId);
      const attempts = await listAttemptsForQuiz(scope.organizationId, quizId);
      return jsonOk({ attempts });
    },
  },
  {
    method: "POST",
    pattern: "quizzes/:quizId/attempts",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const quizId = validate(uuidSchema, params.quizId);
      const attempt = await startAttempt({ organizationId: scope.organizationId, quizId, userId: scope.userId });
      return jsonCreated({ attempt });
    },
  },
  {
    method: "GET",
    pattern: "attempts",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "assessment:read");
      validate(attemptFilterSchema, Object.fromEntries(searchParams(request)));
      const attempts = await listMyAttempts({ organizationId: scope.organizationId, userId: scope.userId });
      return jsonOk({ attempts });
    },
  },
  {
    method: "GET",
    pattern: "attempts/:attemptId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const attemptId = validate(uuidSchema, params.attemptId);
      const attempt = await getAttemptDetail({
        organizationId: scope.organizationId,
        attemptId,
        viewer: { userId: scope.userId, canReview: scope.role !== "LEARNER" },
      });
      return jsonOk({ attempt });
    },
  },
  {
    method: "POST",
    pattern: "attempts/:attemptId/submit",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const attemptId = validate(uuidSchema, params.attemptId);
      const input = await parseBody(request, quizSubmitSchema);
      const result = await submitAttempt({
        organizationId: scope.organizationId,
        attemptId,
        userId: scope.userId,
        answers: input.answers,
      });
      return jsonOk(result);
    },
  },
  {
    method: "POST",
    pattern: "answers/:answerId/grade",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:grade");
      const answerId = validate(uuidSchema, params.answerId);
      const input = await parseBody(request, gradeSchema);
      const result = await gradeAnswerManually({
        organizationId: scope.organizationId,
        answerId,
        actorUserId: scope.userId,
        pointsAwarded: input.pointsAwarded,
        feedback: input.feedback ?? null,
      });
      return jsonOk(result);
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;
export const PATCH = dispatch.PATCH;
export const DELETE = dispatch.DELETE;
