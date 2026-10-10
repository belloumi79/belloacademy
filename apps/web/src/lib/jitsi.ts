/**
 * Intégration Jitsi Meet.
 *
 * Deux modes supportés :
 *  - instance publique (`meet.jit.si`) : aucun jeton, l'accès est contrôlé en amont
 *    par BelloAcademy (le nom de salle n'est jamais exposé avant autorisation) ;
 *  - instance auto-hébergée avec authentification par jeton (JWT) : BelloAcademy
 *    signe un jeton de courte durée, avec le rôle (modérateur ou participant) et
 *    le nom de salle. Le secret ne quitte jamais le serveur.
 *
 * Le nom de salle respecte un format strict et non devinable (`JITSI_ROOM_PATTERN`),
 * mais il n'est **pas** considéré comme une protection : la décision d'accès est
 * prise côté serveur (`decideLiveAccess`) avant toute génération de jeton ou d'URL.
 */

import { SignJWT } from "jose";

import { env } from "@/env";
import { internal } from "@/lib/errors";
import { buildJitsiRoomName, isValidJitsiRoomName, type LiveParticipantRole } from "@belloacademy/shared";
import { generateRoomSuffix } from "@/lib/auth/tokens";

export type JitsiJoinContext = {
  roomName: string;
  userId: string;
  displayName: string;
  email?: string | null;
  role: LiveParticipantRole;
  /** Durée de validité du jeton (secondes). */
  ttlSeconds?: number;
};

export type JitsiJoinDescriptor = {
  domain: string;
  roomName: string;
  /** URL de l'interface Jitsi (à charger dans l'iframe ou à ouvrir). */
  url: string;
  /** Jeton signé, uniquement lorsque l'instance l'exige. */
  jwt: string | null;
  displayName: string;
  role: LiveParticipantRole;
  /** Vrai si l'utilisateur est animateur/modérateur (peut gérer la salle). */
  isModerator: boolean;
  expiresAt: Date | null;
};

/**
 * Génère un nom de salle non devinable pour une session.
 *
 * Le préfixe d'instance est intégré à la partie lisible (et non collé devant le
 * nom déjà construit) : la partie lisible reste ainsi bornée à 20 caractères,
 * conformément à `JITSI_ROOM_PATTERN`. La partie aléatoire (24 caractères
 * hexadécimaux) garantit qu'un nom de salle n'est pas devinable.
 */
export function generateRoomName(courseId: string): string {
  const prefix = env().JITSI_ROOM_PREFIX.replace(/[^a-z0-9]/gi, "").toLowerCase() || "belloacademy";
  const suffix = generateRoomSuffix();
  const slug = courseId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  // Une seule implémentation du format de salle : celle du domaine partagé.
  const room = buildJitsiRoomName(`${prefix}${slug}`, suffix);
  if (!isValidJitsiRoomName(room)) {
    throw internal("Nom de salle Jitsi invalide.");
  }
  return room;
}

export function jitsiDomain(): string {
  return env().JITSI_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function isJwtRequired(): boolean {
  return env().JITSI_REQUIRE_JWT;
}

export function isJitsiConfigured(): boolean {
  const current = env();
  if (!isJwtRequired()) return true;
  return Boolean(current.JITSI_APP_ID && current.JITSI_APP_SECRET);
}

function moderatorRoles(role: LiveParticipantRole): boolean {
  return role === "HOST" || role === "MODERATOR";
}

/**
 * Signe un jeton Jitsi (HS256). Les revendications suivent le format attendu par
 * `prosody`/`jitsi-meet` en mode « token authentication ».
 */
export async function signJitsiToken(context: JitsiJoinContext): Promise<{ token: string; expiresAt: Date }> {
  const current = env();
  if (!current.JITSI_APP_ID || !current.JITSI_APP_SECRET) {
    throw internal("Jitsi : JITSI_APP_ID / JITSI_APP_SECRET non configurés.");
  }
  const ttl = context.ttlSeconds ?? 2 * 60 * 60;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const isModerator = moderatorRoles(context.role);

  const token = await new SignJWT({
    room: context.roomName,
    context: {
      user: {
        id: context.userId,
        name: context.displayName,
        email: context.email ?? undefined,
        moderator: isModerator,
      },
      features: { recording: isModerator, livestreaming: isModerator },
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: `${current.JITSI_APP_ID}/${current.JITSI_JWT_AUDIENCE}` })
    .setIssuer(current.JITSI_JWT_ISSUER)
    .setAudience(current.JITSI_JWT_AUDIENCE)
    .setSubject(jitsiDomain())
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 30)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(current.JITSI_APP_SECRET));

  return { token, expiresAt };
}

/**
 * Prépare tout ce qu'il faut pour rejoindre une réunion. À n'appeler qu'après
 * une décision d'accès positive.
 */
export async function buildJoinDescriptor(context: JitsiJoinContext): Promise<JitsiJoinDescriptor> {
  const domain = jitsiDomain();
  const needsToken = isJwtRequired();
  const signed = needsToken ? await signJitsiToken(context) : null;

  const params = new URLSearchParams();
  if (signed) params.set("jwt", signed.token);
  params.set("userInfo.displayName", JSON.stringify(context.displayName));

  const url = `https://${domain}/${context.roomName}${params.size > 0 ? `?${params.toString()}` : ""}`;

  return {
    domain,
    roomName: context.roomName,
    url,
    jwt: signed?.token ?? null,
    displayName: context.displayName,
    role: context.role,
    isModerator: moderatorRoles(context.role),
    expiresAt: signed?.expiresAt ?? null,
  };
}

/** Indique si l'instance Jitsi est joignable (sonde de disponibilité). */
export async function jitsiReachable(timeoutMs = 4000): Promise<boolean> {
  const domain = jitsiDomain();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://${domain}/external_api.js`, {
      method: "HEAD",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
