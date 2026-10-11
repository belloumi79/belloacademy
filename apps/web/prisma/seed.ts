/**
 * Données de démonstration BelloAcademy.
 *
 * Objectif : disposer immédiatement d'une plateforme peuplée pour valider les
 * parcours (catalogue, formation, quiz, devoir, classe virtuelle, certificat,
 * facturation) sans jamais écrire de secret réel dans le dépôt.
 *
 * Le script est idempotent : il peut être relancé sans dupliquer les données.
 * Il s'exécute avec le rôle *plateforme* (BYPASSRLS), ce qui est nécessaire
 * puisqu'il crée plusieurs organisations.
 *
 * Mot de passe des comptes de démonstration : `SEED_PASSWORD` s'il est défini,
 * sinon `BelloAcademy!2026` (à changer dès la première connexion).
 */

import { createHash } from "node:crypto";

import { DEFAULT_PLANS, resolveOrganizationSettings } from "@belloacademy/shared";

import { prismaPlatform } from "@/lib/db/prisma";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";

const PASSWORD = process.env.SEED_PASSWORD ?? "BelloAcademy!2026";
const DEMO_SLUG = "academie-bello";
const DEMO_EMAIL_DOMAIN = "belloacademy.tn";

/**
 * Garde-fou de production.
 *
 * Le seed de démonstration crée des comptes à mot de passe connu et affiche ce
 * mot de passe dans les journaux. C'est acceptable en développement, jamais en
 * production : il faut alors une autorisation explicite, ou se limiter à
 * l'amorçage du superadministrateur.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ALLOW_DEMO_DATA = process.env.SEED_ALLOW_DEMO_DATA === "true";
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase() || null;
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || null;

type SeededUser = { id: string; email: string };

/**
 * Identifiant stable dérivé d'une chaîne : le seed reste idempotent sans
 * dépendre d'un identifiant aléatoire. La valeur produite est un UUID valide
 * (version 4, variante RFC 4122), compatible avec les colonnes `uuid`.
 */
function stableUuid(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16) as Uint8Array;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function daysFromNow(days: number, hours = 0): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000);
}

async function upsertUser(input: {
  email: string;
  name: string;
  isSuperAdmin?: boolean;
  emailVerified?: boolean;
}): Promise<SeededUser> {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prismaPlatform.user.upsert({
    where: { email: input.email },
    update: { name: input.name },
    create: {
      email: input.email,
      name: input.name,
      passwordHash,
      locale: "fr",
      timezone: "Africa/Tunis",
      isSuperAdmin: input.isSuperAdmin ?? false,
      status: "ACTIVE",
      emailVerifiedAt: input.emailVerified === false ? null : new Date(),
    },
    select: { id: true, email: true },
  });
  return user;
}

async function upsertPlans(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    await prismaPlatform.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description ?? null,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceYearlyCents: plan.priceYearlyCents,
        currency: plan.currency,
        trialDays: plan.trialDays,
        features: plan.features,
        limits: plan.limits,
        sortOrder: plan.sortOrder,
        isActive: true,
        isPublic: true,
      },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description ?? null,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceYearlyCents: plan.priceYearlyCents,
        currency: plan.currency,
        trialDays: plan.trialDays,
        features: plan.features,
        limits: plan.limits,
        sortOrder: plan.sortOrder,
      },
    });
  }
}

/**
 * Amorçage minimal en production : crée (ou promeut) le superadministrateur à
 * partir des variables d'environnement, sans aucune donnée de démonstration.
 */
