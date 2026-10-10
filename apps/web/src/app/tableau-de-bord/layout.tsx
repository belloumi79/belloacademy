/**
 * Coquille du tableau de bord.
 *
 * La session est exigée au niveau du segment : toute page enfant peut donc
 * supposer un utilisateur authentifié. La colonne de navigation est calculée
 * côté serveur à partir du rôle réel dans l'organisation courante.
 */

import type { Metadata } from "next";

import { DashboardNav } from "@/components/dashboard/nav";
import { loadPageContext } from "@/server/page-context";

export const metadata: Metadata = {
  title: "Tableau de bord",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const page = await loadPageContext();

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[16rem_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <DashboardNav page={page} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
