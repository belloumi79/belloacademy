/** Devoirs et dépôts : /api/assignments/[...path] */

import { assignmentSchema, gradeSubmissionSchema, submissionSchema, uuidSchema } from "@belloacademy/shared";

import { jsonCreated, jsonOk, parseBody, validate } from "@/lib/http/api";
import { createDispatcher } from "@/lib/http/dispatch";
import { orgScope } from "@/lib/http/tenant";
import {
  createAssignment,
  deleteAssignment,
  getAssignmentForLearner,
  gradeSubmission,
  listCourseAssignments,
  listMyAssignments,
  listSubmissions,
  submitAssignment,
  updateAssignment,
} from "@/server/services/assignments";

export const runtime = "nodejs";

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "assessment:read");
      const assignments = await listMyAssignments({ organizationId: scope.organizationId, userId: scope.userId });
      return jsonOk({ assignments });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "assessment:manage");
      const input = await parseBody(request, assignmentSchema);
      const assignment = await createAssignment({
        organizationId: scope.organizationId,
        courseId: input.courseId,
        actorUserId: scope.userId,
        title: input.title,
        instructionsMd: input.instructionsMd,
        maxScore: input.maxScore,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        allowLate: input.allowLate,
        isPublished: input.isPublished,
        ...(input.lessonId ? { lessonId: input.lessonId } : {}),
      });
      return jsonCreated({ assignment });
    },
  },
  {
    method: "GET",
    pattern: "course/:courseId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:manage");
      const courseId = validate(uuidSchema, params.courseId);
      const assignments = await listCourseAssignments(scope.organizationId, courseId);
      return jsonOk({ assignments });
    },
  },
  {
    method: "GET",
    pattern: ":assignmentId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const assignmentId = validate(uuidSchema, params.assignmentId);
      const assignment = await getAssignmentForLearner({
        organizationId: scope.organizationId,
        assignmentId,
        userId: scope.userId,
      });
      return jsonOk({ assignment });
    },
  },
  {
    method: "PATCH",
    pattern: ":assignmentId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:manage");
      const assignmentId = validate(uuidSchema, params.assignmentId);
      const input = await parseBody(request, assignmentSchema.partial());
      const { dueAt, ...rest } = input;
      const patch: Partial<{
        title: string;
        instructionsMd: string;
        maxScore: number;
        dueAt: Date | null;
        allowLate: boolean;
        isPublished: boolean;
      }> = { ...rest };
      if (dueAt !== undefined) patch.dueAt = dueAt ? new Date(dueAt) : null;
      const assignment = await updateAssignment({
        organizationId: scope.organizationId,
        assignmentId,
        actorUserId: scope.userId,
        patch,
      });
      return jsonOk({ assignment });
    },
  },
  {
    method: "DELETE",
    pattern: ":assignmentId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:manage");
      const assignmentId = validate(uuidSchema, params.assignmentId);
      const result = await deleteAssignment({ organizationId: scope.organizationId, assignmentId, actorUserId: scope.userId });
      return jsonOk(result);
    },
  },
  {
    method: "GET",
    pattern: ":assignmentId/submissions",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:grade");
      const assignmentId = validate(uuidSchema, params.assignmentId);
      const submissions = await listSubmissions(scope.organizationId, assignmentId);
      return jsonOk({ submissions });
    },
  },
  {
    method: "POST",
    pattern: ":assignmentId/submissions",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:read");
      const assignmentId = validate(uuidSchema, params.assignmentId);
      const input = await parseBody(request, submissionSchema);
      const submission = await submitAssignment({
        organizationId: scope.organizationId,
        assignmentId,
        userId: scope.userId,
        textContent: input.textContent ?? null,
        assetIds: input.assetIds ?? [],
      });
      return jsonCreated({ submission });
    },
  },
  {
    method: "POST",
    pattern: "submissions/:submissionId/grade",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "assessment:grade");
      const submissionId = validate(uuidSchema, params.submissionId);
      const input = await parseBody(request, gradeSubmissionSchema);
      const result = await gradeSubmission({
        organizationId: scope.organizationId,
        submissionId,
        graderUserId: scope.userId,
        score: input.score,
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
