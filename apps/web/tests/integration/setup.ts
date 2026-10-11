/**
 * Préparation des tests d'intégration.
 *
 * 1. Bascule les variables d'environnement vers la base de test dédiée
 *    (`TEST_*`), de sorte qu'aucun test ne puisse écrire dans la base de
 *    développement.
 * 2. Applique les migrations sur cette base (idempotent) afin que la suite soit
 *    reproductible sur une base vierge.
 */
import { execFileSync } from "node:child_process";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variable ${name} absente : les tests d'intégration nécessitent une base PostgreSQL de test (voir .env.example).`,
    );
  }
  return value;
}

const testUrl = requireEnv("TEST_DATABASE_URL");
const testPlatformUrl = requireEnv("TEST_PLATFORM_DATABASE_URL");
const testMigrateUrl = requireEnv("TEST_MIGRATE_DATABASE_URL");

process.env.DATABASE_URL = testUrl;
process.env.DATABASE_PLATFORM_URL = testPlatformUrl;
process.env.MIGRATE_DATABASE_URL = testMigrateUrl;
if (process.env.TEST_SHADOW_DATABASE_URL) {
  process.env.SHADOW_DATABASE_URL = process.env.TEST_SHADOW_DATABASE_URL;
}
(process.env as Record<string, string>).NODE_ENV = "test";
// Secrets déterministes pour les tests : aucune valeur réelle n'est utilisée.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_belloacademy";

execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: {
    ...process.env,
    MIGRATE_DATABASE_URL: testMigrateUrl,
    SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL ?? testMigrateUrl,
  },
});
