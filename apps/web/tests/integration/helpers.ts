/**
 * Utilitaires communs aux tests d'intégration.
 *
 * Deux clients coexistent volontairement :
 *  - `ownerPrisma` : rôle propriétaire, utilisé uniquement pour préparer et
 *    nettoyer la base de test (aucun test métier ne passe par lui) ;
 *  - les services applicatifs : rôle applicatif soumis aux politiques RLS, ce
 *    qui permet de vérifier l'isolation réelle entre organisations.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_PLANS, type PlanMetric } from "@belloacademy/shared";

import { PrismaClient } from "@/generated/prisma/client";
import { register } from "@/server/services/accounts";
import { createOrganization } from "@/server/services/organizations";
import { createCourse, createLesson, createSection, publishCourse, updateLesson } from "@/server/services/courses";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable ${name} absente pour les tests d'intégration.`);
  return value;
}

/** Client « propriétaire » : sert au nettoyage et aux fixtures, jamais aux assertions. */
export const ownerPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv("TEST_MIGRATE_DATABASE_URL") }),
});

/** Vide toutes les tables (sauf l'historique de migrations) avant chaque suite. */
export async function resetDatabase(): Promise<void> {
  const tables = await ownerPrisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  await ownerPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Référentiel de forfaits (le seed de démonstration n'est pas exécuté ici). */
export async function seedPlans(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    await ownerPrisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceYearlyCents: plan.priceYearlyCents,
        trialDays: plan.trialDays,
        features: plan.features,
        limits: plan.limits,
      },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description ?? null,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceYearlyCents: plan.priceYearlyCents,
        currency: plan.currency,
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
        features: plan.features,
        limits: plan.limits,
      },
    });
  }
}

let userCounter = 0;

/** Crée un compte par le service d'inscription réel (mot de passe haché). */
export async function createUser(prefix: string): Promise<{ id: string; email: string; name: string }> {
  userCounter += 1;
  const email = `${prefix}-${userCounter}@test.belloacademy.tn`;
  const user = await register({
    name: `Utilisateur ${prefix} ${userCounter}`,
    email,
    password: "MotDePasseTest!2026",
    locale: "fr",
  });
  return { id: user.id, email: user.email, name: user.name };
}

/** Organisation neuve rattachée à son administrateur. */
export async function createTenant(prefix: string, planCode = "business") {
  const admin = await createUser(`${prefix}-admin`);
  const organization = await createOrganization({
    name: `Organisation ${prefix}`,
    slug: `${prefix}-${userCounter}`,
    ownerUserId: admin.id,
    planCode,
  });
  return { organization, admin };
}
/**
 * Rattache un compte existant à une organisation avec un rôle actif.
 *
 * Passe par le client « propriétaire » : l'objectif du test est de préparer un
 * état de départ, pas de vérifier le parcours d'invitation (couvert ailleurs).
 */
export async function addMember(
  organizationId: string,
  userId: string,
  role: "ORG_ADMIN" | "INSTRUCTOR" | "LEARNER" | "BILLING_MANAGER" = "LEARNER",
) {
  return ownerPrisma.membership.create({
    data: { organizationId, userId, role, status: "ACTIVE" },
  });
}

/** Crée un apprenant rattaché à une organisation. */
export async function createLearner(
  tenant: { organization: { id: string } },
  prefix = "apprenant",
): Promise<{ id: string; email: string; name: string }> {
  const user = await createUser(prefix);
  await addMember(tenant.organization.id, user.id, "LEARNER");
  return user;
}

/** Fixe une limite de forfait directement en base (test des quotas). */
export async function setPlanLimits(planCode: string, limits: Partial<Record<PlanMetric, number | null>>) {
  await ownerPrisma.plan.update({ where: { code: planCode }, data: { limits } });
}

/** Formation publiée avec une section et des leçons publiées (parcours réel). */
export async function createPublishedCourse(
  tenant: { organization: { id: string }; admin: { id: string } },
  options: { title: string; priceCents?: number; lessonCount?: number; certificateEnabled?: boolean } = {
    title: "Formation de test",
  },
) {
  const course = await createCourse({
    organizationId: tenant.organization.id,
    instructorId: tenant.admin.id,
    actorUserId: tenant.admin.id,
    title: options.title,
    description: "Formation créée par les tests d'intégration.",
    priceCents: options.priceCents ?? 0,
    certificateEnabled: options.certificateEnabled ?? false,
  });

  const section = await createSection({
    organizationId: tenant.organization.id,
    courseId: course.id,
    title: "Section 1",
  });

  const lessonCount = options.lessonCount ?? 2;
  const lessons: Array<{ id: string }> = [];
  for (let index = 0; index < lessonCount; index += 1) {
    const lesson = await createLesson({
      organizationId: tenant.organization.id,
      courseId: course.id,
      sectionId: section.id,
      title: `Leçon ${index + 1}`,
      type: "TEXT",
      contentMd: "Contenu de la leçon.",
    });
    await updateLesson({
      organizationId: tenant.organization.id,
      lessonId: lesson.id,
      data: { isPublished: true },
    });
    lessons.push(lesson);
  }

  await publishCourse({
    organizationId: tenant.organization.id,
    courseId: course.id,
    actorUserId: tenant.admin.id,
  });

  return { course, section, lessons };
}

export async function closeTestDatabase(): Promise<void> {
  await ownerPrisma.$disconnect();
}
