import type { Metadata } from "next";
import Link from "next/link";

import { formatDate, formatDateTime } from "@belloacademy/shared";
import { Badge, Card, CardBody, CardHeader, EmptyState, Stat, Table } from "@/components/ui";
import { requirePageOrganization } from "@/server/page-context";
import { listMyAttempts } from "@/server/services/assessments";

export const metadata: Metadata = { title: "Mes évaluations" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "En cours",
  SUBMITTED: "Correction en attente",
  GRADED: "Corrigé",
  EXPIRED: "Expiré",
};

function statusTone(status: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (status === "GRADED") return "success";
  if (status === "SUBMITTED") return "warning";
  if (status === "EXPIRED") return "danger";
  if (status === "IN_PROGRESS") return "brand";
  return "neutral";
}

export default async function MyAssessmentsPage() {
  const page = await requirePageOrganization();
  const attempts = await listMyAttempts({
    organizationId: page.organizationId,
    userId: page.user.id,
  });

  const graded = attempts.filter((attempt) => attempt.status === "GRADED" && attempt.passed !== null);
  const passed = graded.filter((attempt) => attempt.passed === true);
  const average =
    graded.length > 0
      ? Math.round(graded.reduce((total, attempt) => total + attempt.score, 0) / graded.length)
      : null;
  const inProgress = attempts.filter(
    (attempt) => attempt.status === "IN_PROGRESS" || attempt.status === "SUBMITTED",
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Mes évaluations</h1>
        <p className="mt-1 text-sm text-ink-600">
          Historique de vos quiz, scores et tentatives encore ouvertes.
        </p>
      </header>

      {attempts.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Tentatives" value={attempts.length} />
          <Stat label="Score moyen" value={average !== null ? `${average} / 100` : "—"} />
          <Stat
            label="Réussites"
            value={`${passed.length} / ${graded.length}`}
            hint={graded.length === 0 ? "Aucune tentative corrigée pour l'instant." : undefined}
          />
        </div>
      ) : null}

      {inProgress.length > 0 ? (
        <Card>
          <CardHeader title="Tentatives à terminer" />
          <CardBody>
            <ul className="space-y-2">
              {inProgress.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink-900">{attempt.quiz.title}</p>
                    <p className="text-sm text-ink-600">
                      {attempt.quiz.course.title} — tentative n°{attempt.attemptNumber}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={statusTone(attempt.status)}>{STATUS_LABELS[attempt.status] ?? attempt.status}</Badge>
                    <Link
                      href={`/tableau-de-bord/evaluations/${attempt.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {attempt.status === "IN_PROGRESS" ? "Reprendre" : "Voir"}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {attempts.length === 0 ? (
        <EmptyState
          title="Aucune évaluation passée"
          description="Les quiz disponibles apparaissent dans vos formations. Votre historique s'affichera ici dès votre première tentative."
          action={
            <Link href="/tableau-de-bord/formations" className="text-sm font-medium text-brand-700 hover:underline">
              Voir mes formations
            </Link>
          }
        />
      ) : (
        <Card>
          <CardHeader title="Historique complet" />
          <CardBody>
            <Table head={["Quiz", "Formation", "Tentative", "Score", "Statut", "Terminé le", ""]}>
              {attempts.map((attempt) => (
                <tr key={attempt.id} className="border-t border-ink-100">
                  <td className="px-3 py-2 font-medium text-ink-900">{attempt.quiz.title}</td>
                  <td className="px-3 py-2 text-ink-700">{attempt.quiz.course.title}</td>
                  <td className="px-3 py-2 text-ink-600">n°{attempt.attemptNumber}</td>
                  <td className="px-3 py-2 text-ink-700">
                    {attempt.status === "GRADED" || attempt.status === "SUBMITTED"
                      ? `${attempt.score} / ${attempt.maxScore}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(attempt.status)}>{STATUS_LABELS[attempt.status] ?? attempt.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-ink-600">
                    {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : formatDate(attempt.startedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/tableau-de-bord/evaluations/${attempt.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Détail
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
