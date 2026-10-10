import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { RegisterForm } from "@/components/forms/register-form";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = {
  title: "Créer un compte",
  description:
    "Créez votre compte BelloAcademy : apprenant, ou organisation complète avec essai gratuit du forfait par défaut.",
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Créer un compte</h1>
      <p className="mt-2 text-sm text-ink-700">
        Renseignez un nom d&apos;organisation pour ouvrir votre propre académie, ou laissez le champ vide pour rejoindre la
        plateforme comme apprenant.
      </p>

      <Card className="mt-6">
        <CardBody>
          <Suspense fallback={<p className="text-sm text-ink-500">Chargement du formulaire…</p>}>
            <RegisterForm />
          </Suspense>
        </CardBody>
      </Card>

      <p className="mt-4 text-sm text-ink-600">
        Vous avez déjà un compte ?{" "}
        <Link href="/connexion" className="font-medium text-brand-700 hover:text-brand-600">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
