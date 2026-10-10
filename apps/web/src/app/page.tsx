import type { Metadata } from "next";
import Link from "next/link";

import { Badge, ButtonLink, Card, CardBody } from "@/components/ui";
import { listCatalog } from "@/server/services/courses";
import { listPublicPlans } from "@/server/services/billing";

export const metadata: Metadata = {
  title: "BelloAcademy — plateforme de formation en ligne multi-organisations",
  description:
    "Créez, vendez et animez vos formations en ligne : cours vidéo, classes virtuelles Jitsi Meet, quiz, devoirs et certificats vérifiables. Une instance pour toutes vos organisations.",
};

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Catalogue et parcours",
    body: "Sections, chapitres, leçons vidéo ou documents, ressources téléchargeables et reprise du cours là où l'apprenant s'est arrêté.",
  },
  {
    title: "Classes virtuelles Jitsi Meet",
    body: "Planification des sessions, rappels automatiques, fuseaux horaires, salle non devinable et accès réservé aux apprenants inscrits.",
  },
  {
    title: "Évaluations et certificats",
    body: "Quiz corrigés automatiquement, devoirs déposés en ligne, seuil de réussite et certificats PDF vérifiables publiquement.",
  },
  {
    title: "Multi-organisations",
    body: "Chaque école, centre ou formateur dispose de son espace isolé, de ses forfaits et de son journal d'audit.",
  },
];

const STEPS = [
  { title: "Créez votre organisation", body: "Invitez vos formateurs, importez vos apprenants et personnalisez votre espace." },
  { title: "Publiez vos formations", body: "Structurez vos contenus, fixez un prix ou rendez la formation gratuite, puis publiez." },
  { title: "Formez et certifiez", body: "Suivez la progression en direct, animez vos classes virtuelles et délivrez les certificats." },
];

export default async function HomePage() {
  const [catalog, plans] = await Promise.all([
    listCatalog({ pageSize: 3, sort: "recent" }),
    listPublicPlans(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <Badge tone="brand">Plateforme SaaS multi-organisations</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance text-ink-900 sm:text-4xl lg:text-5xl">
            Formez vos apprenants en ligne, du premier cours au certificat.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-700">
            BelloAcademy réunit le catalogue de formations, les classes virtuelles Jitsi Meet, les évaluations et la
            facturation dans une seule plateforme. Chaque organisation garde ses données strictement séparées.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/inscription" size="lg">
              Créer un compte gratuitement
            </ButtonLink>
            <ButtonLink href="/formations" variant="secondary" size="lg">
              Explorer le catalogue
            </ButtonLink>
          </div>
          <dl className="mt-8 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink-500">Formations publiées</dt>
              <dd className="mt-1 text-xl font-semibold text-ink-900">{catalog.total}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Forfaits</dt>
              <dd className="mt-1 text-xl font-semibold text-ink-900">{plans.length}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Logiciel</dt>
              <dd className="mt-1 text-xl font-semibold text-ink-900">Libre</dd>
            </div>
          </dl>
        </div>

        <Card>
          <CardBody className="space-y-4">
            <p className="text-sm font-semibold text-ink-900">Ce que vous obtenez dès le départ</p>
            <ul className="space-y-3 text-sm text-ink-700">
              {[
                "Un espace d'administration par organisation, avec rôles et permissions.",
                "Des formations gratuites ou payantes, en brouillon, publiées ou archivées.",
                "Des quiz notés automatiquement et des devoirs corrigés par le formateur.",
                "Un certificat PDF à identifiant unique et une page de vérification publique.",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="rounded-lg bg-ink-100 p-3 text-xs text-ink-600">
              Installation locale possible en une commande Docker Compose, avec PostgreSQL, Redis, stockage compatible S3
              et Jitsi Meet auto-hébergé.
            </p>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="fonctionnalites" className="mt-16">
        <h2 id="fonctionnalites" className="text-2xl font-semibold text-ink-900">
          Tout le cycle pédagogique
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardBody>
                <h3 className="font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{feature.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="comment" className="mt-16">
        <h2 id="comment" className="text-2xl font-semibold text-ink-900">
          Comment ça marche
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-ink-200 bg-white p-5">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                {index + 1}
              </span>
              <h3 className="mt-3 font-semibold text-ink-900">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-700">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {catalog.items.length > 0 ? (
        <section aria-labelledby="recentes" className="mt-16">
          <div className="flex items-end justify-between gap-4">
            <h2 id="recentes" className="text-2xl font-semibold text-ink-900">
              Dernières formations publiées
            </h2>
            <Link href="/formations" className="text-sm font-medium text-brand-700 hover:text-brand-600">
              Voir tout le catalogue
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {catalog.items.map((course) => (
              <Card key={course.id}>
                <CardBody className="flex h-full flex-col">
                  <Badge tone={course.priceCents === 0 ? "success" : "brand"}>
                    {course.priceCents === 0 ? "Gratuit" : "Payant"}
                  </Badge>
                  <h3 className="mt-3 font-semibold text-ink-900">
                    <Link href={`/formations/${course.slug}`} className="hover:text-brand-700">
                      {course.title}
                    </Link>
                  </h3>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm text-ink-700">{course.subtitle ?? course.description}</p>
                  <p className="mt-3 text-xs text-ink-500">
                    {course._count.lessons} leçons · {course._count.enrollments} inscrits
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-16 rounded-2xl bg-brand-900 p-8 text-center text-white">
        <h2 className="text-2xl font-semibold text-balance">Prêt à ouvrir votre académie ?</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-brand-100">
          Créez votre organisation, invitez vos formateurs et publiez votre première formation. Les forfaits
          s&apos;ajustent au nombre d&apos;utilisateurs, de formations et de classes virtuelles.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/inscription" variant="secondary" size="lg">
            Commencer maintenant
          </ButtonLink>
          <ButtonLink
            href="/tarifs"
            size="lg"
            className="border border-white/40 bg-white/10 text-white hover:bg-white/20"
            variant="ghost"
          >
            Comparer les forfaits
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
