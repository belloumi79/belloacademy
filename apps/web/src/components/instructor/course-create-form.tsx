/**
 * Création d'une formation (espace formateur).
 *
 * Le formulaire ne demande que le strict nécessaire : le titre. Tout le reste
 * est complété depuis l'éditeur de formation, qui s'ouvre juste après la
 * création. La formation naît en brouillon, conformément au schéma serveur.
 *
 * L'autorisation est vérifiée par l'API (`course:create`) : ce composant ne
 * fait que guider la saisie.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  LANGUAGE_OPTIONS,
  type CourseLevel,
} from "@belloacademy/shared";

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/client/api";

type CreatedCourse = { course: { id: string; slug: string; title: string } };

export function CourseCreateForm({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<CourseLevel>("BEGINNER");
  const [language, setLanguage] = useState("fr");
  const [priceDinars, setPriceDinars] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canCreate) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (trimmed.length < 4) {
      setError("Le titre doit contenir au moins 4 caractères.");
      return;
    }
    const dinars = Number(priceDinars.replace(",", "."));
    if (!Number.isFinite(dinars) || dinars < 0) {
      setError("Indiquez un prix valide (0 pour une formation gratuite).");
      return;
    }

    setBusy(true);
    try {
      const created = await apiFetch<CreatedCourse>("/api/courses", {
        method: "POST",
        body: {
          title: trimmed,
          description: description.trim(),
          level,
          language,
          priceCents: Math.round(dinars * 100),
        },
      });
      router.push(`/tableau-de-bord/formateur/${created.course.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "La création a échoué. Vérifiez votre connexion et réessayez.",
      );
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-card] border border-dashed border-ink-300 bg-white px-5 py-4">
        <div>
          <p className="text-sm font-medium text-ink-800">Créer une nouvelle formation</p>
          <p className="text-xs text-ink-500">
            Vous pourrez ajouter les sections, les leçons et les ressources juste après.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Nouvelle formation</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Nouvelle formation"
        description="La formation est créée en brouillon : elle n'apparaît au catalogue qu'après publication."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Field label="Titre" name="new-course-title" required hint="Au moins 4 caractères.">
            <Input
              id="new-course-title"
              name="new-course-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={160}
              autoComplete="off"
            />
          </Field>

          <Field label="Description" name="new-course-description" hint="Présentez la formation en quelques phrases.">
            <Textarea
              id="new-course-description"
              name="new-course-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={20000}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Niveau" name="new-course-level">
              <Select
                id="new-course-level"
                name="new-course-level"
                value={level}
                onChange={(event) => setLevel(event.target.value as CourseLevel)}
              >
                {COURSE_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {COURSE_LEVEL_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Langue" name="new-course-language">
              <Select
                id="new-course-language"
                name="new-course-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Prix (TND)" name="new-course-price" hint="0 pour une formation gratuite.">
              <Input
                id="new-course-price"
                name="new-course-price"
                type="number"
                min="0"
                step="0.01"
                value={priceDinars}
                onChange={(event) => setPriceDinars(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Création…" : "Créer et ouvrir l'éditeur"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={busy}
            >
              Annuler
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
