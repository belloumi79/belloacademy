/**
 * Erreurs applicatives typées.
 *
 * Le message porté par `AppError` est destiné à l'utilisateur (il est renvoyé tel
 * quel par la couche HTTP) : il ne doit jamais contenir d'information sensible.
 * Les détails techniques restent dans `context`, journalisé côté serveur.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PLAN_LIMIT_REACHED"
  | "NOT_CONFIGURED"
  | "INTERNAL";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly context?: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.context = options.context;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, { details });

export const validationError = (message: string, details?: unknown) =>
  new AppError(422, "VALIDATION_ERROR", message, { details });

export const unauthenticated = (message = "Authentification requise.") =>
  new AppError(401, "UNAUTHENTICATED", message);

export const forbidden = (message = "Accès refusé.") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Ressource introuvable.") =>
  new AppError(404, "NOT_FOUND", message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "CONFLICT", message, { details });

export const rateLimited = (message = "Trop de requêtes. Réessayez plus tard.") =>
  new AppError(429, "RATE_LIMITED", message);

export const payloadTooLarge = (message = "Fichier trop volumineux.") =>
  new AppError(413, "PAYLOAD_TOO_LARGE", message);

export const unsupportedMediaType = (message = "Type de fichier non pris en charge.") =>
  new AppError(415, "UNSUPPORTED_MEDIA_TYPE", message);

export const planLimitReached = (message: string, details?: unknown) =>
  new AppError(402, "PLAN_LIMIT_REACHED", message, { details });

/** Service indisponible faute de configuration (503, jamais 500). */
export const notConfigured = (message = "Service non configuré sur cette instance.") =>
  new AppError(503, "NOT_CONFIGURED", message);

export const internal = (message = "Une erreur interne est survenue.", context?: Record<string, unknown>) =>
  new AppError(500, "INTERNAL", message, { context });

/** Vrai si l'erreur est exploitable par la couche HTTP. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  // Erreurs Prisma connues (contrainte d'unicité, enregistrement absent).
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2002") {
      const target = (error as { meta?: { target?: unknown } }).meta?.target;
      return conflict("Cette valeur existe déjà.", { target });
    }
    if (code === "P2025") return notFound();
    if (code === "P2003") return badRequest("Référence invalide : l'élément lié n'existe pas.");
  }

  return internal("Une erreur interne est survenue.", {
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
  });
}
