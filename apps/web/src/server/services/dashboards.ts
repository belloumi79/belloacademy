/**
 * Tableaux de bord par rôle.
 *
 * Toutes les statistiques sont **calculées depuis la base** : aucun chiffre
 * codé en dur. Les agrégations sont bornées par des filtres temporels et des
 * `take`/`groupBy` afin d'éviter les requêtes coûteuses.
 *
 * Les vues inter-organisations (superadministration) passent par
 * `prismaPlatform` ; les vues d'une organisation passent par `withTenant`.
 */

import { prismaPlatform, withTenant } from "@/lib/db/prisma";
import { getPlanLimits, getUsage, type UsageSnapshot } from "@/server/services/organizations";
import type { PlanLimits } from "@belloacademy/shared";

export type DateRange = { from: Date; to: Date };

export function defaultRange(days = 30, now: Date = new Date()): DateRange {
  const to = new Date(now);
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

/** Séries mensuelles réutilisables (12 derniers mois). */
function monthBuckets(months = 12, now: Date = new Date()): Date[] {
  const buckets: Date[] = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    buckets.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)));
  }
  return buckets;
}

export type PlatformOverview = {
  organizations: { total: number; active: number; newInPeriod: number };
  users: { total: number; newInPeriod: number };
  courses: { published: number; draft: number };
  enrollments: { total: number; inPeriod: number };
  liveSessions: { upcoming: number };
  revenue: { currency: string; paidCentsInPeriod: number; outstandingCents: number };
  subscriptionsByStatus: { status: string; count: number }[];
  monthly: { month: string; organizations: number; enrollments: number; revenueCents: number }[];
};

/** Vue globale (superadministrateur). */
export async function platformOverview(range: DateRange = defaultRange(30)): Promise<PlatformOverview> {
  const buckets = monthBuckets(12);

  const [
    orgTotal,
    orgActive,
    orgNew,
    userTotal,
    userNew,
    coursePublished,
    courseDraft,
    enrollmentTotal,
    enrollmentNew,
    liveUpcoming,
    paid,
    open,
    subscriptions,
    orgSeries,
    enrollmentSeries,
    revenueSeries,
  ] = await Promise.all([
    prismaPlatform.organization.count({ where: { deletedAt: null } }),
    prismaPlatform.organization.count({
      where: {
        deletedAt: null,
        subscriptions: { some: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } } },
      },
    }),
    prismaPlatform.organization.count({ where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } } }),
    prismaPlatform.user.count({ where: { deletedAt: null } }),
    prismaPlatform.user.count({ where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } } }),
    prismaPlatform.course.count({ where: { status: "PUBLISHED" } }),
    prismaPlatform.course.count({ where: { status: "DRAFT" } }),
    prismaPlatform.enrollment.count(),
    prismaPlatform.enrollment.count({ where: { enrolledAt: { gte: range.from, lte: range.to } } }),
    prismaPlatform.liveSession.count({ where: { status: "SCHEDULED", scheduledStart: { gte: new Date() } } }),
    prismaPlatform.invoice.aggregate({
      where: { status: "PAID", paidAt: { gte: range.from, lte: range.to } },
      _sum: { amountCents: true },
    }),
    prismaPlatform.invoice.aggregate({ where: { status: "OPEN" }, _sum: { amountCents: true } }),
    prismaPlatform.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prismaPlatform.organization.findMany({
      where: { createdAt: { gte: buckets[0] } },
      select: { createdAt: true },
    }),
    prismaPlatform.enrollment.findMany({ where: { enrolledAt: { gte: buckets[0] } }, select: { enrolledAt: true } }),
    prismaPlatform.invoice.findMany({
      where: { status: "PAID", paidAt: { gte: buckets[0] } },
      select: { paidAt: true, amountCents: true },
    }),
  ]);

  const key = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthly = buckets.map((bucket) => ({ month: key(bucket), organizations: 0, enrollments: 0, revenueCents: 0 }));
  const index = new Map(monthly.map((entry, position) => [entry.month, position]));

  const bump = (month: string, field: "organizations" | "enrollments" | "revenueCents", by = 1) => {
    const position = index.get(month);
    if (position === undefined) return;
    const bucket = monthly[position];
    if (bucket) bucket[field] += by;
  };

  for (const row of orgSeries) bump(key(row.createdAt), "organizations");
  for (const row of enrollmentSeries) bump(key(row.enrolledAt), "enrollments");
  for (const row of revenueSeries) {
    if (!row.paidAt) continue;
    bump(key(row.paidAt), "revenueCents", row.amountCents);
  }

  return {
    organizations: { total: orgTotal, active: orgActive, newInPeriod: orgNew },
    users: { total: userTotal, newInPeriod: userNew },
    courses: { published: coursePublished, draft: courseDraft },
    enrollments: { total: enrollmentTotal, inPeriod: enrollmentNew },
    liveSessions: { upcoming: liveUpcoming },
    revenue: {
      currency: process.env.BILLING_CURRENCY ?? "TND",
      paidCentsInPeriod: paid._sum.amountCents ?? 0,
      outstandingCents: open._sum.amountCents ?? 0,
    },
    subscriptionsByStatus: subscriptions.map((row) => ({ status: row.status, count: row._count._all })),
    monthly,
  };
}

