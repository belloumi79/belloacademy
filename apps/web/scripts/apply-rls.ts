/**
 * Application (ou réapplication) des politiques Row Level Security.
 *
 * Les politiques sont normalement créées par la migration Prisma
 * `*_row_level_security`. Ce script sert aux environnements où la base a été
 * créée sans migrations (restauration d'un dump, base gérée hors Prisma) : il
 * rejoue le même fichier SQL de façon idempotente, puis vérifie que les
 * politiques sont bien actives sur les tables tenant.
 *
 * Usage : `pnpm db:rls`
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";


import { Client } from "pg";

import { env } from "../src/env";
import { logger } from "../src/lib/logger";

const RLS_FILE = join(import.meta.dirname, "..", "..", "..", "infra", "sql", "rls.sql");
const PRIVILEGES_FILE = join(import.meta.dirname, "..", "..", "..", "infra", "sql", "app-role-privileges.sql");

/** Tables soumises aux politiques tenant (doit rester aligné avec rls.sql). */
const TENANT_TABLES = [
  "categories",
  "courses",
  "sections",
  "lessons",
  "lesson_resources",
  "enrollments",
  "lesson_progress",
  "live_sessions",
  "live_attendance",
  "quizzes",
  "questions",
  "question_options",
  "quiz_attempts",
  "quiz_answers",
  "assignments",
  "assignment_submissions",
  "submission_files",
  "certificates",
  "assets",
  "notifications",
  "audit_logs",
  "subscriptions",
  "invoices",
  "usage_counters",
] as const;

async function main(): Promise<void> {
  // Les politiques s'appliquent avec le rôle propriétaire : c'est lui qui
  // détient les droits de création de politiques et de tables.
  const connectionString = env().MIGRATE_DATABASE_URL ?? env().DATABASE_URL;
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const currentRole = await client.query<{ current_user: string }>("SELECT current_user");
    logger.info(`Application des politiques RLS en tant que « ${currentRole.rows[0]?.current_user} ».`);

    const rls = readFileSync(RLS_FILE, "utf8");
    await client.query(rls);
    logger.info(`Politiques RLS appliquées depuis ${RLS_FILE}.`);

    const privileges = readFileSync(PRIVILEGES_FILE, "utf8");
    await client.query(privileges);
    logger.info(`Privilèges du rôle applicatif accordés depuis ${PRIVILEGES_FILE}.`);

    const { rows } = await client.query<{ relname: string; relrowsecurity: boolean; policies: string }>(
      `SELECT c.relname,
              c.relrowsecurity,
              count(p.polname)::text AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        GROUP BY c.relname, c.relrowsecurity
        ORDER BY c.relname`,
      [[...TENANT_TABLES]],
    );

    const byName = new Map(rows.map((row) => [row.relname, row]));
    const missing: string[] = [];
    const unprotected: string[] = [];

    for (const table of TENANT_TABLES) {
      const row = byName.get(table);
      if (!row) {
        missing.push(table);
        continue;
      }
      if (!row.relrowsecurity || Number(row.policies) === 0) unprotected.push(table);
    }

    if (missing.length > 0) {
      logger.error(`Tables tenant absentes : ${missing.join(", ")}. Appliquez d'abord les migrations.`);
    }
    if (unprotected.length > 0) {
      logger.error(`Tables sans politique active : ${unprotected.join(", ")}.`);
    }

    if (missing.length > 0 || unprotected.length > 0) {
      process.exitCode = 1;
      return;
    }

    logger.info(`RLS vérifié : ${rows.length} tables tenant protégées.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  logger.error("Échec de l'application des politiques RLS.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
