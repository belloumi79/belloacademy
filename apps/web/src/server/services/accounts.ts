/**
 * Comptes : inscription, connexion, vérification d'e-mail, réinitialisation de
 * mot de passe, profil.
 *
 * Points de sécurité :
 *  - le mot de passe n'est jamais journalisé ni renvoyé ;
 *  - le verrouillage progressif (`failedLogins`, `lockedUntil`) limite les
 *    attaques par force brute, en complément de la limitation de débit HTTP ;
 *  - la réponse à une demande de réinitialisation est identique que l'adresse
 *    existe ou non (pas d'énumération de comptes) ;
 *  - les jetons sont stockés hachés (SHA-256) et à usage unique.
 */

import {
  EMAIL_VERIFICATION_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  addInterval,
  normalizeEmail,
} from "@belloacademy/shared";

import { env } from "@/env";
import { recordAudit } from "@/lib/audit";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
} from "@/lib/auth/session";
import { createToken, hashToken, safeCompareHex } from "@/lib/auth/tokens";
import { prisma, prismaPlatform } from "@/lib/db/prisma";
import { badRequest, conflict, forbidden, notFound, unauthenticated, validationError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { issueCsrfToken } from "@/lib/csrf";
import { createOrganization } from "@/server/services/organizations";
import { consumeInvite } from "@/server/services/members";

const MAX_FAILED_LOGINS = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Contrôle de robustesse du mot de passe, appliqué côté service en plus de la
 * validation du schéma : la politique reste vraie même si un appelant
 * (script, tâche planifiée) contourne la couche HTTP.
 */
function assertPasswordPolicy(password: string): void {
  const result = checkPasswordPolicy(password);
  if (!result.ok) {
    throw validationError(result.reasons.join(" "), { reasons: result.reasons });
  }
}

export type RegisterInput = {
  email: string;
  password: string;
  name: string;
  locale?: string;
  timezone?: string;
  /**
   * Nom de l'organisation à créer pour cet utilisateur (inscription
   * self-service). Le créateur en devient administrateur.
   */
  organizationName?: string | null;
  /**
   * Identifiant d'organisation.
   *  - avec `organizationName` : identifiant imposé à la nouvelle organisation ;
   *  - seul : rejoint une organisation existante en tant qu'apprenant.
   */
  organizationSlug?: string | null;
  /** Invitation à consommer : l'utilisateur rejoint l'organisation invitante. */
  inviteToken?: string | null;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  isSuperAdmin: boolean;
  emailVerifiedAt: Date | null;
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
};

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  isSuperAdmin: boolean;
  emailVerifiedAt: Date | null;
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    timezone: user.timezone,
    isSuperAdmin: user.isSuperAdmin,
    emailVerifiedAt: user.emailVerifiedAt,
    status: user.status,
  };
}

/** Programme l'e-mail de vérification d'adresse (jeton à usage unique). */
async function sendVerificationEmail(userId: string, email: string, name: string): Promise<void> {
  const { token, tokenHash, expiresAt } = createToken(EMAIL_VERIFICATION_TTL_SECONDS);
  await prisma.authToken.create({
    data: { userId, email, type: "EMAIL_VERIFICATION", tokenHash, expiresAt },
  });
  await enqueue("email.send", {
    to: email,
    template: "verify_address",
    context: { name, token, appUrl: env().APP_URL },
  });
}

/**
 * Inscription self-service.
 *
 * Trois cas, par ordre de priorité :
 *  1. `inviteToken` : rejoint l'organisation qui a invité, avec le rôle prévu ;
 *  2. `organizationName` : crée une nouvelle organisation dont l'utilisateur
 *     devient administrateur (`organizationSlug` fixe alors son identifiant) ;
 *  3. `organizationSlug` seul : rejoint une organisation existante en apprenant.
 *
 * Sans aucune de ces informations, le compte est créé sans organisation :
 * l'utilisateur pourra en créer une plus tard depuis son espace.
 */
