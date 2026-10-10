/**
 * Sessions serveur.
 *
 * Le cookie ne contient qu'un jeton opaque ; la session vit en base (`sessions`).
 * L'empreinte du jeton est stockée, jamais le jeton lui-même. Les sessions sont
 * révocables individuellement (déconnexion) et globalement (changement de mot
 * de passe, suspension de compte).
 */

import { cookies, headers } from "next/headers";

import { env } from "@/env";
import { prisma, prismaPlatform } from "@/lib/db/prisma";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@belloacademy/shared";
import { createToken, hashToken } from "@/lib/auth/tokens";

export type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export type CreatedSession = {
  session: SessionRecord;
  token: string;
  expiresAt: Date;
};

export const SESSION_RENEW_THRESHOLD_SECONDS = 60 * 60 * 24 * 7;

async function requestMetadata(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? null;
    return { ip, userAgent: headerList.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function createSession(userId: string, options: { ttlSeconds?: number } = {}): Promise<CreatedSession> {
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const { token, tokenHash, expiresAt } = createToken(ttl);
  const meta = await requestMetadata();

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
    },
    select: { id: true, userId: true, expiresAt: true, ip: true, userAgent: true, createdAt: true },
  });

  // Le cookie de session est posé ici : tout appelant qui crée une session
  // (connexion, inscription, acceptation d'invitation) ouvre ainsi la session.
  const store = await cookies();
  store.set({ ...sessionCookieOptions(session.expiresAt), value: token });

  return { session, token, expiresAt };
}

/** Supprime le cookie de session (déconnexion). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set({ name: SESSION_COOKIE_NAME, value: "", path: "/", maxAge: 0 });
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  };
}

/** Session valide correspondant au cookie courant (ou `null`). */
export async function getSessionFromCookie(): Promise<{ session: SessionRecord; token: string } | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, ip: true, userAgent: true, createdAt: true, revokedAt: true },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    session: {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
    },
    token,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Prolonge une session proche de l'expiration (rotation glissante). */
export async function touchSession(sessionId: string, expiresAt: Date): Promise<void> {
  const remaining = (expiresAt.getTime() - Date.now()) / 1000;
  if (remaining > SESSION_RENEW_THRESHOLD_SECONDS) return;
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) },
  });
}

/** Nombre de sessions actives d'un utilisateur (affichage « appareils connectés »). */
export async function countActiveSessions(userId: string): Promise<number> {
  return prismaPlatform.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } });
}
