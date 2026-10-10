/**
 * Isolation multi-tenant — test central du produit.
 *
 * On vérifie trois garanties complémentaires :
 *  1. hors contexte de tenant, le rôle applicatif ne voit aucune ligne ;
 *  2. dans le contexte de l'organisation A, les données de B sont invisibles
 *     (y compris par identifiant direct, c'est-à-dire en modifiant l'URL) ;
 *  3. les écritures croisées sont refusées par la base, pas seulement par le code.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma, withTenant } from "@/lib/db/prisma";
import {
  createCourse,
  createLesson,
  createSection,
  publishCourse,
  updateLesson,
} from "@/server/services/courses";

import { closeTestDatabase, createTenant, createUser, resetDatabase, seedPlans } from "./helpers";

let tenantA: Awaited<ReturnType<typeof createTenant>>;
let tenantB: Awaited<ReturnType<typeof createTenant>>;
let courseA: { id: string };
let courseB: { id: string };

beforeAll(async () => {
  await resetDatabase();
  await seedPlans();

  tenantA = await createTenant("alpha");
  tenantB = await createTenant("beta");

  // Une formation ne peut être publiée qu'avec au moins une leçon publiée :
  // le programme est donc construit avant la publication.
  courseA = await createCourse({
    organizationId: tenantA.organization.id,
    instructorId: tenantA.admin.id,
    actorUserId: tenantA.admin.id,
    title: "Formation de l'organisation Alpha",
    description: "Contenu propre à Alpha.",
  });
  const sectionA = await createSection({
    organizationId: tenantA.organization.id,
    courseId: courseA.id,
    title: "Section Alpha",
  });
  const lessonA = await createLesson({
    organizationId: tenantA.organization.id,
    courseId: courseA.id,
    sectionId: sectionA.id,
    title: "Leçon Alpha",
    type: "TEXT",
    contentMd: "Contenu réservé à Alpha.",
  });
  await updateLesson({
    organizationId: tenantA.organization.id,
    lessonId: lessonA.id,
    data: { isPublished: true },
  });
  await publishCourse({
    organizationId: tenantA.organization.id,
    courseId: courseA.id,
    actorUserId: tenantA.admin.id,
  });

  courseB = await createCourse({
    organizationId: tenantB.organization.id,
    instructorId: tenantB.admin.id,
    actorUserId: tenantB.admin.id,
    title: "Formation de l'organisation Beta",
    description: "Contenu propre à Beta.",
  });
  const sectionB = await createSection({
    organizationId: tenantB.organization.id,
    courseId: courseB.id,
    title: "Section Beta",
  });
  const lessonB = await createLesson({
    organizationId: tenantB.organization.id,
    courseId: courseB.id,
    sectionId: sectionB.id,
    title: "Leçon Beta",
    type: "TEXT",
    contentMd: "Contenu réservé à Beta.",
  });
  await updateLesson({
    organizationId: tenantB.organization.id,
    lessonId: lessonB.id,
    data: { isPublished: true },
  });
  await publishCourse({
    organizationId: tenantB.organization.id,
    courseId: courseB.id,
    actorUserId: tenantB.admin.id,
  });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("isolation des données entre organisations", () => {
  it("ne renvoie aucune ligne hors contexte de tenant", async () => {
    const courses = await prisma.course.findMany();
    const lessons = await prisma.lesson.findMany();
    const memberships = await prisma.membership.findMany();

    expect(courses).toHaveLength(0);
    expect(lessons).toHaveLength(0);
    expect(memberships).toHaveLength(0);
  });

  it("ne voit que les données de son organisation", async () => {
    const seenByA = await withTenant(tenantA.organization.id, (tx) => tx.course.findMany({ select: { id: true } }));
    const seenByB = await withTenant(tenantB.organization.id, (tx) => tx.course.findMany({ select: { id: true } }));

    expect(seenByA.map((row) => row.id)).toEqual([courseA.id]);
    expect(seenByB.map((row) => row.id)).toEqual([courseB.id]);
  });

  it("refuse la lecture d'une ressource d'une autre organisation par identifiant", async () => {
    const leaked = await withTenant(tenantA.organization.id, (tx) =>
      tx.course.findUnique({ where: { id: courseB.id }, select: { id: true, title: true } }),
    );
    expect(leaked).toBeNull();
  });

  it("refuse la lecture d'une leçon d'une autre organisation", async () => {
    const lessonOfA = await withTenant(tenantA.organization.id, (tx) =>
      tx.lesson.findFirst({ select: { id: true } }),
    );
    expect(lessonOfA).not.toBeNull();

    const fromB = await withTenant(tenantB.organization.id, (tx) =>
      tx.lesson.findUnique({ where: { id: lessonOfA!.id }, select: { id: true } }),
    );
    expect(fromB).toBeNull();
  });

  it("refuse une écriture portant l'identifiant d'une autre organisation", async () => {
    await expect(
      withTenant(tenantB.organization.id, (tx) =>
        tx.course.update({
          where: { id: courseA.id },
          data: { title: "Tentative de modification croisée" },
        }),
      ),
    ).rejects.toThrow();

    const untouched = await withTenant(tenantA.organization.id, (tx) =>
      tx.course.findUnique({ where: { id: courseA.id }, select: { title: true } }),
    );
    expect(untouched?.title).toBe("Formation de l'organisation Alpha");
  });

  it("ne laisse pas fuiter les appartenances des autres organisations", async () => {
    const outsider = await createUser("outsider");
    const memberships = await withTenant(tenantA.organization.id, (tx) =>
      tx.membership.findMany({ select: { userId: true } }),
    );
    expect(memberships.map((row) => row.userId)).not.toContain(outsider.id);
  });
});
