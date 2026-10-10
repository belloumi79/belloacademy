/**
 * Couche HTTP des routes API.
 *
 * Toute route est déclarée via `route()` qui centralise :
 *  - l'application du CSRF pour les méthodes mutantes ;
 *  - la limitation de débit ;
 *  - la journalisation structurée (avec identifiant de requête) ;
 *  - la traduction des erreurs en réponses JSON sans fuite d'information.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

import { assertCsrf, MUTATING_METHODS } from "@/lib/csrf";
import { AppError, isAppError, toAppError, validationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit, type RateLimitName } from "@/lib/rate-limit";
import { newRequestId } from "@/lib/auth/tokens";

export type ApiContext<TParams = Record<string, string>> = {
  request: NextRequest;
  params: TParams;
  requestId: string;
};

export type RouteOptions = {
  /** Applique la protection CSRF (activée par défaut sur les méthodes mutantes). */
  csrf?: boolean;
  /** Politique de limitation de débit. */
  rateLimit?: RateLimitName;
  /** Identifiant de limitation dérivé de la requête (IP par défaut). */
  rateLimitIdentifier?: (request: NextRequest) => string | null;
};

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as unknown as Record<string, unknown>, {
    status: 200,
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function jsonCreated<T>(data: T): NextResponse {
  return jsonOk(data, { status: 201 });
}

export function jsonError(error: AppError, requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
        requestId,
      },
    },
    { status: error.status, headers: { "cache-control": "no-store" } },
  );
}

type Handler<TParams> = (context: ApiContext<TParams>) => Promise<NextResponse | Response> | NextResponse | Response;

/**
 * Enveloppe une route API avec les protections transverses.
 *
 * @example
 * export const POST = route(async ({ request }) => {
 *   const body = await parseBody(request, schema);
 *   return jsonOk({ ok: true });
 * }, { rateLimit: "write" });
 */
export function route<TParams extends Record<string, string> = Record<string, string>>(
  handler: Handler<TParams>,
  options: RouteOptions = {},
) {
  return async (request: NextRequest, segment: { params: Promise<TParams> } | undefined) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const params = ((await segment?.params) ?? {}) as TParams;

    try {
      if (options.csrf !== false && MUTATING_METHODS.has(request.method)) {
        assertCsrf(request);
      }

      if (options.rateLimit) {
        const identifier = options.rateLimitIdentifier?.(request) ?? clientIp(request);
        await enforceRateLimit(options.rateLimit, identifier);
      }

      const response = await handler({ request, params, requestId });
      logger.request("requête API traitée", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      if (response instanceof NextResponse || response instanceof Response) {
        response.headers.set("x-request-id", requestId);
      }
      return response;
    } catch (error) {
      const appError = toAppError(error);
      if (!isAppError(error) || appError.status >= 500) {
        logger.error("erreur API", {
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          code: appError.code,
          message: appError.message,
          context: appError.context,
        });
      } else {
        logger.warn("requête refusée", {
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          code: appError.code,
        });
      }
      return jsonError(appError, requestId);
    }
  };
}

/** Lit et valide le corps JSON d'une requête. */
export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw validationError("Corps de requête JSON invalide.");
  }
  return validate(schema, raw);
}

/** Valide une donnée quelconque (paramètres de requête, formulaire…). */
export function validate<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError("Données invalides.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** Construit un objet de recherche paginé à partir de l'URL. */
export function searchParams(request: NextRequest): URLSearchParams {
  return new URL(request.url).searchParams;
}
