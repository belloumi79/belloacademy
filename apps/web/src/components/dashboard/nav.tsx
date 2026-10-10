/**
 * Navigation du tableau de bord.
 *
 * Les entrées sont filtrées par rôle : un apprenant ne voit pas les outils de
 * gestion, un administrateur d'organisation ne voit pas la console plateforme.
 * Le filtrage est purement présentationnel — chaque page revérifie ses droits.
 */

import {
  roleHasPermission,
  ROLE_LABELS,
  type OrgRole,
  type Permission,
  type Role,
} from "@belloacademy/shared";

import { ActiveNavLink } from "@/components/dashboard/active-nav-link";
import type { PageContext } from "@/server/page-context";

type NavItem = {
  href: string;
  label: string;
  permission?: Permission;
  /** Rôles pour lesquels l'entrée est pertinente, en plus des permissions. */
  roles?: Role[];
};

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Apprentissage",
    items: [
      { href: "/tableau-de-bord", label: "Vue d'ensemble" },
      { href: "/tableau-de-bord/formations", label: "Mes formations" },
      { href: "/tableau-de-bord/classes-virtuelles", label: "Classes virtuelles" },
      { href: "/tableau-de-bord/evaluations", label: "Évaluations" },
      { href: "/tableau-de-bord/certificats", label: "Certificats" },
    ],
  },
  {
    title: "Formation",
    items: [
      { href: "/tableau-de-bord/formateur", label: "Espace formateur", permission: "course:create" },
      { href: "/tableau-de-bord/evaluations/corrections", label: "Corrections", permission: "assessment:grade" },
    ],
  },
  {
    title: "Organisation",
    items: [
      { href: "/tableau-de-bord/organisation", label: "Administration", permission: "member:read" },
      { href: "/tableau-de-bord/organisation/membres", label: "Membres et invitations", permission: "member:invite" },
      { href: "/tableau-de-bord/facturation", label: "Forfait et factures" },
      { href: "/tableau-de-bord/organisation/audit", label: "Journal d'audit", permission: "audit:read" },
    ],
  },
  {
    title: "Plateforme",
    items: [
      { href: "/tableau-de-bord/administration", label: "Console plateforme", permission: "platform:admin" },
    ],
  },
  {
    title: "Compte",
    items: [
      { href: "/tableau-de-bord/notifications", label: "Notifications" },
      { href: "/tableau-de-bord/profil", label: "Profil et sécurité" },
    ],
  },
];

function isVisible(item: NavItem, role: Role | null): boolean {
  if (item.permission) {
    if (!role) return false;
    return roleHasPermission(role, item.permission);
  }
  if (item.roles) {
    if (!role) return false;
    return item.roles.includes(role);
  }
  return true;
}

export function DashboardNav({ page }: { page: PageContext }) {
  const role = page.role;

  return (
    <nav aria-label="Navigation du tableau de bord" className="space-y-6">
      <div className="rounded-xl border border-ink-200 bg-white p-4">
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Organisation</p>
        <p className="mt-1 truncate font-semibold text-ink-900">{page.organizationName ?? "Aucune"}</p>
        <p className="mt-1 text-xs text-ink-500">
          {role ? ROLE_LABELS[role as OrgRole] ?? ROLE_LABELS[role as keyof typeof ROLE_LABELS] : "Visiteur"}
        </p>
        {page.memberships.length > 1 ? (
          <p className="mt-2 text-xs text-ink-500">
            {page.memberships.length} organisations accessibles — changez d&apos;organisation depuis le profil.
          </p>
        ) : null}
      </div>

      {SECTIONS.map((section) => {
        const items = section.items.filter((item) => isVisible(item, role));
        if (items.length === 0) return null;
        return (
          <div key={section.title}>
            <p className="px-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">{section.title}</p>
            <ul className="mt-2 space-y-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <ActiveNavLink href={item.href}>{item.label}</ActiveNavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