async function bootstrapSuperAdmin(): Promise<void> {
  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    throw new Error(
      "Production : renseignez SEED_SUPER_ADMIN_EMAIL et SEED_SUPER_ADMIN_PASSWORD, " +
        "ou définissez SEED_ALLOW_DEMO_DATA=true pour créer explicitement les données de démonstration.",
    );
  }

  const policy = checkPasswordPolicy(SUPER_ADMIN_PASSWORD);
  if (!policy.ok) {
    throw new Error(`SEED_SUPER_ADMIN_PASSWORD refusé : ${policy.reasons.join(" ")}`);
  }

  const passwordHash = await hashPassword(SUPER_ADMIN_PASSWORD);
  const admin = await prismaPlatform.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { isSuperAdmin: true, status: "ACTIVE" },
    create: {
      email: SUPER_ADMIN_EMAIL,
      name: "Superadministrateur",
      passwordHash,
      locale: "fr",
      timezone: "Africa/Tunis",
      isSuperAdmin: true,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
    select: { email: true },
  });

  console.info("Forfaits et superadministrateur amorcés (aucune donnée de démonstration).");
  console.info(`  Superadministrateur : ${admin.email}`);
}

async function main(): Promise<void> {
  // En production, ni comptes de démonstration ni mot de passe affiché.
  if (IS_PRODUCTION && !ALLOW_DEMO_DATA) {
    console.info("→ Forfaits");
    await upsertPlans();
    await bootstrapSuperAdmin();
    return;
  }

  console.info("→ Forfaits");
  await upsertPlans();

  console.info("→ Comptes");
  const superAdmin = await upsertUser({
    email: `superadmin@${DEMO_EMAIL_DOMAIN}`,
    name: "Samira Ben Ammar",
    isSuperAdmin: true,
  });
  const orgAdmin = await upsertUser({
    email: `direction@${DEMO_EMAIL_DOMAIN}`,
    name: "Karim Belloumi",
  });
  const instructor = await upsertUser({
    email: `formateur@${DEMO_EMAIL_DOMAIN}`,
    name: "Nadia Trabelsi",
  });
  const learner = await upsertUser({
    email: `apprenant@${DEMO_EMAIL_DOMAIN}`,
    name: "Yassine Gharbi",
  });
  const learnerTwo = await upsertUser({
    email: `apprenante2@${DEMO_EMAIL_DOMAIN}`,
    name: "Ines Mansouri",
  });
  const billingManager = await upsertUser({
    email: `facturation@${DEMO_EMAIL_DOMAIN}`,
    name: "Hatem Zaidi",
  });

  console.info("→ Organisation de démonstration");
  const organization = await prismaPlatform.organization.upsert({
    where: { slug: DEMO_SLUG },
    update: { name: "Académie Bello" },
    create: {
      slug: DEMO_SLUG,
      name: "Académie Bello",
      legalName: "Académie Bello SARL",
      billingEmail: `facturation@${DEMO_EMAIL_DOMAIN}`,
      country: "TN",
      timezone: "Africa/Tunis",
      currency: "TND",
      locale: "fr",
      settings: resolveOrganizationSettings({
        allowSelfRegistration: true,
        requireEmailVerification: false,
        defaultCourseLanguage: "fr",
      }),
      trialEndsAt: daysFromNow(14),
    },
    select: { id: true, slug: true },
  });

  const membershipData = [
    { user: orgAdmin, role: "ORG_ADMIN" as const, title: "Directeur" },
    { user: instructor, role: "INSTRUCTOR" as const, title: "Formatrice" },
    { user: billingManager, role: "BILLING_MANAGER" as const, title: "Responsable facturation" },
    { user: learner, role: "LEARNER" as const, title: null },
    { user: learnerTwo, role: "LEARNER" as const, title: null },
  ];
  for (const entry of membershipData) {
    await prismaPlatform.membership.upsert({
      where: {
        userId_organizationId: { userId: entry.user.id, organizationId: organization.id },
      },
      update: { role: entry.role, status: "ACTIVE" },
      create: {
        userId: entry.user.id,
        organizationId: organization.id,
        role: entry.role,
        status: "ACTIVE",
        title: entry.title,
        joinedAt: new Date(),
      },
    });
  }

  console.info("→ Abonnement (essai)");
  const starterPlan = await prismaPlatform.plan.findUniqueOrThrow({ where: { code: "starter" } });
  const existingSubscription = await prismaPlatform.subscription.findFirst({
    where: { organizationId: organization.id },
    select: { id: true },
  });
  if (!existingSubscription) {
    await prismaPlatform.subscription.create({
      data: {
        organizationId: organization.id,
        planId: starterPlan.id,
        provider: "MOCK",
        status: "TRIALING",
        interval: "monthly",
        currentPeriodStart: new Date(),
        currentPeriodEnd: daysFromNow(30),
        trialEndsAt: daysFromNow(14),
      },
    });
  }
  await prismaPlatform.organization.update({
    where: { id: organization.id },
    data: { planId: starterPlan.id },
  });

  console.info("→ Catégories");
  const categories = [
    { slug: "developpement-web", name: "Développement web", position: 0 },
    { slug: "data-ia", name: "Data et intelligence artificielle", position: 1 },
    { slug: "entrepreneuriat", name: "Entrepreneuriat", position: 2 },
  ];
  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    const row = await prismaPlatform.category.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug: category.slug } },
      update: { name: category.name, position: category.position },
      create: {
        organizationId: organization.id,
        slug: category.slug,
        name: category.name,
        position: category.position,
      },
      select: { id: true, slug: true },
    });
    categoryIds.set(row.slug, row.id);
  }

  console.info("→ Formations");
  const webCourse = await prismaPlatform.course.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "nextjs-production" } },
    update: { status: "PUBLISHED" },
    create: {
      organizationId: organization.id,
      slug: "nextjs-production",
      title: "Développer une application Next.js prête pour la production",
      subtitle: "App Router, authentification, base de données et déploiement",
      description:
        "Une formation complète pour construire une application Next.js robuste : structure App Router, validation des entrées, authentification par sessions, accès aux données, tests et mise en production.",
      instructorId: instructor.id,
      createdById: instructor.id,
      categoryId: categoryIds.get("developpement-web") ?? null,
      level: "INTERMEDIATE",
      language: "fr",
      objectives: [
        "Structurer une application App Router maintenable",
        "Sécuriser les routes et valider les entrées",
        "Mettre en place authentification et autorisations",
        "Déployer avec migrations et supervision",
      ],
      prerequisites: ["Bases de JavaScript et TypeScript", "Notions de React"],
      durationMinutes: 480,
      priceCents: 0,
      currency: "TND",
      status: "PUBLISHED",
      certificateEnabled: true,
      certificateMinScore: 70,
      publishedAt: daysFromNow(-30),
    },
    select: { id: true, slug: true, title: true },
  });

  const dataCourse = await prismaPlatform.course.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "python-data-analyse" } },
    update: { status: "PUBLISHED" },
    create: {
      organizationId: organization.id,
      slug: "python-data-analyse",
      title: "Analyse de données avec Python",
      subtitle: "Pandas, visualisation et restitution de résultats",
      description:
        "Apprenez à charger, nettoyer, analyser et visualiser des données avec Python, puis à restituer vos résultats dans un rapport clair et reproductible.",
      instructorId: instructor.id,
      createdById: instructor.id,
      categoryId: categoryIds.get("data-ia") ?? null,
      level: "BEGINNER",
      language: "fr",
      objectives: [
        "Manipuler des jeux de données avec pandas",
        "Produire des graphiques lisibles",
        "Automatiser un rapport reproductible",
      ],
      prerequisites: ["Aucun prérequis technique"],
      durationMinutes: 300,
      priceCents: 19900,
      currency: "TND",
      status: "PUBLISHED",
      certificateEnabled: true,
      certificateMinScore: 60,
      publishedAt: daysFromNow(-12),
    },
    select: { id: true, slug: true, title: true },
  });

  const draftCourse = await prismaPlatform.course.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "entreprendre-en-tunisie" } },
    update: {},
    create: {
      organizationId: organization.id,
      slug: "entreprendre-en-tunisie",
      title: "Entreprendre en Tunisie : de l'idée au marché",
      subtitle: "Brouillon en préparation",
      description:
        "Parcours en cours de rédaction : cadrage du projet, statut juridique, financement et premiers clients.",
      instructorId: instructor.id,
      createdById: instructor.id,
      categoryId: categoryIds.get("entrepreneuriat") ?? null,
      level: "BEGINNER",
      language: "fr",
      objectives: ["Cadrer une idée de projet"],
      prerequisites: [],
      durationMinutes: 180,
      priceCents: 0,
      currency: "TND",
      status: "DRAFT",
    },
    select: { id: true, slug: true },
  });

  console.info("→ Programme, leçons et ressources");
  const curriculum: {
    courseId: string;
    sections: {
      title: string;
      summary: string;
      lessons: {
        title: string;
        type: "VIDEO" | "TEXT" | "DOCUMENT" | "FILE" | "LINK";
        contentMd?: string;
        videoUrl?: string;
        externalUrl?: string;
        durationSeconds?: number;
        isPreview?: boolean;
      }[];
    }[];
  }[] = [
    {
      courseId: webCourse.id,
      sections: [
        {
          title: "Bien démarrer",
          summary: "Comprendre la structure d'un projet App Router.",
          lessons: [
            {
              title: "Présentation de la formation",
              type: "VIDEO",
              videoUrl: "https://example.org/videos/nextjs-presentation.mp4",
              durationSeconds: 420,
              isPreview: true,
            },
            {
              title: "Structure d'un projet App Router",
              type: "TEXT",
              contentMd:
                "## Organisation des dossiers\n\nLe dossier `app` décrit les routes, `components` les briques d'interface et `lib` les utilitaires. Chaque route peut définir `page.tsx`, `layout.tsx` et des gestionnaires `route.ts`.\n\n## Règle\n\nUne page reste un composant serveur tant qu'elle n'a pas besoin d'interactivité.",
              durationSeconds: 600,
            },
          ],
        },
        {
          title: "Sécurité et données",
          summary: "Valider les entrées et contrôler les autorisations côté serveur.",
          lessons: [
            {
              title: "Valider chaque entrée",
              type: "TEXT",
              contentMd:
                "Toute donnée qui vient du navigateur est non fiable. Validez-la avec un schéma avant de l'utiliser, et renvoyez un message d'erreur exploitable.",
              durationSeconds: 540,
            },
            {
              title: "Autorisations côté serveur",
              type: "VIDEO",
              videoUrl: "https://example.org/videos/autorisations.mp4",
              durationSeconds: 780,
            },
          ],
        },
      ],
    },
    {
      courseId: dataCourse.id,
      sections: [
        {
          title: "Premiers pas",
          summary: "Installer l'environnement et charger un jeu de données.",
          lessons: [
            {
              title: "Installer Python et pandas",
              type: "TEXT",
              contentMd:
                "Créez un environnement virtuel, installez pandas et ouvrez un carnet de notes pour suivre les exercices.",
              durationSeconds: 480,
              isPreview: true,
            },
            {
              title: "Charger un fichier CSV",
              type: "TEXT",
              contentMd:
                "`pandas.read_csv` charge un fichier tabulaire. Vérifiez toujours les types et les valeurs manquantes juste après le chargement.",
              durationSeconds: 600,
            },
          ],
        },
      ],
    },
  ];

  for (const course of curriculum) {
    for (const [sectionIndex, section] of course.sections.entries()) {
      const sectionRow = await prismaPlatform.section.upsert({
        where: { id: stableUuid(`section:${course.courseId}:${sectionIndex}`) },
        update: { title: section.title, summary: section.summary, position: sectionIndex },
        create: {
          id: stableUuid(`section:${course.courseId}:${sectionIndex}`),
          organizationId: organization.id,
          courseId: course.courseId,
          title: section.title,
          summary: section.summary,
          position: sectionIndex,
        },
        select: { id: true },
      });

      for (const [lessonIndex, lesson] of section.lessons.entries()) {
        await prismaPlatform.lesson.upsert({
          where: { id: stableUuid(`lesson:${course.courseId}:${sectionIndex}:${lessonIndex}`) },
          update: { title: lesson.title, position: lessonIndex },
          create: {
            id: stableUuid(`lesson:${course.courseId}:${sectionIndex}:${lessonIndex}`),
            organizationId: organization.id,
            sectionId: sectionRow.id,
            courseId: course.courseId,
            title: lesson.title,
            type: lesson.type,
            contentMd: lesson.contentMd ?? null,
            videoUrl: lesson.videoUrl ?? null,
            videoProvider: lesson.videoUrl ? "external" : null,
            externalUrl: lesson.externalUrl ?? null,
            durationSeconds: lesson.durationSeconds ?? null,
            position: lessonIndex,
            isPreview: lesson.isPreview ?? false,
            isPublished: true,
          },
        });
      }
    }
  }

  const firstLesson = await prismaPlatform.lesson.findFirstOrThrow({
    where: { courseId: webCourse.id },
    orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
    select: { id: true, title: true },
  });

  const resource = await prismaPlatform.asset.upsert({
    where: { id: stableUuid(`asset:${organization.id}:support`) },
    update: {},
    create: {
      id: stableUuid(`asset:${organization.id}:support`),
      organizationId: organization.id,
      uploaderId: instructor.id,
      driver: "local",
      bucket: "belloacademy",
      objectKey: `${organization.id}/lessons/support-formation.md`,
      filename: "support-formation.md",
      mimeType: "text/markdown",
      sizeBytes: 2048,
      visibility: "PRIVATE",
    },
    select: { id: true },
  });
  await prismaPlatform.lessonResource.upsert({
    where: { id: stableUuid(`resource:${firstLesson.id}:0`) },
    update: {},
    create: {
      id: stableUuid(`resource:${firstLesson.id}:0`),
      organizationId: organization.id,
      lessonId: firstLesson.id,
      assetId: resource.id,
      title: "Support écrit de la leçon",
      position: 0,
    },
  });

  console.info("→ Quiz et devoir");
  const quiz = await prismaPlatform.quiz.upsert({
    where: { id: stableUuid(`quiz:${webCourse.id}`) },
    update: { isPublished: true },
    create: {
      id: stableUuid(`quiz:${webCourse.id}`),
      organizationId: organization.id,
      courseId: webCourse.id,
      lessonId: firstLesson.id,
      title: "Évaluation — bases de Next.js",
      description: "Vérifiez votre compréhension de la structure d'un projet et des bonnes pratiques.",
      passingScore: 70,
      maxAttempts: 3,
      timeLimitMinutes: 20,
      isPublished: true,
    },
    select: { id: true },
  });

  const questions = [
    {
      position: 0,
      type: "SINGLE_CHOICE" as const,
      prompt: "Quel fichier définit le contenu d'une route dans l'App Router ?",
      explanation: "`page.tsx` décrit le contenu d'une route ; `layout.tsx` en décrit l'ossature.",
      points: 1,
      options: [
        { label: "page.tsx", isCorrect: true },
        { label: "route.tsx", isCorrect: false },
        { label: "index.html", isCorrect: false },
      ],
    },
    {
      position: 1,
      type: "TRUE_FALSE" as const,
      prompt: "Les données envoyées par le navigateur peuvent être utilisées sans validation.",
      explanation: "Toute entrée externe doit être validée côté serveur.",
      points: 1,
      options: [
        { label: "Vrai", isCorrect: false },
        { label: "Faux", isCorrect: true },
      ],
    },
    {
      position: 2,
      type: "SHORT_ANSWER" as const,
      prompt: "Quel mécanisme PostgreSQL restreint l'accès aux lignes d'une table par organisation ?",
      explanation: "Les politiques de sécurité au niveau des lignes (RLS).",
      points: 2,
      acceptedAnswers: ["RLS", "row level security", "row-level security", "securite au niveau des lignes"],
      options: [],
    },
  ];

  for (const question of questions) {
    const questionId = stableUuid(`question:${quiz.id}:${question.position}`);
    await prismaPlatform.question.upsert({
      where: { id: questionId },
      update: { prompt: question.prompt, points: question.points },
      create: {
        id: questionId,
        organizationId: organization.id,
        quizId: quiz.id,
        type: question.type,
        prompt: question.prompt,
        explanation: question.explanation,
        points: question.points,
        position: question.position,
        acceptedAnswers: question.acceptedAnswers ?? [],
      },
    });
    for (const [optionIndex, option] of question.options.entries()) {
      await prismaPlatform.questionOption.upsert({
        where: { id: stableUuid(`option:${questionId}:${optionIndex}`) },
        update: { label: option.label, isCorrect: option.isCorrect },
        create: {
          id: stableUuid(`option:${questionId}:${optionIndex}`),
          organizationId: organization.id,
          questionId,
          label: option.label,
          isCorrect: option.isCorrect,
          position: optionIndex,
        },
      });
    }
  }

  await prismaPlatform.assignment.upsert({
    where: { id: stableUuid(`assignment:${webCourse.id}`) },
    update: { isPublished: true },
    create: {
      id: stableUuid(`assignment:${webCourse.id}`),
      organizationId: organization.id,
      courseId: webCourse.id,
      title: "Devoir — structurer une application",
      instructionsMd:
        "Décrivez la structure de dossiers de votre application, justifiez le découpage et déposez un document ou une archive de votre projet.",
      maxScore: 100,
      dueAt: daysFromNow(10),
      allowLate: true,
      isPublished: true,
    },
  });

  console.info("→ Classe virtuelle");
  const roomName = `belloacademy-${webCourse.slug}-demo`;
  await prismaPlatform.liveSession.upsert({
    where: { roomName },
    update: { scheduledStart: daysFromNow(2, 3), scheduledEnd: daysFromNow(2, 4) },
    create: {
      organizationId: organization.id,
      courseId: webCourse.id,
      hostUserId: instructor.id,
      createdById: instructor.id,
      title: "Atelier en direct — structurer son application",
      description: "Session de questions-réponses et revue de code en direct.",
      roomName,
      provider: "jitsi",
      jitsiDomain: process.env.JITSI_DOMAIN ?? "meet.jit.si",
      status: "SCHEDULED",
      scheduledStart: daysFromNow(2, 3),
      scheduledEnd: daysFromNow(2, 4),
      timezone: "Africa/Tunis",
    },
  });

  console.info("→ Inscriptions et progression");
  const enrollment = await prismaPlatform.enrollment.upsert({
    where: { courseId_userId: { courseId: webCourse.id, userId: learner.id } },
    update: { status: "ACTIVE" },
    create: {
      organizationId: organization.id,
      courseId: webCourse.id,
      userId: learner.id,
      status: "ACTIVE",
      progressPercent: 0,
      source: "self",
      enrolledAt: daysFromNow(-7),
      lastAccessedAt: daysFromNow(-1),
    },
    select: { id: true },
  });

  const lessons = await prismaPlatform.lesson.findMany({
    where: { courseId: webCourse.id },
    orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
    select: { id: true },
  });
  const completed = lessons.slice(0, 1);
  for (const lesson of completed) {
    await prismaPlatform.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
      update: { completedAt: new Date() },
      create: {
        organizationId: organization.id,
        enrollmentId: enrollment.id,
        lessonId: lesson.id,
        userId: learner.id,
        completedAt: new Date(),
        positionSeconds: 0,
      },
    });
  }
  const percent = lessons.length > 0 ? Math.round((completed.length / lessons.length) * 100) : 0;
  await prismaPlatform.enrollment.update({
    where: { id: enrollment.id },
    data: { progressPercent: percent },
  });

  // Deuxième apprenant : parcours terminé, ce qui rend le certificat cohérent
  // (un certificat n'est jamais émis pour une formation non suivie).
  const completedEnrollment = await prismaPlatform.enrollment.upsert({
    where: { courseId_userId: { courseId: dataCourse.id, userId: learnerTwo.id } },
    update: { status: "COMPLETED", progressPercent: 100 },
    create: {
      organizationId: organization.id,
      courseId: dataCourse.id,
      userId: learnerTwo.id,
      status: "COMPLETED",
      progressPercent: 100,
      source: "self",
      enrolledAt: daysFromNow(-30),
      lastAccessedAt: daysFromNow(-5),
      completedAt: daysFromNow(-5),
    },
    select: { id: true },
  });
  const dataLessons = await prismaPlatform.lesson.findMany({
    where: { courseId: dataCourse.id },
    select: { id: true },
  });
  for (const lesson of dataLessons) {
    await prismaPlatform.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: completedEnrollment.id, lessonId: lesson.id } },
      update: { completedAt: daysFromNow(-5) },
      create: {
        organizationId: organization.id,
        enrollmentId: completedEnrollment.id,
        lessonId: lesson.id,
        userId: learnerTwo.id,
        completedAt: daysFromNow(-5),
        positionSeconds: 0,
      },
    });
  }

  console.info("→ Certificat vérifiable");
  const existingCertificate = await prismaPlatform.certificate.findFirst({
    where: { courseId: dataCourse.id, userId: learnerTwo.id },
    select: { id: true, verificationCode: true, serial: true },
  });
  if (!existingCertificate) {
    const year = new Date().getUTCFullYear();
    await prismaPlatform.certificate.create({
      data: {
        organizationId: organization.id,
        courseId: dataCourse.id,
        userId: learnerTwo.id,
        serial: `BA-${year}-0001`,
        verificationCode: "demo-verification-0001",
        finalScore: 88,
        issuedAt: daysFromNow(-5),
        metadata: { demo: true },
      },
    });
  }

  console.info("→ Notifications");
  await prismaPlatform.notification.upsert({
    where: { id: stableUuid(`notification:${learner.id}:welcome`) },
    update: {},
    create: {
      id: stableUuid(`notification:${learner.id}:welcome`),
      userId: learner.id,
      organizationId: organization.id,
      type: "SYSTEM",
      title: "Bienvenue sur BelloAcademy",
      body: "Votre compte est actif. Explorez le catalogue et inscrivez-vous à une formation.",
      href: "/formations",
    },
  });
  await prismaPlatform.notification.upsert({
    where: { id: stableUuid(`notification:${learner.id}:live-reminder`) },
    update: {},
    create: {
      id: stableUuid(`notification:${learner.id}:live-reminder`),
      userId: learner.id,
      organizationId: organization.id,
      type: "LIVE_SESSION_REMINDER",
      title: "Classe virtuelle à venir",
      body: "Atelier en direct — structurer son application, dans deux jours.",
      href: "/tableau-de-bord/classes-virtuelles",
    },
  });

  console.info("");
  console.info("Données de démonstration prêtes.");
  console.info(`  Superadministrateur : ${superAdmin.email}`);
  console.info(`  Administrateur      : ${orgAdmin.email}`);
  console.info(`  Formateur           : ${instructor.email}`);
  console.info(`  Apprenant           : ${learner.email}`);
  console.info(`  Organisation        : ${organization.slug}`);
  console.info(`  Formation payante   : /formations/${dataCourse.slug}`);
  console.info(`  Brouillon           : /formations/${draftCourse.slug} (non publié)`);
  console.info(`  Mot de passe        : ${PASSWORD}`);
  console.info("");
}

main()
  .then(async () => {
    await prismaPlatform.$disconnect();
  })
  .catch(async (error) => {
    console.error("Échec du seed :", error);
    await prismaPlatform.$disconnect();
    process.exit(1);
  });
