import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = {
  title: "Mot de passe oublié",
  description: "Recevez un lien de réinitialisation de mot de passe.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Mot de passe oublié</h1>
      <p className="mt-2 text-sm text-ink-700">
        Indiquez votre adresse e-mail : si un compte y est associé, un lien de réinitialisation valable une heure vous sera
        envoyé.
      </p>

      <Card className="mt-6">
        <CardBody>
          <ForgotPasswordForm />
        </CardBody>
      </Card>

      <p className="mt-4 text-sm text-ink-600">
        <Link href="/connexion" className="font-medium text-brand-700 hover:text-brand-600">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
