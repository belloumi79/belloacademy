import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, ButtonLink, Card, CardBody } from "@/components/ui";
import { verifyCertificate } from "@/server/services/certificates";

export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Vérification du certificat ${decodeURIComponent(code)}`,
    robots: { index: false, follow: false },
  };
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("fr-TN", { dateStyle: "long" }).format(value);
}

export default async function CertificateVerificationPage({ params }: { params: Params }) {
  const { code } = await params;
  const result = await verifyCertificate(decodeURIComponent(code));

  if (!result.found) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold text-ink-900">Certificat introuvable</h1>
        <div className="mt-6">
          <Alert tone="danger" title="Aucun certificat ne correspond à ce code">
            Vérifiez la saisie du code (format BA-XXXXXXXX). Si le problème persiste, demandez à l&apos;organisation
            émettrice de confirmer la référence du certificat.
          </Alert>
        </div>
        <div className="mt-6">
          <ButtonLink href="/verifier-certificat" variant="secondary">
            Vérifier un autre certificat
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-ink-900">Résultat de la vérification</h1>
        <Badge tone={result.valid ? "success" : "danger"}>{result.valid ? "Certificat valide" : "Certificat révoqué"}</Badge>
      </div>

      {!result.valid ? (
        <div className="mt-4">
          <Alert tone="warning" title="Ce certificat a été révoqué">
            Il a été émis le {formatDate(result.issuedAt)} puis révoqué le{" "}
            {result.revokedAt ? formatDate(result.revokedAt) : "—"}. Il ne doit plus être présenté comme une
            certification valide.
          </Alert>
        </div>
      ) : null}

      <Card className="mt-6">
        <CardBody>
          <dl className="divide-y divide-ink-100 text-sm">
            <div className="flex flex-wrap justify-between gap-2 py-3">
              <dt className="text-ink-500">Titulaire</dt>
              <dd className="font-medium text-ink-900">{result.recipientName}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-3">
              <dt className="text-ink-500">Formation</dt>
              <dd className="font-medium text-ink-900">{result.courseTitle}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-3">
              <dt className="text-ink-500">Organisme émetteur</dt>
              <dd className="font-medium text-ink-900">{result.organizationName}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-3">
              <dt className="text-ink-500">Date de délivrance</dt>
              <dd className="font-medium text-ink-900">{formatDate(result.issuedAt)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-3">
              <dt className="text-ink-500">Numéro de série</dt>
              <dd className="font-mono text-xs text-ink-900">{result.serial}</dd>
            </div>
            {result.finalScore !== null ? (
              <div className="flex flex-wrap justify-between gap-2 py-3">
                <dt className="text-ink-500">Score final</dt>
                <dd className="font-medium text-ink-900">{Math.round(result.finalScore)} %</dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-ink-500">
        Cette page ne divulgue ni adresse e-mail, ni identifiant interne. Pour toute contestation, contactez
        l&apos;organisation émettrice.{" "}
        <Link href="/verifier-certificat" className="text-brand-700 underline">
          Vérifier un autre certificat
        </Link>
      </p>
    </div>
  );
}
