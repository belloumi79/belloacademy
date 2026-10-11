/**
 * Parcours critiques de bout en bout (HTTP réel).
 *
 * Complète les tests d'intégration : ceux-ci appellent les services directement,
 * ce script vérifie ce que voit réellement un client — cookies de session, jeton
 * CSRF, codes de statut HTTP, redirections et refus d'autorisation.
 *
 * Prérequis : un serveur BelloAcademy démarré (`pnpm dev` ou `pnpm start`) et une
 * base migrée. La cible est lue dans `E2E_BASE_URL` (défaut : APP_URL).
 *
 * Usage :
 *   pnpm test:e2e              exécute les parcours puis nettoie ses propres données
 *   pnpm test:e2e -- --purge   supprime les résidus `e2e-*` d'exécutions interrompues
 */

import "dotenv/config";

import { env } from "../src/env";
import { prismaPlatform } from "../src/lib/db/prisma";

const BASE_URL = (process.env.E2E_BASE_URL ?? env().APP_URL).replace(/\/+$/, "");
const RUN_ID = Math.random().toString(36).slice(2, 10);
const PASSWORD = "MotDePasseE2E!2026";

/**
 * Identifiants créés par cette exécution. Ils servent au nettoyage final : seules
 * les lignes portant EXACTEMENT ces valeurs sont supprimées, jamais autre chose.
 */
const CREATED = {
  organizationSlugs: [`e2e-${RUN_ID}`, `e2e-autre-${RUN_ID}`],
  emails: [`e2e-owner-${RUN_ID}@example.test`, `e2e-other-${RUN_ID}@example.test`],
};

/**
 * Supprime les organisations et comptes créés par ce passage.
 *
 * Toutes les relations filles (appartenances, abonnements, cours, journaux...)
 * sont en `onDelete: Cascade` sur `Organization` : supprimer l'organisation
 * suffit. Sans ce nettoyage, chaque exécution laisserait des organisations
 * `e2e-*` dans la base visée.
 */
async function cleanup(): Promise<void> {
  try {
    const organizations = await prismaPlatform.organization.deleteMany({
      where: { slug: { in: CREATED.organizationSlugs } },
    });
    const users = await prismaPlatform.user.deleteMany({
      where: { email: { in: CREATED.emails } },
    });
    console.log(
      `\nNettoyage : ${organizations.count} organisation(s) et ${users.count} compte(s) de test supprimés.`,
    );
  } catch (error) {
    console.warn(
      "Nettoyage impossible (données de test conservées) :",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await prismaPlatform.$disconnect();
  }
}

/**
 * Purge les résidus d'exécutions interrompues (avant que le nettoyage final
 * n'existe, ou après un plantage). Le filtre est strictement limité aux
 * organisations `e2e-*` et aux comptes `e2e-*@example.test` : aucune donnée
 * réelle ne peut correspondre à ces motifs.
 */
async function purgeStaleData(): Promise<void> {
  const organizations = await prismaPlatform.organization.deleteMany({
    where: { slug: { startsWith: "e2e-" } },
  });
  const users = await prismaPlatform.user.deleteMany({
    where: { email: { startsWith: "e2e-", endsWith: "@example.test" } },
  });
  console.log(
    `Purge : ${organizations.count} organisation(s) et ${users.count} compte(s) résiduels supprimés.`,
  );
  await prismaPlatform.$disconnect();
}

type Check = { name: string; ok: boolean; detail?: string };

const results: Check[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, ...(detail ? { detail } : {}) });
  const icon = ok ? "✓" : "✗";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

function assert(name: string, condition: boolean, detail?: string): void {
  record(name, condition, detail);
}

/**
 * Client HTTP minimal conservant les cookies entre les appels, à la manière d'un
 * navigateur : sans cela, le jeton CSRF (cookie non httpOnly) ne serait jamais
 * renvoyé et toutes les mutations seraient rejetées.
 */
class Session {
  private readonly cookies = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private store(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; json: unknown; text: string; location: string | null }> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      accept: "application/json",
      ...options.headers,
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    if (method !== "GET") {
      headers["content-type"] = "application/json";
      // N'injecte le jeton que si l'appelant ne s'est pas prononcé : un test qui
      // envoie explicitement un en-tête vide doit réellement partir sans jeton,
      // sinon la vérification CSRF serait contournée par le client de test.
      if (!("x-csrf-token" in headers)) {
        const csrf = this.cookies.get("belloacademy_csrf");
        if (csrf) headers["x-csrf-token"] = csrf;
      }
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      redirect: "manual",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    this.store(response);

    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return {
      status: response.status,
      json,
      text,
      location: response.headers.get("location"),
    };
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--purge")) {
    await purgeStaleData();
    return;
  }

