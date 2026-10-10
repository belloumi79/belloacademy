import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Deux projets de test, volontairement séparés :
 *  - `unit`        : logique pure (domaine, validation, utilitaires), sans base ;
 *  - `integration` : parcours réels sur une base PostgreSQL dédiée (TEST_DATABASE_URL).
 *
 * Les tests d'intégration ne touchent jamais la base de développement : le
 * fichier `tests/integration/setup.ts` bascule les variables d'environnement
 * vers la base de test avant le chargement des modules applicatifs.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/setup.ts", "tests/integration/setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
