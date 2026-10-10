/** Classes virtuelles (Jitsi Meet) : /api/live-sessions/[...path] */

import { liveJoinSchema, liveSessionCreateSchema, liveSessionUpdateSchema, uuidSchema } from "@belloacademy/shared";

import { jsonCreated, jsonOk, parseBody, validate } from "@/lib/http/api";
import { createDispatcher } from "@/lib/http/dispatch";
import { orgScope } from "@/lib/http/tenant";
import {
  decideJoin,
  getLiveSession,
  joinLiveSession,
  leaveLiveSession,
  listCourseLiveSessions,
  listUpcomingSessions,
  scheduleLiveSession,
  updateLiveSession,
} from "@/server/services/live";

export const runtime = "nodejs";

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "live:read");
      const sessions = await listUpcomingSessions(scope.organizationId, scope.userId);
      return jsonOk({ sessions });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "live:create");
      const input = await parseBody(request, liveSessionCreateSchema);
      const scheduledStart = new Date(input.scheduledStart);
      const scheduledEnd = new Date(scheduledStart.getTime() + input.durationMinutes * 60_000);
      const session = await scheduleLiveSession({
        organizationId: scope.organizationId,
        courseId: input.courseId,
        actorUserId: scope.userId,
        title: input.title,
        description: input.description ?? null,
        scheduledStart,
        scheduledEnd,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      });
      return jsonCreated({ session });
    },
  },
  {
    method: "GET",
    pattern: "course/:courseId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "live:read");
      const courseId = validate(uuidSchema, params.courseId);
      const sessions = await listCourseLiveSessions(scope.organizationId, courseId);
      return jsonOk({ sessions });
    },
  },
  {
    method: "GET",
    pattern: ":sessionId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "live:read");
      const sessionId = validate(uuidSchema, params.sessionId);
      const session = await getLiveSession(scope.organizationId, sessionId);
      return jsonOk({ session });
    },
  },
  {
    method: "PATCH",
    pattern: ":sessionId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "live:manage");
      const sessionId = validate(uuidSchema, params.sessionId);
      const input = await parseBody(request, liveSessionUpdateSchema);
      const session = await updateLiveSession({
        organizationId: scope.organizationId,
        sessionId,
        actorUserId: scope.userId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.scheduledStart !== undefined ? { scheduledStart: new Date(input.scheduledStart) } : {}),
        ...(input.scheduledStart !== undefined && input.durationMinutes !== undefined
          ? {
              scheduledEnd: new Date(
                new Date(input.scheduledStart).getTime() + input.durationMinutes * 60_000,
              ),
            }
          : {}),
      });
      return jsonOk({ session });
    },
  },
  {
    method: "POST",
    pattern: ":sessionId/join",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "live:read");
      const sessionId = validate(uuidSchema, params.sessionId);
      const input = await parseBody(request, liveJoinSchema);
      const descriptor = await joinLiveSession({
        organizationId: scope.organizationId,
        sessionId,
        userId: scope.userId,
        displayName: input.displayName ?? scope.context.user.name,
        isOrgStaff: scope.role !== "LEARNER",
      });
      return jsonOk(descriptor);
    },
  },
  {
    method: "POST",
    pattern: ":sessionId/leave",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "live:read");
      const sessionId = validate(uuidSchema, params.sessionId);
      await leaveLiveSession({ organizationId: scope.organizationId, sessionId, userId: scope.userId });
      return jsonOk({ left: true });
    },
  },
  {
    method: "GET",
    pattern: ":sessionId/access",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "live:read");
      const sessionId = validate(uuidSchema, params.sessionId);
      const decision = await decideJoin({
        organizationId: scope.organizationId,
        sessionId,
        userId: scope.userId,
        isOrgStaff: scope.role !== "LEARNER",
      });
      return jsonOk(decision);
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;
export const PATCH = dispatch.PATCH;
