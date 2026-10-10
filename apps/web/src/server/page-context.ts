/**
 * Contexte de page authentifiée.
 *
 * Les pages du tableau de bord ne s'appuient jamais sur un identifiant fourni
 * par l'URL pour choisir l'organisation : le tenant courant est résolu côté
 * serveur (en-tête, cookie ou première appartenance active), puis le rôle y est
 * vérifié. Une organisation demandée mais non autorisée est simplement ignorée.
 */

import { redirect } from "next/navigation";
import {
  roleHasPermission,
  type OrgRole,
  type Permission,
  type Role,
} from "@belloacademy/shared";

import {
  getAuthContext,
  resolveCurrentOrganizationId,
  resolveRole,
  type AuthContext,
} from "@/lib/auth/authorization";

export type { AuthContext };

export type PageContext = {
  context: AuthContext;
  user: AuthContext["user"];
  sessionId: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  role: Role | null;
  memberships: AuthContext["memberships"];
};

/** Exige une session : redirige vers la connexion en conservant la destination. */
export async function requirePageSession(pathname?: string): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) {
    const target = pathname ? `?suivant=${encodeURIComponent(pathname)}` : "";
    redirect(`/connexion${target}`);
  }
  return context;
}

/**
 * Contexte complet d'une page du tableau de bord. `organizationId` peut être
 * nul lorsqu'un compte n'appartient encore à aucune organisation : les pages
 * concernées affichent alors un état vide explicite plutôt que d'échouer.
 */
export async function loadPageContext(candidate?: string | null): Promise<PageContext> {
  const context = await getAuthContext();
  if (!context) redirect("/connexion?suivant=%2Ftableau-de-bord");

  const organizationId = await resolveCurrentOrganizationId(context, candidate ?? null);
  const role = organizationId ? resolveRole(context, organizationId) : null;
  const membership = organizationId
    ? context.memberships.find((item) => item.organizationId === organizationId) ?? null
    : null;

  return {
    context,
    user: context.user,
    sessionId: context.sessionId,
    organizationId,
    organizationName: membership?.organizationName ?? null,
    organizationSlug: membership?.organizationSlug ?? null,
    role,
    memberships: context.memberships,
  };
}

/** Contexte exigeant une organisation active : redirige sinon vers la vue d'ensemble. */
export async function requirePageOrganization(): Promise<PageContext & { organizationId: string }> {
  const page = await loadPageContext();
  if (!page.organizationId) redirect("/tableau-de-bord?erreur=organisation-absente");
  return page as PageContext & { organizationId: string };
}

/** Le rôle courant possède-t-il cette permission ? */
export function can(page: PageContext, permission: Permission): boolean {
  if (!page.role) return false;
  return roleHasPermission(page.role, permission);
}

/** Vérifie une permission ; redirige vers la vue d'ensemble si elle manque. */
export async function requirePagePermission(permission: Permission): Promise<PageContext & { organizationId: string }> {
  const page = await requirePageOrganization();
  if (!can(page, permission)) redirect("/tableau-de-bord?erreur=acces-refuse");
  return page;
}

/** Libellés des rôles pour l'affichage (l'organisation courante d'abord). */
export function primaryOrgRole(memberships: AuthContext["memberships"]): OrgRole | null {
  const active = memberships.find((membership) => membership.status === "ACTIVE");
  return active?.role ?? null;
}
