/** Organisations (tenants) et paramètres associés. */

export const ORGANIZATION_SETTINGS_DEFAULTS = {
  allowSelfRegistration: true,
  requireEmailVerification: true,
  defaultCourseVisibility: "ORG" as const,
  supportEmail: null as string | null,
  certificateIssuer: null as string | null,
  jitsiDomain: null as string | null,
  allowPublicCatalog: true,
};

export type CourseVisibility = "ORG" | "PUBLIC";

export type OrganizationSettings = {
  allowSelfRegistration: boolean;
  requireEmailVerification: boolean;
  defaultCourseVisibility: CourseVisibility;
  supportEmail: string | null;
  certificateIssuer: string | null;
  jitsiDomain: string | null;
  allowPublicCatalog: boolean;
};

/** Fusionne les paramètres stockés (JSON) avec les valeurs par défaut. */
export function resolveOrganizationSettings(raw: unknown): OrganizationSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...ORGANIZATION_SETTINGS_DEFAULTS };
  const source = raw as Record<string, unknown>;
  return {
    allowSelfRegistration:
      typeof source.allowSelfRegistration === "boolean"
        ? source.allowSelfRegistration
        : ORGANIZATION_SETTINGS_DEFAULTS.allowSelfRegistration,
    requireEmailVerification:
      typeof source.requireEmailVerification === "boolean"
        ? source.requireEmailVerification
        : ORGANIZATION_SETTINGS_DEFAULTS.requireEmailVerification,
    defaultCourseVisibility:
      source.defaultCourseVisibility === "PUBLIC" || source.defaultCourseVisibility === "ORG"
        ? source.defaultCourseVisibility
        : ORGANIZATION_SETTINGS_DEFAULTS.defaultCourseVisibility,
    supportEmail: typeof source.supportEmail === "string" ? source.supportEmail : null,
    certificateIssuer: typeof source.certificateIssuer === "string" ? source.certificateIssuer : null,
    jitsiDomain: typeof source.jitsiDomain === "string" ? source.jitsiDomain : null,
    allowPublicCatalog:
      typeof source.allowPublicCatalog === "boolean"
        ? source.allowPublicCatalog
        : ORGANIZATION_SETTINGS_DEFAULTS.allowPublicCatalog,
  };
}

export const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const RESERVED_ORG_SLUGS = [
  "admin",
  "api",
  "app",
  "auth",
  "dashboard",
  "docs",
  "help",
  "login",
  "register",
  "support",
  "www",
];

export function isReservedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_SLUGS.includes(slug.toLowerCase());
}
