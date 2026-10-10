/**
 * Vue d'ensemble du tableau de bord.
 *
 * Une seule page sert les quatre rôles : le contenu est choisi à partir du rôle
 * réel dans l'organisation courante (superadministrateur, administrateur,
 * formateur, apprenant). Les statistiques proviennent de la base, jamais de
 * valeurs codées en dur.
 */

import Link from "next/link";

import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Progress,
  Stat,
  Table,
} from "@/components/ui";
import { ROLE_LABELS, SUBSCRIPTION_STATUS_LABELS, formatAmount } from "@belloacademy/shared";
import {
  instructorOverview,
  learnerOverview,
  organizationOverview,
  platformOverview,
} from "@/server/services/dashboards";
import { loadPageContext } from "@/server/page-context";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "organisation-absente": "Aucune organisation active n'est rattachée à ce compte.",
  "acces-refuse": "Votre rôle ne permet pas d'accéder à cette section.",
};

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorKey = typeof params.erreur === "string" ? params.erreur : undefined;
  const page = await loadPageContext();

  if (!page.organizationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-ink-900">Votre espace</h1>
        <EmptyState
          title="Aucune organisation rattachée"
          description="Créez votre organisation depuis l'inscription, ou demandez une invitation à l'administrateur d'une organisation existante."
          action={<ButtonLink href="/inscription">Créer une organisation</ButtonLink>}
        />
      </div>
    );
  }

  const { organizationId, role } = page;

  return (
    <div className="space-y-8">
      {errorKey && ERRORS[errorKey] ? <Alert tone="warning">{ERRORS[errorKey]}</Alert> : null}

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Bonjour {page.user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          {page.organizationName} · {role ? ROLE_LABELS[role] ?? role : "Visiteur"}
        </p>
      </header>

      {role === "SUPER_ADMIN" ? <PlatformSection /> : null}
      {role === "ORG_ADMIN" ? <OrgSection organizationId={organizationId} /> : null}
      {role === "INSTRUCTOR" ? <InstructorSection organizationId={organizationId} userId={page.user.id} /> : null}
      {role === "LEARNER" || role === "BILLING_MANAGER" || !role ? (
        <LearnerSection organizationId={organizationId} userId={page.user.id} />
      ) : null}
    </div>
  );
}

