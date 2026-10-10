/**
 * Fichiers privés : autorisation en lecture et cloisonnement.
 *
 * Vérifie le critère d'acceptation : « les fichiers privés ne sont pas
 * accessibles sans autorisation ». L'accès est décidé côté serveur, à partir de
 * l'appartenance à l'organisation, du rôle, de la propriété du dépôt et de
 * l'inscription à la formation qui référence l'objet — jamais depuis le client.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enrollUser } from "@/server/services/enrollments";
import { createLessonResource } from "@/server/services/courses";
import { requestUpload, resolveAssetAccess, storeUploadedBody } from "@/server/services/uploads";

import {
  addMember,
  closeTestDatabase,
  createLearner,
  createPublishedCourse,
  createTenant,
  createUser,
  resetDatabase,
  seedPlans,
} from "./helpers";

type Tenant = Awaited<ReturnType<typeof createTenant>>;

let tenant: Tenant;
let otherTenant: Tenant;
let learner: Awaited<ReturnType<typeof createLearner>>;
let course: Awaited<ReturnType<typeof createPublishedCourse>>;

/** Dépose un fichier privé réellement stocké (pilote local en test). */
async function uploadPrivateFile(
  options: { organizationId: string; userId: string; filename?: string } = {
    organizationId: "",
    userId: "",
  },
) {
  const organizationId = options.organizationId || tenant.organization.id;
  const userId = options.userId || tenant.admin.id;
  const filename = options.filename ?? "support-interne.pdf";

  const ticket = await requestUpload({
    organizationId,
    userId,
    filename,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    category: "lessons",
    visibility: "PRIVATE",
  });

  await storeUploadedBody({
    organizationId,
    userId,
    assetId: ticket.assetId,
    body: new Uint8Array(1024),
    contentType: "application/pdf",
  });

  return ticket.assetId;
}

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
  tenant = await createTenant("fichiers");
  otherTenant = await createTenant("externe");
  learner = await createLearner(tenant, "fichiers-apprenant");
  course = await createPublishedCourse(tenant, { title: "Formation documentée", lessonCount: 2 });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("autorisation d'accès à un fichier privé", () => {
  it("autorise le déposant à lire son propre fichier", async () => {
    const assetId = await uploadPrivateFile();

    const resolved = await resolveAssetAccess({
      organizationId: tenant.organization.id,
      assetId,
      viewer: { userId: tenant.admin.id, role: "ORG_ADMIN" },
    });

    expect(resolved.assetId).toBe(assetId);
    expect(resolved.filename).toBe("support-interne.pdf");
  });

  it("refuse un apprenant qui n'est pas inscrit à la formation concernée", async () => {
    const assetId = await uploadPrivateFile();
    await createLessonResource({
      organizationId: tenant.organization.id,
      lessonId: course.lessons[0]!.id,
      title: "Support du cours",
      assetId,
    });

    await expect(
      resolveAssetAccess({
        organizationId: tenant.organization.id,
        assetId,
        viewer: { userId: learner.id, role: "LEARNER" },
      }),
    ).rejects.toThrow();
  });

  it("autorise un apprenant inscrit à la formation qui référence le fichier", async () => {
    const assetId = await uploadPrivateFile();
    await createLessonResource({
      organizationId: tenant.organization.id,
      lessonId: course.lessons[0]!.id,
      title: "Support du cours",
      assetId,
    });
    await enrollUser({
      organizationId: tenant.organization.id,
      courseId: course.course.id,
      userId: learner.id,
      source: "self",
    });

    const resolved = await resolveAssetAccess({
      organizationId: tenant.organization.id,
      assetId,
      viewer: { userId: learner.id, role: "LEARNER" },
    });

    expect(resolved.assetId).toBe(assetId);
  });

  it("refuse un membre d'une autre organisation, même avec l'identifiant exact", async () => {
    const assetId = await uploadPrivateFile();
    const foreigner = await createUser("fichiers-externe");
    await addMember(otherTenant.organization.id, foreigner.id, "ORG_ADMIN");

    await expect(
      resolveAssetAccess({
        organizationId: otherTenant.organization.id,
        assetId,
        viewer: { userId: foreigner.id, role: "ORG_ADMIN" },
      }),
    ).rejects.toThrow();
  });

  it("ne divulgue jamais le chemin de stockage interne au client", async () => {
    const assetId = await uploadPrivateFile();
    const resolved = await resolveAssetAccess({
      organizationId: tenant.organization.id,
      assetId,
      viewer: { userId: tenant.admin.id, role: "ORG_ADMIN" },
    });

    expect(resolved).not.toHaveProperty("uploadUrl");
    expect(JSON.stringify(resolved)).not.toContain("..");
  });
});

describe("validation des dépôts", () => {
  it("refuse un type de fichier non autorisé", async () => {
    await expect(
      requestUpload({
        organizationId: tenant.organization.id,
        userId: tenant.admin.id,
        filename: "script.sh",
        mimeType: "application/x-sh",
        sizeBytes: 512,
        category: "lessons",
        visibility: "PRIVATE",
      }),
    ).rejects.toThrow();
  });

  it("refuse un fichier dépassant la taille maximale", async () => {
    await expect(
      requestUpload({
        organizationId: tenant.organization.id,
        userId: tenant.admin.id,
        filename: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 5 * 1024 * 1024 * 1024,
        category: "lessons",
        visibility: "PRIVATE",
      }),
    ).rejects.toThrow();
  });
});
