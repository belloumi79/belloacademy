/**
 * Lecture d'un objet stocké localement : /api/files/:assetId
 *
 * Le pilote S3 renvoie des URL présignées ; le pilote local, lui, n'a pas
 * d'URL publique. Cette route sert donc de point de lecture unique, après
 * contrôle d'autorisation (`resolveAssetAccess`) : propriétaire, personnel de
 * l'organisation, ou apprenant inscrit à une formation référençant l'objet.
 */

import { uuidSchema } from "@belloacademy/shared";

import { route, validate } from "@/lib/http/api";
import { orgAccess } from "@/lib/http/tenant";
import { readAssetBody } from "@/server/services/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(
  async ({ request, params }) => {
    const scope = await orgAccess(request);
    const assetId = validate(uuidSchema, params.assetId);
    const file = await readAssetBody({
      organizationId: scope.organizationId,
      assetId,
      viewer: { userId: scope.userId, role: scope.role },
    });

    return new Response(file.body as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  },
  { csrf: false },
);
