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

  return { context, role, organizationId, userId: context.user.id };
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
