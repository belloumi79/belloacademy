/**
 * Certificats : /api/certificates/[...path]
 *
 * L'émission est refusée si les conditions de réussite ne sont pas réunies
 * (progression terminée + note minimale du cours). Le PDF est généré puis
 * stocké ; la page publique de vérification ne divulgue que le strict
 * nécessaire (nom, intitulé de formation, organisation, date, numéro).
 */

import { z } from "zod";
import { uuidSchema } from "@belloacademy/shared";

import { createDispatcher } from "@/lib/http/dispatch";
import { jsonCreated, jsonOk, parseBody, validate } from "@/lib/http/api";
import { orgScope } from "@/lib/http/tenant";
import {
  getCertificatePdf,
  issueCertificate,
  listCourseCertificates,
  listMyCertificates,
  revokeCertificate,
} from "@/server/services/certificates";

export const runtime = "nodejs";

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "certificate:read");
      const url = new URL(request.url);
      const courseId = url.searchParams.get("courseId");
      if (courseId) {
        const certificates = await listCourseCertificates(
          scope.organizationId,
          validate(uuidSchema, courseId),
        );
        return jsonOk({ certificates });
      }
      const certificates = await listMyCertificates({
        organizationId: scope.organizationId,
        userId: scope.userId,
      });
      return jsonOk({ certificates });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "certificate:issue");
      const input = await parseBody(
        request,
        z.object({
          courseId: uuidSchema,
          userId: uuidSchema,
          finalScore: z.coerce.number().int().min(0).max(1000).nullable().optional(),
        }),
      );
      const certificate = await issueCertificate({
        organizationId: scope.organizationId,
        courseId: input.courseId,
        userId: input.userId,
        finalScore: input.finalScore ?? null,
        actorUserId: scope.userId,
      });
      return jsonCreated({ certificate });
    },
  },
  {
    method: "POST",
    pattern: ":certificateId/revoke",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "certificate:revoke");
      const certificateId = validate(uuidSchema, params.certificateId);
      const input = await parseBody(
        request,
        z.object({ reason: z.string().trim().max(500).optional() }),
      );
      const certificate = await revokeCertificate({
        organizationId: scope.organizationId,
        certificateId,
        actorUserId: scope.userId,
        reason: input.reason ?? null,
      });
      return jsonOk({ certificate });
    },
  },
  {
    method: "GET",
    pattern: ":certificateId/pdf",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "certificate:read");
      const certificateId = validate(uuidSchema, params.certificateId);
      const file = await getCertificatePdf({
        organizationId: scope.organizationId,
        certificateId,
        viewerUserId: scope.userId,
        canReview: scope.role !== "LEARNER",
      });
      return new Response(file.body as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
          "cache-control": "private, no-store",
        },
      });
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;

export const dynamic = "force-dynamic";
