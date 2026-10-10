/** Notifications in-app : /api/notifications */

import { notificationReadSchema } from "@belloacademy/shared";

import { requireAuth } from "@/lib/auth/authorization";
import { jsonOk, parseBody, route, searchParams } from "@/lib/http/api";
import { listNotifications, markNotificationsRead } from "@/server/services/notifications";

export const GET = route(async ({ request }) => {
  const context = await requireAuth();
  const params = searchParams(request);
  const unreadOnly = params.get("unread") === "true";
  const rawLimit = Number(params.get("limit") ?? 30) || 30;

  const result = await listNotifications(context.user.id, { unreadOnly, limit: rawLimit });
  return jsonOk(result);
});

export const POST = route(async ({ request }) => {
  const context = await requireAuth();
  const input = await parseBody(request, notificationReadSchema);

  const updated = await markNotificationsRead({
    userId: context.user.id,
    all: input.all,
    ids: input.ids,
  });

  return jsonOk({ updated });
});
