/**
 * Identité, rôles et permissions.
 *
 * Deux niveaux d'autorisation, volontairement distincts :
 *  - rôle *plateforme* : `SUPER_ADMIN`, porté par un drapeau sur l'utilisateur
 *    (`users.isSuperAdmin`), portée globale ;
 *  - rôle *d'organisation* : porté par l'appartenance (`memberships.role`),
 *    strictement limité à une organisation.
 *
 * Les permissions sont vérifiées **côté serveur** à chaque requête. Les
 * fonctions de ce module sont pures et partagées entre le serveur (contrôle
 * d'accès) et l'interface (affichage conditionnel) : l'interface ne constitue
 * jamais une barrière de sécurité.
 */

export const ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "INSTRUCTOR", "LEARNER", "BILLING_MANAGER"] as const;
export type Role = (typeof ROLES)[number];

/** Rôles attribuables dans une organisation (le superadmin est global). */
export const ORG_ROLES = ["ORG_ADMIN", "INSTRUCTOR", "LEARNER", "BILLING_MANAGER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Superadministrateur",
  ORG_ADMIN: "Administrateur d'organisation",
  INSTRUCTOR: "Formateur",
  LEARNER: "Apprenant",
  BILLING_MANAGER: "Gestionnaire de facturation",
};

export const PERMISSIONS = [
  "platform:admin",
  "org:read",
  "org:update",
  "org:delete",
  "member:read",
  "member:invite",
  "member:update",
  "member:remove",
  "course:read",
  "course:create",
  "course:update",
  "course:delete",
  "course:publish",
  "enrollment:read",
  "enrollment:create",
  "enrollment:manage",
  "assessment:read",
  "assessment:manage",
  "assessment:grade",
  "certificate:read",
  "certificate:issue",
  "certificate:revoke",
  "live:read",
  "live:create",
  "live:manage",
  "billing:read",
  "billing:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const LEARNER_PERMISSIONS: Permission[] = ["org:read", "course:read", "enrollment:read", "enrollment:create", "assessment:read", "certificate:read", "live:read"];

const INSTRUCTOR_PERMISSIONS: Permission[] = [
  ...LEARNER_PERMISSIONS,
  "member:read",
  "course:create",
  "course:update",
  "course:publish",
  "enrollment:manage",
  "assessment:manage",
  "assessment:grade",
  "certificate:issue",
  "live:create",
  "live:manage",
];

const ORG_ADMIN_PERMISSIONS: Permission[] = [
  ...INSTRUCTOR_PERMISSIONS,
  "org:update",
  "member:invite",
  "member:update",
  "member:remove",
  "course:delete",
  "certificate:revoke",
  "billing:read",
  "audit:read",
];

const BILLING_MANAGER_PERMISSIONS: Permission[] = ["org:read", "member:read", "billing:read", "billing:manage", "enrollment:read", "course:read"];

/** Matrice rôle → permissions. `SUPER_ADMIN` détient toutes les permissions. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ORG_ADMIN: ORG_ADMIN_PERMISSIONS,
  INSTRUCTOR: INSTRUCTOR_PERMISSIONS,
  LEARNER: LEARNER_PERMISSIONS,
  BILLING_MANAGER: BILLING_MANAGER_PERMISSIONS,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => roleHasPermission(role, permission));
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/** Utilisateur authentifié tel qu'exposé à l'application (jamais de hash). */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  isSuperAdmin: boolean;
  emailVerified: boolean;
};

export const SESSION_COOKIE_NAME = "belloacademy_session";
export const CSRF_COOKIE_NAME = "belloacademy_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Durées de vie (secondes). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24 * 3;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const ORG_INVITE_TTL_SECONDS = 60 * 60 * 24 * 7;
