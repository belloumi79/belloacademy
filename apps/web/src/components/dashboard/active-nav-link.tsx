"use client";

/**
 * Lien de navigation avec état actif.
 *
 * L'état actif dépend de l'URL courante : il est donc calculé côté navigateur,
 * tandis que la liste des entrées reste rendue côté serveur (filtrée par rôle).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui";

export function ActiveNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isRoot = href === "/tableau-de-bord";
  const active = isRoot ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-lg px-3 py-2 text-sm",
        active
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-ink-700 hover:bg-ink-100 hover:text-brand-700",
      )}
    >
      {children}
    </Link>
  );
}
