/**
 * Classes virtuelles Jitsi Meet : planification, contrôle d'accès et connexion.
 *
 * Vérifie le critère d'acceptation : « une session Jitsi peut être planifiée et
 * rejoindre la réunion selon les droits de l'utilisateur ». Le contrôle d'accès
 * ne repose jamais sur le seul caractère imprévisible du nom de salle : il est
 * décidé côté serveur à partir de l'appartenance, de l'inscription et de l'état
 * de la session.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  decideJoin,
  joinLiveSession,
  listUpcomingSessions,
  scheduleLiveSession,
  sessionsNeedingReminder,
  updateLiveSession,
} from "@/server/services/live";
import { enrollUser } from "@/server/services/enrollments";

import {
  closeTestDatabase,
  createLearner,
  createPublishedCourse,
  createTenant,
  resetDatabase,
  seedPlans,
} from "./helpers";

type Tenant = Awaited<ReturnType<typeof createTenant>>;

let tenant: Tenant;
let otherTenant: Tenant;
let learner: Awaited<ReturnType<typeof createLearner>>;
let course: Awaited<ReturnType<typeof createPublishedCourse>>;

function windowIn(hoursFromNow: number, durationMinutes = 60) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  return { scheduledStart: start, scheduledEnd: new Date(start.getTime() + durationMinutes * 60 * 1000) };
}

/** Session ouverte immédiatement : la salle ouvre 15 min avant le début. */
function windowNow(durationMinutes = 60) {
  const start = new Date(Date.now() - 60 * 1000);
  return { scheduledStart: start, scheduledEnd: new Date(start.getTime() + durationMinutes * 60 * 1000) };
}

async function schedule(overrides: Partial<Parameters<typeof scheduleLiveSession>[0]> = {}) {
  return scheduleLiveSession({
    organizationId: tenant.organization.id,
    courseId: course.course.id,
    actorUserId: tenant.admin.id,
    title: "Atelier en direct",
    ...windowIn(2),
    ...overrides,
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
  tenant = await createTenant("direct");
  otherTenant = await createTenant("voisin");
  learner = await createLearner(tenant, "direct-apprenant");
  course = await createPublishedCourse(tenant, { title: "Formation en direct", lessonCount: 2 });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("planification d'une session en direct", () => {
  it("génère un nom de salle non devinable et programme un rappel", async () => {
    const session = await schedule();
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    expect(session.roomName).toMatch(/^[a-z0-9]{8,20}-[a-z0-9]{12,32}$/);

    const upcoming = await listUpcomingSessions(tenant.organization.id, learner.id, 10);
    expect(upcoming.map((entry) => entry.id)).toContain(session.id);
  });

  it("refuse une fenêtre incohérente", async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    await expect(
      scheduleLiveSession({
        organizationId: tenant.organization.id,
        courseId: course.course.id,
        actorUserId: tenant.admin.id,
        title: "Fenêtre invalide",
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() - 60 * 1000),
      }),
    ).rejects.toThrow();
  });

  it("ne programme aucun rappel pour une session annulée", async () => {
    const session = await schedule();
    await updateLiveSession({
      status: "CANCELLED",
      organizationId: tenant.organization.id,
      sessionId: session.id,
      actorUserId: tenant.admin.id,
    });

    const reminders = await sessionsNeedingReminder(35);
    expect(reminders.map((entry) => entry.id)).not.toContain(session.id);
  });
});

describe("contrôle d'accès à la salle", () => {
  it("refuse un utilisateur non inscrit", async () => {
    const session = await schedule();
    const { decision } = await decideJoin({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: learner.id,
      isOrgStaff: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not_enrolled");
  });

  it("accepte un apprenant inscrit avec le rôle participant", async () => {
    const session = await schedule(windowNow());
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const { decision } = await decideJoin({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: learner.id,
      isOrgStaff: false,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.role).toBe("PARTICIPANT");
  });

  it("refuse un membre d'une autre organisation", async () => {
    const session = await schedule();
    const { decision } = await decideJoin({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: otherTenant.admin.id,
      isOrgStaff: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not_member");
  });

  it("donne le rôle animateur à l'équipe pédagogique", async () => {
    const session = await schedule();
    const { decision } = await decideJoin({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: tenant.admin.id,
      isOrgStaff: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.role).toBe("HOST");
  });

  it("refuse une session annulée, même à l'animateur", async () => {
    const session = await schedule();
    await updateLiveSession({
      status: "CANCELLED",
      organizationId: tenant.organization.id,
      sessionId: session.id,
      actorUserId: tenant.admin.id,
    });

    const { decision } = await decideJoin({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: tenant.admin.id,
      isOrgStaff: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cancelled");
  });
});

describe("connexion à la réunion", () => {
  it("fournit un descripteur de connexion complet à un apprenant inscrit", async () => {
    const session = await schedule(windowNow());
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const descriptor = await joinLiveSession({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: learner.id,
      displayName: "Apprenant Test",
      isOrgStaff: false,
    });

    expect(descriptor.domain).toBeTruthy();
    expect(descriptor.roomName).toBe(session.roomName);
    expect(descriptor.url).toContain(session.roomName);
    expect(descriptor.isModerator).toBe(false);
    expect(descriptor.role).toBe("PARTICIPANT");
  });

  it("marque l'animateur comme modérateur", async () => {
    const session = await schedule(windowNow());
    const descriptor = await joinLiveSession({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: tenant.admin.id,
      displayName: "Formateur Test",
      isOrgStaff: true,
    });

    expect(descriptor.isModerator).toBe(true);
    expect(descriptor.role).toBe("HOST");
  });

  it("journalise la présence sans divulguer de données personnelles", async () => {
    const session = await schedule(windowNow());
    await joinLiveSession({
      organizationId: tenant.organization.id,
      sessionId: session.id,
      userId: tenant.admin.id,
      displayName: "Formateur Test",
      isOrgStaff: true,
    });

    const { prismaPlatform } = await import("@/lib/db/prisma");
    const attendance = await prismaPlatform.liveAttendance.findMany({
      where: { liveSessionId: session.id },
      select: { userId: true, role: true, joinedAt: true },
    });

    expect(attendance).toHaveLength(1);
    expect(attendance[0]?.role).toBe("HOST");
  });
});
