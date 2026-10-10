import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Progress,
} from "@/components/ui";
import { EnrollButton } from "@/components/courses/enroll-button";
import {
  COURSE_LANGUAGE_LABELS,
  COURSE_LEVEL_LABELS,
  LESSON_TYPE_LABELS,
  formatAmount,
} from "@belloacademy/shared";
import { getAuthContext } from "@/lib/auth/authorization";
import { AppError } from "@/lib/errors";
import { getCourseForLearner, resolveCourseOwner } from "@/server/services/courses";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

async function loadCourse(slug: string) {
  const context = await getAuthContext().catch(() => null);
  try {
    const owner = await resolveCourseOwner(slug);
    const data = await getCourseForLearner(owner.organizationId, slug, context?.user.id ?? null);
    return { data, context, owner };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const owner = await resolveCourseOwner(slug);
    const { course } = await getCourseForLearner(owner.organizationId, slug, null);
    return {
      title: course.title,
      description: course.subtitle ?? course.description.slice(0, 155),
    };
  } catch {
    return { title: "Formation introuvable" };
  }
}

export default async function CoursePage({ params }: { params: Params }) {
  const { slug } = await params;
  const { data, context, owner } = await loadCourse(slug);
  const { course, enrollment } = data;

  const totalLessons = course.sections.reduce((sum, section) => sum + section.lessons.length, 0);
  const totalMinutes = Math.round(course.durationMinutes ?? 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Fil d'Ariane" className="text-xs text-ink-500">
        <Link href="/formations" className="hover:text-brand-700">
          Catalogue
        </Link>
        {course.category ? (
          <>
            {" / "}
            <Link href={`/formations?categorie=${course.category.id}`} className="hover:text-brand-700">
              {course.category.name}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={course.priceCents === 0 ? "success" : "brand"}>
              {course.priceCents === 0 ? "Gratuit" : formatAmount(course.priceCents, course.currency)}
            </Badge>
            <Badge>{COURSE_LEVEL_LABELS[course.level]}</Badge>
            <Badge>{COURSE_LANGUAGE_LABELS[course.language] ?? course.language}</Badge>
            {course.certificateEnabled ? <Badge tone="brand">Certificat délivré</Badge> : null}
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance text-ink-900">{course.title}</h1>
          {course.subtitle ? <p className="mt-3 text-lg text-ink-700">{course.subtitle}</p> : null}

          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-500">Leçons</dt>
              <dd className="mt-1 font-semibold text-ink-900">{totalLessons}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Durée</dt>
              <dd className="mt-1 font-semibold text-ink-900">
                {totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min` : `${totalMinutes} min`}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Classes virtuelles</dt>
              <dd className="mt-1 font-semibold text-ink-900">{course._count.liveSessions}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Inscrits</dt>
              <dd className="mt-1 font-semibold text-ink-900">{course._count.enrollments}</dd>
            </div>
          </dl>

          <section className="mt-8">
            <h2 className="text-xl font-semibold text-ink-900">Présentation</h2>
            <div className="prose-content mt-3 whitespace-pre-line">{course.description}</div>
          </section>

          {course.objectives.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-xl font-semibold text-ink-900">Objectifs pédagogiques</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-700">
                {course.objectives.map((objective) => (
                  <li key={objective} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" />
                    <span>{objective}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {course.prerequisites.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-xl font-semibold text-ink-900">Prérequis</h2>
              <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-ink-700">
                {course.prerequisites.map((prerequisite) => (
                  <li key={prerequisite}>{prerequisite}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-10">
            <h2 className="text-xl font-semibold text-ink-900">Programme</h2>
            {course.sections.length === 0 ? (
              <p className="mt-3 text-sm text-ink-600">
                Le programme détaillé sera publié prochainement.
              </p>
            ) : (
              <ol className="mt-4 space-y-4">
                {course.sections.map((section, index) => (
                  <li key={section.id}>
                    <Card>
                      <CardHeader
                        title={
                          <span>
                            {index + 1}. {section.title}
                          </span>
                        }
                        description={section.summary ?? undefined}
                        action={<span className="text-xs text-ink-500">{section.lessons.length} leçons</span>}
                      />
                      <CardBody>
                        <ul className="divide-y divide-ink-100 text-sm">
                          {section.lessons.map((lesson) => (
                            <li key={lesson.id} className="flex items-center justify-between gap-3 py-2">
                              <span className="flex items-center gap-2 text-ink-800">
                                <span className="text-xs text-ink-500">{LESSON_TYPE_LABELS[lesson.type]}</span>
                                {lesson.title}
                                {lesson.isPreview ? <Badge tone="brand">Aperçu</Badge> : null}
                              </span>
                              <span className="text-xs text-ink-500">
                                {lesson.durationSeconds ? `${Math.round(lesson.durationSeconds / 60)} min` : "—"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24">
          <Card>
            <CardBody className="space-y-4">
              <p className="text-2xl font-semibold text-ink-900">
                {course.priceCents === 0 ? "Gratuit" : formatAmount(course.priceCents ?? 0, course.currency)}
              </p>
              {enrollment ? (
                <div className="space-y-2">
                  <Progress
                    value={enrollment.progressPercent}
                    label={`Progression : ${enrollment.progressPercent} %`}
                  />
                  <Link
                    href={`/tableau-de-bord/formations/${course.slug}`}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-base font-medium text-white hover:bg-brand-700"
                  >
                    Continuer la formation
                  </Link>
                </div>
              ) : (
                <EnrollButton
                  courseId={course.id}
                  organizationId={owner.organizationId}
                  isAuthenticated={Boolean(context)}
                  isEnrolled={false}
                  priceCents={course.priceCents}
                  courseSlug={course.slug}
                />
              )}

              <dl className="space-y-2 border-t border-ink-100 pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Formateur</dt>
                  <dd className="font-medium text-ink-900">{course.instructor.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Organisation</dt>
                  <dd className="font-medium text-ink-900">
                    {course.category ? course.category.name : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Publiée le</dt>
                  <dd className="font-medium text-ink-900">
                    {course.publishedAt
                      ? new Intl.DateTimeFormat("fr-TN", { dateStyle: "long" }).format(course.publishedAt)
                      : "—"}
                  </dd>
                </div>
              </dl>

              {course.certificateEnabled ? (
                <p className="rounded-lg bg-ink-100 p-3 text-xs text-ink-600">
                  Un certificat vérifiable est délivré à partir de {course.certificateMinScore} % de réussite.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
