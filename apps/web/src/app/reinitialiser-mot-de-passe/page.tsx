import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/forms/reset-password-form";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = {
  title: "Réinitialiser le mot de passe",
  description: "Choisissez un nouveau mot de passe pour votre compte.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Nouveau mot de passe</h1>
      <p className="mt-2 text-sm text-ink-700">
        Le lien de réinitialisation est à usage unique et expire une heure après son envoi.
      </p>

      <Card className="mt-6">
        <CardBody>
          <ResetPasswordForm token={token} />
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
