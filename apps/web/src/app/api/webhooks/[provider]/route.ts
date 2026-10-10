/**
 * Webhooks de prestataires de paiement : /api/webhooks/:provider
 *
 * Route **publique** par nature (le prestataire ne possède pas de session), donc
 * hors CSRF, mais protégée autrement :
 *  - limitation de débit dédiée ;
 *  - vérification de signature HMAC (`verifyStripeSignature`) sur le corps brut ;
 *  - idempotence garantie par l'unicité `(provider, eventId)` sur `payment_events`.
 *
 * Le corps est lu tel quel : toute désérialisation préalable invaliderait la
 * signature.
 */

import { env } from "@/env";
import { badRequest, forbidden, notFound, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { newRequestId } from "@/lib/auth/tokens";
import { handleWebhook } from "@/server/services/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = { stripe: "STRIPE", mock: "MOCK" } as const;

type ProviderKey = keyof typeof PROVIDERS;

export async function POST(request: Request, segment: { params: Promise<{ provider: string }> }) {
  const requestId = newRequestId();
  try {
    const { provider } = await segment.params;
    const key = provider?.toLowerCase() as ProviderKey | undefined;
    if (!key || !(key in PROVIDERS)) throw notFound("Prestataire de paiement inconnu.");

    const forwarded = request.headers.get("x-forwarded-for");
    await enforceRateLimit("webhook", forwarded?.split(",")[0]?.trim() ?? "unknown");

    const rawBody = await request.text();
    if (!rawBody) throw badRequest("Corps de requête vide.");

    const result = await handleWebhook({
      provider: PROVIDERS[key],
      rawBody,
      signatureHeader: request.headers.get("stripe-signature"),
    });

    return Response.json(result, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.status >= 500) {
      logger.error("webhook en échec", { requestId, code: appError.code, message: appError.message });
    } else {
      logger.warn("webhook refusé", { requestId, code: appError.code });
    }
    return Response.json(
      { error: { code: appError.code, message: appError.message, requestId } },
      { status: appError.status, headers: { "cache-control": "no-store" } },
    );
  }
}

/** Sonde de configuration : indique le prestataire actif sans révéler de secret. */
export async function GET(_request: Request, segment: { params: Promise<{ provider: string }> }) {
  const { provider } = await segment.params;
  const active = env().BILLING_PROVIDER;
  if (!provider || !(provider.toLowerCase() in PROVIDERS)) throw notFound("Prestataire inconnu.");
  if (provider.toLowerCase() !== active) {
    throw forbidden("Ce prestataire n'est pas celui configuré sur cette instance.");
  }
  return Response.json({ provider: active, configured: true });
}
