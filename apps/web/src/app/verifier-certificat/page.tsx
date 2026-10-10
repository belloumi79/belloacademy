import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardBody, Field, Input } from "@/components/ui";

export const metadata: Metadata = {
  title: "Vérifier un certificat",
  description:
    "Contrôlez l'authenticité d'un certificat BelloAcademy à partir de son code de vérification. Aucune donnée personnelle superflue n'est affichée.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyCertificatePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = params.code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  // Le formulaire est un GET classique : le code saisi est redirigé vers sa page
  // de résultat, ce qui rend chaque vérification citable par URL.
  if (code) redirect(`/verifier-certificat/${encodeURIComponent(code)}`);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">Vérifier un certificat</h1>
      <p className="mt-2 text-sm text-ink-700">
        Chaque certificat délivré par BelloAcademy porte un code de vérification unique. Saisissez-le pour confirmer
        qu&apos;un certificat est authentique et toujours valide.
      </p>

      <Card className="mt-6">
        <CardBody>
          <form method="get" action="/verifier-certificat" className="space-y-4">
            <Field
              label="Code de vérification"
              name="code"
              hint="Il figure sur le certificat PDF, au format BA-XXXXXXXX."
              required
            >
              <Input
                id="code"
                name="code"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="BA-1A2B3C4D"
                pattern="[A-Za-z0-9\-]{6,40}"
              />
            </Field>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Vérifier le certificat
            </button>
          </form>
        </CardBody>
      </Card>

      <p className="mt-6 text-xs text-ink-500">
        La page de résultat affiche uniquement l&apos;intitulé de la formation, l&apos;organisation émettrice, la date
        de délivrance et le numéro de série. Aucune adresse e-mail ni identifiant interne n&apos;est divulgué.
      </p>
    </div>
  );
}
