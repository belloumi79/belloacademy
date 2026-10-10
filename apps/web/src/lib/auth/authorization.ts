/**
 * Contexte d'autorisation côté serveur.
 *
 * Toute vérification d'accès passe par ce module : les rôles ne sont jamais lus
 * depuis le client. Le contexte est reconstruit à chaque requête à partir de la
 * session en base et des appartenances (`memberships`) de l'utilisateur.
 */

import { cookies, headers } from "next/headers";

import { prismaPlatform } from "@/lib/db/prisma";
import { getSessionFromCookie } from "@/lib/auth/session";
import { forbidden, notFound, unauthenticated } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  SESSION_COOKIE_NAME,
  roleHasPermission,
  type OrgRole,
  type Permission,
  type Role,
} from "@belloacademy/shared";

export type OrganizationMembership = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: OrgRole;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
};

export type AuthContext = {
  user: {
    id: string;
    email: string;
    name: string;
    locale: string;
    timezone: string;
    isSuperAdmin: boolean;
    emailVerifiedAt: Date | null;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
  sessionId: string;
  memberships: OrganizationMembership[];
};

/** Contexte complet, ou `null` si aucune session valide. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const found = await getSessionFromCookie();
  if (!found) return null;

  // Résolution d'identité : lue avec le rôle plateforme. Cette requête est
  // strictement bornée à `userId` (aucune donnée d'une autre organisation n'est
  // exposée) et doit précéder toute ouverture de contexte de tenant, puisque
  // `memberships` est protégée par RLS.
  const user = await prismaPlatform.user.findUnique({
    where: { id: found.session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      status: true,
      memberships: {
        select: {
          organizationId: true,
          role: true,
          status: true,
          organization: { select: { slug: true, name: true } },
        },
      },
    },
  });

  if (!user) return null;
  if (user.status === "SUSPENDED") {
    logger.warn("Session utilisée par un compte suspendu", { userId: user.id });
    return null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      timezone: user.timezone,
      isSuperAdmin: user.isSuperAdmin,
      emailVerifiedAt: user.emailVerifiedAt,
      status: user.status,
    },
    sessionId: found.session.id,
    memberships: user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      organizationSlug: membership.organization.slug,
      organizationName: membership.organization.name,
      role: membership.role as OrgRole,
      status: membership.status as "ACTIVE" | "SUSPENDED",
    })),
  };
}

/** Exige une session valide, sinon 401. */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw unauthenticated();
  return context;
}

/** Exige une session valide *et* une adresse e-mail vérifiée. */
export async function requireVerifiedAuth(): Promise<AuthContext> {
  const context = await requireAuth();
  if (!context.user.emailVerifiedAt && !context.user.isSuperAdmin) {
    throw forbidden("Confirmez votre adresse e-mail pour continuer.");
  }
  return context;
}

export async function requireSuperAdmin(): Promise<AuthContext> {
  const context = await requireAuth();
  if (!context.user.isSuperAdmin) throw forbidden();
  return context;
}

export function findMembership(
  context: AuthContext,
  organizationId: string,
): OrganizationMembership | null {
  return context.memberships.find((membership) => membership.organizationId === organizationId) ?? null;
}

/** Rôle effectif de l'utilisateur pour une organisation donnée. */
export function resolveRole(context: AuthContext, organizationId: string): Role | null {
  if (context.user.isSuperAdmin) return "SUPER_ADMIN";
  const membership = findMembership(context, organizationId);
  if (!membership || membership.status !== "ACTIVE") return null;
  return membership.role;
}

/**
 * Exige un accès à l'organisation cible avec la permission demandée.
 * Un utilisateur appartenant à une autre organisation obtient 403 — jamais 404
 * silencieux : l'absence de fuite d'existence est traitée par les services.
 */
export async function requireOrgPermission(
  organizationId: string,
  permission: Permission,
): Promise<{ context: AuthContext; role: Role }> {
  const context = await requireAuth();
  const role = resolveRole(context, organizationId);
  if (!role) throw forbidden("Vous n'appartenez pas à cette organisation.");
  if (!roleHasPermission(role, permission)) throw forbidden();
  return { context, role };
}

/** Exige une appartenance active, sans permission particulière. */
export async function requireOrgAccess(
  organizationId: string,
): Promise<{ context: AuthContext; role: Role }> {
  const context = await requireAuth();
  const role = resolveRole(context, organizationId);
  if (!role) throw forbidden("Vous n'appartenez pas à cette organisation.");
  return { context, role };
}

/**
 * Résout l'organisation courante de l'utilisateur : en-tête `x-organization-id`,
 * puis cookie `belloacademy_org`, puis première appartenance active.
 */
export async function resolveCurrentOrganizationId(
  context: AuthContext,
  candidate?: string | null,
): Promise<string | null> {
  const headerList = await headers();
  const fromHeader = candidate ?? headerList.get("x-organization-id");
  if (fromHeader && findMembership(context, fromHeader)) return fromHeader;

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get("belloacademy_org")?.value ?? null;
  if (fromCookie && findMembership(context, fromCookie)) return fromCookie;

  const firstActive = context.memberships.find((membership) => membership.status === "ACTIVE");
  return firstActive?.organizationId ?? null;
}

/**
 * Recherche une organisation par slug en s'appuyant sur le rôle plateforme :
 * nécessaire pour l'inscription publique et les invitations (avant toute session).
 */
export async function findOrganizationBySlug(slug: string) {
  return prismaPlatform.organization.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, slug: true, name: true, settings: true, planId: true },
  });
}

/** Utilisé par les pages d'administration : lève 404 si l'organisation est absente. */
export async function requireOrganization(organizationId: string) {
  const organization = await prismaPlatform.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
  });
  if (!organization) throw notFound("Organisation introuvable.");
  return organization;
}

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
