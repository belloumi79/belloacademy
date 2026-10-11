/**
 * Gestionnaires de tâches asynchrones.
 *
 * Chaque tâche est idempotente : une tâche rejouée après un incident ne doit
 * jamais produire deux fois le même effet (deux e-mails, deux certificats, deux
 * factures). L'idempotence est obtenue soit par une contrainte d'unicité, soit
 * par un état vérifié avant écriture.
 */

import { env } from "@/env";
import { prismaPlatform } from "@/lib/db/prisma";
import { enqueue, registerJobHandler } from "@/lib/jobs";
import { sendTemplateMail, type MailTemplateName } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { notifyMany } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit";
import { issueCertificate } from "@/server/services/certificates";
import { renewDueSubscriptions } from "@/server/services/billing";
import { sessionsNeedingReminder } from "@/server/services/live";
import { getUsage } from "@/server/services/organizations";

function appUrl(): string {
  return env().APP_URL;
}

/** Envoi d'un e-mail transactionnel à partir d'un gabarit. */
function registerEmailHandlers(): void {
  registerJobHandler("email.send", async (payload) => {
    const to = typeof payload.to === "string" ? payload.to : null;
    const template = typeof payload.template === "string" ? payload.template : null;
    const context =
      typeof payload.context === "object" && payload.context !== null
        ? (payload.context as Record<string, unknown>)
        : {};
    if (!to || !template) {
      logger.warn("tâche e-mail incomplète ignorée", { template, hasRecipient: Boolean(to) });
      return;
    }
    const result = await sendTemplateMail({
      to,
      template: template as MailTemplateName,
      context: { ...context, appUrl: appUrl() },
    });
    if (result.status === "FAILED") {
      // On relève l'erreur pour que la file applique sa politique de reprise.
      throw new Error(result.error ?? "échec d'envoi d'e-mail");
    }
  });
}

/** Émission d'un certificat (après validation des conditions de réussite). */
function registerCertificateHandlers(): void {
  registerJobHandler("certificate.issue", async (payload) => {
    const organizationId = typeof payload.organizationId === "string" ? payload.organizationId : null;
    const courseId = typeof payload.courseId === "string" ? payload.courseId : null;
    const userId = typeof payload.userId === "string" ? payload.userId : null;
    if (!organizationId || !courseId || !userId) {
      logger.warn("tâche de certificat incomplète ignorée", { organizationId, courseId, userId });
      return;
    }
    const finalScore = typeof payload.finalScore === "number" ? payload.finalScore : null;
    await issueCertificate({ organizationId, courseId, userId, finalScore });
  });
}

/** Rappels de classes virtuelles : une notification et un e-mail par participant. */
function registerLiveHandlers(): void {
  registerJobHandler("live.reminder", async (payload) => {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    if (!sessionId) return;

    const session = await prismaPlatform.liveSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        organizationId: true,
        courseId: true,
        title: true,
        scheduledStart: true,
        status: true,
        course: { select: { slug: true, title: true } },
      },
    });
    if (!session || session.status !== "SCHEDULED") return;

    const participants = await prismaPlatform.enrollment.findMany({
      where: { courseId: session.courseId, status: "ACTIVE" },
      select: { userId: true, user: { select: { email: true, name: true, locale: true } } },
    });

    const href = `/tableau-de-bord/classes-virtuelles/${session.id}`;
    await notifyMany(
      participants.map((participant) => ({
        userId: participant.userId,
        organizationId: session.organizationId,
        type: "LIVE_SESSION_REMINDER" as const,
        title: `Classe virtuelle bientôt : ${session.title}`,
        body: `La session « ${session.course.title} » commence le ${session.scheduledStart.toISOString()}.`,
        href,
        data: { sessionId: session.id },
      })),
    );

    for (const participant of participants) {
      await enqueue(
        "email.send",
        {
          to: participant.user.email,
          template: "live_session_reminder",
          context: {
            name: participant.user.name,
            courseTitle: session.course.title,
            sessionTitle: session.title,
            startsAt: session.scheduledStart.toISOString(),
            sessionId: session.id,
          },
        },
        { dedupeKey: `live-reminder:${session.id}:${participant.userId}` },
      );
    }

    logger.info("rappels de session programmés", {
      sessionId: session.id,
      recipients: participants.length,
    });
  });

  // Transition SCHEDULED → LIVE → ENDED pilotée par l'horloge, sans action humaine.
  registerJobHandler("live.status_sync", async () => {
    const now = new Date();
    const started = await prismaPlatform.liveSession.updateMany({
      where: { status: "SCHEDULED", scheduledStart: { lte: now }, scheduledEnd: { gt: now } },
      data: { status: "LIVE", startedAt: now },
    });
    const ended = await prismaPlatform.liveSession.updateMany({
      where: { status: { in: ["SCHEDULED", "LIVE"] }, scheduledEnd: { lte: now } },
      data: { status: "ENDED", endedAt: now },
    });
    if (started.count > 0 || ended.count > 0) {
      logger.info("synchronisation des statuts de session", { started: started.count, ended: ended.count });
    }
  });
}