  console.log(`\nParcours critiques BelloAcademy sur ${BASE_URL}\n`);

  // 1. Sonde de disponibilité.
  const anonymous = new Session();
  const health = await anonymous.request("/api/health");
  assert(
    "la sonde /api/health répond",
    health.status === 200 || health.status === 503,
    `statut ${health.status}`,
  );

  // 2. Catalogue public accessible sans session.
  const catalog = await anonymous.request("/api/courses?pageSize=5");
  assert("le catalogue public est lisible sans authentification", catalog.status === 200, `statut ${catalog.status}`);

  // 3. Une route protégée refuse l'accès anonyme.
  const protectedRoute = await anonymous.request("/api/me");
  assert(
    "une route protégée refuse un visiteur anonyme",
    protectedRoute.status === 401 || protectedRoute.status === 403,
    `statut ${protectedRoute.status}`,
  );

  // 4. Inscription : crée l'utilisateur, la session et le jeton CSRF.
  const owner = new Session();
  const email = `e2e-owner-${RUN_ID}@example.test`;
  const registration = await owner.request("/api/auth/register", {
    method: "POST",
    body: {
      name: `E2E Owner ${RUN_ID}`,
      email,
      password: PASSWORD,
      locale: "fr",
      organizationName: `E2E Organisation ${RUN_ID}`,
      organizationSlug: `e2e-${RUN_ID}`,
    },
  });
  assert("un nouvel utilisateur peut créer un compte", registration.status === 201, `statut ${registration.status}`);

  const session = await owner.request("/api/auth/session");
  const authenticated = (session.json as { authenticated?: boolean } | null)?.authenticated === true;
  assert("la session est active après l'inscription", authenticated, `statut ${session.status}`);

  // 5. Les données privées sont accessibles au propriétaire.
  const me = await owner.request("/api/me");
  assert("le profil du titulaire est lisible", me.status === 200, `statut ${me.status}`);

  // 5 bis. Chaîne de contenu : création, programme, publication.
  const courseTitle = `Formation E2E ${RUN_ID}`;
  const createdCourse = await owner.request("/api/courses", {
    method: "POST",
    body: {
      title: courseTitle,
      description: "Formation créée par le parcours de vérification.",
      level: "BEGINNER",
      language: "fr",
      priceCents: 0,
    },
  });
  const courseBody = createdCourse.json as { course?: { id?: string; slug?: string } } | null;
  const courseId = courseBody?.course?.id ?? "";
  const courseSlug = courseBody?.course?.slug ?? "";
  assert("un formateur peut créer une formation", createdCourse.status === 201 && Boolean(courseId), `statut ${createdCourse.status}`);

  const createdSection = await owner.request(`/api/courses/${courseId}/sections`, {
    method: "POST",
    body: { title: "Section de vérification" },
  });
  const sectionId = (createdSection.json as { section?: { id?: string } } | null)?.section?.id ?? "";
  assert("une section peut être ajoutée", createdSection.status === 201 && Boolean(sectionId), `statut ${createdSection.status}`);

  const createdLesson = await owner.request(`/api/courses/${courseId}/lessons`, {
    method: "POST",
    body: { sectionId, title: "Leçon de vérification", type: "TEXT", contentMd: "Contenu de vérification." },
  });
  const lessonId = (createdLesson.json as { lesson?: { id?: string } } | null)?.lesson?.id ?? "";
  assert("une leçon peut être ajoutée", createdLesson.status === 201 && Boolean(lessonId), `statut ${createdLesson.status}`);

  const publishedLesson = await owner.request(`/api/courses/${courseId}/lessons/${lessonId}`, {
    method: "PATCH",
    body: { isPublished: true },
  });
  assert("une leçon peut être publiée", publishedLesson.status === 200, `statut ${publishedLesson.status}`);

  const publishedCourse = await owner.request(`/api/courses/${courseId}/publish`, { method: "POST", body: {} });
  assert(
    "une formation dotée d'une leçon publiée peut être publiée",
    publishedCourse.status === 200,
    `statut ${publishedCourse.status}`,
  );

  // Recherche ciblée : le catalogue plafonne `pageSize` à 48, une recherche par
  // titre unique évite de dépendre du nombre total de formations en base.
  const catalogAfterPublish = await anonymous.request(
    `/api/courses?pageSize=48&search=${encodeURIComponent(courseTitle)}`,
  );
  const catalogSlugs = ((catalogAfterPublish.json as { items?: { slug?: string }[] } | null)?.items ?? []).map(
    (entry) => entry.slug,
  );
  assert(
    "la formation publiée apparaît au catalogue public",
    catalogAfterPublish.status === 200 && catalogSlugs.includes(courseSlug),
    `statut ${catalogAfterPublish.status}`,
  );