export async function register(input: RegisterInput): Promise<AuthenticatedUser> {
  const email = normalizeEmail(input.email);

  const existing = await prismaPlatform.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw conflict("Un compte existe déjà avec cette adresse e-mail.");
  }

  const joinSlug = input.organizationSlug?.trim() || null;
  const organizationName = input.organizationName?.trim() || null;
  const inviteToken = input.inviteToken?.trim() || null;

  // Une organisation existante n'est recherchée que si aucun nom n'est fourni :
  // sinon le slug désigne l'identifiant souhaité pour la nouvelle organisation.
  const joinable =
    joinSlug && !organizationName
      ? await prismaPlatform.organization.findFirst({
          where: { slug: joinSlug, deletedAt: null },
          select: { id: true, name: true },
        })
      : null;

  if (joinSlug && !organizationName && !joinable) {
    throw notFound("Organisation introuvable.");
  }

  assertPasswordPolicy(input.password);
  const passwordHash = await hashPassword(input.password);

  const user = await prismaPlatform.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash,
      locale: input.locale ?? env().DEFAULT_LOCALE,
      timezone: input.timezone ?? env().DEFAULT_TIMEZONE,
      status: "ACTIVE",
    },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      status: true,
    },
  });

  let organizationId: string | null = joinable?.id ?? null;
  let joinedRole: string | null = joinable ? "LEARNER" : null;

  if (inviteToken) {
    const joined = await consumeInvite({ token: inviteToken, userId: user.id, userEmail: email });
    organizationId = joined.organizationId;
    joinedRole = joined.role;
  } else if (organizationName) {
    const organization = await createOrganization({
      name: organizationName,
      ...(joinSlug ? { slug: joinSlug } : {}),
      ownerUserId: user.id,
    });
    organizationId = organization.id;
    joinedRole = "ORG_ADMIN";
  } else if (joinable) {
    await prismaPlatform.membership.create({
      data: {
        userId: user.id,
        organizationId: joinable.id,
        role: "LEARNER",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
  }

  await sendVerificationEmail(user.id, email, user.name);

  await recordAudit({
    action: "user.registered",
    actorUserId: user.id,
    entityType: "User",
    entityId: user.id,
    organizationId,
    metadata: { organizationSlug: joinSlug, joinedRole },
  });

  return publicUser(user);
}

export type LoginResult = { user: AuthenticatedUser; sessionId: string };

/**
 * Vérifie des identifiants : verrouillage progressif, coût constant sur un
 * compte inexistant, remise à zéro des échecs en cas de succès.
 *
 * Séparé de `login()` (qui ouvre la session et pose les cookies) afin d'être
 * testable sans contexte de requête HTTP.
 */
export async function authenticate(input: {
  email: string;
  password: string;
}): Promise<AuthenticatedUser> {
  const email = normalizeEmail(input.email);
  const user = await prismaPlatform.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      status: true,
      passwordHash: true,
      failedLogins: true,
      lockedUntil: true,
      deletedAt: true,
    },
  });

  // Message unique : ne révèle pas si l'adresse existe.
  const invalid = () => unauthenticated("Adresse e-mail ou mot de passe incorrect.");

  if (!user || user.deletedAt) {
    // Coût constant : évite de distinguer un compte inexistant par le temps de réponse.
    await verifyPassword(input.password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    throw invalid();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw forbidden("Compte temporairement verrouillé. Réessayez dans quelques minutes.");
  }

  if (user.status === "SUSPENDED") {
    throw forbidden("Ce compte est suspendu. Contactez votre administrateur.");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    const failedLogins = user.failedLogins + 1;
    await prismaPlatform.user.update({
      where: { id: user.id },
      data: {
        failedLogins,
        lockedUntil: failedLogins >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
    logger.warn("échec de connexion", { userId: user.id, failedLogins });
    throw invalid();
  }

  await prismaPlatform.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  return publicUser(user);
}

/** Connexion : authentification, puis création de session + jeton CSRF. */
export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const user = await authenticate(input);
  const session = await createSession(user.id);
  await issueCsrfToken();

  await recordAudit({
    action: "user.login_succeeded",
    actorUserId: user.id,
    entityType: "User",
    entityId: user.id,
    metadata: { sessionId: session.session.id },
  });

  return { user, sessionId: session.session.id };
}

export async function logout(sessionId: string, userId: string): Promise<void> {
  await revokeSession(sessionId);
  await recordAudit({
    action: "user.logout",
    actorUserId: userId,
    entityType: "Session",
    entityId: sessionId,
  });
}

/** Consomme un jeton à usage unique et renvoie l'utilisateur associé. */
async function consumeToken(
  token: string,
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "ORG_INVITE",
  email?: string,
) {
  const tokenHash = hashToken(token);
  const record = await prismaPlatform.authToken.findFirst({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, email: true },
  });
  if (!record) throw badRequest("Lien invalide ou expiré.");
  if (email && normalizeEmail(email) !== normalizeEmail(record.email)) {
    throw badRequest("Lien invalide ou expiré.");
  }

  // Vérification supplémentaire en temps constant sur l'empreinte.
  if (!safeCompareHex(record.id ? hashToken(token) : "", tokenHash)) {
    throw badRequest("Lien invalide ou expiré.");
  }

  const consumed = await prismaPlatform.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) throw badRequest("Lien déjà utilisé.");

  return record;
}

