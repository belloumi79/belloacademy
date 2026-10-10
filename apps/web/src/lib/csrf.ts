/**
 * Protection CSRF.
 *
 * Stratégie « double soumission » : un jeton aléatoire est déposé dans un cookie
 * lisible par le client, et doit être renvoyé dans l'en-tête `x-csrf-token` sur
 * toute méthode mutante. Un attaquant inter-site ne peut pas lire le cookie, donc
 * ne peut pas forger l'en-tête. Le contrôle d'origine est appliqué en complément.
 *
 * Les routes API n'acceptent pas de jeton dans le corps : les clients doivent
 * envoyer l'en-tête.
 */

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { env } from "@/env";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@belloacademy/shared";
import { createToken } from "@/lib/auth/tokens";
import { forbidden } from "@/lib/errors";

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CSRF_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Émet (ou renouvelle) le cookie CSRF. À appeler lors de l'ouverture d'une session. */
export async function issueCsrfToken(): Promise<string> {
  const token = createToken(CSRF_TOKEN_TTL_SECONDS).token;
  const cookieStore = await cookies();
  cookieStore.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: CSRF_TOKEN_TTL_SECONDS,
  });
  return token;
}

export async function clearCsrfToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set({ name: CSRF_COOKIE_NAME, value: "", path: "/", maxAge: 0 });
}

/**
 * Vérifie l'origine de la requête puis le jeton CSRF.
 * @throws AppError 403 si l'un des deux contrôles échoue.
 */
export function assertCsrf(request: NextRequest): void {
  const expectedOrigin = new URL(env().APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin) {
    throw forbidden("Origine de la requête non autorisée.");
  }

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") {
    throw forbidden("Requête inter-site refusée.");
  }

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
    throw forbidden("Jeton CSRF manquant ou invalide.");
  }
}
