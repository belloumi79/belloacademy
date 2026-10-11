/**
 * Éditeur de formation (espace formateur).
 *
 * Compose le contenu pédagogique : métadonnées, sections et leçons. Chaque
 * mutation passe par l'API (`/api/courses/...`) puis recharge le programme
 * complet depuis le serveur : l'interface ne devine jamais l'état résultant,
 * ce qui évite tout décalage entre l'affichage et la base.
 *
 * Les contrôles d'autorisation sont côté serveur : ce composant ne fait que
 * masquer les actions indisponibles.
 */

"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import {
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  COURSE_STATUS_LABELS,
  LANGUAGE_OPTIONS,
  LESSON_TYPES,
  LESSON_TYPE_LABELS,
  type CourseLevel,
  type CourseStatus,
  type LessonType,
} from "@belloacademy/shared";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/client/api";

export type EditorCourse = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  level: CourseLevel;
  language: string;
  priceCents: number;
  currency: string;
  durationMinutes: number | null;
  status: CourseStatus;
  categoryId: string | null;
  imageUrl: string | null;
  objectives: string[];
  prerequisites: string[];
  certificateEnabled: boolean;
  certificateMinScore: number;
  _count: { enrollments: number; lessons: number };
};

export type EditorLesson = {
  id: string;
  title: string;
  type: LessonType;
  isPreview: boolean;
  isPublished: boolean;
  durationSeconds: number | null;
  contentMd: string | null;
  videoUrl: string | null;
};

export type EditorSection = {
  id: string;
  title: string;
  summary: string | null;
  lessons: EditorLesson[];
};

type Notice = { tone: "success" | "danger" | "warning"; message: string } | null;

const STATUS_TONES: Record<CourseStatus, "success" | "warning" | "neutral"> = {
  PUBLISHED: "success",
  DRAFT: "warning",
  ARCHIVED: "neutral",
};

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listToLines(values: string[]): string {
  return values.join("\n");
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Vous n'avez pas les droits pour cette action.";
    if (error.status === 409) return error.message;
    return error.message;
  }
  return "Une erreur inattendue est survenue.";
}

