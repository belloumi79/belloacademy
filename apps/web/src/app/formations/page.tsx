import type { Metadata } from "next";
import Link from "next/link";

import { Badge, ButtonLink, Card, CardBody, EmptyState, inputClass } from "@/components/ui";
import { COURSE_LANGUAGE_LABELS, COURSE_LEVELS, COURSE_LEVEL_LABELS, formatAmount } from "@belloacademy/shared";
import { listCatalog, listCatalogCategories } from "@/server/services/courses";

export const metadata: Metadata = {
  title: "Catalogue des formations",
  description: "Recherchez parmi les formations publiées : niveau, langue, catégorie et prix.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value && value.length > 0 ? value : undefined;
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = first(params.q);
  const categoryId = first(params.categorie);
  const level = first(params.niveau);
  const language = first(params.langue);
  const price = first(params.prix);
  const sort = first(params.tri);
  const page = Number.parseInt(first(params.page) ?? "1", 10) || 1;

  const [catalog, categories] = await Promise.all([
    listCatalog({
      ...(search ? { search } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(level ? { level } : {}),
      ...(language ? { language } : {}),
      ...(price === "gratuit" ? { price: "free" as const } : {}),
      ...(price === "payant" ? { price: "paid" as const } : {}),
      ...(sort === "populaire" ? { sort: "popular" as const } : {}),
      ...(sort === "titre" ? { sort: "title" as const } : {}),
      page,
      pageSize: 12,
    }),
    listCatalogCategories(),
  ]);

  function pageHref(target: number): string {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: search, categorie: categoryId, niveau: level, langue: language, prix: price, tri: sort })) {
      if (value) next.set(key, value);
    }
    next.set("page", String(target));
    return `/formations?${next.toString()}`;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">Catalogue des formations</h1>
        <p className="mt-2 text-sm text-ink-700">
          {catalog.total} formation{catalog.total > 1 ? "s" : ""} publiée{catalog.total > 1 ? "s" : ""} sur la plateforme.
        </p>
      </header>

      <form method="get" className="mt-6 grid gap-3 rounded-xl border border-ink-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="sm:col-span-2">
          <label htmlFor="q" className="block text-xs font-medium text-ink-600">
            Recherche
          </label>
          <input id="q" name="q" type="search" defaultValue={search ?? ""} placeholder="Titre, description…" className={inputClass} />
        </div>
        <div>
          <label htmlFor="categorie" className="block text-xs font-medium text-ink-600">
            Catégorie
          </label>
          <select id="categorie" name="categorie" defaultValue={categoryId ?? ""} className={inputClass}>
            <option value="">Toutes</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category._count.courses})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="niveau" className="block text-xs font-medium text-ink-600">
            Niveau
          </label>
          <select id="niveau" name="niveau" defaultValue={level ?? ""} className={inputClass}>
            <option value="">Tous</option>
            {COURSE_LEVELS.map((item) => (
              <option key={item} value={item}>
                {COURSE_LEVEL_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="prix" className="block text-xs font-medium text-ink-600">
            Prix
          </label>
          <select id="prix" name="prix" defaultValue={price ?? ""} className={inputClass}>
            <option value="">Gratuit et payant</option>
            <option value="gratuit">Gratuit</option>
            <option value="payant">Payant</option>
          </select>
        </div>
        <div>
          <label htmlFor="tri" className="block text-xs font-medium text-ink-600">
            Tri
          </label>
          <select id="tri" name="tri" defaultValue={sort ?? ""} className={inputClass}>
            <option value="">Plus récentes</option>
            <option value="populaire">Les plus suivies</option>
            <option value="titre">Titre (A→Z)</option>
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Filtrer
          </button>
          <Link href="/formations" className="rounded-lg px-4 py-2 text-sm font-medium text-ink-600 hover:text-brand-700">
            Réinitialiser
          </Link>
        </div>
      </form>

      {catalog.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Aucune formation ne correspond à ces critères"
            description="Élargissez la recherche, ou revenez à la liste complète du catalogue."
            action={
              <ButtonLink href="/formations" variant="secondary">
                Voir tout le catalogue
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.items.map((course) => (
            <li key={course.id}>
              <Card className="flex h-full flex-col">
                <CardBody className="flex h-full flex-col">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={course.priceCents === 0 ? "success" : "brand"}>
                      {course.priceCents === 0 ? "Gratuit" : formatAmount(course.priceCents, course.currency)}
                    </Badge>
                    <Badge>{COURSE_LEVEL_LABELS[course.level]}</Badge>
                    {course.category ? <Badge>{course.category.name}</Badge> : null}
                  </div>
                  <h2 className="mt-3 text-base font-semibold text-ink-900">
                    <Link href={`/formations/${course.slug}`} className="hover:text-brand-700">
                      {course.title}
                    </Link>
                  </h2>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm text-ink-700">{course.subtitle ?? course.description}</p>
                  <p className="mt-3 text-xs text-ink-500">
                    {course.instructor.name} · {course._count.lessons} leçons · {course._count.enrollments} inscrits ·{" "}
                    {COURSE_LANGUAGE_LABELS[course.language] ?? course.language}
                  </p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {catalog.pageCount > 1 ? (
        <nav aria-label="Pagination du catalogue" className="mt-8 flex items-center justify-between gap-4">
          {catalog.page > 1 ? (
            <ButtonLink href={pageHref(catalog.page - 1)} variant="secondary" size="sm">
              Page précédente
            </ButtonLink>
          ) : (
            <span />
          )}
          <p className="text-sm text-ink-600">
            Page {catalog.page} sur {catalog.pageCount}
          </p>
          {catalog.page < catalog.pageCount ? (
            <ButtonLink href={pageHref(catalog.page + 1)} variant="secondary" size="sm">
              Page suivante
            </ButtonLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
