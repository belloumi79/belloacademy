import type { Metadata } from "next";

import { formatDate, formatMoney } from "@belloacademy/shared";

import { Badge, Card, CardBody, CardHeader, EmptyState, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/page-context";
import { platformOverview } from "@/server/services/dashboards";
import { listAllOrganizations } from "@/server/services/organizations";

export const metadata: Metadata = { title: "Console plateforme" };
export const dynamic = "force-dynamic";

export default async function PlatformAdminPage() {
  const page = await requirePagePermission("platform:admin");

  const [overview, organizations] = await Promise.all([platformOverview(), listAllOrganizations(100)]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Console plateforme</h1>
        <p className="mt-1 text-sm text-ink-600">
          Vue globale de BelloAcademy : organisations, utilisateurs, revenus et abonnements.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Organisations"
          value={overview.organizations.total}
          hint={`${overview.organizations.active} actives — ${overview.organizations.newInPeriod} nouvelles sur 30 j`}
        />
        <Stat
          label="Utilisateurs"
          value={overview.users.total}
          hint={`${overview.users.newInPeriod} inscriptions sur 30 j`}
        />
        <Stat
          label="Formations publiées"
          value={overview.courses.published}
          hint={`${overview.courses.draft} brouillons`}
        />
        <Stat
          label="Inscriptions"
          value={overview.enrollments.total}
          hint={`${overview.enrollments.inPeriod} sur 30 j`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Encaissé (30 j)"
          value={formatMoney(overview.revenue.paidCentsInPeriod, overview.revenue.currency)}
          hint="Factures marquées payées"
        />
        <Stat
          label="En attente de paiement"
          value={formatMoney(overview.revenue.outstandingCents, overview.revenue.currency)}
          hint="Factures ouvertes"
        />
        <Stat label="Classes virtuelles à venir" value={overview.liveSessions.upcoming} />
      </div>

      <Card>
        <CardHeader
          title="Abonnements par statut"
          description="Répartition réelle des abonnements enregistrés, tous forfaits confondus."
        />
        <CardBody>
          {overview.subscriptionsByStatus.length === 0 ? (
            <p className="text-sm text-ink-500">Aucun abonnement enregistré pour le moment.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {overview.subscriptionsByStatus.map((entry) => (
                <li key={entry.status}>
                  <Badge tone={entry.status === "ACTIVE" ? "success" : entry.status === "PAST_DUE" ? "danger" : "neutral"}>
                    {entry.status} — {entry.count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Organisations"
          description="Chaque ligne est isolée des autres : aucune donnée n'est agrégée depuis une autre organisation."
        />
        <CardBody>
          {organizations.length === 0 ? (
            <EmptyState
              title="Aucune organisation"
              description="Les organisations apparaissent ici dès leur création par un administrateur."
            />
          ) : (
            <Table head={["Organisation", "Forfait", "Pays", "Membres", "Formations", "Inscriptions", "Créée le"]}>
              {organizations.map((organization) => (
                <tr key={organization.id} className="border-t border-ink-100">
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink-900">{organization.name}</span>
                    <span className="ml-2 text-xs text-ink-500">{organization.slug}</span>
                    {organization.deletedAt ? (
                      <Badge tone="danger">supprimée</Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{organization.planName ?? "—"}</td>
                  <td className="px-3 py-2">{organization.country}</td>
                  <td className="px-3 py-2">{organization.members}</td>
                  <td className="px-3 py-2">{organization.courses}</td>
                  <td className="px-3 py-2">{organization.enrollments}</td>
                  <td className="px-3 py-2">{formatDate(organization.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Évolution mensuelle" description="12 derniers mois, calculés à partir des données réelles." />
        <CardBody>
          <Table head={["Mois", "Nouvelles organisations", "Inscriptions", "Encaissé"]}>
            {overview.monthly.map((row) => (
              <tr key={row.month} className="border-t border-ink-100">
                <td className="px-3 py-2">{row.month}</td>
                <td className="px-3 py-2">{row.organizations}</td>
                <td className="px-3 py-2">{row.enrollments}</td>
                <td className="px-3 py-2">{formatMoney(row.revenueCents, overview.revenue.currency)}</td>
              </tr>
            ))}
          </Table>
        </CardBody>
      </Card>

      <p className="text-xs text-ink-500">
        Connecté en tant que {page.user.email} — rôle superadministrateur.
      </p>
    </div>
  );
}
