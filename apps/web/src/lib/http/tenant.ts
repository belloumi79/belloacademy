/**
 * Résolution du tenant pour les routes API.
 *
 * L'organisation cible est déterminée par l'en-tête `x-organization-id`, la
 * requête (`organizationId`), le cookie d'organisation courante, ou à défaut la
 * première appartenance active. Le rôle y est résolu puis confronté à la
 * permission demandée : un utilisateur ne peut jamais atteindre les données
 * d'une autre organisation en changeant un identifiant.
 */

import type { NextRequest } from "next/server";
import { roleHasPermission, type Permission, type Role } from "@belloacademy/shared";

import { forbidden } from "@/lib/errors";
import { requireAuth, resolveCurrentOrganizationId, resolveRole, type AuthContext } from "@/lib/auth/authorization";
import { instructorOwnsCourse } from "@/server/services/courses";

/** Identifiant UUID v4 : sert à distinguer un identifiant d'un segment de route. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrgScope = {
  context: AuthContext;
  role: Role;
  organizationId: string;
  userId: string;
};

export async function orgScope(request: NextRequest, permission: Permission): Promise<OrgScope> {
  const context = await requireAuth();
  const url = new URL(request.url);
  const candidate = url.searchParams.get("organizationId") ?? request.headers.get("x-organization-id");
  const organizationId = await resolveCurrentOrganizationId(context, candidate);

  if (!organizationId) {
    throw forbidden("Aucune organisation active pour cette requête.");
  }
  const role = resolveRole(context, organizationId);
  if (!role) throw forbidden("Vous n'appartenez pas à cette organisation.");
  if (!roleHasPermission(role, permission)) throw forbidden();
  if (role === "INSTRUCTOR") await assertInstructorCourseOwnership(organizationId, context.user.id, url);

  return { context, role, organizationId, userId: context.user.id };
}

/**
 * Portée d'un formateur : il ne peut agir que sur ses propres formations.
 *
 * Un administrateur d'organisation (ou le superadministrateur) garde la main sur
 * toutes les formations de son organisation. Pour un formateur, on déduit la
 * formation visée depuis l'URL — soit `/api/courses/<courseId>/...`, soit un
 * `courseId` explicite — puis on vérifie qu'il en est bien le titulaire. Les
 * routes qui ne visent aucune formation (ex. création) ne sont pas contraintes.
 */
async function assertInstructorCourseOwnership(
  organizationId: string,
  userId: string,
  url: URL,
): Promise<void> {
  const segments = url.pathname.split("/").filter(Boolean);
  const coursesIndex = segments.indexOf("courses");
  const fromPath = coursesIndex >= 0 ? segments[coursesIndex + 1] : undefined;
  const candidate = url.searchParams.get("courseId") ?? fromPath;
  if (!candidate || !UUID_PATTERN.test(candidate)) return;
  if (!(await instructorOwnsCourse(organizationId, candidate, userId))) {
    throw forbidden("Cette formation appartient à un autre formateur.");
  }
}

/** Variante sans permission particulière : appartenance active exigée. */
export async function orgAccess(request: NextRequest): Promise<OrgScope> {
  const context = await requireAuth();
  const url = new URL(request.url);
  const candidate = url.searchParams.get("organizationId") ?? request.headers.get("x-organization-id");
  const organizationId = await resolveCurrentOrganizationId(context, candidate);
  if (!organizationId) throw forbidden("Aucune organisation active pour cette requête.");
  const role = resolveRole(context, organizationId);
  if (!role) throw forbidden("Vous n'appartenez pas à cette organisation.");
  return { context, role, organizationId, userId: context.user.id };
}

/** Organisation publique (catalogue) désignée par son slug. */
export async function publicOrganizationId(slug: string | null): Promise<string | null> {
  if (!slug) return null;
  const { findOrganizationBySlug } = await import("@/lib/auth/authorization");
  const organization = await findOrganizationBySlug(slug);
  return organization?.id ?? null;
}

/**
 * Autorisation sur une organisation **désignée explicitement** (identifiant
 * présent dans le chemin de l'URL, par exemple `/api/organizations/:id/members`).
 *
 * C'est la variante à utiliser dès qu'un identifiant d'organisation vient de la
 * requête : `orgScope()` résout le tenant courant à partir de l'en-tête, du
 * cookie ou de la première appartenance, ce qui autoriserait un appelant à
 * faire valider son propre rôle tout en lisant les données d'un autre tenant.
 * Ici, le rôle est résolu **sur l'organisation ciblée**, et rien d'autre.
 */
export async function orgScopeFor(
  organizationId: string | undefined,
  permission: Permission,
): Promise<OrgScope> {
  if (!organizationId) throw forbidden("Organisation non précisée.");
  const context = await requireAuth();
  const role = resolveRole(context, organizationId);
  if (!role) throw forbidden("Vous n'appartenez pas à cette organisation.");
  if (!roleHasPermission(role, permission)) throw forbidden();
  return { context, role, organizationId, userId: context.user.id };
}
