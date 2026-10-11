/**
 * Éditeur de formation (espace formateur).
 *
 * L'accès exige la permission `course:update`. Un formateur ne peut ouvrir que
 * ses propres formations : la vérification est faite ici, côté serveur, et non
 * en masquant le lien depuis la liste.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CourseEditor, type EditorCourse, type EditorLesson, type EditorSection } from "@/components/instructor/course-editor";
import { can, requirePagePermission } from "@/server/page-context";
import { getCourseCurriculum, getCourseForEditor, listCatalogCategories } from "@/server/services/courses";

export const dynamic = "force-dynamic";

type Params = Promise<{ courseId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { courseId } = await params;
  try {
    const page = await requirePagePermission("course:update");
    const course = await getCourseForEditor(page.organizationId, courseId);
    return { title: `Éditer — ${course.title}` };
  } catch {
    return { title: "Éditer une formation" };
  }
}

export default async function EditCoursePage({ params }: { params: Params }) {
  const { courseId } = await params;
  const page = await requirePagePermission("course:update");

  const [course, curriculum, categories] = await Promise.all([
    getCourseForEditor(page.organizationId, courseId).catch(() => null),
    getCourseCurriculum(page.organizationId, courseId).catch(() => null),
    listCatalogCategories(page.organizationId),
  ]);

  if (!course || !curriculum) notFound();

  // Un formateur n'édite que ses propres formations ; l'administration voit tout.
  if (page.role === "INSTRUCTOR" && course.instructor.id !== page.user.id) {
    notFound();
  }

  const editorCourse: EditorCourse = {
    id: course.id,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    level: course.level,
    language: course.language,
    priceCents: course.priceCents,
    currency: course.currency,
    durationMinutes: course.durationMinutes,
    status: course.status,
    categoryId: course.categoryId,
    imageUrl: course.imageUrl,
    objectives: course.objectives,
    prerequisites: course.prerequisites,
    certificateEnabled: course.certificateEnabled,
    certificateMinScore: course.certificateMinScore,
    _count: course._count,
  };

  const editorSections: EditorSection[] = curriculum.sections.map((section) => ({
    id: section.id,
    title: section.title,
    summary: section.summary,
    lessons: section.lessons.map(
      (lesson): EditorLesson => ({
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        isPreview: lesson.isPreview,
        isPublished: lesson.isPublished,
        durationSeconds: lesson.durationSeconds,
        contentMd: lesson.contentMd,
        videoUrl: lesson.videoUrl,
      }),
    ),
  }));

  return (
    <div className="space-y-6">
      <nav aria-label="Fil d'Ariane" className="text-xs text-ink-500">
        <Link href="/tableau-de-bord/formateur" className="hover:text-brand-700">
          Espace formateur
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-700">{course.title}</span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold text-ink-900">{course.title}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {course._count.enrollments} inscrit(s) — modifiez la fiche, le programme et la publication.
        </p>
      </header>

      <CourseEditor
        course={editorCourse}
        sections={editorSections}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        canPublish={can(page, "course:publish")}
      />
    </div>
  );
}
