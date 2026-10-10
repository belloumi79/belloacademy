import type { Metadata } from "next";
import Link from "next/link";

import {
  PLAN_METRIC_LABELS,
  ROLE_LABELS,
  formatDateTime,
  percent,
  type OrgRole,
  type PlanMetric,
} from "@belloacademy/shared";

import { Badge, Card, CardBody, CardHeader, EmptyState, Progress, Stat, Table } from "@/components/ui";
import { can, requirePagePermission } from "@/server/page-context";
import { organizationOverview } from "@/server/services/dashboards";
import { getOrganizationSettings, listOrganizationsForUser } from "@/server/services/organizations";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

const METRIC_ORDER: PlanMetric[] = ["users", "courses", "storageMb", "liveSessionsPerMonth", "enrollments"];

export default async function OrganizationPage() {
  const page = await requirePagePermission("member:read");

  const [overview, settings] = await Promise.all([
    organizationOverview(page.organizationId),
    getOrganizationSettings(page.organizationId),
  ]);

  const showBilling = can(page, "billing:read");
  const organization =
    (await listOrganizationsForUser(page.user.id)).find((item) => item.id === page.organizationId) ?? null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{page.organizationName ?? "Administration"}</h1>
          <p className="mt-1 text-sm text-ink-600">
            Vue d&apos;ensemble des 30 derniers jours : effectifs, catalogue, inscriptions et consommation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tableau-de-bord/organisation/membres" className="text-sm font-medium text-brand-700 hover:underline">
            Membres et invitations
          </Link>
          {can(page, "audit:read") ? (
            <Link href="/tableau-de-bord/organisation/audit" className="text-sm font-medium text-brand-700 hover:underline">
              Journal d&apos;audit
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Membres"
          value={overview.members.total}
          hint={`${overview.members.newInPeriod} nouveaux sur la période`}
        />
        <Stat
          label="Formations publiées"
          value={overview.courses.published}
          hint={`${overview.courses.draft} brouillon(s), ${overview.courses.archived} archivée(s)`}
        />
        <Stat
          label="Inscriptions actives"
          value={overview.enrollments.active}
          hint={`${overview.enrollments.inPeriod} sur la période`}
        />
        <Stat label="Taux d'achèvement" value={`${overview.completionRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Répartition des rôles" />
          <CardBody className="space-y-3">
            {overview.members.byRole.length === 0 ? (
              <p className="text-sm text-ink-500">Aucun membre enregistré.</p>
            ) : (
              overview.members.byRole.map((entry) => {
                const share = percent(entry.count, Math.max(1, overview.members.total));
                return (
                  <div key={entry.role} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-700">
                        {ROLE_LABELS[entry.role as OrgRole] ?? ROLE_LABELS[entry.role as keyof typeof ROLE_LABELS] ?? entry.role}
                      </span>
                      <span className="text-ink-500">
                        {entry.count} ({share}%)
                      </span>
                    </div>
                    <Progress value={share} />
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Consommation du forfait"
            description={showBilling ? "Utilisation réelle face aux limites du forfait souscrit." : "Suivi de la consommation."}
          />
          <CardBody className="space-y-3">
            {METRIC_ORDER.map((metric) => {
              const used = overview.usage[metric] ?? 0;
              const limit = overview.limits[metric] ?? null;
              const share = limit ? percent(used, limit) : 0;
              return (
                <div key={metric} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-700">{PLAN_METRIC_LABELS[metric]}</span>
                    <span className="text-ink-500">{limit === null ? `${used} (illimité)` : `${used} / ${limit}`}</span>
                  </div>
                  {limit === null ? null : <Progress value={share} />}
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Inscriptions et achèvements"
          description="Douze derniers mois, calculés à partir des inscriptions réelles."
        />
        <CardBody className="p-0">
          <Table head={["Mois", "Inscriptions", "Achèvements"]}>
            {overview.monthly.map((bucket) => (
              <tr key={bucket.month} className="border-t border-ink-200">
                <td className="px-4 py-2 text-ink-700">{bucket.month}</td>
                <td className="px-4 py-2 text-ink-700">{bucket.enrollments}</td>
                <td className="px-4 py-2 text-ink-700">{bucket.completions}</td>
              </tr>
            ))}
          </Table>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Prochaines classes virtuelles" />
          <CardBody className="space-y-3">
            {overview.upcomingSessions.length === 0 ? (
              <p className="text-sm text-ink-500">Aucune session planifiée.</p>
            ) : (
              overview.upcomingSessions.map((session) => (
                <div key={session.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/tableau-de-bord/classes-virtuelles/${session.id}`}
                    className="text-sm font-medium text-ink-900 hover:text-brand-700"
                  >
                    {session.title}
                  </Link>
                  <p className="text-xs text-ink-500">
                    {session.courseTitle} — {formatDateTime(session.scheduledStart)}
                  </p>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Paramètres de l'organisation" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">Identifiant public</span>
              <span className="font-medium text-ink-900">{page.organizationSlug ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">Pays et devise</span>
              <span className="font-medium text-ink-900">
                {organization?.country ?? "—"} — {organization?.currency ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">Fuseau horaire</span>
              <span className="font-medium text-ink-900">{organization?.timezone ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">Forfait</span>
              <span className="font-medium text-ink-900">{organization?.planName ?? "Aucun"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge tone={settings.allowSelfRegistration ? "success" : "neutral"}>
                {settings.allowSelfRegistration ? "Auto-inscription ouverte" : "Auto-inscription fermée"}
              </Badge>
              <Badge tone={settings.allowPublicCatalog ? "success" : "neutral"}>
                {settings.allowPublicCatalog ? "Catalogue public" : "Catalogue privé"}
              </Badge>
              <Badge tone={settings.requireEmailVerification ? "warning" : "neutral"}>
                {settings.requireEmailVerification ? "E-mail à vérifier" : "Vérification d'e-mail désactivée"}
              </Badge>
            </div>
            {settings.supportEmail ? (
              <p className="pt-1 text-ink-500">
                Contact support : <span className="text-ink-900">{settings.supportEmail}</span>
              </p>
            ) : null}
            {overview.pendingGrading > 0 ? (
              <p className="pt-1 text-sm text-warning-700">
                {overview.pendingGrading} dépôt(s) de devoir en attente de correction.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {overview.courses.total === 0 ? (
        <EmptyState
          title="Aucune formation dans cette organisation"
          description="Créez une première formation depuis l'espace formateur pour voir apparaître les statistiques ici."
        />
      ) : null}
    </div>
  );
}
