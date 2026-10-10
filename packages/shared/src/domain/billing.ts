/**
 * Forfaits SaaS, abonnements, factures et limites.
 *
 * Les limites réelles sont stockées en base (`plans.limits`, JSON) afin de
 * pouvoir évoluer sans redéploiement. `DEFAULT_PLANS` sert de référentiel pour
 * le seed et les tests. Les fonctions de ce module sont pures.
 */

export const PLAN_METRICS = ["users", "courses", "storageMb", "liveSessionsPerMonth", "enrollments"] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];

export const PLAN_METRIC_LABELS: Record<PlanMetric, string> = {
  users: "Utilisateurs",
  courses: "Formations publiées",
  storageMb: "Stockage (Mo)",
  liveSessionsPerMonth: "Classes virtuelles / mois",
  enrollments: "Inscriptions actives",
};

export const PLAN_FEATURES = [
  "certificates",
  "liveClasses",
  "assignments",
  "quizzes",
  "customBranding",
  "customDomain",
  "apiAccess",
  "advancedAnalytics",
  "auditLog",
  "sso",
  "prioritySupport",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  certificates: "Certificats de réussite",
  liveClasses: "Classes virtuelles (Jitsi Meet)",
  assignments: "Devoirs et correction",
  quizzes: "Quiz et examens",
  customBranding: "Personnalisation (logo, couleurs)",
  customDomain: "Domaine personnalisé",
  apiAccess: "Accès API",
  advancedAnalytics: "Statistiques avancées",
  auditLog: "Journal d'audit",
  sso: "Authentification unique (SSO)",
  prioritySupport: "Support prioritaire",
};

/** Limites d'un forfait. `null` = illimité, clé absente = non configuré. */
export type PlanLimits = Partial<Record<PlanMetric, number | null>>;

export type PlanDefinition = {
  code: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
  limits: Record<PlanMetric, number | null>;
  features: PlanFeature[];
};

export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    code: "free",
    name: "Découverte",
    description: "Pour tester la plateforme avec une petite promotion.",
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    currency: "TND",
    trialDays: 0,
    sortOrder: 10,
    limits: { users: 15, courses: 3, storageMb: 512, liveSessionsPerMonth: 4, enrollments: 50 },
    features: ["quizzes", "liveClasses"],
  },
  {
    code: "starter",
    name: "Essentiel",
    description: "Pour un formateur indépendant qui vend ses premières formations.",
    priceMonthlyCents: 4900,
    priceYearlyCents: 49000,
    currency: "TND",
    trialDays: 14,
    sortOrder: 20,
    limits: { users: 100, courses: 20, storageMb: 10240, liveSessionsPerMonth: 40, enrollments: 1000 },
    features: ["quizzes", "assignments", "liveClasses", "certificates", "customBranding"],
  },
  {
    code: "business",
    name: "Centre de formation",
    description: "Pour les centres de formation et les écoles multi-promotions.",
    priceMonthlyCents: 14900,
    priceYearlyCents: 149000,
    currency: "TND",
    trialDays: 14,
    sortOrder: 30,
    limits: { users: 1000, courses: 200, storageMb: 102400, liveSessionsPerMonth: 400, enrollments: 20000 },
    features: [
      "quizzes",
      "assignments",
      "liveClasses",
      "certificates",
      "customBranding",
      "customDomain",
      "apiAccess",
      "advancedAnalytics",
      "auditLog",
    ],
  },
  {
    code: "enterprise",
    name: "Établissement",
    description: "Volume élevé, exigences de conformité et accompagnement dédié.",
    priceMonthlyCents: 39900,
    priceYearlyCents: 399000,
    currency: "TND",
    trialDays: 30,
    sortOrder: 40,
    limits: { users: null, courses: null, storageMb: null, liveSessionsPerMonth: null, enrollments: null },
    features: [
      "quizzes",
      "assignments",
      "liveClasses",
      "certificates",
      "customBranding",
      "customDomain",
      "apiAccess",
      "advancedAnalytics",
      "auditLog",
      "sso",
      "prioritySupport",
    ],
  },
];

export const BILLING_INTERVALS = ["MONTHLY", "YEARLY"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "INCOMPLETE",
  "EXPIRED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: "Période d'essai",
  ACTIVE: "Active",
  PAST_DUE: "Impayé",
  CANCELED: "Résiliée",
  INCOMPLETE: "Incomplète",
  EXPIRED: "Expirée",
};

/** Statuts ouvrant droit aux fonctionnalités payantes. */
export const ENTITLED_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE"];

export const INVOICE_STATUSES = ["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Brouillon",
  OPEN: "En attente",
  PAID: "Payée",
  VOID: "Annulée",
  UNCOLLECTIBLE: "Irrécouvrable",
};

/**
 * Prestataires de paiement.
 * `MOCK` est un mode de test explicitement identifié : il ne prétend jamais
 * qu'un paiement réel a été encaissé.
 */
export const PAYMENT_PROVIDERS = ["MOCK", "STRIPE"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export type LimitCheckResult = {
  allowed: boolean;
  limit: number | null;
  used: number;
  requested: number;
  remaining: number | null;
};

/** Vérifie une limite à partir d'une valeur déjà comptée. */
export function checkLimit(used: number, limit: number | null | undefined, increment = 1): LimitCheckResult {
  if (limit === null || limit === undefined) {
    return { allowed: true, limit: null, used, requested: increment, remaining: null };
  }
  const remaining = Math.max(0, limit - used);
  return { allowed: used + increment <= limit, limit, used, requested: increment, remaining };
}

export type LimitCheck = LimitCheckResult & { metric: PlanMetric; current: number };

/** Vérifie une limite de forfait par métrique. */
export function checkPlanLimit(
  limits: PlanLimits | null | undefined,
  metric: PlanMetric,
  current: number,
  requested = 1,
): LimitCheck {
  const limit = limits?.[metric] ?? null;
  const result = checkLimit(current, limit, requested);
  return { ...result, metric, current };
}

export function hasFeature(features: readonly string[] | null | undefined, feature: PlanFeature): boolean {
  return Array.isArray(features) && features.includes(feature);
}

/** Normalise un JSON de limites venant de la base. */
export function parseLimits(value: unknown): PlanLimits {
  const limits: PlanLimits = {};
  if (typeof value !== "object" || value === null) return limits;
  const record = value as Record<string, unknown>;
  for (const metric of PLAN_METRICS) {
    const raw = record[metric];
    if (raw === null) {
      limits[metric] = null;
      continue;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) limits[metric] = raw;
  }
  return limits;
}

export function parseFeatures(value: unknown): PlanFeature[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PlanFeature => (PLAN_FEATURES as readonly string[]).includes(String(item)));
}

/** Formate un montant en centimes (TND par défaut, 3 décimales). */
export function formatAmount(cents: number, currency = "TND", locale = "fr-TN"): string {
  const fractionDigits = currency === "TND" ? 3 : 2;
  const value = cents / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${value.toFixed(fractionDigits)} ${currency}`;
  }
}

/** Période facturée suivante à partir d'une date. */
export function addInterval(date: Date, interval: BillingInterval): Date {
  const next = new Date(date.getTime());
  if (interval === "YEARLY") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