/** Cycle de vie des abonnements : renouvellements et expirations. */
function registerBillingHandlers(): void {
  registerJobHandler("billing.subscription_renewal", async () => {
    const outcome = await renewDueSubscriptions();
    if (outcome.renewed > 0 || outcome.expired > 0) {
      logger.info("cycle de facturation traité", { renewed: outcome.renewed, expired: outcome.expired });
    }
  });

  registerJobHandler("billing.trial_check", async (payload) => {
    const organizationId = typeof payload.organizationId === "string" ? payload.organizationId : null;
    if (!organizationId) return;
    const organization = await prismaPlatform.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, trialEndsAt: true, plan: { select: { code: true } } },
    });
    if (!organization?.trialEndsAt) return;
    if (organization.trialEndsAt.getTime() > Date.now()) {
      // Toujours en essai : on replanifie la vérification à l'échéance.
      await enqueue(
        "billing.trial_check",
        { organizationId },
        { runAt: organization.trialEndsAt, dedupeKey: `trial-check:${organizationId}` },
      );
      return;
    }
    await recordAudit({
      action: "billing.subscription_changed",
      organizationId,
      entityType: "Organization",
      entityId: organizationId,
      metadata: { reason: "trial_expired", previousPlan: organization.plan?.code ?? null },
    });
    logger.info("essai gratuit arrivé à échéance", { organizationId });
  });
}

/** Photographie de la consommation : alimente les compteurs et l'audit. */
function registerUsageHandlers(): void {
  registerJobHandler("plan.usage_snapshot", async () => {
    const organizations = await prismaPlatform.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, slug: true },
    });
    for (const organization of organizations) {
      const usage = await getUsage(organization.id);
      logger.info("consommation mesurée", { organizationId: organization.id, slug: organization.slug, usage });
    }
    logger.info("photographie de consommation enregistrée", { organizations: organizations.length });
  });
}

/** Enregistre tous les gestionnaires. À appeler une fois par processus. */
export function registerAllJobHandlers(): void {
  registerEmailHandlers();
  registerCertificateHandlers();
  registerLiveHandlers();
  registerBillingHandlers();
  registerUsageHandlers();
}

/**
 * Programmes récurrents. `dedupeKey` garantit qu'une seule occurrence est en
 * file à un instant donné, même si plusieurs workers appellent cette fonction.
 */
export async function scheduleRecurringJobs(now: Date = new Date()): Promise<void> {
  const jobs: Array<{ name: Parameters<typeof enqueue>[0]; runAt: Date; dedupeKey: string }> = [
    {
      name: "billing.subscription_renewal",
      runAt: new Date(now.getTime() + 5 * 60 * 1000),
      dedupeKey: `recurring:billing.subscription_renewal:${now.toISOString().slice(0, 13)}`,
    },
    {
      name: "live.status_sync",
      runAt: new Date(now.getTime() + 60 * 1000),
      dedupeKey: `recurring:live.status_sync:${Math.floor(now.getTime() / 300000)}`,
    },
    {
      name: "plan.usage_snapshot",
      runAt: new Date(now.getTime() + 15 * 60 * 1000),
      dedupeKey: `recurring:plan.usage_snapshot:${now.toISOString().slice(0, 13)}`,
    },
  ];

  for (const job of jobs) {
    await enqueue(job.name, {}, { runAt: job.runAt, dedupeKey: job.dedupeKey });
  }
}

/** Programme un rappel pour chaque session entrant dans la fenêtre de rappel. */
export async function enqueueDueReminders(windowMinutes = 35): Promise<number> {
  const sessions = await sessionsNeedingReminder(windowMinutes);
  let scheduled = 0;
  for (const session of sessions) {
    const created = await enqueue(
      "live.reminder",
      { sessionId: session.id },
      { dedupeKey: `live-reminder-job:${session.id}` },
    );
    if (created) scheduled += 1;
  }
  return scheduled;
}
