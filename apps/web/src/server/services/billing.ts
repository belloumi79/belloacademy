/**
 * Abonnements, factures et prestataires de paiement.
 *
 * Séparation stricte des responsabilités :
 *  - la logique métier (forfaits, périodes, limites, factures) vit ici ;
 *  - l'intégration d'un prestataire se limite à la vérification de signature et
 *    à la traduction d'un événement en opération métier (`applyWebhookEvent`).
 *
 * Aucun paiement réel n'est jamais simulé : le prestataire `MOCK` est un **mode
 * de test explicite**, refusé en production, et une facture n'est marquée payée
 * que par `confirmMockPayment()` (appel explicite) ou par un webhook vérifié.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { DEFAULT_PLANS, addInterval, type BillingInterval } from "@belloacademy/shared";

import { env } from "@/env";
import { prismaPlatform, withTenant } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit";
import { badRequest, conflict, forbidden, internal, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { notifyWithEmail } from "@/lib/notifications";
import { assertWithinPlan } from "@/server/services/organizations";

export type PaymentProvider = "MOCK" | "STRIPE" | "MANUAL";

/** Catalogue des forfaits publiés (table `plans`, alimentée par le seed). */
export async function listPublicPlans() {
  const plans = await prismaPlatform.plan.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: { sortOrder: "asc" },
  });
  if (plans.length > 0) return plans;
  // Repli : le référentiel partagé sert de catalogue tant que le seed n'a pas tourné.
  return DEFAULT_PLANS.map((plan) => ({
    id: plan.code,
    code: plan.code,
    name: plan.name,
    description: plan.description ?? null,
    priceMonthlyCents: plan.priceMonthlyCents,
    priceYearlyCents: plan.priceYearlyCents,
    currency: plan.currency,
    trialDays: plan.trialDays,
    isActive: true,
    isPublic: true,
    sortOrder: plan.sortOrder,
    features: plan.features,
    limits: plan.limits,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));
}

export async function getPlanByCode(code: string) {
  return prismaPlatform.plan.findUnique({ where: { code } });
}

