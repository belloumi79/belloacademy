import type { Metadata } from "next";

import { Badge, ButtonLink, Card, CardBody } from "@/components/ui";
import {
  PLAN_FEATURE_LABELS,
  PLAN_METRICS,
  PLAN_METRIC_LABELS,
  formatAmount,
  hasFeature,
  parseLimits,
  type PlanFeature,
  type PlanMetric,
} from "@belloacademy/shared";
import { listPublicPlans } from "@/server/services/billing";

export const metadata: Metadata = {
  title: "Forfaits et abonnements",
  description:
    "Comparez les forfaits BelloAcademy : utilisateurs, formations publiées, stockage, classes virtuelles et inscriptions actives. Essai gratuit selon le forfait.",
};

export const dynamic = "force-dynamic";

const HIGHLIGHTED_FEATURES: PlanFeature[] = [
  "liveClasses",
  "quizzes",
  "assignments",
  "certificates",
  "customDomain",
  "sso",
  "prioritySupport",
];

function limitLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Illimité";
  return String(value);
}

export default async function PricingPage() {
  const plans = await listPublicPlans();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">Forfaits et abonnements</h1>
        <p className="mt-2 text-sm text-ink-700">
          Chaque organisation souscrit un forfait qui fixe ses limites et ses fonctionnalités. Les prix sont affichés
          hors taxes, facturés mensuellement ou annuellement, et résiliables à la fin de la période en cours.
        </p>
      </header>

      {plans.length === 0 ? (
        <Card className="mt-8">
          <CardBody>
            <p className="text-sm text-ink-700">
              Aucun forfait public n&apos;est configuré pour le moment. Un superadministrateur peut en définir depuis
              l&apos;espace d&apos;administration.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="mt-8 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const limits = parseLimits(plan.limits);
            const features = (plan.features ?? []) as PlanFeature[];
            return (
              <li key={plan.id}>
                <Card className="flex h-full flex-col">
                  <CardBody className="flex h-full flex-col gap-4">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-ink-900">{plan.name}</h2>
                        {plan.trialDays > 0 ? <Badge tone="success">{plan.trialDays} j d&apos;essai</Badge> : null}
                      </div>
                      {plan.description ? <p className="mt-2 text-sm text-ink-700">{plan.description}</p> : null}
                    </div>

                    <div>
                      <p className="text-2xl font-semibold text-ink-900">
                        {formatAmount(plan.priceMonthlyCents, plan.currency)}
                        <span className="text-sm font-normal text-ink-500"> / mois</span>
                      </p>
                      {plan.priceYearlyCents > 0 ? (
                        <p className="mt-1 text-xs text-ink-500">
                          ou {formatAmount(plan.priceYearlyCents, plan.currency)} par an
                        </p>
                      ) : null}
                    </div>

                    <dl className="space-y-1.5 border-t border-ink-200 pt-4 text-sm">
                      {PLAN_METRICS.map((metric: PlanMetric) => (
                        <div key={metric} className="flex items-center justify-between gap-3">
                          <dt className="text-ink-600">{PLAN_METRIC_LABELS[metric]}</dt>
                          <dd className="font-medium text-ink-900">{limitLabel(limits[metric])}</dd>
                        </div>
                      ))}
                    </dl>

                    <ul className="space-y-1.5 border-t border-ink-200 pt-4 text-sm">
                      {HIGHLIGHTED_FEATURES.map((feature) => {
                        const enabled = hasFeature(features, feature);
                        return (
                          <li key={feature} className="flex items-start gap-2">
                            <span
                              aria-hidden
                              className={enabled ? "mt-1 text-success-700" : "mt-1 text-ink-400"}
                            >
                              {enabled ? "✓" : "—"}
                            </span>
                            <span className={enabled ? "text-ink-700" : "text-ink-500"}>
                              {PLAN_FEATURE_LABELS[feature]}
                              <span className="sr-only">{enabled ? " inclus" : " non inclus"}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="mt-auto pt-2">
                      <ButtonLink href="/inscription" className="w-full">
                        Créer mon organisation
                      </ButtonLink>
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="facturation" className="mt-12 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <h2 id="facturation" className="font-semibold text-ink-900">
              Facturation et paiements
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              Les factures sont émises par l&apos;organisation et conservées dans son espace. Le prestataire de
              paiement est configuré côté serveur : aucune clé secrète ne transite par le navigateur. Sur une
              installation de démonstration, un mode de test explicitement identifié permet de simuler le parcours
              d&apos;abonnement sans aucun encaissement réel.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="font-semibold text-ink-900">Changer ou résilier</h2>
            <p className="mt-2 text-sm text-ink-700">
              Un administrateur d&apos;organisation peut changer de forfait à tout moment ; le changement prend effet
              immédiatement et la période est recalculée. La résiliation est programmée pour la fin de la période déjà
              réglée, et l&apos;accès reste ouvert jusqu&apos;à cette date.
            </p>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
