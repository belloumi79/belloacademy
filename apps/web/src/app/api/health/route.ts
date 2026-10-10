/** Sonde de disponibilité : base de données, stockage, Jitsi, file de tâches. */

import { prismaPlatform } from "@/lib/db/prisma";
import { jsonOk, route } from "@/lib/http/api";
import { jobStats } from "@/lib/jobs";
import { isJitsiConfigured, jitsiReachable } from "@/lib/jitsi";
import { getStorage } from "@/lib/storage";
import { env } from "@/env";

export const dynamic = "force-dynamic";

export const GET = route(
  async () => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await prismaPlatform.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (error) {
      checks.database = { ok: false, detail: error instanceof Error ? error.message : "erreur" };
    }

    try {
      getStorage();
      checks.storage = { ok: true, detail: env().STORAGE_DRIVER };
    } catch (error) {
      checks.storage = { ok: false, detail: error instanceof Error ? error.message : "erreur" };
    }

    if (isJitsiConfigured()) {
      const reachable = await jitsiReachable(2500);
      checks.jitsi = { ok: reachable, detail: env().JITSI_DOMAIN };
    } else {
      checks.jitsi = { ok: false, detail: "JITSI_DOMAIN non configuré" };
    }

    try {
      const stats = await jobStats();
      checks.jobs = { ok: stats.dead === 0, detail: `pending=${stats.pending} failed=${stats.failed} dead=${stats.dead}` };
    } catch (error) {
      checks.jobs = { ok: false, detail: error instanceof Error ? error.message : "erreur" };
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return jsonOk({ status: ok ? "ok" : "degraded", version: "0.1.0", checks }, { status: ok ? 200 : 503 });
  },
  { csrf: false },
);
