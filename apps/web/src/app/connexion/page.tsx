import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/forms/login-form";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = {
  title: "Connexion",
  description: "Connectez-vous à votre espace BelloAcademy.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Connexion</h1>
      <p className="mt-2 text-sm text-ink-700">Accédez à vos formations, vos classes virtuelles et vos certificats.</p>

      <Card className="mt-6">
        <CardBody>
          <Suspense fallback={<p className="text-sm text-ink-500">Chargement du formulaire…</p>}>
            <LoginForm />
          </Suspense>
        </CardBody>
      </Card>

      <div className="mt-4 space-y-2 text-sm text-ink-600">
        <p>
          <Link href="/mot-de-passe-oublie" className="font-medium text-brand-700 hover:text-brand-600">
            Mot de passe oublié ?
          </Link>
        </p>
        <p>
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="font-medium text-brand-700 hover:text-brand-600">
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
