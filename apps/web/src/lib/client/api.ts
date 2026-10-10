/**
 * Client HTTP des composants navigateur.
 *
 * Toute mutation passe par `apiFetch`, qui :
 *  - ajoute l'en-tête CSRF lu dans le cookie (double soumission) ;
 *  - demande explicitement du JSON (`Accept`), afin de ne jamais recevoir une
 *    page HTML d'erreur à la place d'une réponse d'API ;
 *  - normalise les erreurs en `ApiError` exploitable par les formulaires.
 */

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@belloacademy/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export type ApiFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  organizationId?: string | null;
  signal?: AbortSignal;
};

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };

  if (method !== "GET") {
    headers["content-type"] = "application/json";
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) headers[CSRF_HEADER_NAME] = csrf;
  }
  if (options.organizationId) headers["x-organization-id"] = options.organizationId;

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      error?.message ?? "La requête a échoué. Réessayez.",
      response.status,
      error?.code ?? "UNKNOWN",
      error?.details,
    );
  }

  return payload as T;
}

/** Déclenche le téléchargement d'un fichier protégé (URL temporaire). */
export async function downloadAsset(assetId: string): Promise<void> {
  const result = await apiFetch<{ url: string }>(`/api/uploads/${assetId}/download`);
  window.open(result.url, "_blank", "noopener,noreferrer");
}
