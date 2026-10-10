/**
 * Notifications applicatives et notifications par e-mail.
 *
 * Une notification est toujours écrite dans la table `notifications` (lue dans
 * l'interface). L'envoi d'e-mail est délégué à la file de tâches : une panne
 * SMTP ne fait jamais échouer l'action métier qui a déclenché la notification.
 */

import { prisma, type DbClient } from "@/lib/db/prisma";
import { enqueue } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import type { NotificationType } from "@/generated/prisma/enums";

export type NotificationInput = {
  userId: string;
  organizationId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  data?: Record<string, unknown>;
};

/** Crée une notification in-app. */
export async function notify(input: NotificationInput, client: DbClient = prisma): Promise<string> {
  const created = await client.notification.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      data: (input.data ?? {}) as never,
    },
    select: { id: true },
  });
  return created.id;
}

/** Crée plusieurs notifications en une seule requête. */
export async function notifyMany(inputs: NotificationInput[], client: DbClient = prisma): Promise<number> {
  if (inputs.length === 0) return 0;
  const created = await client.notification.createMany({
    data: inputs.map((input) => ({
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      data: (input.data ?? {}) as never,
    })),
  });
  return created.count;
}

export type EmailJobPayload = {
  to: string;
  template: string;
  context: Record<string, unknown>;
  dedupeKey?: string;
};

/** Programme un e-mail transactionnel (traitement asynchrone, idempotent). */
export async function queueEmail(payload: EmailJobPayload): Promise<void> {
  try {
    await enqueue(
      "email.send",
      { to: payload.to, template: payload.template, context: payload.context },
      payload.dedupeKey ? { dedupeKey: payload.dedupeKey } : {},
    );
  } catch (error) {
    logger.error("programmation d'e-mail impossible", { template: payload.template, error });
  }
}

/** Notification + e-mail en une opération. */
export async function notifyWithEmail(
  notification: NotificationInput,
  email: Omit<EmailJobPayload, "to"> & { to: string },
  client: DbClient = prisma,
): Promise<void> {
  await notify(notification, client);
  await queueEmail(email);
}
