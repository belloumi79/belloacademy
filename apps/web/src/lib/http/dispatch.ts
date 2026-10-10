/**
 * Répartiteur de routes API.
 *
 * Chaque ressource expose un unique *catch-all* Next.js (`/api/courses/[...path]`)
 * dont le fichier déclare ses routes sous forme de table. Le répartiteur :
 *  - associe `METHOD + segments` à la première route correspondante ;
 *  - délègue à `route()`, qui applique CSRF, limitation de débit, journalisation
 *    et traduction des erreurs (aucune de ces protections n'est réimplémentée) ;
 *  - expose les paramètres dynamiques (`:courseId`) dans `params`.
 *
 * Ce choix garde une surface d'API REST lisible et documentée tout en évitant
 * des dizaines de fichiers quasi identiques.
 */

import type { NextRequest } from "next/server";

import { badRequest, notFound } from "@/lib/errors";
import { route, type ApiContext } from "@/lib/http/api";
import type { RateLimitName } from "@/lib/rate-limit";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type DispatchContext = ApiContext<Record<string, string>> & { path: string[] };

export type ApiRouteDefinition = {
  method: HttpMethod;
  /** Motif de chemin, segments séparés par `/`. `:nom` capture un segment. */
  pattern: string;
  handler: (context: DispatchContext) => Promise<Response> | Response;
  /** Politique de limitation de débit supplémentaire appliquée dans le handler. */
  rateLimit?: RateLimitName;
};

const METHODS: HttpMethod[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

function matchPattern(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const segment = segments[index]!;
    if (part.startsWith(":")) {
      if (!segment) return null;
      params[part.slice(1)] = decodeURIComponent(segment);
      continue;
    }
    if (part !== segment) return null;
  }
  return params;
}

/**
 * Signature attendue par Next.js pour un fichier `route.ts` : la forme exacte
 * de `params` dépend du nom du dossier (`[...path]` → `{ path: string[] }`,
 * `[assetId]` → `{ assetId: string }`). Le type est donc volontairement large,
 * et les segments sont relus dans le handler.
 */
type NextRouteHandler = (
  request: NextRequest,
  segment: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

/**
 * Handler explicite pour une méthode HTTP non exposée par une ressource.
 *
 * Next.js valide la signature des exports d'un `route.ts` contre le type de
 * contexte généré (dont `params`) ; ce helper renvoie un handler correctement
 * typé qui répond systématiquement 400 au lieu de laisser Next inférer un
 * contexte incompatible.
 */
export function unsupportedMethod(message: string): NextRouteHandler {
  return route(async () => {
    throw badRequest(message);
  }) as unknown as NextRouteHandler;
}

/**
 * Construit les exports HTTP d'un fichier `route.ts` de ressource.
 *
 * @example
 * const dispatch = createDispatcher([
 *   { method: "GET", pattern: "", handler: listCourses },
 *   { method: "POST", pattern: ":courseId/publish", handler: publishCourse },
 * ]);
 * export const GET = dispatch.GET;
 * export const POST = dispatch.POST;
 */
export function createDispatcher(definitions: ApiRouteDefinition[]): Partial<Record<HttpMethod, NextRouteHandler>> {
  const handlers: Partial<Record<HttpMethod, NextRouteHandler>> = {};

  for (const method of METHODS) {
    const applicable = definitions.filter((definition) => definition.method === method);
    if (applicable.length === 0) continue;

    const isMutating = method !== "GET";
    handlers[method] = route(
      async ({ request, params, requestId }) => {
        const captured = params as unknown as { path?: string[] };
        const segments = (captured.path ?? []).filter((segment) => segment.length > 0);
        for (const definition of applicable) {
          const matched = matchPattern(definition.pattern, segments);
          if (!matched) continue;
          return definition.handler({ request, params: matched, requestId, path: segments });
        }
        throw notFound("Route API inconnue.");
      },
      isMutating ? { rateLimit: "write" } : {},
    ) as NextRouteHandler;
  }

  return handlers;
}
