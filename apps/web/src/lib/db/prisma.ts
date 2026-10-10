/**
 * Client Prisma et stratégie d'isolation multi-tenant.
 *
 * Trois accès distincts à la base :
 *  - `prisma`         : rôle applicatif (`DATABASE_URL`), soumis aux politiques
 *                       Row Level Security (voir `prisma/migrations/*_row_level_security`).
 *                       Toute requête sur une table tenant doit passer par `withTenant`.
 *  - `prismaPlatform` : rôle plateforme (`DATABASE_PLATFORM_URL`, BYPASSRLS), réservé
 *                       aux opérations légitimement inter-organisations (superadmin,
 *                       facturation, résolution des appartenances à la connexion).
 *  - migrations       : rôle propriétaire (`MIGRATE_DATABASE_URL`), utilisé uniquement
 *                       par la CLI Prisma.
 *
 * Le contexte de tenant est propagé par `withTenant`, qui ouvre une transaction et
 * positionne `app.current_org_id` en portée transaction (`set_config(..., true)`).
 * Les politiques RLS comparent `organizationId` à cette valeur : même en cas d'oubli
 * d'un filtre applicatif, aucune ligne d'une autre organisation ne peut être lue.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/env";
import { logger } from "@/lib/logger";
import { PrismaClient } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

export type TransactionClient = Prisma.TransactionClient;
export type DbClient = PrismaClient | TransactionClient;

function createClient(connectionString: string, label: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }] : [{ emit: "event", level: "error" }],
  });

  if (env().NODE_ENV === "development") {
    client.$on("warn", (event: { message: string }) => logger.warn(`[prisma:${label}] ${event.message}`));
  }
  client.$on("error", (event: { message: string }) => logger.error(`[prisma:${label}] ${event.message}`));

  return client;
}

const globalForPrisma = globalThis as unknown as {
  __belloacademyPrisma?: PrismaClient;
  __belloacademyPrismaPlatform?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__belloacademyPrisma ?? createClient(env().DATABASE_URL, "app");

/**
 * Accès plateforme. Si `DATABASE_PLATFORM_URL` n'est pas configurée, l'accès
 * retombe sur le rôle applicatif : les opérations inter-organisations échoueront
 * alors silencieusement (0 ligne) — c'est volontaire et documenté dans docs/SECURITY.md.
 */
export const prismaPlatform: PrismaClient =
  globalForPrisma.__belloacademyPrismaPlatform ??
  createClient(env().DATABASE_PLATFORM_URL ?? env().DATABASE_URL, env().DATABASE_PLATFORM_URL ? "platform" : "app(fallback)");

if (env().NODE_ENV !== "production") {
  globalForPrisma.__belloacademyPrisma = prisma;
  globalForPrisma.__belloacademyPrismaPlatform = prismaPlatform;
}

export const TENANT_SETTING_KEY = "app.current_org_id";

/**
 * Exécute `fn` dans une transaction dont le contexte de tenant est fixé à
 * `organizationId`. Toutes les requêtes RLS de la transaction sont filtrées.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  if (!organizationId) throw new Error("withTenant: organizationId requis");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING_KEY}, ${organizationId}, true)`;
    return fn(tx);
  });
}

/**
 * Exécute `fn` sans contexte de tenant. Sur les tables protégées par RLS, les
 * requêtes ne renvoient aucune ligne : à n'utiliser que pour les tables non
 * tenant (utilisateurs, sessions, jetons, plans, tâches).
 */
export async function withAnonymous<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING_KEY}, '', true)`;
    return fn(tx);
  });
}

/** Vrai si le contexte de tenant courant correspond bien à `organizationId`. */
export async function assertTenantBound(tx: TransactionClient, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ current: string | null }>>`SELECT current_setting(${TENANT_SETTING_KEY}, true) AS current`;
  const current = rows[0]?.current ?? null;
  if (current !== organizationId) {
    throw new Error(
      `Contexte de tenant incohérent : attendu ${organizationId}, obtenu ${current ?? "aucun"}.`,
    );
  }
}

export async function disconnectPrisma(): Promise<void> {
  await Promise.all([prisma.$disconnect(), prismaPlatform.$disconnect()]);
}