export async function verifyEmail(token: string): Promise<AuthenticatedUser> {
  const record = await consumeToken(token, "EMAIL_VERIFICATION");
  if (!record.userId) throw badRequest("Lien invalide ou expiré.");

  const user = await prismaPlatform.user.update({
    where: { id: record.userId },
    data: { emailVerifiedAt: new Date(), status: "ACTIVE" },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      status: true,
    },
  });

  await recordAudit({
    action: "user.email_verified",
    actorUserId: user.id,
    entityType: "User",
    entityId: user.id,
  });

  return publicUser(user);
}

/** Nouvelle demande de vérification (l'utilisateur est authentifié mais non vérifié). */
export async function resendVerification(userId: string): Promise<void> {
  const user = await prismaPlatform.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw notFound("Compte introuvable.");
  if (user.emailVerifiedAt) return;

  await prismaPlatform.authToken.updateMany({
    where: { userId, type: "EMAIL_VERIFICATION", usedAt: null },
    data: { usedAt: new Date() },
  });
  await sendVerificationEmail(user.id, user.email, user.name);
}

/**
 * Demande de réinitialisation. Répond toujours de la même façon (anti-énumération).
 */
export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const user = await prismaPlatform.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, deletedAt: true, status: true },
  });

  if (!user || user.deletedAt || user.status === "SUSPENDED") return;

  const { token, tokenHash, expiresAt } = createToken(PASSWORD_RESET_TTL_SECONDS);
  await prisma.authToken.create({
    data: { userId: user.id, email: user.email, type: "PASSWORD_RESET", tokenHash, expiresAt },
  });

  await enqueue("email.send", {
    to: user.email,
    template: "reset_password",
    context: { name: user.name, token, appUrl: env().APP_URL },
  });

  await recordAudit({
    action: "user.password_reset_requested",
    actorUserId: user.id,
    entityType: "User",
    entityId: user.id,
  });
}

/** Réinitialisation effective : toutes les sessions existantes sont révoquées. */
export async function resetPassword(input: { token: string; password: string }): Promise<void> {
  const record = await consumeToken(input.token, "PASSWORD_RESET");
  if (!record.userId) throw badRequest("Lien invalide ou expiré.");

  assertPasswordPolicy(input.password);
  const passwordHash = await hashPassword(input.password);
  await prismaPlatform.user.update({
    where: { id: record.userId },
    data: { passwordHash, failedLogins: 0, lockedUntil: null },
  });
  await revokeAllUserSessions(record.userId);

  await recordAudit({
    action: "user.password_reset_completed",
    actorUserId: record.userId,
    entityType: "User",
    entityId: record.userId,
  });
}

/** Changement de mot de passe par un utilisateur authentifié. */
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  currentSessionId: string;
}): Promise<void> {
  const user = await prismaPlatform.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw notFound("Compte introuvable.");

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) throw forbidden("Mot de passe actuel incorrect.");

  assertPasswordPolicy(input.newPassword);
  const passwordHash = await hashPassword(input.newPassword);
  await prismaPlatform.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Les autres sessions sont fermées ; la session courante est conservée.
  await revokeAllUserSessions(user.id, input.currentSessionId);

  await recordAudit({
    action: "user.password_changed",
    actorUserId: user.id,
    entityType: "User",
    entityId: user.id,
  });
}

export async function updateProfile(input: {
  userId: string;
  name?: string;
  locale?: string;
  timezone?: string;
  avatarUrl?: string | null;
}): Promise<AuthenticatedUser> {
  const user = await prismaPlatform.user.update({
    where: { id: input.userId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      status: true,
    },
  });
  return publicUser(user);
}

/** Profil complet avec appartenances (utilisé par l'espace personnel). */
export async function getUserProfile(userId: string) {
  return prismaPlatform.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      avatarUrl: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      status: true,
      createdAt: true,
      memberships: {
        where: { status: { in: ["ACTIVE", "INVITED"] } },
        select: {
          id: true,
          role: true,
          status: true,
          organization: { select: { id: true, slug: true, name: true, logoUrl: true } },
        },
      },
    },
  });
}

/**
 * Liste des sessions actives d'un utilisateur (transparence et sécurité :
 * l'utilisateur peut constater et fermer les accès ouverts).
 */
export async function listActiveSessions(userId: string) {
  return prismaPlatform.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true, lastSeenAt: true },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });
}

/** Utilisé par le tableau de bord superadministrateur. */
export async function countUsers(): Promise<number> {
  return prismaPlatform.user.count({ where: { deletedAt: null } });
}

/** Utilitaire interne : réutilisé par le service d'invitations. */
export async function createInviteToken(email: string, ttlSeconds: number) {
  const { token, tokenHash, expiresAt } = createToken(ttlSeconds);
  await prisma.authToken.create({
    data: { email: normalizeEmail(email), type: "ORG_INVITE", tokenHash, expiresAt },
  });
  return { token, expiresAt };
}

export { addInterval };
