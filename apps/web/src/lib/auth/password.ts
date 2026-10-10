/**
 * Hachage des mots de passe.
 *
 * `scrypt` (fourni par Node, sans dépendance native) est utilisé avec un sel
 * aléatoire par utilisateur. Le format stocké est auto-descriptif :
 *
 *   scrypt$<N>$<r>$<p>$<sel base64>$<empreinte base64>
 *
 * Les comparaisons sont faites en temps constant. Les paramètres peuvent être
 * durcis sans casser les empreintes existantes : `needsRehash` indique alors
 * qu'une ré-écriture est souhaitable à la prochaine connexion réussie.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** Paramètres courants (coût ≈ 32 Mio de mémoire, ~100 ms sur un CPU moderne). */
const CURRENT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 } as const;
const MAX_MEM = 256 * 1024 * 1024;

export type PasswordPolicyResult = { ok: true } | { ok: false; reasons: string[] };

/**
 * Politique de mot de passe : longueur, diversité minimale.
 * Volontairement simple et prévisible (pas de règles exotiques).
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const reasons: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    reasons.push(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    reasons.push(`Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);
  }
  const categories = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (categories < 3) {
    reasons.push("Le mot de passe doit mélanger au moins trois types de caractères (minuscules, majuscules, chiffres, symboles).");
  }
  if (/^(.)\1+$/.test(password)) {
    reasons.push("Le mot de passe ne peut pas être une répétition d'un seul caractère.");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, CURRENT.keylen, {
    N: CURRENT.N,
    r: CURRENT.r,
    p: CURRENT.p,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; digest: Buffer };

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return null;
  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(parts[4] ?? "", "base64"),
      digest: Buffer.from(parts[5] ?? "", "base64"),
    };
  } catch {
    return null;
  }
}

/** Vérifie un mot de passe. Renvoie `false` pour toute empreinte illisible. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const derived = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.digest.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: MAX_MEM,
  });
  if (derived.length !== parsed.digest.length) return false;
  return timingSafeEqual(derived, parsed.digest);
}

export function needsRehash(stored: string | null | undefined): boolean {
  const parsed = stored ? parseHash(stored) : null;
  if (!parsed) return true;
  return parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.digest.length < CURRENT.keylen;
}
