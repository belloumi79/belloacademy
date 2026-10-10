/**
 * Jetons opaques à usage unique (vérification d'e-mail, réinitialisation de mot
 * de passe, invitations) et jetons de session.
 *
 * Le secret n'est **jamais** stocké en clair : seule l'empreinte SHA-256 est
 * conservée en base. Un jeton volé en base ne permet donc pas de s'authentifier.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type TokenKind = "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "ORG_INVITE";

/** Jeton aléatoire de 32 octets, encodé en base64url (URL-safe, sans padding). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export type NewToken = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function createToken(ttlSeconds: number, now: Date = new Date()): NewToken {
  const token = generateOpaqueToken();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

/** Identifiant de salle Jitsi : suffixe aléatoire non devinable. */
export function generateRoomSuffix(): string {
  return randomBytes(12).toString("hex");
}

/**
 * Code de vérification lisible (numéro de série, code public de certificat).
 * Alphabet sans caractères ambigus (ni 0/O, ni 1/I/L) pour faciliter la saisie.
 */
export function generateVerificationCode(length = 20): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += alphabet[bytes[index]! % alphabet.length];
  }
  return code;
}

export function newRequestId(): string {
  return randomUUID();
}
