/**
 * Classes virtuelles (Jitsi Meet).
 *
 * Cycle de vie d'une session : `SCHEDULED` → `LIVE` → `ENDED` (ou `CANCELLED`).
 *
 * Décisions d'accès, toutes vérifiées côté serveur :
 *  - l'utilisateur doit être membre actif de l'organisation (RLS + contrôle explicite) ;
 *  - un apprenant doit être inscrit à la formation ;
 *  - la salle n'ouvre qu'à partir de `JOIN_WINDOW_BEFORE_MINUTES` avant le début
 *    et se referme `JOIN_WINDOW_AFTER_MINUTES` après la fin ;
 *  - l'animateur (formateur titulaire, co-animateur ou administrateur) reçoit le
 *    rôle `moderator` ; les autres participants le rôle `participant`.
 *
 * Un nom de salle non devinable n'est **pas** considéré comme une protection :
 * l'autorisation est décidée ici, puis le jeton JWT (si l'instance le requiert)
 * porte le rôle et la salle.
 */

import { LIVE_SESSION_STATUSES, type LiveSessionStatus, type LiveParticipantRole } from "@belloacademy/shared";

import { prismaPlatform, withTenant } from "@/lib/db/prisma";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { buildJoinDescriptor, generateRoomName, isJitsiConfigured, jitsiDomain } from "@/lib/jitsi";
import { notifyMany } from "@/lib/notifications";
import { enqueue } from "@/lib/jobs";
import { env } from "@/env";

export const JOIN_WINDOW_BEFORE_MINUTES = 15;
export const JOIN_WINDOW_AFTER_MINUTES = 60;

export type ScheduleLiveSessionInput = {
  organizationId: string;
  courseId: string;
  actorUserId: string;
  title: string;
  description?: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  timezone?: string;
};

function assertWindow(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw badRequest("Dates de session invalides.");
  }
  if (end.getTime() <= start.getTime()) {
    throw badRequest("La fin de la session doit suivre son début.");
  }
  const maxDurationMs = 12 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > maxDurationMs) {
    throw badRequest("Une session ne peut pas dépasser 12 heures.");
  }
}

/** Programme une session en direct et prévient les apprenants inscrits. */
export async function scheduleLiveSession(input: ScheduleLiveSessionInput) {
  assertWindow(input.scheduledStart, input.scheduledEnd);
  if (!isJitsiConfigured()) {
    throw conflict("Jitsi Meet n'est pas configuré sur cette instance (JITSI_DOMAIN).");
  }

  const session = await withTenant(input.organizationId, async (tx) => {
    const course = await tx.course.findFirst({
      where: { id: input.courseId, organizationId: input.organizationId },
      select: { id: true, title: true, slug: true },
    });
    if (!course) throw notFound("Formation introuvable.");

    return tx.liveSession.create({
      data: {
        organizationId: input.organizationId,
        courseId: course.id,
        hostUserId: input.actorUserId,
        createdById: input.actorUserId,
        title: input.title,
        description: input.description ?? null,
        roomName: generateRoomName(course.id),
        provider: "JITSI",
        jitsiDomain: jitsiDomain(),
        status: "SCHEDULED",
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        timezone: input.timezone ?? "Africa/Tunis",
      },
      select: { id: true, roomName: true, title: true, scheduledStart: true, courseId: true },
    });
  });

  await recordAudit({
    action: "live_session.created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "LiveSession",
    entityId: session.id,
    metadata: { courseId: input.courseId, scheduledStart: input.scheduledStart.toISOString() },
  });

  await notifyEnrolledLearners({
    organizationId: input.organizationId,
    courseId: input.courseId,
    sessionId: session.id,
    title: session.title,
    startsAt: session.scheduledStart,
  });

  // Rappel programmé (idempotent : une seule tâche par session et par échéance).
  await enqueue(
    "live.reminder",
    { sessionId: session.id, organizationId: input.organizationId },
    {
      runAt: new Date(session.scheduledStart.getTime() - 30 * 60 * 1000),
      dedupeKey: `live.reminder:${session.id}`,
    },
  );

  return session;
}

async function notifyEnrolledLearners(input: {
  organizationId: string;
  courseId: string;
  sessionId: string;
  title: string;
  startsAt: Date;
}): Promise<void> {
  const enrollments = await withTenant(input.organizationId, (tx) =>
    tx.enrollment.findMany({
      where: { courseId: input.courseId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { userId: true },
      take: 500,
    }),
  );
  if (enrollments.length === 0) return;

  const when = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Tunis",
  }).format(input.startsAt);

  await notifyMany(
    enrollments.map((enrollment) => ({
      userId: enrollment.userId,
      organizationId: input.organizationId,
      type: "LIVE_SESSION_REMINDER" as const,
      title: "Nouvelle classe virtuelle programmée",
      body: `${input.title} — ${when}`,
      href: `/app/live/${input.sessionId}`,
      data: { sessionId: input.sessionId },
    })),
  );
}

