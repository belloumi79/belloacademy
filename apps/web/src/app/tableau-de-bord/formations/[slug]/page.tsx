import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { COURSE_LEVEL_LABELS, LESSON_TYPE_LABELS, formatAmount } from "@belloacademy/shared";
import { Alert, Badge, ButtonLink, Card, CardBody, Progress } from "@/components/ui";
import { getCourseForLearner } from "@/server/services/courses";
import { getProgressView } from "@/server/services/enrollments";
import { requirePageOrganization } from "@/server/page-context";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const page = await requirePageOrganization();
    const { course } = await getCourseForLearner(page.organizationId, slug, page.user.id);
    return { title: course.title };
  } catch {
    return { title: "Formation" };
  }
}

export default async function CoursePlayerPage({ params }: { params: Params }) {
  const { slug } = await params;
  const page = await requirePageOrganization();

  let data: Awaited<ReturnType<typeof getCourseForLearner>>;
  try {
    data = await getCourseForLearner(page.organizationId, slug, page.user.id);
  } catch {
    notFound();
  }
  const { course, enrollment } = data;

  const progress = enrollment
    ? await getProgressView(page.organizationId, enrollment.id)
    : { completedLessonIds: [], lastLessonId: null, percent: 0 };

  const completed = new Set(progress.completedLessonIds);
  const allLessons = course.sections.flatMap((section) => section.lessons);
  const nextLesson =
    allLessons.find((lesson) => lesson.id === progress.lastLessonId && !completed.has(lesson.id)) ??
    allLessons.find((lesson) => !completed.has(lesson.id)) ??
    allLessons[0] ??
    null;

  return (
    <div className="space-y-6">
      <nav aria-label="Fil d'Ariane" className="text-xs text-ink-500">
        <Link href="/tableau-de-bord/formations" className="hover:text-brand-700">
          Mes formations
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-700">{course.title}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{course.title}</h1>
          <p className="mt-1 text-sm text-ink-600">
            {course.instructor.name} · {COURSE_LEVEL_LABELS[course.level]} · {allLessons.length} leçons
          </p>
        </div>
        {nextLesson && enrollment ? (
          <ButtonLink href={`/tableau-de-bord/formations/${course.slug}/${nextLesson.id}`}>
            {progress.percent > 0 ? "Reprendre" : "Commencer"} la formation
          </ButtonLink>
        ) : null}
      </header>

      {!enrollment ? (
        <Alert tone="warning" title="Inscription requise">
          Vous n&apos;êtes pas encore inscrit à cette formation.{" "}
          <Link href={`/formations/${course.slug}`} className="font-medium underline">
            Voir la fiche de la formation
          </Link>
          .
        </Alert>
      ) : (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-ink-900">Progression du parcours</p>
              <Badge tone={progress.percent >= 100 ? "success" : "brand"}>{progress.percent}%</Badge>
            </div>
            <Progress value={progress.percent} />
            <p className="text-xs text-ink-500">
              {completed.size} leçon{completed.size > 1 ? "s" : ""} terminée{completed.size > 1 ? "s" : ""} sur{" "}
              {allLessons.length}
            </p>
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="programme" className="space-y-4">
        <h2 id="programme" className="text-lg font-semibold text-ink-900">
          Programme
        </h2>
        {course.sections.map((section) => (
          <Card key={section.id}>
            <CardBody>
              <h3 className="font-medium text-ink-900">{section.title}</h3>
              {section.summary ? <p className="mt-1 text-sm text-ink-600">{section.summary}</p> : null}
              <ul className="mt-3 divide-y divide-ink-100">
                {section.lessons.map((lesson) => {
                  const done = completed.has(lesson.id);
                  return (
                    <li key={lesson.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink-800">
                          {done ? <span aria-hidden className="text-success-700">✓ </span> : null}
                          {lesson.title}
                        </p>
                        <p className="text-xs text-ink-500">
                          {LESSON_TYPE_LABELS[lesson.type]}
                          {lesson.durationSeconds
                            ? ` · ${Math.round(lesson.durationSeconds / 60)} min`
                            : ""}
                          {lesson.isPreview ? " · aperçu gratuit" : ""}
                        </p>
                      </div>
                      <Link
                        href={`/tableau-de-bord/formations/${course.slug}/${lesson.id}`}
                        className="shrink-0 text-sm font-medium text-brand-700 hover:text-brand-600"
                      >
                        {done ? "Revoir" : "Ouvrir"}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        ))}
      </section>

      {course.priceCents > 0 && !enrollment ? (
        <p className="text-sm text-ink-600">
          Accès payant : {formatAmount(course.priceCents, course.currency)} — l&apos;inscription est confirmée après
          validation du règlement par l&apos;administrateur de l&apos;organisation.
        </p>
      ) : null}
    </div>
  );
}
