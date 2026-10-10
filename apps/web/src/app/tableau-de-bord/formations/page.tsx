import type { Metadata } from "next";
import Link from "next/link";

import { COURSE_LEVEL_LABELS, formatAmount } from "@belloacademy/shared";
import { Badge, ButtonLink, Card, CardBody, EmptyState, Progress } from "@/components/ui";
import { listEnrollments } from "@/server/services/enrollments";
import { listCatalog } from "@/server/services/courses";
import { requirePageOrganization } from "@/server/page-context";

export const metadata: Metadata = { title: "Mes formations" };
export const dynamic = "force-dynamic";

export default async function MyCoursesPage() {
  const page = await requirePageOrganization();
  const [enrollments, suggestions] = await Promise.all([
    listEnrollments(page.organizationId, page.user.id),
    listCatalog({ pageSize: 6, sort: "popular" }),
  ]);

  const enrolledCourseIds = new Set(enrollments.map((enrollment) => enrollment.course.id));
  const recommended = suggestions.items.filter((course) => !enrolledCourseIds.has(course.id));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Mes formations</h1>
        <p className="mt-1 text-sm text-ink-600">
          Reprenez une formation là où vous l&apos;avez laissée, ou découvrez de nouveaux parcours.
        </p>
      </header>

      {enrollments.length === 0 ? (
        <EmptyState
          title="Vous n'êtes inscrit à aucune formation"
          description="Parcourez le catalogue et inscrivez-vous à une formation gratuite pour commencer immédiatement."
          action={<ButtonLink href="/formations">Explorer le catalogue</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id}>
              <Card className="h-full">
                <CardBody className="flex h-full flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={enrollment.status === "COMPLETED" ? "success" : "brand"}>
                      {enrollment.status === "COMPLETED" ? "Terminée" : "En cours"}
                    </Badge>
                    <Badge>{COURSE_LEVEL_LABELS[enrollment.course.level as keyof typeof COURSE_LEVEL_LABELS] ?? enrollment.course.level}</Badge>
                  </div>
                  <h2 className="text-base font-semibold text-ink-900">
                    <Link href={`/tableau-de-bord/formations/${enrollment.course.slug}`} className="hover:text-brand-700">
                      {enrollment.course.title}
                    </Link>
                  </h2>
                  <Progress value={enrollment.progressPercent} label={`${enrollment.progressPercent}% terminé`} />
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-500">
                      {enrollment.lastAccessedAt
                        ? `Dernier accès le ${enrollment.lastAccessedAt.toLocaleDateString("fr-FR")}`
                        : "Jamais ouvert"}
                    </p>
                    <ButtonLink href={`/tableau-de-bord/formations/${enrollment.course.slug}`} size="sm">
                      Continuer
                    </ButtonLink>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {recommended.length > 0 ? (
        <section aria-labelledby="suggestions">
          <h2 id="suggestions" className="text-lg font-semibold text-ink-900">
            À découvrir
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommended.map((course) => (
              <li key={course.id}>
                <Card className="h-full">
                  <CardBody className="flex h-full flex-col">
                    <Badge tone={course.priceCents === 0 ? "success" : "neutral"}>
                      {course.priceCents === 0 ? "Gratuit" : formatAmount(course.priceCents, course.currency)}
                    </Badge>
                    <h3 className="mt-2 font-medium text-ink-900">
                      <Link href={`/formations/${course.slug}`} className="hover:text-brand-700">
                        {course.title}
                      </Link>
                    </h3>
                    <p className="mt-1 line-clamp-2 flex-1 text-sm text-ink-600">{course.subtitle ?? course.description}</p>
                    <p className="mt-2 text-xs text-ink-500">
                      {course.instructor.name} · {course._count.lessons} leçons
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