export type OrganizationOverview = {
  members: { total: number; byRole: { role: string; count: number }[]; newInPeriod: number };
  courses: { total: number; published: number; draft: number; archived: number };
  enrollments: { total: number; active: number; completed: number; inPeriod: number };
  completionRate: number;
  upcomingSessions: {
    id: string;
    title: string;
    courseTitle: string;
    scheduledStart: Date;
    status: string;
  }[];
  pendingGrading: number;
  usage: UsageSnapshot;
  limits: PlanLimits;
  monthly: { month: string; enrollments: number; completions: number }[];
};

/** Vue d'une organisation (administrateur d'organisation). */
export async function organizationOverview(
  organizationId: string,
  range: DateRange = defaultRange(30),
): Promise<OrganizationOverview> {
  const buckets = monthBuckets(12);

  const [
    members,
    membersByRole,
    membersNew,
    courses,
    enrollmentsTotal,
    enrollmentsActive,
    enrollmentsCompleted,
    enrollmentsNew,
    upcoming,
    pendingGrading,
    usage,
    limits,
    enrollmentSeries,
    completionSeries,
  ] = await Promise.all([
    prismaPlatform.membership.count({ where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } } }),
    prismaPlatform.membership.groupBy({
      by: ["role"],
      where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } },
      _count: { _all: true },
    }),
    prismaPlatform.membership.count({ where: { organizationId, createdAt: { gte: range.from, lte: range.to } } }),
    prismaPlatform.course.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    prismaPlatform.enrollment.count({ where: { organizationId } }),
    prismaPlatform.enrollment.count({ where: { organizationId, status: "ACTIVE" } }),
    prismaPlatform.enrollment.count({ where: { organizationId, status: "COMPLETED" } }),
    prismaPlatform.enrollment.count({ where: { organizationId, enrolledAt: { gte: range.from, lte: range.to } } }),
    withTenant(organizationId, (tx) =>
      tx.liveSession.findMany({
        where: { status: { in: ["SCHEDULED", "LIVE"] }, scheduledEnd: { gte: new Date() } },
        orderBy: { scheduledStart: "asc" },
        take: 8,
        select: { id: true, title: true, scheduledStart: true, status: true, course: { select: { title: true } } },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.assignmentSubmission.count({ where: { organizationId, status: "SUBMITTED" } }),
    ),
    getUsage(organizationId),
    getPlanLimits(organizationId),
    withTenant(organizationId, (tx) =>
      tx.enrollment.findMany({ where: { organizationId, enrolledAt: { gte: buckets[0] } }, select: { enrolledAt: true } }),
    ),
    withTenant(organizationId, (tx) =>
      tx.enrollment.findMany({
        where: { organizationId, completedAt: { gte: buckets[0] } },
        select: { completedAt: true },
      }),
    ),
  ]);

  const coursesByStatus = new Map(courses.map((row) => [row.status, row._count._all]));
  const courseTotal = courses.reduce((total, row) => total + row._count._all, 0);

  const key = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthly = buckets.map((bucket) => ({ month: key(bucket), enrollments: 0, completions: 0 }));
  const index = new Map(monthly.map((entry, position) => [entry.month, position]));
  const bump = (month: string, field: "enrollments" | "completions") => {
    const position = index.get(month);
    if (position === undefined) return;
    const bucket = monthly[position];
    if (bucket) bucket[field] += 1;
  };
  for (const row of enrollmentSeries) bump(key(row.enrolledAt), "enrollments");
  for (const row of completionSeries) {
    if (row.completedAt) bump(key(row.completedAt), "completions");
  }

  return {
    members: {
      total: members,
      byRole: membersByRole.map((row) => ({ role: row.role, count: row._count._all })),
      newInPeriod: membersNew,
    },
    courses: {
      total: courseTotal,
      published: coursesByStatus.get("PUBLISHED") ?? 0,
      draft: coursesByStatus.get("DRAFT") ?? 0,
      archived: coursesByStatus.get("ARCHIVED") ?? 0,
    },
    enrollments: {
      total: enrollmentsTotal,
      active: enrollmentsActive,
      completed: enrollmentsCompleted,
      inPeriod: enrollmentsNew,
    },
    completionRate: enrollmentsTotal === 0 ? 0 : Math.round((enrollmentsCompleted / enrollmentsTotal) * 100),
    upcomingSessions: upcoming.map((session) => ({
      id: session.id,
      title: session.title,
      courseTitle: session.course.title,
      scheduledStart: session.scheduledStart,
      status: session.status,
    })),
    pendingGrading,
    usage,
    limits,
    monthly,
  };
}

