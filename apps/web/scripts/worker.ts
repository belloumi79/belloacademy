/**
 * Worker de tâches asynchrones.
 *
 * Processus séparé du serveur web (déployable indépendamment, cf.
 * `infra/docker-compose.yml`). Il consomme la table `jobs` : aucun courtier
 * externe n'est nécessaire, la durabilité est celle de PostgreSQL.
 *
 * Usage : `pnpm worker`
 */
import "dotenv/config";


import { env } from "../src/env";
import { disconnectPrisma } from "../src/lib/db/prisma";
import { drainQueue, jobStats, releaseStaleJobs } from "../src/lib/jobs";
import { logger } from "../src/lib/logger";
import {
  enqueueDueReminders,
  registerAllJobHandlers,
  scheduleRecurringJobs,
} from "../src/server/jobs/handlers";

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let running = true;
let lastRecurringAt = 0;

async function tick(): Promise<void> {
  const now = Date.now();

  // Programmes récurrents : vérifiés au plus une fois par minute.
  if (now - lastRecurringAt > 60_000) {
    lastRecurringAt = now;
    await scheduleRecurringJobs();
    await enqueueDueReminders();
    await releaseStaleJobs(15);
  }

  const result = await drainQueue({ workerId: WORKER_ID, limit: 25 });
  if (result.processed > 0) {
    logger.info("tâches traitées", { ...result, worker: WORKER_ID });
  }
}

async function main(): Promise<void> {
  registerAllJobHandlers();
  const config = env();
  logger.info("worker démarré", {
    worker: WORKER_ID,
    pollIntervalMs: config.JOBS_POLL_INTERVAL_MS,
    env: config.NODE_ENV,
  });

  while (running) {
    try {
      await tick();
    } catch (error) {
      logger.error("erreur du worker", { error });
    }
    await new Promise((resolve) => setTimeout(resolve, env().JOBS_POLL_INTERVAL_MS));
  }

  logger.info("arrêt du worker", { stats: await jobStats() });
  await disconnectPrisma();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info(`signal ${signal} reçu, arrêt en cours`);
    running = false;
  });
}

main().catch(async (error) => {
  logger.error("échec fatal du worker", { error });
  await disconnectPrisma();
  process.exit(1);
});