/** Abonnement courant d'une organisation (le plus récent non terminé). */
export async function getSubscription(organizationId: string) {
  return prismaPlatform.subscription.findFirst({
    where: { organizationId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "INCOMPLETE"] } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

export async function listInvoices(organizationId: string, limit = 50) {
  return prismaPlatform.invoice.findMany({
    where: { organizationId },
    orderBy: { issuedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function getInvoice(organizationId: string, invoiceId: string) {
  const invoice = await prismaPlatform.invoice.findFirst({ where: { id: invoiceId, organizationId } });
  if (!invoice) throw notFound("Facture introuvable.");
  return invoice;
}

function providerFromEnv(): PaymentProvider {
  return env().BILLING_PROVIDER === "stripe" ? "STRIPE" : "MOCK";
}

function assertMockAllowed(): void {
  const current = env();
  if (current.BILLING_PROVIDER !== "mock") {
    throw badRequest("Le mode de paiement de test est désactivé (BILLING_PROVIDER ≠ mock).");
  }
  if (current.NODE_ENV === "production") {
    throw forbidden("Le mode de paiement de test est interdit en production.");
  }
}

function nextInvoiceNumber(sequence: number, now: Date = new Date()): string {
  return `BA-${now.getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}

async function allocateInvoiceNumber(now: Date = new Date()): Promise<string> {
  const count = await prismaPlatform.invoice.count({
    where: { issuedAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) } },
  });
  return nextInvoiceNumber(count + 1, now);
}

export type StartSubscriptionInput = {
  organizationId: string;
  planCode: string;
  interval: BillingInterval;
  actorUserId: string;
  /** Démarre un essai gratuit si le forfait en prévoit un et qu'aucun essai n'a eu lieu. */
  startTrial?: boolean;
};

export type SubscriptionChangeResult = {
  subscriptionId: string;
  status: string;
  provider: PaymentProvider;
  requiresPayment: boolean;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
  trialEndsAt: Date | null;
};

/**
 * Souscrit (ou change de) forfait.
 *
 * En mode `MOCK`, la souscription crée une facture `OPEN` : elle n'est jamais
 * marquée payée automatiquement. L'appelant de test doit confirmer explicitement
 * via `confirmMockPayment()`.
 */
export async function startSubscription(input: StartSubscriptionInput): Promise<SubscriptionChangeResult> {
  const plan = await getPlanByCode(input.planCode);
  if (!plan || !plan.isActive) throw notFound("Forfait introuvable ou inactif.");

  const current = await getSubscription(input.organizationId);
  if (current?.planId === plan.id && current.interval === input.interval && current.status !== "INCOMPLETE") {
    throw conflict("Cette organisation est déjà abonnée à ce forfait pour cet intervalle.");
  }

  const provider = providerFromEnv();
  const now = new Date();
  const interval: BillingInterval = input.interval;
  const periodEnd = addInterval(now, interval);
  const amountCents = interval === "YEARLY" ? plan.priceYearlyCents : plan.priceMonthlyCents;

  const existingTrials = await prismaPlatform.subscription.count({
    where: { organizationId: input.organizationId, trialEndsAt: { not: null } },
  });
  const wantsTrial = Boolean(input.startTrial) && plan.trialDays > 0 && existingTrials === 0;
  const trialEndsAt = wantsTrial ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000) : null;

  const status = wantsTrial ? "TRIALING" : provider === "MOCK" ? "INCOMPLETE" : "INCOMPLETE";
  const requiresPayment = amountCents > 0 && !wantsTrial;

  const result = await prismaPlatform.$transaction(async (tx) => {
    if (current && current.status !== "CANCELED" && current.status !== "EXPIRED") {
      await tx.subscription.update({
        where: { id: current.id },
        data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false },
      });
    }

    const subscription = await tx.subscription.create({
      data: {
        organizationId: input.organizationId,
        planId: plan.id,
        provider,
        status,
        interval,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt,
      },
    });

    let invoiceId: string | null = null;
    if (requiresPayment) {
      const invoice = await tx.invoice.create({
        data: {
          organizationId: input.organizationId,
          subscriptionId: subscription.id,
          number: await allocateInvoiceNumber(now),
          provider,
          status: "OPEN",
          amountCents,
          taxCents: 0,
          currency: plan.currency,
          description: `Abonnement ${plan.name} (${interval === "YEARLY" ? "annuel" : "mensuel"})`,
          lines: [
            {
              label: plan.name,
              quantity: 1,
              unitAmountCents: amountCents,
              totalCents: amountCents,
            },
          ] as never,
          periodStart: now,
          periodEnd,
          issuedAt: now,
          dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      invoiceId = invoice.id;
    }

    await tx.organization.update({
      where: { id: input.organizationId },
      data: { planId: plan.id, trialEndsAt },
    });

    return { subscriptionId: subscription.id, invoiceId };
  });

  await recordAudit({
    action: "billing.subscription_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Subscription",
    entityId: result.subscriptionId,
    metadata: { planCode: plan.code, interval, status, requiresPayment },
  });

  return {
    subscriptionId: result.subscriptionId,
    status,
    provider,
    requiresPayment,
    invoiceId: result.invoiceId,
    amountCents,
    currency: plan.currency,
    trialEndsAt,
  };
}

/**
 * Mode de test explicite : confirme le règlement d'une facture `MOCK`.
 * Refusé si `BILLING_PROVIDER` n'est pas `mock` ou en production.
 */
export async function confirmMockPayment(input: {
  organizationId: string;
  invoiceId: string;
  actorUserId: string;
}): Promise<void> {
  assertMockAllowed();

  const invoice = await getInvoice(input.organizationId, input.invoiceId);
  if (invoice.status === "PAID") return;
  if (invoice.status === "VOID") throw conflict("Cette facture a été annulée.");
  if (invoice.provider !== "MOCK") throw badRequest("Cette facture n'est pas émise par le mode de test.");

  await prismaPlatform.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt: new Date(), paidByUserId: input.actorUserId },
    });
    if (invoice.subscriptionId) {
      const subscription = await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } });
      if (subscription) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: addInterval(new Date(), subscription.interval as BillingInterval) },
        });
      }
    }
  });

  await recordAudit({
    action: "billing.payment_succeeded",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { mode: "mock", amountCents: invoice.amountCents },
  });
}

export async function cancelSubscription(input: {
  organizationId: string;
  actorUserId: string;
  atPeriodEnd: boolean;
}): Promise<void> {
  const subscription = await getSubscription(input.organizationId);
  if (!subscription) throw notFound("Aucun abonnement actif.");

  await prismaPlatform.subscription.update({
    where: { id: subscription.id },
    data: input.atPeriodEnd
      ? { cancelAtPeriodEnd: true }
      : { status: "CANCELED", canceledAt: new Date(), cancelAtPeriodEnd: false },
  });

  await recordAudit({
    action: "billing.subscription_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Subscription",
    entityId: subscription.id,
    metadata: { cancelAtPeriodEnd: input.atPeriodEnd },
  });
}

export async function resumeSubscription(input: { organizationId: string; actorUserId: string }): Promise<void> {
  const subscription = await getSubscription(input.organizationId);
  if (!subscription) throw notFound("Aucun abonnement actif.");
  if (!subscription.cancelAtPeriodEnd) throw conflict("Cet abonnement n'est pas programmé pour annulation.");

  await prismaPlatform.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: false },
  });

  await recordAudit({
    action: "billing.subscription_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Subscription",
    entityId: subscription.id,
    metadata: { resumed: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Vérification des webhooks                                                   */
/* -------------------------------------------------------------------------- */

/** Signature attendue : `t=<timestamp>,v1=<hmac sha256 de "t.payload">`. */
export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | null;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): boolean {
  if (!input.header) return false;
  const parts = new Map(
    input.header
      .split(",")
      .map((chunk) => chunk.split("=", 2))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([name, value]) => [name.trim(), value.trim()]),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;

  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.now ?? new Date();
  const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) return false;

  const expected = createHmac("sha256", input.secret).update(`${timestamp}.${input.rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export type WebhookInput = {
  provider: PaymentProvider;
  rawBody: string;
  signatureHeader: string | null;
};

export type WebhookResult = { received: true; duplicate: boolean; handled: boolean; type: string };

/**
 * Traite un webhook de prestataire de façon **idempotente**.
 *
 * L'unicité `(provider, eventId)` sur `payment_events` garantit qu'un événement
 * rejoué par le prestataire n'est appliqué qu'une fois.
 */
export async function handleWebhook(input: WebhookInput): Promise<WebhookResult> {
  const current = env();
  const secret = current.STRIPE_WEBHOOK_SECRET;
  if (input.provider === "STRIPE") {
    if (!secret) throw internal("STRIPE_WEBHOOK_SECRET n'est pas configuré.");
    if (!verifyStripeSignature({ rawBody: input.rawBody, header: input.signatureHeader, secret })) {
      throw forbidden("Signature de webhook invalide.");
    }
  } else if (input.provider === "MOCK") {
    // Le mode test n'accepte pas de webhooks externes : la confirmation est locale.
    throw forbidden("Le prestataire MOCK n'accepte pas de webhook externe.");
  }

  let parsed: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    parsed = JSON.parse(input.rawBody) as typeof parsed;
  } catch {
    throw badRequest("Corps de webhook illisible.");
  }

  const eventId = typeof parsed.id === "string" ? parsed.id : null;
  const type = typeof parsed.type === "string" ? parsed.type : "unknown";
  if (!eventId) throw badRequest("Événement sans identifiant.");

  const existing = await prismaPlatform.paymentEvent.findUnique({
    where: { provider_eventId: { provider: input.provider, eventId } },
  });
  if (existing?.processedAt) {
    return { received: true, duplicate: true, handled: true, type: existing.type };
  }

  const event =
    existing ??
    (await prismaPlatform.paymentEvent.create({
      data: {
        provider: input.provider,
        eventId,
        type,
        payload: parsed as never,
        receivedAt: new Date(),
        attempts: 0,
      },
    }));

  await recordAudit({
    action: "billing.webhook_received",
    organizationId: null,
    entityType: "PaymentEvent",
    entityId: event.id,
    metadata: { provider: input.provider, type },
  });

  try {
    const handled = await applyWebhookEvent({ provider: input.provider, type, payload: parsed });
    await prismaPlatform.paymentEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: null, attempts: { increment: 1 } },
    });
    return { received: true, duplicate: false, handled, type };
  } catch (error) {
    await prismaPlatform.paymentEvent.update({
      where: { id: event.id },
      data: {
        attempts: { increment: 1 },
        error: error instanceof Error ? error.message.slice(0, 500) : "erreur inconnue",
      },
    });
    logger.error("échec de traitement d'un webhook", { type, error });
    throw error;
  }
}

type ParsedEvent = { id?: string; type?: string; data?: { object?: Record<string, unknown> } };

/** Traduit un événement de prestataire en opération métier. */
async function applyWebhookEvent(input: {
  provider: PaymentProvider;
  type: string;
  payload: ParsedEvent;
}): Promise<boolean> {
  const object = input.payload.data?.object ?? {};
  const organizationId = typeof object.metadata === "object" && object.metadata !== null
    ? ((object.metadata as Record<string, unknown>).organizationId as string | undefined)
    : undefined;

  switch (input.type) {
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const providerInvoiceId = typeof object.id === "string" ? object.id : null;
      if (!providerInvoiceId) return false;
      const invoice = await prismaPlatform.invoice.findFirst({
        where: { providerInvoiceId, provider: input.provider },
      });
      if (!invoice) {
        logger.warn("webhook de paiement pour une facture inconnue", { providerInvoiceId });
        return false;
      }
      await prismaPlatform.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: new Date() } });
        if (invoice.subscriptionId) {
          const subscription = await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } });
          if (subscription) {
            const now = new Date();
            await tx.subscription.update({
              where: { id: subscription.id },
              data: {
                status: "ACTIVE",
                currentPeriodStart: now,
                currentPeriodEnd: addInterval(now, subscription.interval as BillingInterval),
              },
            });
          }
        }
      });
      await recordAudit({
        action: "billing.payment_succeeded",
        organizationId: invoice.organizationId,
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { provider: input.provider, providerInvoiceId },
      });
      return true;
    }

    case "invoice.payment_failed": {
      const providerInvoiceId = typeof object.id === "string" ? object.id : null;
      if (!providerInvoiceId) return false;
      const invoice = await prismaPlatform.invoice.findFirst({
        where: { providerInvoiceId, provider: input.provider },
      });
      if (!invoice) return false;
      await prismaPlatform.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OPEN" } });
        if (invoice.subscriptionId) {
          await tx.subscription.update({ where: { id: invoice.subscriptionId }, data: { status: "PAST_DUE" } });
        }
      });
      await recordAudit({
        action: "billing.payment_failed",
        organizationId: invoice.organizationId,
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { provider: input.provider, providerInvoiceId },
      });
      const owners = await prismaPlatform.membership.findMany({
        where: { organizationId: invoice.organizationId, role: { in: ["ORG_ADMIN", "BILLING_MANAGER"] }, status: "ACTIVE" },
        select: { user: { select: { id: true, email: true, name: true } } },
      });
      for (const owner of owners) {
        await notifyWithEmail(
          {
            userId: owner.user.id,
            organizationId: invoice.organizationId,
            type: "BILLING",
            title: "Échec de paiement",
            body: `La facture ${invoice.number} n'a pas pu être réglée.`,
            href: "/dashboard/organisation/facturation",
          },
          {
            to: owner.user.email,
            template: "billing_notice",
            context: {
              name: owner.user.name,
              title: "Échec de paiement",
              message: `La facture ${invoice.number} (${invoice.amountCents / 100} ${invoice.currency}) n'a pas pu être réglée.`,
              actionUrl: `${env().APP_URL}/dashboard/organisation/facturation`,
            },
            dedupeKey: `billing-failed:${invoice.id}`,
          },
        );
      }
      return true;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const providerSubscriptionId = typeof object.id === "string" ? object.id : null;
      if (!providerSubscriptionId) return false;
      const subscription = await prismaPlatform.subscription.findFirst({
        where: { providerSubscriptionId, provider: input.provider },
      });
      if (!subscription) return false;
      const status =
        input.type === "customer.subscription.deleted"
          ? "CANCELED"
          : typeof object.status === "string" && object.status === "past_due"
            ? "PAST_DUE"
            : "ACTIVE";
      await prismaPlatform.subscription.update({ where: { id: subscription.id }, data: { status } });
      await recordAudit({
        action: "billing.subscription_changed",
        organizationId: subscription.organizationId,
        entityType: "Subscription",
        entityId: subscription.id,
        metadata: { provider: input.provider, status, externalEvent: input.type },
      });
      return true;
    }

    default:
      if (organizationId) {
        await recordAudit({
          action: "billing.webhook_received",
          organizationId,
          entityType: "PaymentEvent",
          metadata: { type: input.type, unhandled: true },
        });
      }
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Renouvellements                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Renouvelle les abonnements arrivés à échéance : facture émise pour le nouveau
 * cycle, période avancée. Les abonnements dont l'annulation est programmée sont
 * clôturés. Utilisé par le worker (`billing.subscription_renewal`).
 */
