/**
 * Dépôt de fichiers pour les devoirs : /api/assignment-files
 *
 * Cette route existe parce que les apprenants n'ont pas la permission
 * `course:update` qui protège `/api/uploads`. Elle est donc volontairement
 * étroite : appartenance active à l'organisation, catégorie imposée
 * (`submissions`) et visibilité forcée à `PRIVATE`. Le fichier déposé reste
 * lisible par son déposant, par le personnel de l'organisation (correction) et
 * par personne d'autre.
 */

import { uploadRequestSchema } from "@belloacademy/shared";

import { jsonCreated, parseBody, route } from "@/lib/http/api";
import { orgAccess } from "@/lib/http/tenant";
import { requestUpload } from "@/server/services/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async ({ request }) => {
  const scope = await orgAccess(request);
  const input = await parseBody(request, uploadRequestSchema);

  const ticket = await requestUpload({
    organizationId: scope.organizationId,
    userId: scope.userId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    category: "submissions",
    visibility: "PRIVATE",
    localUploadBasePath: "/api/assignment-files",
  });

  return jsonCreated(ticket);
});
