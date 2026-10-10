/**
 * Facturation : /api/billing/[...path]
 *
 * La logique métier vit dans `server/services/billing` ; les routes ne font que
 * résoudre l'organisation, vérifier la permission et valider l'entrée.
 *
 * En mode de test (`BILLING_PROVIDER=mock`), aucune souscription n'est marquée
 * payée automatiquement : `POST /api/billing/confirm-mock` doit être appelé
 * explicitement, et le mode est refusé en production.
 */

import { checkoutSchema, subscriptionUpdateSchema } from "@belloacademy/shared";
import { z } from "zod";

import { createDispatcher } from "@/lib/http/dispatch";
import { jsonOk, parseBody } from "@/lib/http/api";
import { orgScope } from "@/lib/http/tenant";
import {
  cancelSubscription,
  confirmMockPayment,
  getSubscription,
  listInvoices,
  listPublicPlans,
  resumeSubscription,
  startSubscription,
} from "@/server/services/billing";

export const runtime = "nodejs";

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "billing:read");
      const [subscription, invoices, plans] = await Promise.all([
        getSubscription(scope.organizationId),
        listInvoices(scope.organizationId),
        listPublicPlans(),
      ]);
      return jsonOk({ subscription, invoices, plans });
    },
  },
  {
    method: "POST",
    pattern: "subscribe",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "billing:manage");
      const input = await parseBody(request, checkoutSchema);
      const result = await startSubscription({
        organizationId: scope.organizationId,
        planCode: input.planCode,
        interval: input.interval,
        actorUserId: scope.userId,
        startTrial: true,
      });
      return jsonOk(result);
    },
  },
  {
    method: "POST",
    pattern: "confirm-mock",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "billing:manage");
      const input = await parseBody(request, z.object({ invoiceId: z.uuid() }));
      await confirmMockPayment({
        organizationId: scope.organizationId,
        invoiceId: input.invoiceId,
        actorUserId: scope.userId,
      });
      return jsonOk({ confirmed: true });
    },
  },
  {
    method: "POST",
    pattern: "cancel",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "billing:manage");
      const input = await parseBody(request, subscriptionUpdateSchema);
      await cancelSubscription({
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        atPeriodEnd: input.cancelAtPeriodEnd ?? true,
      });
      return jsonOk({ canceled: true, atPeriodEnd: input.cancelAtPeriodEnd ?? true });
    },
  },
  {
    method: "POST",
    pattern: "resume",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "billing:manage");
      await resumeSubscription({ organizationId: scope.organizationId, actorUserId: scope.userId });
      return jsonOk({ resumed: true });
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;

export const dynamic = "force-dynamic";
