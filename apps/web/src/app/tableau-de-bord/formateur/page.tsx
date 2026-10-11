import type { Metadata } from "next";
import Link from "next/link";

import { formatDateTime, percent } from "@belloacademy/shared";

import { Badge, Card, CardBody, CardHeader, EmptyState, Progress, Stat, Table } from "@/components/ui";import { CourseCreateForm } from "@/components/instructor/course-create-form";
import { can, requirePagePermission } from "@/server/page-context";
import { instructorOverview } from "@/server/services/dashboards";
import { listInstructorCourses } from "@/server/services/courses";

export const metadata: Metadata = { title: "Espace formateur" };
export const dynamic = "force-dynamic";

const COURSE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  PUBLISHED: "Publiée",
  ARCHIVED: "Archivée",
};

export default async function InstructorPage() {
  const page = await requirePagePermission("course:create");

  const [overview, courses] = await Promise.all([
    instructorOverview(page.organizationId, page.user.id),
    listInstructorCourses(page.organizationId, page.user.id),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Espace formateur</h1>
        <p className="mt-1 text-sm text-ink-600">
          Vos formations, vos apprenants et le travail de correction en attente.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Formations" value={overview.courses.length} />
        <Stat label="Apprenants actifs" value={overview.students.active} hint={`${overview.students.total} au total`} />
        <Stat label="Progression moyenne" value={`${overview.averageProgress}%`} />
        <Stat label="Corrections en attente" value={overview.pendingSubmissions.length} />
      </div>

      <CourseCreateForm canCreate={can(page, "course:create")} />

      {courses.length === 0 ? (
        <EmptyState
          title="Aucune formation ne vous est rattachée"
          description="Créez votre première formation avec le formulaire ci-dessus."
        />
      ) : (
        <Card>
          <CardHeader title="Mes formations" description="Statut, audience et volume publié." />
          <CardBody className="p-0">
            <Table head={["Formation", "Statut", "Inscrits", "Leçons publiées", "Progression"]}>
              {courses.map((course) => {
                const stats = overview.courses.find((entry) => entry.id === course.id);
                const progress = percent(stats?.publishedLessons ?? 0, Math.max(1, course._count.lessons));
                return (
                  <tr key={course.id} className="border-t border-ink-200">
                    <td className="px-4 py-3">
                      <Link
                        href={`/tableau-de-bord/formateur/${course.id}`}
                        className="font-medium text-ink-900 hover:text-brand-700"
                      >
                        {course.title}
                      </Link>
                      <p className="text-xs text-ink-500">{course.category?.name ?? "Sans catégorie"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={course.status === "PUBLISHED" ? "success" : course.status === "DRAFT" ? "warning" : "neutral"}>
                        {COURSE_STATUS_LABELS[course.status] ?? course.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{course._count.enrollments}</td>
                    <td className="px-4 py-3 text-ink-700">
                      {stats?.publishedLessons ?? 0} / {course._count.lessons}
                    </td>
                    <td className="w-40 px-4 py-3">
                      <Progress value={progress} label={`${progress}%`} />
                    </td>
                  </tr>
                );
              })}
            </Table>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Devoirs à corriger"
            description="Dépôts en attente d'une appréciation."
            action={
              <Link href="/tableau-de-bord/evaluations/corrections" className="text-sm font-medium text-brand-700 hover:underline">
                Tout voir
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {overview.pendingSubmissions.length === 0 ? (
              <p className="text-sm text-ink-500">Aucun dépôt en attente.</p>
            ) : (
              overview.pendingSubmissions.map((submission) => (
                <div key={submission.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{submission.assignmentTitle}</p>
                    <p className="text-xs text-ink-500">
                      {submission.learnerName} — {submission.courseTitle}
                    </p>
                  </div>
                  <p className="text-xs text-ink-500">
                    {submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}
                  </p>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Derniers résultats de quiz" description="10 tentatives les plus récentes." />
          <CardBody className="space-y-3">
            {overview.recentQuizResults.length === 0 ? (
              <p className="text-sm text-ink-500">Aucune tentative enregistrée.</p>
            ) : (
              overview.recentQuizResults.map((result) => (
                <div key={result.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{result.quizTitle}</p>
                    <p className="text-xs text-ink-500">{result.learnerName}</p>
                  </div>
                  <Badge tone={result.passed === null ? "warning" : result.passed ? "success" : "danger"}>
                    {result.score} / {result.maxScore}
                  </Badge>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

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
                <p className="text-xs text-ink-500">{formatDateTime(session.scheduledStart)}</p>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
