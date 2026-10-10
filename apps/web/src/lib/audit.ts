/**
 * Journal d'audit des opérations sensibles.
 *
 * Le journal est immuable (aucune mise à jour/suppression applicative) et ne
 * contient jamais de secret, mot de passe ou jeton : `redact()` est appliqué par
 * le logger, et seules des métadonnées explicites sont enregistrées ici.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma, prismaPlatform, type DbClient } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export const AUDIT_ACTIONS = [
  "user.registered",
  "user.email_verified",
  "user.password_reset_requested",
  "user.password_reset_completed",
  "user.password_changed",
  "user.login_succeeded",
  "user.login_failed",
  "user.logout",
  "user.suspended",
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "membership.invited",
  "membership.invite_accepted",
  "membership.role_changed",
  "membership.removed",
  "course.created",
  "course.updated",
  "course.published",
  "course.archived",
  "course.deleted",
  "enrollment.created",
  "enrollment.completed",
  "assessment.created",
  "assessment.submitted",
  "assessment.graded",
  "assignment.submitted",
  "assignment.graded",
  "certificate.issued",
  "certificate.revoked",
  "live_session.created",
  "live_session.updated",
  "live_session.cancelled",
  "live_session.joined",
  "billing.subscription_changed",
  "billing.payment_succeeded",
  "billing.payment_failed",
  "billing.webhook_received",
  "file.uploaded",
  "file.downloaded",
  "plan_limit_reached",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditInput = {
  action: AuditAction;
  organizationId?: string | null;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Écrit une entrée d'audit. Ne lève jamais d'exception : un échec de
 * journalisation ne doit pas interrompre l'opération métier.
 */
export async function recordAudit(input: AuditInput, client: DbClient = prisma): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        action: input.action,
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.warn("Échec de l'écriture du journal d'audit", { action: input.action, error });
  }
}

export type AuditListFilters = {
  organizationId?: string | null;
  action?: AuditAction;
  actorUserId?: string;
  entityId?: string;
  limit?: number;
};

/** Liste paginée du journal (réservée aux administrateurs). */
export async function listAuditLogs(filters: AuditListFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return prismaPlatform.auditLog.findMany({
    where: {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
