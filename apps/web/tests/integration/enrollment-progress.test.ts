/**
 * Parcours d'apprentissage : inscription, progression, reprise.
 *
 * Vérifie le critère d'acceptation central côté apprenant : on s'inscrit à une
 * formation autorisée, on marque des leçons terminées, la progression est
 * persistée puis restaurée (reprise là où l'apprenant s'est arrêté).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getCourseForLearner, getLessonForLearner } from "@/server/services/courses";
import { enrollUser, listEnrollments, markLessonProgress, nextLesson } from "@/server/services/enrollments";

import {
  closeTestDatabase,
  createLearner,
  createPublishedCourse,
  createTenant,
  resetDatabase,
  seedPlans,
} from "./helpers";

type Tenant = Awaited<ReturnType<typeof createTenant>>;
type Learner = Awaited<ReturnType<typeof createLearner>>;
type Course = Awaited<ReturnType<typeof createPublishedCourse>>;

let tenant: Tenant;
let learner: Learner;
let course: Course;

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
  tenant = await createTenant("apprenant");
  learner = await createLearner(tenant);
  course = await createPublishedCourse(tenant, {
    title: "Formation de test",
    lessonCount: 3,
    priceCents: 0,
  });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("inscription à une formation gratuite", () => {
  it("inscrit l'apprenant et expose la formation débloquée", async () => {
    const enrollment = await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    expect(enrollment.status).toBe("ACTIVE");
    expect(enrollment.progressPercent).toBe(0);

    const detail = await getCourseForLearner(tenant.organization.id, course.course.slug, learner.id);
    expect(detail.enrollment).not.toBeNull();
    expect(detail.course.sections.length).toBeGreaterThan(0);
  });

  it("refuse une seconde inscription identique", async () => {
    const input = {
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self" as const,
    };

    await enrollUser(input);
    await expect(enrollUser(input)).rejects.toThrow();
  });

  it("n'expose aucune inscription à un visiteur non inscrit", async () => {
    const detail = await getCourseForLearner(tenant.organization.id, course.course.slug, learner.id);
    expect(detail.enrollment).toBeNull();
  });
});

describe("protection du contenu réservé", () => {
  it("refuse le contenu d'une leçon sans inscription", async () => {
    const lessonId = course.lessons[0]!.id;

    await expect(
      getLessonForLearner({
        organizationId: tenant.organization.id,
        lessonId,
        userId: learner.id,
      }),
    ).rejects.toThrow(/Inscrivez-vous/);
  });

  it("ouvre le contenu d'une leçon à un apprenant inscrit", async () => {
    const enrollment = await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const lesson = await nextLesson(tenant.organization.id, enrollment.id);
    expect(lesson).not.toBeNull();

    const detail = await getLessonForLearner({
      organizationId: tenant.organization.id,
      lessonId: lesson!.id,
      userId: learner.id,
    });

    expect(detail.locked).toBe(false);
    expect(detail.lesson.id).toBe(lesson!.id);
  });
});

describe("progression et reprise", () => {
  it("persiste la progression et la restaure", async () => {
    const enrollment = await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const first = await nextLesson(tenant.organization.id, enrollment.id);
    expect(first).not.toBeNull();

    await markLessonProgress({
      organizationId: tenant.organization.id,
      enrollmentId: enrollment.id,
      lessonId: first!.id,
      userId: learner.id,
      completed: true,
      positionSeconds: 120,
    });

    const afterFirst = await listEnrollments(tenant.organization.id, learner.id);
    expect(afterFirst[0]?.progressPercent).toBeGreaterThan(0);

    const second = await nextLesson(tenant.organization.id, enrollment.id);
    expect(second?.id).not.toBe(first!.id);

    await markLessonProgress({
      organizationId: tenant.organization.id,
      enrollmentId: enrollment.id,
      lessonId: second!.id,
      userId: learner.id,
      completed: true,
      positionSeconds: 90,
    });

    const progress = await listEnrollments(tenant.organization.id, learner.id);
    expect(progress[0]?.progressPercent).toBeGreaterThan(afterFirst[0]!.progressPercent);
  });

  it("marque la formation terminée quand toutes les leçons sont validées", async () => {
    const enrollment = await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    let guard = 0;
    let cursor = await nextLesson(tenant.organization.id, enrollment.id);
    while (cursor && guard < 20) {
      await markLessonProgress({
        organizationId: tenant.organization.id,
        enrollmentId: enrollment.id,
        lessonId: cursor.id,
        userId: learner.id,
        completed: true,
        positionSeconds: 30,
      });
      cursor = await nextLesson(tenant.organization.id, enrollment.id);
      guard += 1;
    }

    expect(guard).toBe(3);
    const summaries = await listEnrollments(tenant.organization.id, learner.id);
    expect(summaries[0]?.progressPercent).toBe(100);
    expect(summaries[0]?.status).toBe("COMPLETED");
  });
});
