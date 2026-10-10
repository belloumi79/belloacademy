/**
 * File de tâches asynchrone, persistée en base.
 *
 * Choix : une file en base (`jobs`) plutôt qu'un courtier externe. Elle est
 * durable (un redémarrage ne perd pas les tâches), ne demande aucun service
 * supplémentaire en développement, et le verrouillage `FOR UPDATE SKIP LOCKED`
 * permet plusieurs workers concurrents sans double exécution.
 *
 * Les tâches sont reprises automatiquement (backoff exponentiel) jusqu'à
 * `maxAttempts`, puis marquées `DEAD` pour inspection.
 */

import { logger } from "@/lib/logger";
import { prismaPlatform } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type JobName =
  | "email.send"
  | "live.reminder"
  | "certificate.issue"
  | "billing.subscription_renewal"
  | "billing.trial_check"
  | "live.status_sync"
  | "plan.usage_snapshot";

export type JobPayload = Record<string, unknown>;

export type JobHandler = (payload: JobPayload, meta: { jobId: string; attempt: number }) => Promise<void>;

const handlers = new Map<JobName, JobHandler>();

export function registerJobHandler(name: JobName, handler: JobHandler): void {
  handlers.set(name, handler);
}

export function registeredJobNames(): JobName[] {
  return [...handlers.keys()];
}

export type EnqueueOptions = {
  queue?: string;
  runAt?: Date;
  maxAttempts?: number;
  /** Empêche les doublons : une tâche portant la même clé n'est créée qu'une fois. */
  dedupeKey?: string;
};

/**
 * Ajoute une tâche. Renvoie l'identifiant créé, ou `null` si une tâche portant
 * la même `dedupeKey` existe déjà (comportement idempotent).
 */
export async function enqueue(
  name: JobName,
  payload: JobPayload = {},
  options: EnqueueOptions = {},
): Promise<string | null> {
  try {
    const created = await prismaPlatform.job.create({
      data: {
        name,
        queue: options.queue ?? "default",
        payload: payload as Prisma.InputJsonValue,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 5,
        dedupeKey: options.dedupeKey ?? null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Violation d'unicité sur dedupeKey : la tâche est déjà programmée.
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return null;
    }
    logger.error("échec de mise en file d'une tâche", { name, error });
    throw error;
  }
}

type ClaimedJob = {
  id: string;
  name: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

/** Réserve atomiquement la prochaine tâche éligible. */
async function claimNextJob(workerId: string, queue: string): Promise<ClaimedJob | null> {
  const rows = await prismaPlatform.$queryRaw<ClaimedJob[]>`
    UPDATE jobs SET
      status = 'RUNNING',
      "lockedAt" = NOW(),
      "lockedBy" = ${workerId},
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'PENDING' AND "runAt" <= NOW() AND queue = ${queue}
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, name, payload, attempts, "maxAttempts"
  `;
  return rows[0] ?? null;
}

function backoffDate(attempt: number): Date {
  const seconds = Math.min(3600, 2 ** attempt * 30);
  return new Date(Date.now() + seconds * 1000);
}

/** Exécute une tâche : marque SUCCEEDED, ou replanifie/abandonne selon les tentatives. */
export async function runJob(job: ClaimedJob): Promise<"succeeded" | "retried" | "dead"> {
  const handler = handlers.get(job.name as JobName);
  if (!handler) {
    await prismaPlatform.job.update({
      where: { id: job.id },
      data: { status: "DEAD", lastError: `Aucun gestionnaire pour « ${job.name} ».`, completedAt: new Date() },
    });
    logger.error("tâche sans gestionnaire", { jobId: job.id, name: job.name });
    return "dead";
  }

  try {
    await handler((job.payload ?? {}) as JobPayload, { jobId: job.id, attempt: job.attempts });
    await prismaPlatform.job.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
    });
    return "succeeded";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= job.maxAttempts;
    await prismaPlatform.job.update({
      where: { id: job.id },
      data: exhausted
        ? { status: "DEAD", lastError: message.slice(0, 2000), completedAt: new Date() }
        : { status: "PENDING", lastError: message.slice(0, 2000), runAt: backoffDate(job.attempts), lockedAt: null, lockedBy: null },
    });
    logger.error("échec d'exécution d'une tâche", {
      jobId: job.id,
      name: job.name,
      attempt: job.attempts,
      exhausted,
      error: message,
    });
    return exhausted ? "dead" : "retried";
  }
}

export type DrainResult = { processed: number; succeeded: number; retried: number; dead: number };

/** Traite les tâches éligibles (une passe). Utilisé par le worker et par les tests. */
export async function drainQueue(options: { workerId?: string; queue?: string; limit?: number } = {}): Promise<DrainResult> {
  const workerId = options.workerId ?? `worker-${process.pid}`;
  const queue = options.queue ?? "default";
  const limit = options.limit ?? 10;
  const result: DrainResult = { processed: 0, succeeded: 0, retried: 0, dead: 0 };

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob(workerId, queue);
    if (!job) break;
    const outcome = await runJob(job);
    result.processed += 1;
    if (outcome === "succeeded") result.succeeded += 1;
    else if (outcome === "retried") result.retried += 1;
    else result.dead += 1;
  }

  return result;
}

/** Libère les tâches bloquées par un worker disparu (verrou plus vieux que `staleMinutes`). */
export async function releaseStaleJobs(staleMinutes = 15): Promise<number> {
  const threshold = new Date(Date.now() - staleMinutes * 60 * 1000);
  const released = await prismaPlatform.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: threshold } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
  if (released.count > 0) logger.warn("tâches bloquées libérées", { count: released.count });
  return released.count;
}

export type JobStats = { pending: number; running: number; failed: number; dead: number };

export async function jobStats(): Promise<JobStats> {
  const [pending, running, failed, dead] = await Promise.all([
    prismaPlatform.job.count({ where: { status: "PENDING" } }),
    prismaPlatform.job.count({ where: { status: "RUNNING" } }),
    prismaPlatform.job.count({ where: { status: "FAILED" } }),
    prismaPlatform.job.count({ where: { status: "DEAD" } }),
  ]);
  return { pending, running, failed, dead };
}