export type InstructorOverview = {
  courses: { id: string; title: string; status: string; enrollments: number; publishedLessons: number }[];
  students: { total: number; active: number };
  averageProgress: number;
  pendingSubmissions: {
    id: string;
    assignmentTitle: string;
    courseTitle: string;
    learnerName: string;
    submittedAt: Date;
  }[];
  upcomingSessions: { id: string; title: string; scheduledStart: Date; status: string }[];
  recentQuizResults: {
    id: string;
    quizTitle: string;
    learnerName: string;
    score: number;
    maxScore: number;
    passed: boolean | null;
    submittedAt: Date | null;
  }[];
};

/** Vue formateur : ses cours, ses apprenants, les corrections en attente. */
export async function instructorOverview(organizationId: string, instructorId: string): Promise<InstructorOverview> {
  const [courses, submissions, upcoming, quizAttempts] = await Promise.all([
    withTenant(organizationId, (tx) =>
      tx.course.findMany({
        where: { organizationId, instructorId },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          status: true,
          _count: { select: { enrollments: true } },
          lessons: { where: { isPublished: true }, select: { id: true } },
        },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.assignmentSubmission.findMany({
        where: { organizationId, status: "SUBMITTED", assignment: { course: { instructorId } } },
        orderBy: { submittedAt: "asc" },
        take: 10,
        select: {
          id: true,
          submittedAt: true,
          user: { select: { name: true } },
          assignment: { select: { title: true, course: { select: { title: true } } } },
        },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.liveSession.findMany({
        where: { organizationId, hostUserId: instructorId, status: { in: ["SCHEDULED", "LIVE"] }, scheduledEnd: { gte: new Date() } },
        orderBy: { scheduledStart: "asc" },
        take: 5,
        select: { id: true, title: true, scheduledStart: true, status: true },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.quizAttempt.findMany({
        where: { organizationId, status: "GRADED", quiz: { course: { instructorId } } },
        orderBy: { submittedAt: "desc" },
        take: 10,
        select: {
          id: true,
          score: true,
          maxScore: true,
          passed: true,
          submittedAt: true,
          user: { select: { name: true } },
          quiz: { select: { title: true } },
        },
      }),
    ),
  ]);

  const enrollmentsByCourse = courses.map((course) => course._count.enrollments);
  const [studentsTotal, studentsActive, progressAggregate] = await Promise.all([
    withTenant(organizationId, (tx) =>
      tx.enrollment.count({ where: { organizationId, course: { instructorId } } }),
    ),
    withTenant(organizationId, (tx) =>
      tx.enrollment.count({ where: { organizationId, status: "ACTIVE", course: { instructorId } } }),
    ),
    withTenant(organizationId, (tx) =>
      tx.enrollment.aggregate({ where: { organizationId, course: { instructorId } }, _avg: { progressPercent: true } }),
    ),
  ]);
  void enrollmentsByCourse;

  return {
    courses: courses.map((course) => ({
      id: course.id,
      title: course.title,
      status: course.status,
      enrollments: course._count.enrollments,
      publishedLessons: course.lessons.length,
    })),
    students: { total: studentsTotal, active: studentsActive },
    averageProgress: Math.round(progressAggregate._avg.progressPercent ?? 0),
    pendingSubmissions: submissions.map((submission) => ({
      id: submission.id,
      assignmentTitle: submission.assignment.title,
      courseTitle: submission.assignment.course.title,
      learnerName: submission.user.name,
      submittedAt: submission.submittedAt,
    })),
    upcomingSessions: upcoming,
    recentQuizResults: quizAttempts.map((attempt) => ({
      id: attempt.id,
      quizTitle: attempt.quiz.title,
      learnerName: attempt.user.name,
      score: attempt.score,
      maxScore: attempt.maxScore,
      passed: attempt.passed,
      submittedAt: attempt.submittedAt,
    })),
  };
}

export type LearnerOverview = {
  enrollments: {
    id: string;
    courseId: string;
    courseTitle: string;
    courseSlug: string;
    instructorName: string;
    progressPercent: number;
    status: string;
    completedLessons: number;
    totalLessons: number;
    nextLessonId: string | null;
    lastAccessedAt: Date | null;
  }[];
  upcomingSessions: {
    id: string;
    title: string;
    courseTitle: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    status: string;
  }[];
  results: {
    id: string;
    quizTitle: string;
    courseTitle: string;
    score: number;
    maxScore: number;
    passed: boolean | null;
    submittedAt: Date | null;
  }[];
  certificates: { id: string; serial: string; courseTitle: string; issuedAt: Date }[];
  pendingAssignments: { id: string; title: string; courseTitle: string; dueAt: Date | null }[];
};

/** Vue apprenant : progression, prochaines sessions, résultats, certificats. */
export async function learnerOverview(organizationId: string, userId: string): Promise<LearnerOverview> {
  const [enrollments, sessions, results, certificates, pending] = await Promise.all([
    withTenant(organizationId, (tx) =>
      tx.enrollment.findMany({
        where: { organizationId, userId, status: { in: ["ACTIVE", "COMPLETED"] } },
        orderBy: { lastAccessedAt: "desc" },
        take: 24,
        select: {
          id: true,
          progressPercent: true,
          status: true,
          lastAccessedAt: true,
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              instructor: { select: { name: true } },
              _count: { select: { lessons: { where: { isPublished: true } } } },
            },
          },
          progress: { where: { completedAt: { not: null } }, select: { lessonId: true } },
        },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.liveSession.findMany({
        where: {
          organizationId,
          status: { in: ["SCHEDULED", "LIVE"] },
          scheduledEnd: { gte: new Date() },
          course: { enrollments: { some: { userId, status: { in: ["ACTIVE", "COMPLETED"] } } } },
        },
        orderBy: { scheduledStart: "asc" },
        take: 6,
        select: {
          id: true,
          title: true,
          scheduledStart: true,
          scheduledEnd: true,
          status: true,
          course: { select: { title: true } },
        },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.quizAttempt.findMany({
        where: { organizationId, userId, status: "GRADED" },
        orderBy: { submittedAt: "desc" },
        take: 8,
        select: {
          id: true,
          score: true,
          maxScore: true,
          passed: true,
          submittedAt: true,
          quiz: { select: { title: true, course: { select: { title: true } } } },
        },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.certificate.findMany({
        where: { organizationId, userId, revokedAt: null },
        orderBy: { issuedAt: "desc" },
        select: { id: true, serial: true, issuedAt: true, course: { select: { title: true } } },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.assignment.findMany({
        where: {
          organizationId,
          isPublished: true,
          course: { enrollments: { some: { userId, status: "ACTIVE" } } },
          submissions: { none: { userId } },
        },
        orderBy: { dueAt: "asc" },
        take: 6,
        select: { id: true, title: true, dueAt: true, course: { select: { title: true } } },
      }),
    ),
  ]);

  return {
    enrollments: enrollments.map((enrollment) => {
      const completed = enrollment.progress.length;
      const total = enrollment.course._count.lessons;
      return {
        id: enrollment.id,
        courseId: enrollment.course.id,
        courseTitle: enrollment.course.title,
        courseSlug: enrollment.course.slug,
        instructorName: enrollment.course.instructor.name,
        progressPercent: enrollment.progressPercent,
        status: enrollment.status,
        completedLessons: completed,
        totalLessons: total,
        nextLessonId: null,
        lastAccessedAt: enrollment.lastAccessedAt,
      };
    }),
    upcomingSessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      courseTitle: session.course.title,
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      status: session.status,
    })),
    results: results.map((attempt) => ({
      id: attempt.id,
      quizTitle: attempt.quiz.title,
      courseTitle: attempt.quiz.course.title,
      score: attempt.score,
      maxScore: attempt.maxScore,
      passed: attempt.passed,
      submittedAt: attempt.submittedAt,
    })),
    certificates: certificates.map((certificate) => ({
      id: certificate.id,
      serial: certificate.serial,
      courseTitle: certificate.course.title,
      issuedAt: certificate.issuedAt,
    })),
    pendingAssignments: pending.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      courseTitle: assignment.course.title,
      dueAt: assignment.dueAt,
    })),
  };
}

/* ------------------------------------------------- Corrections en attente */

export type PendingGrading = {
  submissions: {
    id: string;
    submittedAt: Date | null;
    learnerName: string;
    assignmentId: string;
    assignmentTitle: string;
    courseTitle: string;
    maxScore: number;
  }[];
  quizAnswers: {
    id: string;
    attemptId: string;
    answerText: string | null;
    points: number;
    questionPrompt: string;
    learnerName: string;
    quizTitle: string;
    courseTitle: string;
  }[];
};

/**
 * Travail de correction restant pour les formations de cet utilisateur.
 * Deux sources distinctes : les dépôts de devoirs et les réponses de quiz
 * ouvertes (réponse courte) qui exigent une appréciation humaine.
 */
export async function listPendingGrading(
  organizationId: string,
  instructorId: string,
): Promise<PendingGrading> {
  const [submissions, quizAnswers] = await Promise.all([
    withTenant(organizationId, (tx) =>
      tx.assignmentSubmission.findMany({
        where: {
          organizationId,
          status: "SUBMITTED",
          assignment: { course: { instructorId, organizationId } },
        },
        orderBy: { submittedAt: "asc" },
        take: 50,
        select: {
          id: true,
          submittedAt: true,
          user: { select: { name: true } },
          assignment: {
            select: { id: true, title: true, maxScore: true, course: { select: { title: true } } },
          },
        },
      }),
    ),
    withTenant(organizationId, (tx) =>
      tx.quizAnswer.findMany({
        where: {
          organizationId,
          isCorrect: null,
          attempt: { status: "SUBMITTED", quiz: { course: { instructorId, organizationId } } },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          attemptId: true,
          answerText: true,
          question: { select: { prompt: true, points: true } },
          attempt: {
            select: {
              user: { select: { name: true } },
              quiz: { select: { title: true, course: { select: { title: true } } } },
            },
          },
        },
      }),
    ),
  ]);

  return {
    submissions: submissions.map((submission) => ({
      id: submission.id,
      submittedAt: submission.submittedAt,
      learnerName: submission.user.name,
      assignmentId: submission.assignment.id,
      assignmentTitle: submission.assignment.title,
      courseTitle: submission.assignment.course.title,
      maxScore: submission.assignment.maxScore,
    })),
    quizAnswers: quizAnswers.map((answer) => ({
      id: answer.id,
      attemptId: answer.attemptId,
      answerText: answer.answerText,
      points: answer.question.points,
      questionPrompt: answer.question.prompt,
      learnerName: answer.attempt.user.name,
      quizTitle: answer.attempt.quiz.title,
      courseTitle: answer.attempt.quiz.course.title,
    })),
  };
}

