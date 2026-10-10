import type { Metadata } from "next";
import Link from "next/link";

import { formatDateTime } from "@belloacademy/shared";

import { Badge, Card, CardBody, CardHeader, EmptyState, Table } from "@/components/ui";
import { listAuditLogs, type AuditAction } from "@/lib/audit";
import { requirePagePermission } from "@/server/page-context";

export const metadata: Metadata = { title: "Journal d'audit" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/** Libellés lisibles des actions journalisées. */
const ACTION_LABELS: Record<string, string> = {
  "user.registered": "Compte créé",
  "user.email_verified": "E-mail vérifié",
  "user.password_reset_requested": "Réinitialisation demandée",
  "user.password_reset_completed": "Mot de passe réinitialisé",
  "user.password_changed": "Mot de passe modifié",
  "session.created": "Connexion",
  "session.revoked": "Déconnexion",
  "session.login_failed": "Échec de connexion",
  "organization.created": "Organisation créée",
  "organization.updated": "Organisation modifiée",
  "membership.invited": "Invitation envoyée",
  "membership.invite_accepted": "Invitation acceptée",
  "membership.role_changed": "Rôle modifié",
  "membership.status_changed": "Statut modifié",
  "membership.removed": "Membre retiré",
  "course.created": "Formation créée",
  "course.updated": "Formation modifiée",
  "course.published": "Formation publiée",
  "course.archived": "Formation archivée",
  "course.deleted": "Formation supprimée",
  "enrollment.created": "Inscription créée",
  "enrollment.canceled": "Inscription annulée",
  "enrollment.completed": "Formation terminée",
  "lesson.completed": "Leçon terminée",
  "assessment.graded": "Évaluation notée",
  "assignment.submitted": "Devoir déposé",
  "assignment.graded": "Devoir corrigé",
  "certificate.issued": "Certificat émis",
  "certificate.revoked": "Certificat révoqué",
  "live_session.scheduled": "Classe virtuelle planifiée",
  "live_session.updated": "Classe virtuelle modifiée",
  "live_session.started": "Classe virtuelle démarrée",
  "live_session.ended": "Classe virtuelle terminée",
  "billing.subscription_started": "Abonnement souscrit",
  "billing.subscription_canceled": "Abonnement résilié",
  "billing.payment_confirmed": "Paiement confirmé",
  "file.uploaded": "Fichier déposé",
  "file.downloaded": "Fichier téléchargé",
  "file.deleted": "Fichier supprimé",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const page = await requirePagePermission("audit:read");
  const { action } = await searchParams;

  const logs = await listAuditLogs({
    organizationId: page.organizationId,
    limit: PAGE_SIZE,
    ...(action ? { action: action as AuditAction } : {}),
  });

  const distinctActions = [...new Set(logs.map((log) => log.action))].sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Journal d&apos;audit</h1>
        <p className="mt-1 text-sm text-ink-600">
          Les {PAGE_SIZE} dernières opérations sensibles de {page.organizationName ?? "l'organisation"}. Les mots de
          passe, jetons et données sensibles ne sont jamais journalisés.
        </p>
      </header>

      {distinctActions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/tableau-de-bord/organisation/audit"
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              action ? "border-ink-200 bg-white text-ink-600" : "border-brand-200 bg-brand-50 text-brand-700"
            }`}
          >
            Toutes
          </Link>
          {distinctActions.map((value) => (
            <Link
              key={value}
              href={`/tableau-de-bord/organisation/audit?action=${encodeURIComponent(value)}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                action === value ? "border-brand-200 bg-brand-50 text-brand-700" : "border-ink-200 bg-white text-ink-600"
              }`}
            >
              {actionLabel(value)}
            </Link>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Événements" description={action ? `Filtré sur « ${actionLabel(action)} »` : "Toutes actions confondues"} />
        <CardBody>
          {logs.length === 0 ? (
            <EmptyState
              title="Aucun événement"
              description="Le journal se remplit dès qu'une opération sensible est effectuée dans cette organisation."
            />
          ) : (
            <Table head={["Date", "Action", "Auteur", "Objet", "Détails"]}>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-600">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone="brand">{actionLabel(log.action)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{log.actor?.name ?? "Système"}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {log.entityType ?? "—"}
                    {log.entityId ? <span className="block font-mono">{log.entityId.slice(0, 8)}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {log.metadata && Object.keys(log.metadata as object).length > 0 ? (
                      <span className="font-mono">{JSON.stringify(log.metadata)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
