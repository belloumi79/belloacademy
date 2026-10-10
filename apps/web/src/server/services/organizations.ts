/**
 * Organisations (tenants) : création, paramètres, consommation et limites.
 *
 * Règle de conception : la création d'une organisation et la lecture
 * inter-organisations passent par `prismaPlatform` (rôle `BYPASSRLS`), car elles
 * s'exécutent *avant* qu'un contexte de tenant existe. Toute opération portant
 * sur les données d'une organisation existante passe par `withTenant`.
 */

import {
  DEFAULT_PLANS,
  ORGANIZATION_SETTINGS_DEFAULTS,
  PLAN_METRICS,
  resolveOrganizationSettings,
  slugify,
  type OrganizationSettings,
  type PlanLimits,
  type PlanMetric,
} from "@belloacademy/shared";

import { prisma, prismaPlatform, withTenant } from "@/lib/db/prisma";
import { conflict, forbidden, notFound, planLimitReached } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enqueue } from "@/lib/jobs";

export type OrganizationSummary = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  country: string;
  currency: string;
  timezone: string;
  planCode: string | null;
  planName: string | null;
  role?: string;
  status?: string;
};

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
  ownerUserId: string;
  country?: string;
  currency?: string;
  timezone?: string;
  locale?: string;
  planCode?: string;
};

/** Début de la période de consommation courante (mois civil, UTC). */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Crée une organisation, son abonnement initial et l'adhésion de son
 * propriétaire. L'opération est atomique : jamais d'organisation sans
 * administrateur.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const name = input.name.trim();
  if (name.length < 2) throw conflict("Le nom de l'organisation est trop court.");

  const baseSlug = slugify(input.slug?.trim() || name) || "organisation";
  const slug = await uniqueSlug(baseSlug);

  const plan = await prismaPlatform.plan.findFirst({
    where: { code: input.planCode ?? DEFAULT_PLANS[0]!.code, isActive: true },
    select: { id: true, code: true, trialDays: true },
  });

  const now = new Date();
  const trialEndsAt = plan && plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;

  const organization = await prismaPlatform.organization.create({
    data: {
      slug,
      name,
      country: input.country ?? "TN",
      currency: input.currency ?? "TND",
      timezone: input.timezone ?? "Africa/Tunis",
      locale: input.locale ?? "fr",
      settings: ORGANIZATION_SETTINGS_DEFAULTS as never,
      planId: plan?.id ?? null,
      trialEndsAt,
      memberships: {
        create: {
          userId: input.ownerUserId,
          role: "ORG_ADMIN",
          status: "ACTIVE",
          joinedAt: now,
        },
      },
      subscriptions: plan
        ? {
            create: {
              planId: plan.id,
              provider: "MOCK",
              status: trialEndsAt ? "TRIALING" : "ACTIVE",
              interval: "MONTHLY",
              currentPeriodStart: currentPeriodStart(now),
              currentPeriodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
              cancelAtPeriodEnd: false,
              trialEndsAt,
            },
          }
        : undefined,
    },
    select: { id: true, slug: true, name: true, planId: true, trialEndsAt: true },
  });

  await prismaPlatform.category.createMany({
    data: [
      { organizationId: organization.id, slug: "general", name: "Général", position: 0 },
      { organizationId: organization.id, slug: "informatique", name: "Informatique", position: 1 },
      { organizationId: organization.id, slug: "gestion", name: "Gestion et commerce", position: 2 },
    ],
    skipDuplicates: true,
  });

  logger.info("organisation créée", { organizationId: organization.id, slug: organization.slug });
  return organization;
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prismaPlatform.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function getOrganizationById(organizationId: string) {
  const organization = await prismaPlatform.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    include: {
      plan: { select: { code: true, name: true, limits: true, features: true } },
    },
  });
  if (!organization) throw notFound("Organisation introuvable.");
  return organization;
}

export async function getOrganizationBySlug(slug: string) {
  return prismaPlatform.organization.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, slug: true, name: true, logoUrl: true, brandColor: true, locale: true, currency: true, timezone: true },
  });
}

