/**
 * Limitation de débit des requêtes sensibles (connexion, inscription,
 * réinitialisation de mot de passe, envoi de fichiers, webhooks).
 *
 * Le compteur est stocké dans le cache partagé (Redis si configuré). En cas
 * d'indisponibilité, on ne bloque pas l'utilisateur : la limitation est un
 * garde-fou, pas une dépendance dure.
 */

import { env } from "@/env";
import { getCacheStore } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { rateLimited } from "@/lib/errors";

export type RateLimitPolicy = {
  /** Nombre d'actions autorisées sur la fenêtre. */
  limit: number;
  /** Durée de la fenêtre en secondes. */
  windowSeconds: number;
};

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 15 * 60 },
  register: { limit: 5, windowSeconds: 60 * 60 },
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  emailVerification: { limit: 5, windowSeconds: 60 * 60 },
  invitation: { limit: 30, windowSeconds: 60 * 60 },
  upload: { limit: 60, windowSeconds: 60 * 60 },
  webhook: { limit: 600, windowSeconds: 60 },
  write: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function buildRateLimitKey(name: RateLimitName, identifier: string): string {
  return `ratelimit:${name}:${identifier}`;
}

export async function consumeRateLimit(
  name: RateLimitName,
  identifier: string,
  policy: RateLimitPolicy = RATE_LIMITS[name],
): Promise<RateLimitResult> {
  if (!env().RATE_LIMIT_ENABLED) {
    return { allowed: true, remaining: policy.limit, retryAfterSeconds: 0 };
  }

  try {
    const cache = await getCacheStore();
    const key = buildRateLimitKey(name, identifier);
    const used = await cache.increment(key, policy.windowSeconds);
    if (used <= policy.limit) {
      return { allowed: true, remaining: Math.max(0, policy.limit - used), retryAfterSeconds: 0 };
    }
    const ttl = await cache.ttl(key);
    return { allowed: false, remaining: 0, retryAfterSeconds: ttl > 0 ? ttl : policy.windowSeconds };
  } catch (error) {
    logger.warn("Limitation de débit indisponible", { name, error });
    return { allowed: true, remaining: policy.limit, retryAfterSeconds: 0 };
  }
}

/** Variante stricte : lève une erreur 429 si la limite est dépassée. */
export async function enforceRateLimit(name: RateLimitName, identifier: string): Promise<void> {
  const result = await consumeRateLimit(name, identifier);
  if (!result.allowed) {
    throw rateLimited(
      `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil(result.retryAfterSeconds / 60))} minute(s).`,
    );
  }
}
