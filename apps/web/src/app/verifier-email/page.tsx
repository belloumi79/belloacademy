import type { Metadata } from "next";
import { Suspense } from "react";

import { VerifyEmailPanel } from "@/components/forms/verify-email-panel";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = {
  title: "Vérification de l'adresse e-mail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Confirmation de votre adresse e-mail</h1>
      <p className="mt-2 text-sm text-ink-700">
        La confirmation sécurise votre compte et active l&apos;envoi des notifications pédagogiques.
      </p>
      <Card className="mt-6">
        <CardBody>
          <Suspense fallback={<p className="text-sm text-ink-600">Chargement…</p>}>
            <VerifyEmailPanel token={token} />
          </Suspense>
        </CardBody>
      </Card>
    </div>
  );
}