/** Organisations auxquelles un utilisateur appartient (avec son rôle). */
export async function listOrganizationsForUser(userId: string): Promise<OrganizationSummary[]> {
  const memberships = await prismaPlatform.membership.findMany({
    where: { userId, status: "ACTIVE", organization: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      status: true,
      organization: {
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          brandColor: true,
          country: true,
          currency: true,
          timezone: true,
          plan: { select: { code: true, name: true } },
        },
      },
    },
  });

  return memberships.map((membership) => ({
    id: membership.organization.id,
    slug: membership.organization.slug,
    name: membership.organization.name,
    logoUrl: membership.organization.logoUrl,
    brandColor: membership.organization.brandColor,
    country: membership.organization.country,
    currency: membership.organization.currency,
    timezone: membership.organization.timezone,
    planCode: membership.organization.plan?.code ?? null,
    planName: membership.organization.plan?.name ?? null,
    role: membership.role,
    status: membership.status,
  }));
}

export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  const organization = await withTenant(organizationId, (tx) =>
    tx.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
  );
  if (!organization) throw notFound("Organisation introuvable.");
  return resolveOrganizationSettings(organization.settings);
}

export async function updateOrganization(
  organizationId: string,
  input: {
    name?: string;
    legalName?: string | null;
    billingEmail?: string | null;
    country?: string;
    currency?: string;
    timezone?: string;
    locale?: string;
    logoUrl?: string | null;
    brandColor?: string | null;
    settings?: Partial<OrganizationSettings>;
  },
) {
  return withTenant(organizationId, async (tx) => {
    const current = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!current) throw notFound("Organisation introuvable.");

    const settings = input.settings
      ? resolveOrganizationSettings({ ...resolveOrganizationSettings(current.settings), ...input.settings })
      : undefined;

    return tx.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.billingEmail !== undefined ? { billingEmail: input.billingEmail } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.brandColor !== undefined ? { brandColor: input.brandColor } : {}),
        ...(settings ? { settings: settings as never } : {}),
      },
      select: { id: true, name: true, slug: true, settings: true },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Limites de forfait et consommation                                         */
/* -------------------------------------------------------------------------- */

export type UsageSnapshot = Record<PlanMetric, number>;

/** Limites effectives du forfait d'une organisation (`null` = illimité). */
export async function getPlanLimits(organizationId: string): Promise<PlanLimits> {
  const organization = await prismaPlatform.organization.findUnique({
    where: { id: organizationId },
    select: { plan: { select: { limits: true } } },
  });
  const limits = organization?.plan?.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) return {};
  const parsed: PlanLimits = {};
  for (const metric of PLAN_METRICS) {
    const raw = (limits as Record<string, unknown>)[metric];
    if (raw === null) parsed[metric] = null;
    else if (typeof raw === "number" && Number.isFinite(raw)) parsed[metric] = raw;
  }
  return parsed;
}

/**
 * Vérifie qu'un ajout reste dans les limites du forfait.
 *
 * `current` est fourni par l'appelant lorsqu'il connaît déjà la consommation
 * (évite une requête supplémentaire) ; sinon elle est lue depuis les compteurs.
 */
export async function assertWithinPlan(
  organizationId: string,
  metric: PlanMetric,
  increment = 1,
  current?: number,
): Promise<void> {
  const limits = await getPlanLimits(organizationId);
  const limit = limits[metric];
  if (limit === undefined || limit === null) return;

  const used = current ?? (await getUsage(organizationId))[metric];
  if (used + increment > limit) {
    throw planLimitReached(
      `Limite du forfait atteinte pour « ${metric} » (${used}/${limit}).`,
      { metric, limit, used, requested: increment },
    );
  }
}

/** Incrémente un compteur de consommation pour la période courante. */
export async function incrementUsage(organizationId: string, metric: PlanMetric, by = 1): Promise<number> {
  const periodStart = currentPeriodStart();
  const counter = await prismaPlatform.usageCounter.upsert({
    where: { organizationId_metric_periodStart: { organizationId, metric, periodStart } },
    create: { organizationId, metric, periodStart, value: by },
    update: { value: { increment: by } },
    select: { value: true },
  });
  return counter.value;
}

/** Décrémente un compteur (suppression d'un cours, d'un membre…). */
export async function decrementUsage(organizationId: string, metric: PlanMetric, by = 1): Promise<void> {
  const periodStart = currentPeriodStart();
  await prismaPlatform.usageCounter.upsert({
    where: { organizationId_metric_periodStart: { organizationId, metric, periodStart } },
    create: { organizationId, metric, periodStart, value: 0 },
    update: { value: { decrement: by } },
  });
}