/** Liste les sessions d'une formation, avec état recalculé. */
export async function listCourseLiveSessions(organizationId: string, courseId: string) {
  const sessions = await withTenant(organizationId, (tx) =>
    tx.liveSession.findMany({
      where: { courseId, organizationId },
      orderBy: { scheduledStart: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        roomName: true,
        scheduledStart: true,
        scheduledEnd: true,
        timezone: true,
        startedAt: true,
        endedAt: true,
        recordingUrl: true,
        host: { select: { id: true, name: true } },
        _count: { select: { attendances: true } },
      },
    }),
  );
  return sessions.map((session) => ({ ...session, status: deriveStatus(session) }));
}

/** Prochaines sessions visibles par un utilisateur (toutes ses organisations). */
export async function listUpcomingSessions(organizationId: string, userId: string, limit = 10) {
  const sessions = await withTenant(organizationId, (tx) =>
    tx.liveSession.findMany({
      where: {
        organizationId,
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledEnd: { gte: new Date(Date.now() - JOIN_WINDOW_AFTER_MINUTES * 60 * 1000) },
        OR: [
          { hostUserId: userId },
          { course: { enrollments: { some: { userId, status: { in: ["ACTIVE", "COMPLETED"] } } } } },
        ],
      },
      orderBy: { scheduledStart: "asc" },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        timezone: true,
        course: { select: { id: true, title: true, slug: true } },
        host: { select: { id: true, name: true } },
      },
    }),
  );
  return sessions.map((session) => ({ ...session, status: deriveStatus(session) }));
}

export async function getLiveSession(organizationId: string, sessionId: string) {
  const session = await withTenant(organizationId, (tx) =>
    tx.liveSession.findFirst({
      where: { id: sessionId, organizationId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        roomName: true,
        jitsiDomain: true,
        scheduledStart: true,
        scheduledEnd: true,
        timezone: true,
        startedAt: true,
        endedAt: true,
        recordingUrl: true,
        hostUserId: true,
        courseId: true,
        host: { select: { id: true, name: true } },
        course: { select: { id: true, title: true, slug: true } },
        attendances: {
          orderBy: { joinedAt: "desc" },
          select: {
            id: true,
            userId: true,
            role: true,
            joinedAt: true,
            leftAt: true,
            durationSeconds: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    }),
  );
  if (!session) throw notFound("Session introuvable.");
  return { ...session, status: deriveStatus(session) };
}

/** État effectif : une session programmée dont la fenêtre est ouverte est « en cours ». */
export function deriveStatus(session: {
  status: LiveSessionStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
}): LiveSessionStatus {
  if (session.status === "CANCELLED" || session.status === "ENDED") return session.status;
  const now = Date.now();
  if (now >= session.scheduledStart.getTime() && now <= session.scheduledEnd.getTime()) return "LIVE";
  return session.status;
}

export type JoinDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "not_member"
    | "not_enrolled"
    | "cancelled"
    | "ended"
    | "too_early"
    | "too_late"
    | "not_configured";
  message?: string;
  role: LiveParticipantRole;
};

/**
 * Décide si un utilisateur peut rejoindre une session.
 * C'est la seule porte d'entrée vers un descripteur de connexion.
 */
export async function decideJoin(input: {
  organizationId: string;
  sessionId: string;
  userId: string;
  isOrgStaff: boolean;
}): Promise<{ decision: JoinDecision; session: Awaited<ReturnType<typeof getLiveSession>> | null }> {
  const membership = await prismaPlatform.membership.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId, status: "ACTIVE" },
    select: { role: true },
  });
  const staff = input.isOrgStaff || membership?.role === "ORG_ADMIN" || membership?.role === "INSTRUCTOR";

  if (!membership && !staff) {
    return {
      decision: { allowed: false, reason: "not_member", role: "PARTICIPANT" },
      session: null,
    };
  }

  const session = await getLiveSession(input.organizationId, input.sessionId);
  const role: LiveParticipantRole =
    session.hostUserId === input.userId ? "HOST" : staff ? "MODERATOR" : "PARTICIPANT";

  if (!isJitsiConfigured()) {
    return { decision: { allowed: false, reason: "not_configured", role }, session };
  }
  if (session.status === "CANCELLED") {
    return { decision: { allowed: false, reason: "cancelled", role }, session };
  }
  if (session.status === "ENDED") {
    return { decision: { allowed: false, reason: "ended", role }, session };
  }

  // Un apprenant doit être inscrit ; l'équipe pédagogique entre librement.
  if (role === "PARTICIPANT") {
    const enrollment = await withTenant(input.organizationId, (tx) =>
      tx.enrollment.findFirst({
        where: { courseId: session.courseId, userId: input.userId, status: { in: ["ACTIVE", "COMPLETED"] } },
        select: { id: true },
      }),
    );
    if (!enrollment) {
      return { decision: { allowed: false, reason: "not_enrolled", role }, session };
    }
  }

  const now = Date.now();
  const opensAt = session.scheduledStart.getTime() - JOIN_WINDOW_BEFORE_MINUTES * 60 * 1000;
  const closesAt = session.scheduledEnd.getTime() + JOIN_WINDOW_AFTER_MINUTES * 60 * 1000;
  if (role === "PARTICIPANT" && now < opensAt) {
    return {
      decision: {
        allowed: false,
        reason: "too_early",
        role,
        message: `La salle ouvre ${JOIN_WINDOW_BEFORE_MINUTES} minutes avant le début.`,
      },
      session,
    };
  }
  if (now > closesAt) {
    return { decision: { allowed: false, reason: "too_late", role }, session };
  }

  return { decision: { allowed: true, reason: "ok", role }, session };
}

