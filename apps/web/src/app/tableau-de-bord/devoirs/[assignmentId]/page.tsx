import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SUBMISSION_STATUS_LABELS, formatDateTime } from "@belloacademy/shared";

import { AssignmentSubmitForm } from "@/components/assessments/assignment-submit-form";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { requirePageOrganization } from "@/server/page-context";
import { getAssignmentForLearner } from "@/server/services/assignments";

export const metadata: Metadata = { title: "Devoir" };
export const dynamic = "force-dynamic";

export default async function AssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const page = await requirePageOrganization();

  const assignment = await getAssignmentForLearner({
    organizationId: page.organizationId,
    assignmentId,
    userId: page.user.id,
  }).catch(() => null);

  if (!assignment) notFound();

  const { submission } = assignment;
  const late = assignment.isOverdue;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <Link href="/tableau-de-bord/devoirs" className="hover:text-brand-700">
          Mes devoirs
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink-700">{assignment.title}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink-900">{assignment.title}</h1>
        <p className="text-sm text-ink-600">
          {assignment.course.title} — noté sur {assignment.maxScore} points
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {assignment.dueAt ? (
            <Badge tone={late ? "danger" : "neutral"}>
              Échéance : {formatDateTime(assignment.dueAt)}
            </Badge>
          ) : (
            <Badge tone="neutral">Sans échéance</Badge>
          )}
          {submission ? (
            <Badge tone={submission.status === "GRADED" ? "success" : "brand"}>
              {SUBMISSION_STATUS_LABELS[submission.status]}
            </Badge>
          ) : null}
          {late && !assignment.allowLate ? <Badge tone="danger">Dépôt en retard fermé</Badge> : null}
        </div>
      </header>

      {assignment.instructionsMd ? (
        <Card>
          <CardHeader title="Consignes" />
          <CardBody>
            <div className="space-y-3 text-sm whitespace-pre-wrap text-ink-700">
              {assignment.instructionsMd}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {submission?.status === "GRADED" ? (
        <Card>
          <CardHeader title="Correction" />
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-700">
              Note : <span className="font-semibold">{submission.score ?? 0}</span> / {assignment.maxScore}
            </p>
            {submission.feedback ? (
              <p className="text-sm whitespace-pre-wrap text-ink-600">{submission.feedback}</p>
            ) : (
              <p className="text-sm text-ink-500">Aucun commentaire du formateur.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {assignment.canSubmit ? (
        <Card>
          <CardHeader
            title={submission ? "Mettre à jour mon dépôt" : "Déposer mon travail"}
            description="Votre dépôt précédent est remplacé, jamais dupliqué."
          />
          <CardBody>
            <AssignmentSubmitForm
              assignmentId={assignment.id}
              organizationId={page.organizationId}
              initialText={submission?.textContent ?? ""}
            />
          </CardBody>
        </Card>
      ) : (
        <Alert tone="neutral" title="Dépôt fermé">
          Ce devoir n&apos;accepte plus de dépôt : l&apos;échéance est dépassée et les retards ne sont pas autorisés, ou
          votre travail a déjà été corrigé.
        </Alert>
      )}
    </div>
  );
}
