import type { Metadata } from "next";
import Link from "next/link";

import { formatDateTime } from "@belloacademy/shared";

import { Badge, Card, CardBody, CardHeader, EmptyState, Table } from "@/components/ui";
import { listPendingGrading } from "@/server/services/dashboards";
import { requirePagePermission } from "@/server/page-context";

export const metadata: Metadata = { title: "Corrections" };
export const dynamic = "force-dynamic";

/**
 * File d'attente de correction : dépôts de devoirs et réponses de quiz
 * nécessitant une évaluation humaine. Les données proviennent des tables
 * réelles de l'organisation courante, filtrées sur les cours du formateur.
 */
export default async function CorrectionsPage() {
  const page = await requirePagePermission("assessment:grade");
  const pending = await listPendingGrading(page.organizationId, page.user.id);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Corrections en attente</h1>
        <p className="mt-1 text-sm text-ink-600">
          Travaux déposés par vos apprenants et questions ouvertes à noter manuellement.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Devoirs déposés"
          description={`${pending.submissions.length} dépôt(s) en attente de note.`}
        />
        <CardBody>
          {pending.submissions.length === 0 ? (
            <EmptyState
              title="Aucun devoir à corriger"
              description="Les dépôts apparaissent ici dès qu'un apprenant soumet un travail."
            />
          ) : (
            <Table head={["Devoir", "Formation", "Apprenant", "Déposé le", "Barème", ""]}>
              {pending.submissions.map((submission) => (
                <tr key={submission.id}>
                  <td className="px-3 py-2 font-medium text-ink-900">{submission.assignmentTitle}</td>
                  <td className="px-3 py-2 text-ink-600">{submission.courseTitle}</td>
                  <td className="px-3 py-2 text-ink-600">{submission.learnerName}</td>
                  <td className="px-3 py-2 text-ink-600">
                    {submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-600">{submission.maxScore} pts</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/tableau-de-bord/formateur/devoirs/${submission.assignmentId}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Corriger
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Questions ouvertes à noter"
          description="Réponses à réponse courte laissées en évaluation manuelle."
        />
        <CardBody>
          {pending.quizAnswers.length === 0 ? (
            <EmptyState title="Rien à noter" description="Toutes les réponses ouvertes sont corrigées." />
          ) : (
            <ul className="space-y-3">
              {pending.quizAnswers.map((answer) => (
                <li key={answer.id} className="rounded-lg border border-ink-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-ink-900">{answer.learnerName}</span>
                    <span className="text-ink-500">·</span>
                    <span className="text-ink-600">{answer.quizTitle}</span>
                    <span className="text-ink-500">·</span>
                    <span className="text-ink-600">{answer.courseTitle}</span>
                    <Badge tone="neutral">{answer.points} pts</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-700">{answer.questionPrompt}</p>
                  <p className="mt-1 text-sm text-ink-600">
                    Réponse : {answer.answerText?.trim() || "—"}
                  </p>
                  <Link
                    href={`/tableau-de-bord/evaluations/${answer.attemptId}`}
                    className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
                  >
                    Noter cette réponse
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
