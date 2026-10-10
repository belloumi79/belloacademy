/**
 * Fichiers : autorisation, dépôt et téléchargement.
 *
 * Principe de sécurité : **aucun objet n'est public par défaut**. Une ressource
 * privée n'est accessible qu'après une décision d'autorisation côté serveur,
 * calculée à partir de l'appartenance à l'organisation, du rôle et de
 * l'inscription au cours concerné. Les URL S3 présignées sont de courte durée
 * et ne sont délivrées qu'après cette décision.
 *
 * Le pilote `local` n'expose pas d'URL directe : le dépôt et la lecture passent
 * par des routes API qui revérifient les droits (aucun accès direct au disque).
 */

import { randomUUID } from "node:crypto";

import { validateUpload } from "@belloacademy/shared";

import { env } from "@/env";
import { recordAudit } from "@/lib/audit";
import { prisma, withTenant } from "@/lib/db/prisma";
import { badRequest, forbidden, notFound, unsupportedMediaType } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getStorage, newObjectKey, type StorageCategory } from "@/lib/storage";
import { assertWithinPlan, getUsage } from "@/server/services/organizations";

export type ViewerContext = {
  userId: string;
  isSuperAdmin?: boolean;
  /** Rôle dans l'organisation, `null` si l'utilisateur n'est pas membre. */
  role?: string | null;
};

export type RequestUploadInput = {
  organizationId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: StorageCategory;
  visibility?: "PRIVATE" | "PUBLIC";
  /**
   * Préfixe de l'URL de dépôt local. Permet aux apprenants de déposer leurs
   * devoirs via une route ouverte à leurs permissions, sans élargir celles de
   * la route générale `/api/uploads`.
   */
  localUploadBasePath?: string;
};

export type UploadTicket = {
  assetId: string;
  key: string;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

/** Déclare un dépôt : valide le fichier, vérifie le forfait, réserve l'objet. */
export async function requestUpload(input: RequestUploadInput): Promise<UploadTicket> {
  const check = validateUpload({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    filename: input.filename,
  });
  if (!check.ok) {
    throw unsupportedMediaType(check.reason);
  }

  const sizeMb = Math.ceil(input.sizeBytes / (1024 * 1024));
  const usage = await getUsage(input.organizationId);
  await assertWithinPlan(input.organizationId, "storageMb", sizeMb, usage.storageMb);

  const assetId = randomUUID();
  const key = newObjectKey({
    organizationId: input.organizationId,
    category: input.category,
    filename: input.filename,
    uuid: assetId,
  });
  const storage = getStorage();
  const bucket = env().STORAGE_DRIVER === "s3" ? (env().S3_BUCKET ?? "belloacademy") : "local";

  await withTenant(input.organizationId, (tx) =>
    tx.asset.create({
      data: {
        id: assetId,
        organizationId: input.organizationId,
        uploaderId: input.userId,
        driver: storage.kind,
        bucket,
        objectKey: key,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        visibility: input.visibility ?? "PRIVATE",
      },
    }),
  );

  const presigned = await storage.presignPut(key, input.mimeType, 900);
  const uploadUrl = presigned ?? `${input.localUploadBasePath ?? "/api/uploads/put"}/${assetId}`;

  return {
    assetId,
    key,
    method: "PUT",
    uploadUrl,
    headers: presigned ? { "Content-Type": input.mimeType } : {},
    expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
  };
}

/** Enregistre le fichier côté serveur (pilote local) après réception du corps. */
export async function storeUploadedBody(input: {
  organizationId: string;
  userId: string;
  assetId: string;
  body: Uint8Array;
  contentType: string | null;
}): Promise<{ sizeBytes: number }> {
  const asset = await withTenant(input.organizationId, (tx) =>
    tx.asset.findFirst({
      where: { id: input.assetId },
      select: { id: true, objectKey: true, mimeType: true, uploaderId: true, filename: true },
    }),
  );
  if (!asset) throw notFound("Fichier introuvable.");

  // Un ticket n'est honoré que par celui qui l'a demandé : sans ce contrôle,
  // n'importe quel membre disposant de la permission d'écriture pourrait
  // remplacer le contenu d'un objet en devinant son identifiant.
  if (asset.uploaderId !== input.userId) {
    throw forbidden("Ce dépôt de fichier ne vous appartient pas.");
  }

  // La validation porte sur le nom d'origine : la clé d'objet contient des
  // séparateurs de dossiers et échouerait sur le contrôle de nom de fichier.
  const check = validateUpload({
    mimeType: asset.mimeType,
    sizeBytes: input.body.byteLength,
    filename: asset.filename,
  });
  if (!check.ok) throw unsupportedMediaType(check.reason);

  await getStorage().putObject({ key: asset.objectKey, body: input.body, contentType: asset.mimeType });

  await withTenant(input.organizationId, (tx) =>
    tx.asset.update({ where: { id: asset.id }, data: { sizeBytes: input.body.byteLength } }),
  );

  await recordAudit({
    action: "file.uploaded",
    organizationId: input.organizationId,
    actorUserId: input.userId,
    entityType: "asset",
    entityId: asset.id,
    metadata: { sizeBytes: input.body.byteLength, mimeType: asset.mimeType },
  });

  return { sizeBytes: input.body.byteLength };
}

/**
 * Autorisation en lecture : propriétaire du dépôt, membre du personnel
 * pédagogique ou administratif, ou apprenant inscrit à un cours utilisant
 * l'objet. Un objet `PUBLIC` reste lisible par tout utilisateur authentifié.
 */
export async function resolveAssetAccess(input: {
  organizationId: string;
  assetId: string;
  viewer: ViewerContext;
}): Promise<{ assetId: string; objectKey: string; filename: string; mimeType: string; visibility: string }> {
  const asset = await withTenant(input.organizationId, (tx) =>
    tx.asset.findFirst({
      where: { id: input.assetId },
      select: { id: true, objectKey: true, filename: true, mimeType: true, visibility: true, uploaderId: true },
    }),
  );
  if (!asset) throw notFound("Fichier introuvable.");

  const isOwner = asset.uploaderId === input.viewer.userId;
  const isStaff =
    input.viewer.isSuperAdmin === true ||
    input.viewer.role === "ORG_ADMIN" ||
    input.viewer.role === "INSTRUCTOR" ||
    input.viewer.role === "BILLING_MANAGER";

  if (!isOwner && !isStaff && asset.visibility !== "PUBLIC") {
    const authorized = await viewerHasCourseAccess(input.organizationId, asset.id, input.viewer.userId);
    if (!authorized) {
      throw forbidden("Vous n'avez pas accès à ce fichier.");
    }
  }

  return {
    assetId: asset.id,
    objectKey: asset.objectKey,
    filename: asset.filename,
    mimeType: asset.mimeType,
    visibility: asset.visibility,
  };
}

/** Vrai si l'utilisateur est inscrit à un cours référençant cet objet. */
async function viewerHasCourseAccess(organizationId: string, assetId: string, userId: string): Promise<boolean> {
  const enrollment = await withTenant(organizationId, (tx) =>
    tx.enrollment.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "COMPLETED"] },
        course: {
          OR: [
            { lessons: { some: { resources: { some: { assetId } } } } },
            { instructorId: userId },
          ],
        },
      },
      select: { id: true },
    }),
  );
  return Boolean(enrollment);
}

