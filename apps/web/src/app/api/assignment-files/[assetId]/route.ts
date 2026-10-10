/**
 * Réception du contenu d'un fichier de devoir : /api/assignment-files/:assetId
 *
 * Même contrat que `/api/uploads/put/:assetId`, mais ouvert aux apprenants. La
 * taille est plafonnée avant lecture et le corps vide est refusé ; le service
 * revérifie ensuite que l'objet appartient bien au déposant et respecte la
 * catégorie `submissions`.
 */

import { uuidSchema } from "@belloacademy/shared";

import { jsonOk, route, validate } from "@/lib/http/api";
import { payloadTooLarge, unsupportedMediaType } from "@/lib/errors";
import { orgAccess } from "@/lib/http/tenant";
import { storeUploadedBody } from "@/server/services/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = route(
  async ({ request, params }) => {
    const scope = await orgAccess(request);
    const assetId = validate(uuidSchema, params.assetId);

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > 200 * 1024 * 1024) throw payloadTooLarge();

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
  { csrf: false },
);
