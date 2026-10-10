import type { Metadata } from "next";
import Link from "next/link";

import {
  INVOICE_STATUS_LABELS,
  PLAN_FEATURE_LABELS,
  PLAN_METRIC_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatAmount,
  formatDate,
  type InvoiceStatus,
  type PlanFeature,
  type PlanMetric,
  type SubscriptionStatus,
} from "@belloacademy/shared";

import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, Progress, Stat, Table } from "@/components/ui";
import { requirePageOrganization } from "@/server/page-context";
import { getSubscription, listInvoices, listPublicPlans } from "@/server/services/billing";
import { getPlanLimits, getUsage } from "@/server/services/organizations";

export const metadata: Metadata = { title: "Forfait et factures" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const page = await requirePageOrganization();

  const [subscription, invoices, plans, usage, limits] = await Promise.all([
    getSubscription(page.organizationId),
    listInvoices(page.organizationId, 50),
    listPublicPlans(),
    getUsage(page.organizationId),
    getPlanLimits(page.organizationId),
  ]);

  const currentPlanCode = subscription?.plan.code ?? null;
  const entitled = subscription ? ["TRIALING", "ACTIVE", "PAST_DUE"].includes(subscription.status) : false;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Forfait et factures</h1>
        <p className="mt-1 text-sm text-ink-600">
          Consultez votre abonnement, votre consommation réelle et l&apos;historique de vos factures.
        </p>
      </header>

      {!entitled ? (
        <Alert tone="warning" title="Aucun forfait actif">
          Votre organisation ne dispose pas d&apos;un abonnement actif. Choisissez un forfait ci-dessous pour réactiver
          les fonctionnalités payantes.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Abonnement courant"
          description={subscription ? `Forfait ${subscription.plan.name}` : "Aucun abonnement enregistré"}
          action={
            <ButtonLink href="/tarifs" variant="secondary" size="sm">
              Comparer les forfaits
            </ButtonLink>
          }
        />
        <CardBody className="space-y-5">
          {subscription ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={subscription.status === "ACTIVE" ? "success" : subscription.status === "PAST_DUE" ? "danger" : "brand"}>
                  {SUBSCRIPTION_STATUS_LABELS[subscription.status as SubscriptionStatus] ?? subscription.status}
                </Badge>
                <Badge tone="neutral">
                  {subscription.interval === "yearly" ? "Facturation annuelle" : "Facturation mensuelle"}
                </Badge>
                {subscription.cancelAtPeriodEnd ? <Badge tone="warning">Résiliation programmée</Badge> : null}
                <Badge tone="neutral">
                  Prestataire : {subscription.provider === "MOCK" ? "mode test" : subscription.provider}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Période en cours" value={formatDate(subscription.currentPeriodStart)} hint={`jusqu'au ${formatDate(subscription.currentPeriodEnd)}`} />
                <Stat
                  label="Montant"
                  value={formatAmount(
                    subscription.interval === "yearly" ? subscription.plan.priceYearlyCents : subscription.plan.priceMonthlyCents,
                    subscription.plan.currency,
                  )}
                  hint={subscription.interval === "yearly" ? "par an" : "par mois"}
                />
                <Stat
                  label="Fin d'essai"
                  value={subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : "—"}
                  hint={subscription.trialEndsAt ? "essai en cours" : "aucun essai"}
                />
              </div>
            </>
          ) : (
            <EmptyState
              title="Aucun abonnement"
              description="Souscrivez à un forfait pour débloquer les formations payantes, les classes virtuelles et les certificats."
              action={<ButtonLink href="/tarifs">Voir les forfaits</ButtonLink>}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Consommation" description="Mesurée sur les données réelles de l'organisation." />
        <CardBody className="space-y-5">
          {(Object.keys(PLAN_METRIC_LABELS) as PlanMetric[]).map((metric) => {
            const used = usage[metric] ?? 0;
            const limit = limits[metric] ?? null;
            const percent = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
            return (
              <div key={metric} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-ink-800">{PLAN_METRIC_LABELS[metric]}</span>
                  <span className="text-ink-600">
                    {used}
                    {limit === null ? " — illimité" : ` / ${limit}`}
                  </span>
                </div>
                {percent !== null ? (
                  <Progress value={percent} />
                ) : (
                  <p className="text-xs text-ink-500">Sans limite sur le forfait actuel.</p>
                )}
                {percent !== null && percent >= 100 ? (
                  <p className="text-xs text-danger-700">
                    Limite atteinte : les nouvelles créations de ce type seront refusées jusqu&apos;au changement de
                    forfait.
                  </p>
                ) : null}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Factures" description={`${invoices.length} facture(s) émise(s)`} />
        <CardBody>
          {invoices.length === 0 ? (
            <EmptyState
              title="Aucune facture"
              description="Les factures apparaissent ici dès qu'un paiement est enregistré pour cette organisation."
            />
          ) : (
            <Table head={["Numéro", "Émise le", "Période", "Montant", "Statut"]}>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-3 font-mono text-xs text-ink-700">{invoice.number}</td>
                  <td className="px-4 py-3 text-ink-600">{formatDate(invoice.issuedAt)}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {invoice.periodStart && invoice.periodEnd
                      ? `${formatDate(invoice.periodStart)} → ${formatDate(invoice.periodEnd)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink-900">
                    {formatAmount(invoice.amountCents + invoice.taxCents, invoice.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={invoice.status === "PAID" ? "success" : invoice.status === "OPEN" ? "warning" : "neutral"}>
                      {INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Forfaits disponibles" description="Tarifs publics du catalogue." />
        <CardBody>
          <ul className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => {
              const features = Array.isArray(plan.features) ? (plan.features as string[]) : [];
              return (
                <li key={plan.code} className="rounded-xl border border-ink-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink-900">{plan.name}</p>
                    {plan.code === currentPlanCode ? <Badge tone="brand">Forfait actuel</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-600">{plan.description}</p>
                  <p className="mt-3 text-lg font-semibold text-ink-900">
                    {formatAmount(plan.priceMonthlyCents, plan.currency)}
                    <span className="text-sm font-normal text-ink-500"> / mois</span>
                  </p>
                  {features.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-ink-600">
                      {features.map((feature) => (
                        <li key={feature}>• {PLAN_FEATURE_LABELS[feature as PlanFeature] ?? feature}</li>
                      ))}
                    </ul>
                  ) : null}
                  <Link
                    href="/tarifs"
                    className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
                  >
                    Voir le détail
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