/** Enregistre l'entrée en salle et renvoie le descripteur de connexion Jitsi. */
export async function joinLiveSession(input: {
  organizationId: string;
  sessionId: string;
  userId: string;
  displayName: string;
  isOrgStaff: boolean;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const { decision, session } = await decideJoin(input);
  if (!session) throw notFound("Session introuvable.");
  if (!decision.allowed) {
    if (decision.reason === "not_member") throw forbidden("Vous n'appartenez pas à cette organisation.");
    if (decision.reason === "not_enrolled") throw forbidden("Vous n'êtes pas inscrit à cette formation.");
    throw conflict(decision.message ?? "Cette session n'est pas accessible pour le moment.");
  }

  const descriptor = await buildJoinDescriptor({
    roomName: session.roomName,
    userId: input.userId,
    displayName: input.displayName,
    role: decision.role,
    ttlSeconds: Math.max(60, Math.round((session.scheduledEnd.getTime() - Date.now()) / 1000) + 3600),
  });

  await withTenant(input.organizationId, async (tx) => {
    await tx.liveAttendance.create({
      data: {
        organizationId: input.organizationId,
        liveSessionId: session.id,
        userId: input.userId,
        role: decision.role,
        joinedAt: new Date(),
      },
    });
    if (session.status === "SCHEDULED") {
      await tx.liveSession.update({
        where: { id: session.id },
        data: { status: "LIVE", startedAt: session.startedAt ?? new Date() },
      });
    }
  });

  await recordAudit({
    action: "live_session.joined",
    organizationId: input.organizationId,
    actorUserId: input.userId,
    entityType: "LiveSession",
    entityId: session.id,
    metadata: { role: decision.role },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return descriptor;
}

/** Marque la sortie d'un participant (durée de présence). */
export async function leaveLiveSession(input: {
  organizationId: string;
  sessionId: string;
  userId: string;
}): Promise<void> {
  await withTenant(input.organizationId, async (tx) => {
    const attendance = await tx.liveAttendance.findFirst({
      where: { liveSessionId: input.sessionId, userId: input.userId, leftAt: null },
      orderBy: { joinedAt: "desc" },
      select: { id: true, joinedAt: true },
    });
    if (!attendance) return;
    const leftAt = new Date();
    await tx.liveAttendance.update({
      where: { id: attendance.id },
      data: {
        leftAt,
        durationSeconds: Math.max(0, Math.round((leftAt.getTime() - attendance.joinedAt.getTime()) / 1000)),
      },
    });
  });
}

export async function updateLiveSession(input: {
  organizationId: string;
  sessionId: string;
  actorUserId: string;
  title?: string;
  description?: string | null;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  status?: LiveSessionStatus;
}) {
  if (!LIVE_SESSION_STATUSES.includes(input.status as LiveSessionStatus) && input.status !== undefined) {
    throw badRequest("Statut de session invalide.");
  }

  const updated = await withTenant(input.organizationId, async (tx) => {
    const current = await tx.liveSession.findFirst({
      where: { id: input.sessionId, organizationId: input.organizationId },
      select: { id: true, scheduledStart: true, scheduledEnd: true },
    });
    if (!current) throw notFound("Session introuvable.");

    const start = input.scheduledStart ?? current.scheduledStart;
    const end = input.scheduledEnd ?? current.scheduledEnd;
    if (input.scheduledStart || input.scheduledEnd) assertWindow(start, end);

    return tx.liveSession.update({
      where: { id: current.id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.scheduledStart ? { scheduledStart: input.scheduledStart } : {}),
        ...(input.scheduledEnd ? { scheduledEnd: input.scheduledEnd } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.status === "ENDED" ? { endedAt: new Date() } : {}),
      },
      select: { id: true, title: true, status: true, scheduledStart: true, scheduledEnd: true },
    });
  });

  await recordAudit({
    action: input.status === "CANCELLED" ? "live_session.cancelled" : "live_session.updated",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "LiveSession",
    entityId: updated.id,
    metadata: { status: updated.status },
  });

  return updated;
}

/** Sessions dont le rappel doit être envoyé (utilisé par le worker). */
export async function sessionsNeedingReminder(windowMinutes = 35) {
  const now = new Date();
  const until = new Date(now.getTime() + windowMinutes * 60 * 1000);
  return prismaPlatform.liveSession.findMany({
    where: { status: "SCHEDULED", scheduledStart: { gte: now, lte: until } },
    select: { id: true, organizationId: true, courseId: true, title: true, scheduledStart: true, hostUserId: true },
  });
}

export { env as liveEnv };
