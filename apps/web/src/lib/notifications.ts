/**
 * Notifications applicatives et notifications par e-mail.
 *
 * Une notification est toujours écrite dans la table `notifications` (lue dans
 * l'interface). L'envoi d'e-mail est délégué à la file de tâches : une panne
 * SMTP ne fait jamais échouer l'action métier qui a déclenché la notification.
 */

import { prisma, withTenant, type DbClient } from "@/lib/db/prisma";
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

/**
 * Exécute `fn` dans le bon contexte de tenant.
 *
 * La table `notifications` est protégée par RLS : écrire une notification
 * rattachée à une organisation exige que `app.organization_id` soit positionné.
 * Un client explicite (transaction déjà ouverte par un service) porte déjà ce
 * contexte ; sinon on ouvre une transaction dédiée.
 */
async function inTenantContext<T>(
  organizationId: string | null | undefined,
  client: DbClient | undefined,
  fn: (db: DbClient) => Promise<T>,
): Promise<T> {
  if (client) return fn(client);
  if (organizationId) return withTenant(organizationId, (tx) => fn(tx));
  return fn(prisma);
}

/** Crée une notification in-app. */
export async function notify(input: NotificationInput, client?: DbClient): Promise<string> {
  return inTenantContext(input.organizationId, client, async (db) => {
    const created = await db.notification.create({
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
  });
}

/**
 * Crée plusieurs notifications en une seule requête par organisation.
 *
 * Le regroupement par organisation est nécessaire : une requête ne peut écrire
 * que dans le tenant courant sous RLS.
 */
export async function notifyMany(inputs: NotificationInput[], client?: DbClient): Promise<number> {
  if (inputs.length === 0) return 0;

  const groups = new Map<string, NotificationInput[]>();
  for (const input of inputs) {
    const key = input.organizationId ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(input);
    else groups.set(key, [input]);
  }

  let total = 0;
  for (const [organizationId, group] of groups) {
    const created = await inTenantContext(organizationId || null, client, async (db) =>
      db.notification.createMany({
        data: group.map((input) => ({
          userId: input.userId,
          organizationId: input.organizationId ?? null,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          href: input.href ?? null,
          data: (input.data ?? {}) as never,
        })),
      }),
    );
    total += created.count;
  }
  return total;
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
  client?: DbClient,
): Promise<void> {
  await notify(notification, client);
  await queueEmail(email);
}
