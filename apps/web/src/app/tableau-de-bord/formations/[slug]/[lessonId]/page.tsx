import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LESSON_TYPE_LABELS, formatDuration } from "@belloacademy/shared";

import { LessonCompleteButton } from "@/components/courses/lesson-complete-button";
import { Alert, Badge, Card, CardBody, CardHeader, Progress } from "@/components/ui";
import { getCourseForLearner, getLessonForLearner } from "@/server/services/courses";
import { getProgressView } from "@/server/services/enrollments";
import { requirePageOrganization } from "@/server/page-context";

export const metadata: Metadata = { title: "Leçon" };
export const dynamic = "force-dynamic";

/** Rendu de texte structuré : titres et paragraphes, sans injection HTML. */
function LessonBody({ content }: { content: string }) {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return (
    <div className="space-y-4 text-sm leading-relaxed text-ink-700">
      {blocks.map((block, index) => {
        if (block.startsWith("### ")) {
          return (
            <h3 key={index} className="text-base font-semibold text-ink-900">
              {block.slice(4)}
            </h3>
          );
        }
        if (block.startsWith("## ")) {
          return (
            <h2 key={index} className="text-lg font-semibold text-ink-900">
              {block.slice(3)}
            </h2>
          );
        }
        if (block.startsWith("# ")) {
          return (
            <h2 key={index} className="text-xl font-semibold text-ink-900">
              {block.slice(2)}
            </h2>
          );
        }
        return (
          <p key={index} className="whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>;
}) {
  const { slug, lessonId } = await params;
  const page = await requirePageOrganization();

  const lessonState = await getLessonForLearner({
    organizationId: page.organizationId,
    lessonId,
    userId: page.user.id,
  }).catch(() => null);

  if (!lessonState || lessonState.lesson.course.slug !== slug) notFound();

  const { lesson, enrollment, locked } = lessonState;
  const courseState = await getCourseForLearner(page.organizationId, slug, page.user.id);
  const progress = enrollment
    ? await getProgressView(page.organizationId, enrollment.id)
    : { completedLessonIds: [] as string[], lastLessonId: null, percent: 0 };

  const orderedLessons = courseState.course.sections.flatMap((section) => section.lessons);
  const currentIndex = orderedLessons.findIndex((item) => item.id === lesson.id);
  const previous = currentIndex > 0 ? orderedLessons[currentIndex - 1] : null;
  const next = currentIndex >= 0 ? orderedLessons[currentIndex + 1] ?? null : null;
  const completed = progress.completedLessonIds.includes(lesson.id);

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <Link href="/tableau-de-bord/formations" className="hover:text-brand-700">
          Mes formations
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/tableau-de-bord/formations/${lesson.course.slug}`} className="hover:text-brand-700">
          {lesson.course.title}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink-700">{lesson.title}</span>
      </nav>

      {locked ? (
        <Alert tone="warning" title="Contenu réservé">
          Cette leçon est réservée aux apprenants inscrits.{" "}
          <Link href={`/formations/${lesson.course.slug}`} className="font-medium underline">
            Voir la formation
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title={lesson.title}
            description={`${LESSON_TYPE_LABELS[lesson.type as keyof typeof LESSON_TYPE_LABELS] ?? lesson.type}${
              lesson.durationSeconds ? ` — ${formatDuration(lesson.durationSeconds)}` : ""
            }`}
            action={completed ? <Badge tone="success">Terminée</Badge> : null}
          />
          <CardBody className="space-y-6">
            {lesson.videoUrl ? (
              <div className="aspect-video w-full overflow-hidden rounded-lg bg-ink-900">
                <iframe
                  src={lesson.videoUrl}
                  title={lesson.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            ) : null}

            {lesson.externalUrl ? (
              <p className="text-sm">
                <a
                  href={lesson.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-700 underline"
                >
                  Ouvrir la ressource externe
                </a>
              </p>
            ) : null}

            {lesson.contentMd ? <LessonBody content={lesson.contentMd} /> : null}

            {lesson.resources.length > 0 ? (
              <div>
                <p className="text-sm font-semibold text-ink-900">Ressources téléchargeables</p>
                <ul className="mt-2 space-y-2">
                  {lesson.resources.map((resource) => (
                    <li key={resource.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2">
                      <span className="min-w-0 truncate text-sm text-ink-700">{resource.title}</span>
                      {resource.assetId ? (
                        <a
                          href={`/api/files/${resource.assetId}`}
                          className="shrink-0 text-sm font-medium text-brand-700 hover:underline"
                        >
                          Télécharger
                        </a>
                      ) : (
                        <span className="shrink-0 text-xs text-ink-500">Réservé</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-4">
          {enrollment ? (
            <Card>
              <CardHeader title="Votre progression" />
              <CardBody className="space-y-4">
                <Progress value={progress.percent} label={`${progress.percent}%`} />
                {enrollment ? (
                  <LessonCompleteButton
                    enrollmentId={enrollment.id}
                    lessonId={lesson.id}
                    organizationId={page.organizationId}
                    completed={completed}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {previous ? (
                    <Link
                      href={`/tableau-de-bord/formations/${lesson.course.slug}/${previous.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      ← Leçon précédente
                    </Link>
                  ) : null}
                  {next ? (
                    <Link
                      href={`/tableau-de-bord/formations/${lesson.course.slug}/${next.id}`}
                      className="ml-auto text-sm font-medium text-brand-700 hover:underline"
                    >
                      Leçon suivante →
                    </Link>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {orderedLessons.length > 0 ? (
            <Card>
              <CardHeader title="Sommaire" description={`${orderedLessons.length} leçons`} />
              <CardBody>
                <ol className="space-y-1 text-sm">
                  {orderedLessons.map((item, index) => {
                    const done = progress.completedLessonIds.includes(item.id);
                    const active = item.id === lesson.id;
                    return (
                      <li key={item.id}>
                        <Link
                          href={`/tableau-de-bord/formations/${lesson.course.slug}/${item.id}`}
                          className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${
                            active ? "bg-brand-50 font-medium text-brand-700" : "text-ink-700 hover:bg-ink-100"
                          }`}
                        >
                          <span className="mt-0.5 w-5 shrink-0 text-xs text-ink-500">
                            {done ? "✓" : index + 1}
                          </span>
                          <span className="min-w-0">{item.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