async function PlatformSection() {
  const overview = await platformOverview();

  return (
    <section aria-labelledby="plateforme" className="space-y-4">
      <h2 id="plateforme" className="text-lg font-semibold text-ink-900">
        Vue plateforme
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Organisations actives" value={overview.organizations.active} hint={`${overview.organizations.total} au total`} />
        <Stat label="Utilisateurs" value={overview.users.total} hint={`+${overview.users.newInPeriod} sur 30 jours`} />
        <Stat label="Formations publiées" value={overview.courses.published} hint={`${overview.courses.draft} brouillons`} />
        <Stat
          label="Encaissé (30 jours)"
          value={formatAmount(overview.revenue.paidCentsInPeriod, overview.revenue.currency)}
          hint={`${formatAmount(overview.revenue.outstandingCents, overview.revenue.currency)} en attente`}
        />
      </div>
      <Card>
        <CardHeader title="Abonnements par statut" description="Répartition courante des forfaits souscrits." />
        <CardBody>
          {overview.subscriptionsByStatus.length === 0 ? (
            <p className="text-sm text-ink-500">Aucun abonnement enregistré.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {overview.subscriptionsByStatus.map((entry) => (
                <li key={entry.status}>
                  <Badge tone="brand">
                    {SUBSCRIPTION_STATUS_LABELS[entry.status as keyof typeof SUBSCRIPTION_STATUS_LABELS] ?? entry.status} : {entry.count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <ButtonLink href="/tableau-de-bord/administration" variant="secondary">
        Ouvrir la console plateforme
      </ButtonLink>
    </section>
  );
}

async function OrgSection({ organizationId }: { organizationId: string }) {
  const overview = await organizationOverview(organizationId);

  return (
    <section aria-labelledby="organisation" className="space-y-4">
      <h2 id="organisation" className="text-lg font-semibold text-ink-900">
        Vue organisation
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Membres" value={overview.members.total} hint={`+${overview.members.newInPeriod} sur 30 jours`} />
        <Stat label="Formations" value={overview.courses.total} hint={`${overview.courses.published} publiées`} />
        <Stat label="Inscriptions actives" value={overview.enrollments.active} hint={`${overview.enrollments.inPeriod} nouvelles`} />
        <Stat label="Taux d'achèvement" value={`${overview.completionRate} %`} hint={`${overview.enrollments.completed} formations terminées`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Prochaines classes virtuelles" description={`${overview.upcomingSessions.length} session(s) à venir`} />
          <CardBody>
            {overview.upcomingSessions.length === 0 ? (
              <p className="text-sm text-ink-500">Aucune session planifiée.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.upcomingSessions.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {session.title}
                      <span className="text-ink-500"> · {session.courseTitle}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">{formatDate(session.scheduledStart)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Consommation du forfait" description="Mesures calculées sur la période courante." />
          <CardBody className="space-y-3">
            {Object.entries(overview.usage).map(([metric, value]) => {
              const limit = overview.limits[metric as keyof typeof overview.limits] ?? null;
              const percent = limit && limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : 0;
              return (
                <div key={metric}>
                  <div className="flex items-center justify-between text-xs text-ink-600">
                    <span>{metric}</span>
                    <span>
                      {value} / {limit ?? "illimité"}
                    </span>
                  </div>
                  {limit ? <Progress value={percent} /> : null}
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/tableau-de-bord/organisation">Administrer l&apos;organisation</ButtonLink>
        <ButtonLink href="/tableau-de-bord/organisation/membres" variant="secondary">
          Membres et invitations
        </ButtonLink>
      </div>
    </section>
  );
}

async function InstructorSection({ organizationId, userId }: { organizationId: string; userId: string }) {
  const overview = await instructorOverview(organizationId, userId);

  return (
    <section aria-labelledby="formateur" className="space-y-4">
      <h2 id="formateur" className="text-lg font-semibold text-ink-900">
        Vue formateur
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Mes formations" value={overview.courses.length} />
        <Stat label="Apprenants" value={overview.students.total} hint={`${overview.students.active} actifs`} />
        <Stat label="Progression moyenne" value={`${overview.averageProgress} %`} />
      </div>

      <Card>
        <CardHeader title="Mes formations" description="Statut et nombre d'inscrits." />
        <CardBody>
          {overview.courses.length === 0 ? (
            <EmptyState
              title="Aucune formation"
              description="Créez votre première formation depuis l'espace formateur."
              action={<ButtonLink href="/tableau-de-bord/formateur">Créer une formation</ButtonLink>}
            />
          ) : (
            <Table head={["Formation", "Statut", "Leçons", "Inscrits"]}>
              {overview.courses.map((course) => (
                <tr key={course.id} className="border-b border-ink-100">
                  <td className="py-2">
                    <Link href={`/tableau-de-bord/formateur/${course.id}`} className="font-medium text-brand-700 hover:text-brand-600">
                      {course.title}
                    </Link>
                  </td>
                  <td className="py-2">{course.status}</td>
                  <td className="py-2">{course.publishedLessons}</td>
                  <td className="py-2">{course.enrollments}</td>
                </tr>
              ))}
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Copies à corriger" description={`${overview.pendingSubmissions.length} en attente`} />
          <CardBody>
            {overview.pendingSubmissions.length === 0 ? (
              <p className="text-sm text-ink-500">Aucune copie en attente.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.pendingSubmissions.map((submission) => (
                  <li key={submission.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {submission.assignmentTitle}
                      <span className="text-ink-500"> · {submission.learnerName}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">{formatDate(submission.submittedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Derniers résultats de quiz" />
          <CardBody>
            {overview.recentQuizResults.length === 0 ? (
              <p className="text-sm text-ink-500">Aucun résultat récent.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.recentQuizResults.map((result) => (
                  <li key={result.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {result.quizTitle}
                      <span className="text-ink-500"> · {result.learnerName}</span>
                    </span>
                    <Badge tone={result.passed ? "success" : result.passed === null ? "neutral" : "danger"}>
                      {result.score} / {result.maxScore}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}

async function LearnerSection({ organizationId, userId }: { organizationId: string; userId: string }) {
  const overview = await learnerOverview(organizationId, userId);

  return (
    <section aria-labelledby="apprenant" className="space-y-4">
      <h2 id="apprenant" className="text-lg font-semibold text-ink-900">
        Mon apprentissage
      </h2>

      {overview.enrollments.length === 0 ? (
        <EmptyState
          title="Vous n'êtes inscrit à aucune formation"
          description="Explorez le catalogue et inscrivez-vous à une formation gratuite ou payante."
          action={<ButtonLink href="/formations">Explorer le catalogue</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {overview.enrollments.map((enrollment) => (
            <li key={enrollment.id}>
              <Card className="h-full">
                <CardBody className="space-y-3">
                  <div>
                    <h3 className="font-semibold text-ink-900">
                      <Link href={`/tableau-de-bord/formations/${enrollment.courseSlug}`} className="hover:text-brand-700">
                        {enrollment.courseTitle}
                      </Link>
                    </h3>
                    <p className="text-xs text-ink-500">{enrollment.instructorName}</p>
                  </div>
                  <Progress
                    value={enrollment.progressPercent}
                    label={`${enrollment.completedLessons} / ${enrollment.totalLessons} leçons · ${enrollment.progressPercent} %`}
                  />
                  <div className="flex items-center gap-2">
                    {enrollment.nextLessonId ? (
                      <ButtonLink
                        href={`/tableau-de-bord/formations/${enrollment.courseSlug}/${enrollment.nextLessonId}`}
                        size="sm"
                      >
                        {enrollment.progressPercent > 0 ? "Reprendre" : "Commencer"}
                      </ButtonLink>
                    ) : (
                      <Badge tone="success">Terminée</Badge>
                    )}
                    {enrollment.status === "PENDING_PAYMENT" ? <Badge tone="warning">Paiement en attente</Badge> : null}
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Prochaines classes virtuelles" />
          <CardBody>
            {overview.upcomingSessions.length === 0 ? (
              <p className="text-sm text-ink-500">Aucune session programmée.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.upcomingSessions.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {session.title}
                      <span className="text-ink-500"> · {session.courseTitle}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">{formatDate(session.scheduledStart)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Mes résultats et certificats" />
          <CardBody className="space-y-3">
            {overview.results.length === 0 && overview.certificates.length === 0 ? (
              <p className="text-sm text-ink-500">Aucun résultat pour le moment.</p>
            ) : (
              <>
                {overview.results.slice(0, 4).map((result) => (
                  <div key={result.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{result.quizTitle}</span>
                    <Badge tone={result.passed ? "success" : result.passed === null ? "neutral" : "danger"}>
                      {result.score} / {result.maxScore}
                    </Badge>
                  </div>
                ))}
                {overview.certificates.map((certificate) => (
                  <div key={certificate.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{certificate.courseTitle}</span>
                    <Link
                      href={`/verifier-certificat/${certificate.serial}`}
                      className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-600"
                    >
                      Certificat {certificate.serial}
                    </Link>
                  </div>
                ))}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
