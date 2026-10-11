import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Configuration du CLI Prisma.
 *
 * `MIGRATE_DATABASE_URL` est obligatoire : c'est le rôle propriétaire, seul
 * autorisé à exécuter du DDL. L'absence de cette variable doit échouer
 * immédiatement, avec un message explicite, plutôt que de laisser Prisma
 * retomber silencieusement sur un autre rôle.
 *
 * `SHADOW_DATABASE_URL` n'est en revanche lu QUE par `prisma migrate dev`
 * (base jetable servant à calculer les différences de schéma). Les commandes de
 * production (`migrate deploy`, `migrate status`, `db seed`, `generate`) n'en
 * ont pas besoin : la variable est donc déclarée de façon conditionnelle, sans
 * quoi le CLI refuserait de démarrer dans un conteneur où elle est absente.
 */
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("MIGRATE_DATABASE_URL"),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
