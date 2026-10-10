/** Notifications in-app : /api/notifications */

import { notificationReadSchema } from "@belloacademy/shared";

import { requireAuth } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { jsonOk, parseBody, route, searchParams } from "@/lib/http/api";

export const GET = route(async ({ request }) => {
  const context = await requireAuth();
  const params = searchParams(request);
  const unreadOnly = params.get("unread") === "true";
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 30) || 30, 1), 100);

  const notifications = await prisma.notification.findMany({
    where: { userId: context.user.id, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const unreadCount = await prisma.notification.count({
    where: { userId: context.user.id, readAt: null },
  });

  return jsonOk({ notifications, unreadCount });
});

export const POST = route(async ({ request }) => {
  const context = await requireAuth();
  const input = await parseBody(request, notificationReadSchema);
  const now = new Date();

  const result = await prisma.notification.updateMany({
    where: {
      userId: context.user.id,
      readAt: null,
      ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
    },
    data: { readAt: now },
  });

  return jsonOk({ updated: result.count });
});
