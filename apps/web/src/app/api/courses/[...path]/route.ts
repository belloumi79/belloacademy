/** Formations : /api/courses/[...path] */

import { courseCreateSchema, courseFilterSchema, courseUpdateSchema, reorderSchema, sectionCreateSchema, sectionUpdateSchema, lessonCreateSchema, lessonUpdateSchema, categorySchema } from "@belloacademy/shared";

import { jsonCreated, jsonOk, parseBody, searchParams } from "@/lib/http/api";
import { createDispatcher } from "@/lib/http/dispatch";
import { orgAccess, orgScope, publicOrganizationId } from "@/lib/http/tenant";
import {
  archiveCourse,
  createCategory,
  createCourse,
  createLesson,
  createSection,
  deleteLesson,
  deleteSection,
  getCourseById,
  getCourseCurriculum,
  getLessonForLearner,
  listCatalog,
  listCatalogCategories,
  listInstructorCourses,
  publishCourse,
  reorderLessons,
  reorderSections,
  updateCourse,
  updateLesson,
  updateSection,
} from "@/server/services/courses";
import { listCourseEnrollments } from "@/server/services/enrollments";

export const runtime = "nodejs";

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async ({ request }) => {
      const query = searchParams(request);
      const filters = courseFilterSchema.parse({
        page: query.get("page") ?? undefined,
        pageSize: query.get("pageSize") ?? undefined,
        search: query.get("search") ?? query.get("q") ?? undefined,
        categoryId: query.get("categoryId") ?? undefined,
        level: query.get("level") ?? undefined,
        language: query.get("language") ?? undefined,
        price: query.get("price") ?? undefined,
        sort: query.get("sort") ?? undefined,
      });
      const organizationId = await publicOrganizationId(query.get("org"));
      const [page, categories] = await Promise.all([
        listCatalog({ ...filters, organizationId: organizationId ?? undefined }),
        listCatalogCategories(organizationId ?? undefined),
      ]);
      return jsonOk({ ...page, categories });
    },
  },
  {
    method: "GET",
    pattern: "mine",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "course:read");
      const query = searchParams(request);
      const mine = query.get("all") === "1" && scope.role !== "LEARNER" ? undefined : scope.userId;
      const courses = await listInstructorCourses(scope.organizationId, mine);
      return jsonOk({ courses });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "course:create");
      const input = await parseBody(request, courseCreateSchema);
      const course = await createCourse({
        ...input,
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        instructorId: scope.userId,
      });
      return jsonCreated({ course });
    },
  },
  {
    method: "POST",
    pattern: "categories",
    handler: async ({ request }) => {
      const scope = await orgScope(request, "course:create");
      const input = await parseBody(request, categorySchema);
      const category = await createCategory({
        organizationId: scope.organizationId,
        name: input.name,
        description: input.description ?? null,
      });
      return jsonCreated({ category });
    },
  },
  {
    method: "GET",
    pattern: ":courseId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:read");
      const [course, curriculum] = await Promise.all([
        getCourseById(scope.organizationId, params.courseId ?? ""),
        getCourseCurriculum(scope.organizationId, params.courseId ?? ""),
      ]);
      return jsonOk({ course, curriculum });
    },
  },
  {
    method: "PATCH",
    pattern: ":courseId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, courseUpdateSchema);
      const course = await updateCourse({
        organizationId: scope.organizationId,
        courseId: params.courseId ?? "",
        actorUserId: scope.userId,
        data: input,
      });
      return jsonOk({ course });
    },
  },
  {
    method: "POST",
    pattern: ":courseId/publish",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:publish");
      const course = await publishCourse({
        organizationId: scope.organizationId,
        courseId: params.courseId ?? "",
        actorUserId: scope.userId,
      });
      return jsonOk({ course });
    },
  },
  {
    method: "POST",
    pattern: ":courseId/archive",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const course = await archiveCourse({
        organizationId: scope.organizationId,
        courseId: params.courseId ?? "",
        actorUserId: scope.userId,
      });
      return jsonOk({ course });
    },
  },
  {
    method: "POST",
    pattern: ":courseId/sections",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, sectionCreateSchema);
      const section = await createSection({
        organizationId: scope.organizationId,
        courseId: params.courseId ?? "",
        title: input.title,
        summary: input.summary ?? null,
      });
      return jsonCreated({ section });
    },
  },
  {
    method: "POST",
    pattern: ":courseId/sections/reorder",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, reorderSchema);
      const orderedIds = [...input.items]
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      const result = await reorderSections({
        organizationId: scope.organizationId,
        courseId: params.courseId ?? "",
        orderedIds,
      });
      return jsonOk(result);
    },
  },
  {
    method: "PATCH",
    pattern: ":courseId/sections/:sectionId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, sectionUpdateSchema);
      const section = await updateSection({
        organizationId: scope.organizationId,
        sectionId: params.sectionId ?? "",
        ...input,
      });
      return jsonOk({ section });
    },
  },
  {
    method: "DELETE",
    pattern: ":courseId/sections/:sectionId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const result = await deleteSection({
        organizationId: scope.organizationId,
        sectionId: params.sectionId ?? "",
      });
      return jsonOk(result);
    },
  },
  {
    method: "POST",
    pattern: ":courseId/lessons",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, lessonCreateSchema);
      const lesson = await createLesson({
        organizationId: scope.organizationId,
        courseId: params.courseId ?? "",
        sectionId: input.sectionId,
        title: input.title,
        type: input.type,
        contentMd: input.contentMd ?? null,
        videoUrl: input.videoUrl ?? null,
        durationSeconds: input.durationSeconds ?? null,
        isPreview: input.isPreview,
      });
      return jsonCreated({ lesson });
    },
  },
  {
    method: "POST",
    pattern: ":courseId/sections/:sectionId/lessons/reorder",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, reorderSchema);
      const orderedIds = [...input.items]
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      const result = await reorderLessons({
        organizationId: scope.organizationId,
        sectionId: params.sectionId ?? "",
        orderedIds,
      });
      return jsonOk(result);
    },
  },
  {
    method: "GET",
    pattern: ":courseId/enrollments",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "enrollment:manage");
      const enrollments = await listCourseEnrollments(scope.organizationId, params.courseId ?? "");
      return jsonOk({ enrollments });
    },
  },
  {
    method: "GET",
    pattern: ":courseId/lessons/:lessonId",
    handler: async ({ request, params }) => {
      const scope = await orgAccess(request);
      const result = await getLessonForLearner({
        organizationId: scope.organizationId,
        lessonId: params.lessonId ?? "",
        userId: scope.userId,
      });
      return jsonOk(result);
    },
  },
  {
    method: "PATCH",
    pattern: ":courseId/lessons/:lessonId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const input = await parseBody(request, lessonUpdateSchema);
      const lesson = await updateLesson({
        organizationId: scope.organizationId,
        lessonId: params.lessonId ?? "",
        data: input,
      });
      return jsonOk({ lesson });
    },
  },
  {
    method: "DELETE",
    pattern: ":courseId/lessons/:lessonId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "course:update");
      const result = await deleteLesson({
        organizationId: scope.organizationId,
        lessonId: params.lessonId ?? "",
      });
      return jsonOk(result);
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;
export const PATCH = dispatch.PATCH;
export const DELETE = dispatch.DELETE;