  // 6. La CSRF est bien exigée : même session, sans en-tête CSRF.
  const noCsrf = await owner.request("/api/auth/logout", {
    method: "POST",
    headers: { "x-csrf-token": "" },
    body: {},
  });
  assert(
    "une mutation sans jeton CSRF est rejetée",
    noCsrf.status === 403 || noCsrf.status === 400,
    `statut ${noCsrf.status}`,
  );

  // 7. Second compte, dans une autre organisation : isolation attendue.
  const other = new Session();
  const otherRegistration = await other.request("/api/auth/register", {
    method: "POST",
    body: {
      name: `E2E Other ${RUN_ID}`,
      email: `e2e-other-${RUN_ID}@example.test`,
      password: PASSWORD,
      locale: "fr",
      organizationName: `E2E Autre ${RUN_ID}`,
      organizationSlug: `e2e-autre-${RUN_ID}`,
    },
  });
  assert(
    "un second compte peut être créé dans une autre organisation",
    otherRegistration.status === 201,
    `statut ${otherRegistration.status}`,
  );

  // 8. Tentative de lecture inter-tenant en forçant l'en-tête d'organisation.
  const otherSession = await other.request("/api/auth/session");
  const otherMemberships = (otherSession.json as { memberships?: { organizationId: string }[] } | null)?.memberships ?? [];
  const ownerSession = await owner.request("/api/auth/session");
  const ownerMemberships = (ownerSession.json as { memberships?: { organizationId: string }[] } | null)?.memberships ?? [];

  if (ownerMemberships[0] && otherMemberships[0]) {
    const crossTenant = await other.request("/api/organizations/" + ownerMemberships[0].organizationId + "/members", {
      headers: { "x-organization-id": ownerMemberships[0].organizationId },
    });
    assert(
      "un tenant ne peut pas lire les membres d'un autre tenant",
      crossTenant.status === 403 || crossTenant.status === 404,
      `statut ${crossTenant.status}`,
    );
  } else {
    record("un tenant ne peut pas lire les membres d'un autre tenant", false, "appartenances introuvables");
  }

  // 9. Vérification publique d'un certificat inexistant : aucune donnée fuit.
  const bogusCertificate = await anonymous.request("/api/certificates/verify/INEXISTANT-0000");
  assert(
    "la vérification d'un certificat inconnu ne divulgue rien",
    bogusCertificate.status === 404 || bogusCertificate.status === 200,
    `statut ${bogusCertificate.status}`,
  );

  // 10. Webhook de paiement : une signature invalide doit être refusée.
  const webhook = await anonymous.request("/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=deadbeef" },
    body: { id: "evt_e2e", type: "invoice.paid" },
  });
  const signatureRefused = [400, 401, 403].includes(webhook.status);
  const webhookUnconfigured = webhook.status === 503;
  assert(
    "un webhook de paiement mal signé est refusé",
    signatureRefused || webhookUnconfigured,
    webhookUnconfigured
      ? "503 : STRIPE_WEBHOOK_SECRET absent, signature non vérifiée"
      : `statut ${webhook.status}`,
  );

  // 11. Déconnexion puis perte d'accès.
  const logout = await owner.request("/api/auth/logout", { method: "POST", body: {} });
  assert("la déconnexion aboutit", logout.status === 200 || logout.status === 204, `statut ${logout.status}`);

  const afterLogout = await owner.request("/api/me");
  assert(
    "la session est close après déconnexion",
    afterLogout.status === 401 || afterLogout.status === 403,
    `statut ${afterLogout.status}`,
  );

  // 12. Limitation du débit sur la connexion.
  const bruteForce = new Session();
  let limited = false;
  for (let attempt = 0; attempt < 14 && !limited; attempt += 1) {
    const response = await bruteForce.request("/api/auth/login", {
      method: "POST",
      body: { email: `inexistant-${RUN_ID}@example.test`, password: PASSWORD },
    });
    if (response.status === 429) limited = true;
  }
  assert("les tentatives de connexion répétées sont limitées", limited, limited ? "429 reçu" : "aucun 429");

  await cleanup();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);

  if (failed.length > 0) {
    console.error("\nÉchecs :");
    for (const result of failed) console.error(` - ${result.name}${result.detail ? ` (${result.detail})` : ""}`);
    process.exitCode = 1;
  }
}

main().catch(async (error: unknown) => {
  console.error("Parcours interrompu :", error instanceof Error ? error.message : error);
  await cleanup();
  process.exitCode = 1;
});