/**
 * Consommation courante. Les métriques structurelles (membres, cours) sont
 * recomptées depuis la base : un compteur dérive toujours à terme, une
 * agrégation non.
 */
export async function getUsage(organizationId: string, now: Date = new Date()): Promise<UsageSnapshot> {
  const periodStart = currentPeriodStart(now);

  const [members, courses, storage, liveSessions, enrollments, counters] = await Promise.all([
    prismaPlatform.membership.count({
      where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } },
    }),
    prismaPlatform.course.count({ where: { organizationId, status: { not: "ARCHIVED" } } }),
    prismaPlatform.asset.aggregate({ where: { organizationId }, _sum: { sizeBytes: true } }),
    prismaPlatform.liveSession.count({ where: { organizationId, scheduledStart: { gte: periodStart } } }),
    prismaPlatform.enrollment.count({ where: { organizationId } }),
    prismaPlatform.usageCounter.findMany({
      where: { organizationId, periodStart },
      select: { metric: true, value: true },
    }),
  ]);

  const snapshot: UsageSnapshot = {
    users: members,
    courses,
    storageMb: Math.ceil((storage._sum.sizeBytes ?? 0) / (1024 * 1024)),
    liveSessionsPerMonth: liveSessions,
    enrollments,
  };

  // Les compteurs peuvent porter des métriques hors agrégation : on prend le maximum.
  for (const counter of counters) {
    if ((PLAN_METRICS as readonly string[]).includes(counter.metric)) {
      const metric = counter.metric as PlanMetric;
      snapshot[metric] = Math.max(snapshot[metric], counter.value);
    }
  }

  return snapshot;
}

/** Vérifie l'appartenance active d'un utilisateur à une organisation. */
export async function assertMembership(organizationId: string, userId: string): Promise<string> {
  const membership = await prismaPlatform.membership.findFirst({
    where: { organizationId, userId, status: "ACTIVE" },
    select: { role: true },
  });
  if (!membership) throw forbidden("Vous n'appartenez pas à cette organisation.");
  return membership.role;
}

/** Programme la vérification de l'expiration d'un essai gratuit. */
export async function scheduleTrialExpiryCheck(organizationId: string, trialEndsAt: Date): Promise<void> {
  await enqueue(
    "billing.trial_check",
    { organizationId },
    { runAt: trialEndsAt, dedupeKey: `trial:${organizationId}:${trialEndsAt.toISOString()}` },
  );
}

export { prisma };

export type PlatformOrganizationRow = {
  id: string;
  slug: string;
  name: string;
  country: string;
  createdAt: Date;
  deletedAt: Date | null;
  planCode: string | null;
  planName: string | null;
  members: number;
  courses: number;
  enrollments: number;
};

/**
 * Toutes les organisations de la plateforme — réservé au superadministrateur.
 *
 * Les compteurs sont obtenus en deux requêtes groupées plutôt qu'en bouclant
 * organisation par organisation, pour éviter le coût en N+1 dès que la
 * plateforme compte un nombre significatif de tenants.
 */
export async function listAllOrganizations(limit = 100): Promise<PlatformOrganizationRow[]> {
  const organizations = await prismaPlatform.organization.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    select: {
      id: true,
      slug: true,
      name: true,
      country: true,
      createdAt: true,
      deletedAt: true,
      plan: { select: { code: true, name: true } },
    },
  });

  const ids = organizations.map((organization) => organization.id);
  if (ids.length === 0) return [];

  const [memberCounts, courseCounts, enrollmentCounts] = await Promise.all([
    prismaPlatform.membership.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, status: { in: ["ACTIVE", "INVITED"] } },
      _count: { _all: true },
    }),
    prismaPlatform.course.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids } },
      _count: { _all: true },
    }),
    prismaPlatform.enrollment.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const toMap = (rows: { organizationId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.organizationId, row._count._all]));

  const members = toMap(memberCounts);
  const courses = toMap(courseCounts);
  const enrollments = toMap(enrollmentCounts);

  return organizations.map((organization) => ({
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    country: organization.country,
    createdAt: organization.createdAt,
    deletedAt: organization.deletedAt,
    planCode: organization.plan?.code ?? null,
    planName: organization.plan?.name ?? null,
    members: members.get(organization.id) ?? 0,
    courses: courses.get(organization.id) ?? 0,
    enrollments: enrollments.get(organization.id) ?? 0,
  }));
}