export function CourseEditor({
  course: initialCourse,
  sections: initialSections,
  categories,
  canPublish,
}: {
  course: EditorCourse;
  sections: EditorSection[];
  categories: { id: string; name: string }[];
  canPublish: boolean;
}) {
  const [course, setCourse] = useState(initialCourse);
  const [sections, setSections] = useState(initialSections);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Champs du formulaire de métadonnées (valeurs de travail, non enregistrées).
  const [title, setTitle] = useState(course.title);
  const [subtitle, setSubtitle] = useState(course.subtitle ?? "");
  const [description, setDescription] = useState(course.description);
  const [level, setLevel] = useState<CourseLevel>(course.level);
  const [language, setLanguage] = useState(course.language);
  const [categoryId, setCategoryId] = useState(course.categoryId ?? "");
  const [priceDinars, setPriceDinars] = useState((course.priceCents / 100).toString());
  const [durationMinutes, setDurationMinutes] = useState(course.durationMinutes?.toString() ?? "");
  const [objectives, setObjectives] = useState(listToLines(course.objectives));
  const [prerequisites, setPrerequisites] = useState(listToLines(course.prerequisites));
  const [certificateEnabled, setCertificateEnabled] = useState(course.certificateEnabled);
  const [certificateMinScore, setCertificateMinScore] = useState(course.certificateMinScore.toString());

  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [editingLesson, setEditingLesson] = useState<string | null>(null);
  const [newLessonFor, setNewLessonFor] = useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [newLessonType, setNewLessonType] = useState<LessonType>("VIDEO");

  /** Recharge la formation et son programme depuis le serveur. */
  const reload = useCallback(async () => {
    const fresh = await apiFetch<{
      course: EditorCourse;
      curriculum: { sections: EditorSection[] };
    }>(`/api/courses/${course.id}`);
    setCourse(fresh.course);
    setSections(fresh.curriculum.sections);
  }, [course.id]);

  /** Exécute une mutation puis recharge l'état, en centralisant les erreurs. */
  const run = useCallback(
    async (key: string, action: () => Promise<void>, success: string) => {
      setBusy(key);
      setNotice(null);
      try {
        await action();
        await reload();
        setNotice({ tone: "success", message: success });
      } catch (error) {
        setNotice({ tone: "danger", message: describeError(error) });
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  async function saveMetadata() {
    const price = Number(priceDinars.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      setNotice({ tone: "danger", message: "Prix invalide." });
      return;
    }
    await run(
      "metadata",
      async () => {
        await apiFetch(`/api/courses/${course.id}`, {
          method: "PATCH",
          body: {
            title: title.trim(),
            subtitle: subtitle.trim() === "" ? null : subtitle.trim(),
            description,
            level,
            language,
            categoryId: categoryId === "" ? null : categoryId,
            priceCents: Math.round(price * 100),
            durationMinutes: durationMinutes.trim() === "" ? null : Number(durationMinutes),
            objectives: linesToList(objectives),
            prerequisites: linesToList(prerequisites),
            certificateEnabled,
            certificateMinScore: Number(certificateMinScore),
          },
        });
      },
      "Fiche enregistrée.",
    );
  }

  async function changeStatus(action: "publish" | "archive") {
    await run(
      action,
      async () => {
        await apiFetch(`/api/courses/${course.id}/${action}`, { method: "POST", body: {} });
      },
      action === "publish" ? "Formation publiée." : "Formation archivée.",
    );
  }

  async function addSection() {
    if (newSectionTitle.trim().length < 2) {
      setNotice({ tone: "danger", message: "Le titre de la section est trop court." });
      return;
    }
    await run(
      "section-add",
      async () => {
        await apiFetch(`/api/courses/${course.id}/sections`, {
          method: "POST",
          body: { title: newSectionTitle.trim() },
        });
        setNewSectionTitle("");
      },
      "Section ajoutée.",
    );
  }

  async function renameSection(sectionId: string, value: string) {
    await run(
      `section-rename-${sectionId}`,
      async () => {
        await apiFetch(`/api/courses/${course.id}/sections/${sectionId}`, {
          method: "PATCH",
          body: { title: value.trim() },
        });
      },
      "Section renommée.",
    );
  }

  async function removeSection(sectionId: string) {
    await run(
      `section-delete-${sectionId}`,
      async () => {
        await apiFetch(`/api/courses/${course.id}/sections/${sectionId}`, { method: "DELETE" });
      },
      "Section supprimée.",
    );
  }

  /** Déplace une section d'un cran et enregistre le nouvel ordre complet. */
  async function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const ordered = [...sections];
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(target, 0, moved);
    await run(
      "section-move",
      async () => {
        await apiFetch(`/api/courses/${course.id}/sections/reorder`, {
          method: "POST",
          body: { items: ordered.map((section, position) => ({ id: section.id, position })) },
        });
      },
      "Ordre des sections mis à jour.",
    );
  }

  async function addLesson(sectionId: string) {
    if (newLessonTitle.trim().length < 2) {
      setNotice({ tone: "danger", message: "Le titre de la leçon est trop court." });
      return;
    }
    await run(
      "lesson-add",
      async () => {
        await apiFetch(`/api/courses/${course.id}/lessons`, {
          method: "POST",
          body: { sectionId, title: newLessonTitle.trim(), type: newLessonType },
        });
        setNewLessonTitle("");
        setNewLessonFor(null);
      },
      "Leçon ajoutée (non publiée).",
    );
  }

  async function saveLesson(lessonId: string, form: HTMLFormElement) {
    const data = new FormData(form);
    const videoUrl = String(data.get("videoUrl") ?? "").trim();
    const duration = String(data.get("durationSeconds") ?? "").trim();
    await run(
      `lesson-save-${lessonId}`,
      async () => {
        await apiFetch(`/api/courses/${course.id}/lessons/${lessonId}`, {
          method: "PATCH",
          body: {
            title: String(data.get("title") ?? "").trim(),
            type: String(data.get("type") ?? "VIDEO"),
            contentMd: String(data.get("contentMd") ?? ""),
            videoUrl: videoUrl === "" ? null : videoUrl,
            durationSeconds: duration === "" ? 0 : Number(duration),
            isPreview: data.get("isPreview") === "on",
          },
        });
      },
      "Leçon enregistrée.",
    );
    setEditingLesson(null);
  }

  async function toggleLessonPublished(lesson: EditorLesson) {
    await run(
      `lesson-publish-${lesson.id}`,
      async () => {
        await apiFetch(`/api/courses/${course.id}/lessons/${lesson.id}`, {
          method: "PATCH",
          body: { isPublished: !lesson.isPublished },
        });
      },
      lesson.isPublished ? "Leçon dépubliée." : "Leçon publiée.",
    );
  }

  async function removeLesson(lessonId: string) {
    await run(
      `lesson-delete-${lessonId}`,
      async () => {
        await apiFetch(`/api/courses/${course.id}/lessons/${lessonId}`, { method: "DELETE" });
      },
      "Leçon supprimée.",
    );
  }

  async function moveLesson(sectionId: string, index: number, direction: -1 | 1) {
    const section = sections.find((entry) => entry.id === sectionId);
    if (!section) return;
    const target = index + direction;
    if (target < 0 || target >= section.lessons.length) return;
    const ordered = [...section.lessons];
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(target, 0, moved);
    await run(
      "lesson-move",
      async () => {
        await apiFetch(`/api/courses/${course.id}/sections/${sectionId}/lessons/reorder`, {
          method: "POST",
          body: { items: ordered.map((lesson, position) => ({ id: lesson.id, position })) },
        });
      },
      "Ordre des leçons mis à jour.",
    );
  }

  const publishedLessons = sections.flatMap((section) => section.lessons).filter((lesson) => lesson.isPublished).length;

  return (
    <div className="space-y-8">
      {notice ? (
        <Alert tone={notice.tone} title={notice.tone === "danger" ? "Action impossible" : undefined}>
          {notice.message}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Fiche de la formation"
          description="Titre, niveau, tarif et conditions d'obtention du certificat."
          action={
            <div className="flex items-center gap-3">
              <Badge tone={STATUS_TONES[course.status]}>{COURSE_STATUS_LABELS[course.status]}</Badge>
              {course.status === "PUBLISHED" ? (
                <ButtonLinkPreview slug={course.slug} />
              ) : null}
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Titre" name="title" required>
              <Input id="title" name="title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Sous-titre" name="subtitle">
              <Input id="subtitle" name="subtitle" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
            </Field>
          </div>

          <Field label="Description" name="description">
            <Textarea
              id="description"
              name="description"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Niveau" name="level">
              <Select id="level" name="level" value={level} onChange={(event) => setLevel(event.target.value as CourseLevel)}>
                {COURSE_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {COURSE_LEVEL_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Langue" name="language">
              <Select id="language" name="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Catégorie" name="categoryId">
              <Select id="categoryId" name="categoryId" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Sans catégorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Prix (en dinars)" name="price" hint="Laissez 0 pour une formation gratuite.">
              <Input
                id="price"
                name="price"
                inputMode="decimal"
                value={priceDinars}
                onChange={(event) => setPriceDinars(event.target.value)}
              />
            </Field>
            <Field label="Durée estimée (minutes)" name="durationMinutes">
              <Input
                id="durationMinutes"
                name="durationMinutes"
                inputMode="numeric"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Objectifs pédagogiques" name="objectives" hint="Un objectif par ligne.">
              <Textarea
                id="objectives"
                name="objectives"
                rows={4}
                value={objectives}
                onChange={(event) => setObjectives(event.target.value)}
              />
            </Field>
            <Field label="Prérequis" name="prerequisites" hint="Un prérequis par ligne.">
              <Textarea
                id="prerequisites"
                name="prerequisites"
                rows={4}
                value={prerequisites}
                onChange={(event) => setPrerequisites(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-start gap-3">
              <input
                id="certificateEnabled"
                name="certificateEnabled"
                type="checkbox"
                className="mt-1 size-4 rounded border-ink-300"
                checked={certificateEnabled}
                onChange={(event) => setCertificateEnabled(event.target.checked)}
              />
              <label htmlFor="certificateEnabled" className="text-sm text-ink-700">
                Délivrer un certificat à la réussite de la formation.
              </label>
            </div>
            <Field label="Score minimal pour le certificat (%)" name="certificateMinScore">
              <Input
                id="certificateMinScore"
                name="certificateMinScore"
                inputMode="numeric"
                disabled={!certificateEnabled}
                value={certificateMinScore}
                onChange={(event) => setCertificateMinScore(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-ink-200 pt-4">
            <Button onClick={saveMetadata} disabled={busy === "metadata"}>
              {busy === "metadata" ? "Enregistrement…" : "Enregistrer"}
            </Button>
            {canPublish && course.status !== "PUBLISHED" ? (
              <Button
                variant="secondary"
                onClick={() => changeStatus("publish")}
                disabled={busy === "publish" || publishedLessons === 0}
                title={publishedLessons === 0 ? "Publiez au moins une leçon avant la formation." : undefined}
              >
                Publier
              </Button>
            ) : null}
            {course.status === "PUBLISHED" ? (
              <Button variant="secondary" onClick={() => changeStatus("archive")} disabled={busy === "archive"}>
                Archiver
              </Button>
            ) : null}
          </div>
          {canPublish && publishedLessons === 0 ? (
            <p className="text-xs text-ink-500">
              Une formation ne peut être publiée qu&apos;avec au moins une leçon publiée.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Programme"
          description={`${sections.length} section(s), ${publishedLessons} leçon(s) publiée(s) sur ${course._count.lessons}.`}
        />
        <CardBody className="space-y-6">
          {sections.length === 0 ? (
            <EmptyState
              title="Aucune section"
              description="Structurez la formation en sections, puis ajoutez-y des leçons."
            />
          ) : (
            sections.map((section, sectionIndex) => (
              <div key={section.id} className="rounded-xl border border-ink-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionTitle
                    section={section}
                    disabled={busy === `section-rename-${section.id}`}
                    onRename={(value) => renameSection(section.id, value)}
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveSection(sectionIndex, -1)}
                      disabled={sectionIndex === 0 || busy === "section-move"}
                      aria-label="Monter la section"
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveSection(sectionIndex, 1)}
                      disabled={sectionIndex === sections.length - 1 || busy === "section-move"}
                      aria-label="Descendre la section"
                    >
                      ↓
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => removeSection(section.id)}
                      disabled={busy === `section-delete-${section.id}` || section.lessons.length > 0}
                      title={
                        section.lessons.length > 0 ? "Supprimez d'abord les leçons de cette section." : undefined
                      }
                    >
                      Supprimer
                    </Button>
                  </div>
                </div>

                <ul className="mt-4 space-y-3">
                  {section.lessons.map((lesson, lessonIndex) => (
                    <li key={lesson.id} className="rounded-lg border border-ink-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">{lesson.title}</p>
                          <p className="text-xs text-ink-500">
                            {LESSON_TYPE_LABELS[lesson.type]}
                            {lesson.isPreview ? " · aperçu public" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={lesson.isPublished ? "success" : "warning"}>
                            {lesson.isPublished ? "Publiée" : "Brouillon"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveLesson(section.id, lessonIndex, -1)}
                            disabled={lessonIndex === 0 || busy === "lesson-move"}
                            aria-label="Monter la leçon"
                          >
                            ↑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveLesson(section.id, lessonIndex, 1)}
                            disabled={lessonIndex === section.lessons.length - 1 || busy === "lesson-move"}
                            aria-label="Descendre la leçon"
                          >
                            ↓
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingLesson(editingLesson === lesson.id ? null : lesson.id)}
                          >
                            {editingLesson === lesson.id ? "Fermer" : "Modifier"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => toggleLessonPublished(lesson)}
                            disabled={busy === `lesson-publish-${lesson.id}`}
                          >
                            {lesson.isPublished ? "Dépublier" : "Publier"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => removeLesson(lesson.id)}
                            disabled={busy === `lesson-delete-${lesson.id}`}
                          >
                            Supprimer
                          </Button>
                        </div>
                      </div>

                      {editingLesson === lesson.id ? (
                        <LessonForm
                          lesson={lesson}
                          busy={busy === `lesson-save-${lesson.id}`}
                          onCancel={() => setEditingLesson(null)}
                          onSubmit={(form) => saveLesson(lesson.id, form)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>

                {newLessonFor === section.id ? (
                  <div className="mt-4 space-y-3 rounded-lg border border-dashed border-ink-300 p-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Titre de la leçon" name={`new-lesson-title-${section.id}`}>
                        <Input
                          id={`new-lesson-title-${section.id}`}
                          name={`new-lesson-title-${section.id}`}
                          value={newLessonTitle}
                          onChange={(event) => setNewLessonTitle(event.target.value)}
                        />
                      </Field>
                      <Field label="Type" name={`new-lesson-type-${section.id}`}>
                        <Select
                          id={`new-lesson-type-${section.id}`}
                          name={`new-lesson-type-${section.id}`}
                          value={newLessonType}
                          onChange={(event) => setNewLessonType(event.target.value as LessonType)}
                        >
                          {LESSON_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {LESSON_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => addLesson(section.id)} disabled={busy === "lesson-add"}>
                        Ajouter la leçon
                      </Button>
                      <Button variant="secondary" onClick={() => setNewLessonFor(null)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setNewLessonFor(section.id);
                      setNewLessonTitle("");
                      setNewLessonType("VIDEO");
                    }}
                  >
                    Ajouter une leçon
                  </Button>
                )}
              </div>
            ))
          )}

          <div className="space-y-3 border-t border-ink-200 pt-4">
            <Field label="Nouvelle section" name="newSectionTitle" hint="Un chapitre du programme, par exemple « Introduction ».">
              <Input
                id="newSectionTitle"
                name="newSectionTitle"
                value={newSectionTitle}
                onChange={(event) => setNewSectionTitle(event.target.value)}
              />
            </Field>
            <Button onClick={addSection} disabled={busy === "section-add"}>
              Ajouter la section
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** Lien vers la fiche publique (aperçu) d'une formation publiée. */
function ButtonLinkPreview({ slug }: { slug: string }) {
  return (
    <Link href={`/formations/${slug}`} className="text-sm font-medium text-brand-700 hover:underline">
      Voir la fiche publique
    </Link>
  );
}

/** Titre de section éditable : bascule en champ texte au clic. */
function SectionTitle({
  section,
  disabled,
  onRename,
}: {
  section: EditorSection;
  disabled: boolean;
  onRename: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(section.title);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(section.title);
          setEditing(true);
        }}
        className="text-left text-sm font-semibold text-ink-900 hover:text-brand-700"
      >
        {section.title}
        <span className="ml-2 text-xs font-normal text-ink-500">renommer</span>
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim().length >= 2) {
          onRename(value);
          setEditing(false);
        }
      }}
    >
      <Input
        aria-label="Titre de la section"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="max-w-xs"
      />
      <Button type="submit" size="sm" disabled={disabled}>
        OK
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>
        Annuler
      </Button>
    </form>
  );
}

/** Formulaire d'édition du contenu d'une leçon. */
function LessonForm({
  lesson,
  busy,
  onCancel,
  onSubmit,
}: {
  lesson: EditorLesson;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  return (
    <form
      className="mt-3 space-y-3 border-t border-ink-200 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event.currentTarget);
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Titre" name={`lesson-title-${lesson.id}`} required>
          <Input id={`lesson-title-${lesson.id}`} name="title" defaultValue={lesson.title} required />
        </Field>
        <Field label="Type" name={`lesson-type-${lesson.id}`}>
          <Select id={`lesson-type-${lesson.id}`} name="type" defaultValue={lesson.type}>
            {LESSON_TYPES.map((type) => (
              <option key={type} value={type}>
                {LESSON_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Durée (secondes)" name={`lesson-duration-${lesson.id}`}>
          <Input
            id={`lesson-duration-${lesson.id}`}
            name="durationSeconds"
            inputMode="numeric"
            defaultValue={lesson.durationSeconds ?? 0}
          />
        </Field>
      </div>

      <Field
        label="URL de la vidéo"
        name={`lesson-video-${lesson.id}`}
        hint="Lien direct vers le fichier vidéo ou la plateforme d'hébergement."
      >
        <Input
          id={`lesson-video-${lesson.id}`}
          name="videoUrl"
          type="url"
          defaultValue={lesson.videoUrl ?? ""}
          placeholder="https://…"
        />
      </Field>

      <Field label="Contenu (Markdown)" name={`lesson-content-${lesson.id}`}>
        <Textarea
          id={`lesson-content-${lesson.id}`}
          name="contentMd"
          rows={6}
          defaultValue={lesson.contentMd ?? ""}
        />
      </Field>

      <div className="flex items-center gap-3">
        <input
          id={`lesson-preview-${lesson.id}`}
          name="isPreview"
          type="checkbox"
          className="size-4 rounded border-ink-300"
          defaultChecked={lesson.isPreview}
        />
        <label htmlFor={`lesson-preview-${lesson.id}`} className="text-sm text-ink-700">
          Rendre cette leçon consultable gratuitement (aperçu public).
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer la leçon"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