/** URL de téléchargement : directe (S3 présignée) ou via l'API (local). */
export async function getDownloadUrl(input: {
  organizationId: string;
  assetId: string;
  viewer: ViewerContext;
}): Promise<{ url: string; filename: string; mimeType: string }> {
  const asset = await resolveAssetAccess(input);
  const storage = getStorage();
  const presigned = await storage.presignGet(asset.objectKey, { filename: asset.filename, expiresInSeconds: 300 });

  await recordAudit({
    action: "file.downloaded",
    organizationId: input.organizationId,
    actorUserId: input.viewer.userId,
    entityType: "asset",
    entityId: asset.assetId,
  });

  return {
    url: presigned ?? `/api/files/${asset.assetId}`,
    filename: asset.filename,
    mimeType: asset.mimeType,
  };
}

/** Lit le corps d'un objet après autorisation (pilote local). */
export async function readAssetBody(input: {
  organizationId: string;
  assetId: string;
  viewer: ViewerContext;
}): Promise<{ body: Uint8Array; filename: string; mimeType: string }> {
  const asset = await resolveAssetAccess(input);
  const stored = await getStorage().getObject(asset.objectKey);
  if (!stored) throw notFound("Fichier introuvable dans le stockage.");
  return { body: stored.body, filename: asset.filename, mimeType: stored.contentType ?? asset.mimeType };
}

/** Supprime un objet (propriétaire ou administrateur). */
export async function deleteAsset(input: {
  organizationId: string;
  assetId: string;
  actorUserId: string;
}): Promise<void> {
  const asset = await withTenant(input.organizationId, (tx) =>
    tx.asset.findFirst({ where: { id: input.assetId }, select: { id: true, objectKey: true } }),
  );
  if (!asset) throw notFound("Fichier introuvable.");

  try {
    await getStorage().deleteObject(asset.objectKey);
  } catch (error) {
    logger.warn("suppression de l'objet impossible", { objectKey: asset.objectKey, error });
  }

  await withTenant(input.organizationId, (tx) => tx.asset.delete({ where: { id: asset.id } }));
}

/** Liste les objets d'une organisation (administration). */
export async function listAssets(input: {
  organizationId: string;
  category?: StorageCategory;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const prefix = input.category ? `org/${input.organizationId}/${input.category}/` : `org/${input.organizationId}/`;
  return prisma.asset.findMany({
    where: { organizationId: input.organizationId, objectKey: { startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      visibility: true,
      createdAt: true,
      uploader: { select: { id: true, name: true } },
    },
  });
}

/** Vérifie qu'un dépôt est bien rattaché à son organisation (anti-IDOR). */
export async function assertAssetOwnership(organizationId: string, assetId: string): Promise<void> {
  const found = await withTenant(organizationId, (tx) =>
    tx.asset.findFirst({ where: { id: assetId }, select: { id: true } }),
  );
  if (!found) throw badRequest("Fichier invalide pour cette organisation.");
}
