/**
 * Pied de page du site.
 */

import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-ink-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-ink-900">BelloAcademy</p>
          <p className="mt-2 text-sm text-ink-500">
            Plateforme de formation en ligne multi-organisations : cours, classes virtuelles Jitsi Meet, évaluations et
            certificats vérifiables.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-900">Plateforme</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-500">
            <li>
              <Link href="/formations" className="hover:text-brand-700">
                Catalogue des formations
              </Link>
            </li>
            <li>
              <Link href="/tarifs" className="hover:text-brand-700">
                Forfaits et abonnements
              </Link>
            </li>
            <li>
              <Link href="/verifier-certificat" className="hover:text-brand-700">
                Vérifier un certificat
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-900">Assistance</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-500">
            <li>Documentation technique : dossier docs/</li>
            <li>Supervision : /api/health</li>
          </ul>
        </div>
      </div>
      <p className="border-t border-ink-100 px-4 py-4 text-center text-xs text-ink-500">
        BelloAcademy — logiciels libres, données hébergées sur votre infrastructure.
      </p>
    </footer>
  );
}
