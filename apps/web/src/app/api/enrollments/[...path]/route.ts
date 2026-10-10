/** Inscriptions et progression : /api/enrollments/[...path] */

import { enrollmentCreateSchema, progressUpdateSchema, uuidSchema } from "@belloacademy/shared";

import { jsonCreated, jsonOk, parseBody, searchParams, validate } from "@/lib/http/api";
import { createDispatcher } from "@/lib/http/dispatch";
import { orgScope } from "@/lib/http/tenant";
import { z } from "zod";
import {
  cancelEnrollment,
  enrollWithPlanCheck,
  getEnrollment,
  getProgressView,
  listCourseEnrollments,
  listEnrollments,
  markLessonProgress,
  nextLesson,
} from "@/server/services/enrollments";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "enrollment:read");
      const enrollments = await listEnrollments(scope.organizationId, scope.userId);
      return jsonOk({ enrollments });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "enrollment:create");
      const input = await parseBody(request, enrollmentCreateSchema);
      const enrollment = await enrollWithPlanCheck({
        organizationId: scope.organizationId,
        courseId: input.courseId,
        userId: scope.userId,
        source: input.source.toLowerCase(),
        bypassPayment: false,
      });
      return jsonCreated({ enrollment });
    },
  },
  {
    method: "GET",
    pattern: ":enrollmentId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:read");
      const enrollmentId = validate(uuidSchema, params.enrollmentId);
      const [progress, next] = await Promise.all([
        getProgressView(scope.organizationId, enrollmentId),
        nextLesson(scope.organizationId, enrollmentId),
      ]);
      return jsonOk({ progress, nextLesson: next });
    },
  },
  {
    method: "PATCH",
    pattern: ":enrollmentId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:create");
      const enrollmentId = validate(uuidSchema, params.enrollmentId);
      const input = await parseBody(request, progressUpdateSchema);
      const result = await markLessonProgress({
        organizationId: scope.organizationId,
        enrollmentId,
        lessonId: input.lessonId,
        userId: scope.userId,
        ...(input.positionSeconds !== undefined ? { positionSeconds: input.positionSeconds } : {}),
        ...(input.completed !== undefined ? { completed: input.completed } : {}),
      });
      return jsonOk(result);
    },
  },
  {
    method: "DELETE",
    pattern: ":enrollmentId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:create");
      const enrollmentId = validate(uuidSchema, params.enrollmentId);
      const result = await cancelEnrollment(scope.organizationId, enrollmentId);
      return jsonOk(result);
    },
  },
  {
    method: "GET",
    pattern: "course/:courseId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:manage");
      const courseId = validate(uuidSchema, params.courseId);
      const query = validate(listQuerySchema, Object.fromEntries(searchParams(request)));
      const result = await listCourseEnrollments(scope.organizationId, courseId, query);
      return jsonOk(result);
    },
  },
  {
    method: "GET",
    pattern: "course/:courseId/mine",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:read");
      const courseId = validate(uuidSchema, params.courseId);
      const enrollment = await getEnrollment(scope.organizationId, courseId, scope.userId);
      return jsonOk({ enrollment });
    },
  },
  {
    method: "PATCH",
    pattern: "course/:courseId/mine",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:read");
      const courseId = validate(uuidSchema, params.courseId);
      const enrollment = await getEnrollment(scope.organizationId, courseId, scope.userId);
      return jsonOk({ enrollment });
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;
export const PATCH = dispatch.PATCH;
export const DELETE = dispatch.DELETE;
