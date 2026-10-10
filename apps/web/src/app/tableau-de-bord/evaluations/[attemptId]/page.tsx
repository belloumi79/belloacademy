import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, QUESTION_TYPE_LABELS, type QuestionType } from "@belloacademy/shared";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { can, requirePageOrganization } from "@/server/page-context";
import { getAttemptDetail } from "@/server/services/assessments";

export const metadata: Metadata = { title: "Détail de l'évaluation" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "En cours",
  SUBMITTED: "Correction en attente",
  GRADED: "Corrigé",
  EXPIRED: "Expiré",
};

export default async function AttemptDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const page = await requirePageOrganization();
  const canReview = can(page, "assessment:grade");

  let attempt: Awaited<ReturnType<typeof getAttemptDetail>>;
  try {
    attempt = await getAttemptDetail({
      organizationId: page.organizationId,
      attemptId,
      viewer: { userId: page.user.id, canReview },
    });
  } catch {
    notFound();
  }

  const reveal = canReview || attempt.status === "GRADED";
  const isOwnAttempt = attempt.userId === page.user.id;

  return (
    <div className="space-y-8">
      <header>
        <Link href="/tableau-de-bord/evaluations" className="text-sm text-brand-700 hover:underline">
          ← Mes évaluations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink-900">{attempt.quiz.title}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {isOwnAttempt ? "Votre tentative" : `Tentative de ${attempt.user.name}`} n°{attempt.attemptNumber} —{" "}
          {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : "non terminée"}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={attempt.status === "GRADED" ? "success" : attempt.status === "EXPIRED" ? "danger" : "warning"}>
          {STATUS_LABELS[attempt.status] ?? attempt.status}
        </Badge>
        {attempt.status === "GRADED" ? (
          <span className="text-sm text-ink-700">
            Score : <strong>{attempt.score}</strong> / {attempt.maxScore}
            {attempt.passed === true ? " — réussi" : attempt.passed === false ? " — non réussi" : ""}
          </span>
        ) : null}
        <span className="text-sm text-ink-500">Seuil de réussite : {attempt.quiz.passingScore} / 100</span>
      </div>

      {!reveal ? (
        <Alert tone="neutral" title="Corrections masquées">
          Les bonnes réponses seront affichées une fois la correction terminée.
        </Alert>
      ) : null}

      <ul className="space-y-4">
        {attempt.answers.map((answer) => {
          const selected = new Set(answer.selectedOptionIds);
          return (
            <li key={answer.id}>
              <Card>
                <CardHeader
                  title={answer.question.prompt}
                  description={`${QUESTION_TYPE_LABELS[answer.question.type as QuestionType] ?? answer.question.type} — ${answer.question.points} point(s)`}
                  action={
                    <Badge
                      tone={
                        answer.isCorrect === true ? "success" : answer.isCorrect === false ? "danger" : "warning"
                      }
                    >
                      {answer.isCorrect === true
                        ? `${answer.pointsAwarded} pt`
                        : answer.isCorrect === false
                          ? "0 pt"
                          : "À corriger"}
                    </Badge>
                  }
                />
                <CardBody className="space-y-3">
                  {answer.question.options.length > 0 ? (
                    <ul className="space-y-1.5">
                      {answer.question.options.map((option) => {
                        const isSelected = selected.has(option.id);
                        const isCorrectOption = "isCorrect" in option ? option.isCorrect : undefined;
                        return (
                          <li
                            key={option.id}
                            className={[
                              "rounded-md border px-3 py-2 text-sm",
                              isSelected ? "border-brand-300 bg-brand-50" : "border-ink-200",
                              reveal && isCorrectOption === true ? "border-success-700/40 bg-success-50" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <span className="text-ink-800">{option.label}</span>
                            {isSelected ? <span className="ml-2 text-xs text-brand-700">votre réponse</span> : null}
                            {reveal && isCorrectOption === true ? (
                              <span className="ml-2 text-xs text-success-700">bonne réponse</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-800">
                      <p className="text-xs text-ink-500">Votre réponse</p>
                      <p className="mt-1 whitespace-pre-wrap">{answer.answerText ?? "—"}</p>
                    </div>
                  )}

                  {reveal && answer.question.explanation ? (
                    <p className="text-sm text-ink-600">
                      <strong className="text-ink-800">Explication :</strong> {answer.question.explanation}
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
