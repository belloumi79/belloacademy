/**
 * Notifications in-app.
 *
 * La liste et le marquage « lu » sont exposés par l'API mais aussi lus
 * directement par les pages serveur : les regrouper ici évite de dupliquer la
 * règle de limite et garantit que les deux chemins voient la même donnée.
 */

import { prisma } from "@/lib/db/prisma";

export const NOTIFICATION_PAGE_SIZE = 30;
export const NOTIFICATION_MAX_PAGE_SIZE = 100;

export type NotificationListOptions = {
  unreadOnly?: boolean;
  limit?: number;
};

export async function listNotifications(userId: string, options: NotificationListOptions = {}) {
  const limit = Math.min(
    Math.max(options.limit ?? NOTIFICATION_PAGE_SIZE, 1),
    NOTIFICATION_MAX_PAGE_SIZE,
  );

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    countUnreadNotifications(userId),
  ]);

  return { notifications, unreadCount };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Marque comme lues soit toutes les notifications, soit une sélection d'ids. */
export async function markNotificationsRead(input: {
  userId: string;
  all?: boolean;
  ids?: string[];
}): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      userId: input.userId,
      readAt: null,
      ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
