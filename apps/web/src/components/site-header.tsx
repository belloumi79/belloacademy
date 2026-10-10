/**
 * En-tête de site.
 *
 * Composant serveur : la session est lue côté serveur, donc la navigation
 * reflète toujours les droits réels sans requête client supplémentaire.
 */

import Link from "next/link";

import { getAuthContext } from "@/lib/auth/authorization";
import { ButtonLink, buttonClass } from "@/components/ui";
import { LogoutButton } from "@/components/forms/logout-button";

const PUBLIC_LINKS = [
  { href: "/formations", label: "Catalogue" },
  { href: "/tarifs", label: "Forfaits" },
];

export async function SiteHeader() {
  const context = await getAuthContext();

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink-900">
          <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            BA
          </span>
          <span>BelloAcademy</span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden items-center gap-6 md:flex">
          {PUBLIC_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-ink-700 hover:text-brand-700">
              {link.label}
            </Link>
          ))}
          {context ? (
            <Link href="/tableau-de-bord" className="text-sm font-medium text-ink-700 hover:text-brand-700">
              Tableau de bord
            </Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-2">
          {context ? (
            <>
              <span className="hidden text-sm text-ink-500 sm:inline">{context.user.name}</span>
              <Link href="/tableau-de-bord/notifications" className={buttonClass("ghost", "sm")}>
                Notifications
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <ButtonLink href="/connexion" variant="secondary" size="sm">
                Connexion
              </ButtonLink>
              <ButtonLink href="/inscription" size="sm">
                Créer un compte
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
