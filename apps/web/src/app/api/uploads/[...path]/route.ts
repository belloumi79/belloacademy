/**
 * Dépôt et accès aux fichiers : /api/uploads/[...path]
 *
 * Deux flux coexistent :
 *  - stockage S3/MinIO : `POST /api/uploads` renvoie une URL présignée, le
 *    client dépose directement l'objet, puis `POST /api/uploads/:assetId/confirm` ;
 *  - stockage local (développement) : l'URL renvoyée pointe sur
 *    `PUT /api/uploads/put/:assetId`, qui écrit le corps reçu via le pilote local.
 *
 * Dans les deux cas, la taille et le type sont revalidés côté serveur avant
 * l'enregistrement : un client ne peut pas contourner la liste blanche.
 */

import { z } from "zod";
import { uuidSchema, uploadRequestSchema } from "@belloacademy/shared";

import { createDispatcher } from "@/lib/http/dispatch";
import { jsonCreated, jsonOk, parseBody, validate } from "@/lib/http/api";
import { orgScope } from "@/lib/http/tenant";
import { payloadTooLarge, unsupportedMediaType } from "@/lib/errors";
import {
  deleteAsset,
  getDownloadUrl,
  listAssets,
  requestUpload,
  storeUploadedBody,
} from "@/server/services/uploads";

export const runtime = "nodejs";

const categorySchema = z.enum(["courses", "lessons", "avatars", "submissions", "certificates", "org-assets"]);

const confirmSchema = z.object({ sizeBytes: z.coerce.number().int().min(1).optional() });

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "course:read");
      const url = new URL(request.url);
      const category = url.searchParams.get("category");
      const assets = await listAssets({
        organizationId: scope.organizationId,
        ...(category ? { category: validate(categorySchema, category) } : {}),
      });
      return jsonOk({ assets });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, uploadRequestSchema);
      const category = validate(
        categorySchema,
        new URL(request.url).searchParams.get("category") ?? "lessons",
      );
      const ticket = await requestUpload({
        organizationId: scope.organizationId,
        userId: scope.userId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        category,
        visibility: input.visibility,
      });
      return jsonCreated(ticket);
    },
  },
  {
    method: "PUT",
    pattern: "put/:assetId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const assetId = validate(uuidSchema, params.assetId);
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > 200 * 1024 * 1024) {
        throw payloadTooLarge();
      }
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength === 0) throw unsupportedMediaType("Fichier vide.");
      const result = await storeUploadedBody({
        organizationId: scope.organizationId,
        userId: scope.userId,
        assetId,
        body,
        contentType: request.headers.get("content-type"),
      });
      return jsonOk(result);
    },
  },
  {
    method: "POST",
    pattern: ":assetId/confirm",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const assetId = validate(uuidSchema, params.assetId);
      await parseBody(request, confirmSchema);
      const download = await getDownloadUrl({
        organizationId: scope.organizationId,
        assetId,
        viewer: { userId: scope.userId, role: scope.role },
      });
      return jsonOk({ confirmed: true, assetId, filename: download.filename });
    },
  },
  {
    method: "GET",
    pattern: ":assetId/download",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:read");
      const assetId = validate(uuidSchema, params.assetId);
      const result = await getDownloadUrl({
        organizationId: scope.organizationId,
        assetId,
        viewer: { userId: scope.userId, role: scope.role },
      });
      // En stockage local, l'URL renvoyée est une route de l'API : on la relaie
      // en redirection plutôt que d'exposer un chemin interne.
      if (result.url.startsWith("/")) {
        return new Response(null, { status: 302, headers: { location: result.url } });
      }
      return jsonOk(result);
    },
  },
  {
    method: "DELETE",
    pattern: ":assetId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const assetId = validate(uuidSchema, params.assetId);
      await deleteAsset({ organizationId: scope.organizationId, assetId, actorUserId: scope.userId });
      return jsonOk({ deleted: true, assetId });
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;
export const PUT = dispatch.PUT;
export const DELETE = dispatch.DELETE;

export const dynamic = "force-dynamic";