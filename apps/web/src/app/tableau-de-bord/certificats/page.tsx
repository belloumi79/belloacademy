import type { Metadata } from "next";
import Link from "next/link";

import { formatDate } from "@belloacademy/shared";
import { Badge, Card, CardBody, CardHeader, EmptyState, Table } from "@/components/ui";
import { requirePageOrganization } from "@/server/page-context";
import { listMyCertificates } from "@/server/services/certificates";

export const metadata: Metadata = { title: "Mes certificats" };
export const dynamic = "force-dynamic";

export default async function MyCertificatesPage() {
  const page = await requirePageOrganization();
  const certificates = await listMyCertificates({
    organizationId: page.organizationId,
    userId: page.user.id,
  });

  const active = certificates.filter((certificate) => certificate.revokedAt === null);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Mes certificats</h1>
        <p className="mt-1 text-sm text-ink-600">
          Chaque certificat possède un code de vérification public : toute personne peut confirmer
          son authenticité sans accéder à vos données personnelles.
        </p>
      </header>

      {certificates.length === 0 ? (
        <EmptyState
          title="Aucun certificat pour le moment"
          description="Un certificat est délivré automatiquement lorsque vous terminez une formation et atteignez le score minimum requis."
          action={
            <Link href="/tableau-de-bord/formations" className="text-sm font-medium text-brand-700 hover:underline">
              Reprendre une formation
            </Link>
          }
        />
      ) : (
        <Card>
          <CardHeader
            title={`${active.length} certificat${active.length > 1 ? "s" : ""} valide${active.length > 1 ? "s" : ""}`}
            description={
              certificates.length !== active.length
                ? `${certificates.length - active.length} certificat(s) révoqué(s) figurent également ci-dessous.`
                : undefined
            }
          />
          <CardBody>
            <Table head={["Formation", "Numéro", "Score final", "Délivré le", "Statut", "Vérification"]}>
              {certificates.map((certificate) => (
                <tr key={certificate.id} className="border-t border-ink-100">
                  <td className="px-3 py-2 font-medium text-ink-900">{certificate.course.title}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-700">{certificate.serial}</td>
                  <td className="px-3 py-2 text-ink-700">
                    {certificate.finalScore !== null ? `${certificate.finalScore} / 100` : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-600">{formatDate(certificate.issuedAt)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={certificate.revokedAt === null ? "success" : "danger"}>
                      {certificate.revokedAt === null ? "Valide" : "Révoqué"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/verifier-certificat/${certificate.serial}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Voir la page publique
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
