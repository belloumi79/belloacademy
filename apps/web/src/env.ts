import { z } from "zod";

/**
 * Validation des variables d'environnement au démarrage.
 *
 * Toute la configuration passe par des variables d'environnement : aucun secret
 * n'est écrit dans le code. Les valeurs par défaut sont réservées au
 * développement local ; en production, les variables marquées `required` doivent
 * être fournies explicitement (le serveur refuse de démarrer sinon).
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes", "on", "oui"].includes(value.toLowerCase());
  });

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  APP_NAME: z.string().trim().min(1).default("BelloAcademy"),
  APP_URL: z.string().trim().min(1).default("http://localhost:3000"),
  DEFAULT_LOCALE: z.enum(["fr", "ar", "en"]).default("fr"),
  DEFAULT_TIMEZONE: z.string().trim().min(1).default("Africa/Tunis"),
  DEFAULT_CURRENCY: z.string().trim().length(3).default("TND"),

  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL est obligatoire"),
  /** Rôle plateforme (BYPASSRLS) : réservé aux lectures inter-organisations. */
  DATABASE_PLATFORM_URL: optionalString,
  MIGRATE_DATABASE_URL: optionalString,
  SHADOW_DATABASE_URL: optionalString,

  AUTH_SECRET: z.string().trim().min(16, "AUTH_SECRET doit contenir au moins 16 caractères"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 30),

  REDIS_URL: optionalString,

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().trim().default("./var/storage"),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().trim().default("us-east-1"),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: booleanish.default(true),
  S3_PUBLIC_BASE_URL: optionalString,

  SMTP_URL: optionalString,
  MAIL_FROM: z.string().trim().default("BelloAcademy <no-reply@belloacademy.local>"),
  MAIL_DRIVER: z.enum(["smtp", "file", "console"]).default("file"),
  MAIL_SPOOL_DIR: z.string().trim().default("./var/mail"),

  BILLING_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  BILLING_CURRENCY: z.string().trim().length(3).default("TND"),

  JITSI_DOMAIN: z.string().trim().default("meet.jit.si"),
  JITSI_APP_ID: optionalString,
  JITSI_APP_SECRET: optionalString,
  JITSI_JWT_AUDIENCE: z.string().trim().default("jitsi"),
  JITSI_JWT_ISSUER: z.string().trim().default("belloacademy"),
  JITSI_REQUIRE_JWT: booleanish.default(false),
  JITSI_ROOM_PREFIX: z.string().trim().default("belloacademy"),

  JOBS_ENABLED: booleanish.default(true),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5000),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RATE_LIMIT_ENABLED: booleanish.default(true),
  TRUST_PROXY: booleanish.default(true),

  SEED_SUPER_ADMIN_EMAIL: optionalString,
  SEED_SUPER_ADMIN_PASSWORD: optionalString,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join(".") || "(racine)"} : ${issue.message}`).join("\n");
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuration invalide :\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Accès paresseux à la configuration validée (importable côté serveur uniquement). */
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
export const isTest = () => env().NODE_ENV === "test";