export async function renewDueSubscriptions(now: Date = new Date()): Promise<{ renewed: number; expired: number }> {
  const due = await prismaPlatform.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      currentPeriodEnd: { lte: now },
    },
    take: 100,
  });

  let renewed = 0;
  let expired = 0;

  for (const subscription of due) {
    if (subscription.cancelAtPeriodEnd) {
      await prismaPlatform.subscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELED", canceledAt: now },
      });
      expired += 1;
      continue;
    }

    const plan = await prismaPlatform.plan.findUnique({ where: { id: subscription.planId } });
    if (!plan) continue;

    const interval = subscription.interval as BillingInterval;
    const amountCents = interval === "YEARLY" ? plan.priceYearlyCents : plan.priceMonthlyCents;
    const periodStart = subscription.currentPeriodEnd;
    const periodEnd = addInterval(periodStart, interval);

    await prismaPlatform.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: subscription.status === "TRIALING" ? "ACTIVE" : subscription.status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
        },
      });
      await tx.invoice.create({
        data: {
          organizationId: subscription.organizationId,
          subscriptionId: subscription.id,
          number: await allocateInvoiceNumber(now),
          provider: subscription.provider,
          status: "OPEN",
          amountCents,
          taxCents: 0,
          currency: plan.currency,
          description: `Renouvellement ${plan.name}`,
          lines: [{ label: plan.name, quantity: 1, unitAmountCents: amountCents, totalCents: amountCents }] as never,
          periodStart,
          periodEnd,
          issuedAt: now,
          dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    });
    renewed += 1;
  }

  return { renewed, expired };
}

/** Vérifie la limite d'un forfait avant une opération facturable. */
export async function assertPlanCapacity(
  organizationId: string,
  metric: Parameters<typeof assertWithinPlan>[1],
  increment = 1,
): Promise<void> {
  await assertWithinPlan(organizationId, metric, increment);
}

/** Génère un identifiant d'événement local (mode test). */
export function newLocalEventId(): string {
  return `mock_${randomUUID()}`;
}

export { withTenant };
