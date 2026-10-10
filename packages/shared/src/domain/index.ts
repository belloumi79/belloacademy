/**
 * Vocabulaire métier partagé (serveur + interface).
 *
 * Un seul module par domaine, sans recouvrement d'export : `course`, `learning`,
 * `assessment`, `live`, `billing`, `identity`, `organization`.
 */

export * from "./identity";
export * from "./organization";
export * from "./course";
export * from "./learning";
export * from "./assessment";
export * from "./live";
export * from "./billing";

/** Contexte de tenant transmis aux couches applicatives. */
export type TenantContext = {
  organizationId: string;
  userId: string;
  role: import("./identity").Role;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
  };
}
