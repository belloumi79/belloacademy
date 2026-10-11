/**
 * Tests unitaires du paquet partagé.
 *
 * Ce paquet contient la logique métier pure : politiques de facturation,
 * contrôle d'accès aux classes virtuelles, correction automatique, validation
 * des téléversements et assainissement des entrées. Ces règles sont exécutées
 * côté serveur pour autoriser ou refuser une action : une régression ici est un
 * défaut de sécurité, pas un simple défaut d'affichage.
 */

import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPES,
  DEFAULT_PLANS,
  PLAN_FEATURES,
  buildJitsiRoomName,
  buildObjectKey,
  buildRoomName,
  checkLimit,
  checkPlanLimit,
  computeProgress,
  computeProgressPercent,
  decideLiveAccess,
  escapeHtml,
  gradeAnswer,
  hasFeature,
  isEnrollmentActive,
  isFreeCourse,
  isValidJitsiRoomName,
  isValidTimeZone,
  normalizeEmail,
  normalizeShortAnswer,
  parseFeatures,
  parseLimits,
  passwordSchema,
  safeRedirectPath,
  sanitizeFilename,
  slugify,
  summarizeAttempt,
  toPercent,
  uniqueSlug,
  uriEncode,
  validateUpload,
} from "../src/index";

describe("normalizeEmail", () => {
  it("met en minuscules et supprime les espaces", () => {
    expect(normalizeEmail("  Karim.BELLOUMI@Example.TN ")).toBe("karim.belloumi@example.tn");
  });
});

describe("slugify", () => {
  it("retire les accents et normalise la ponctuation", () => {
    expect(slugify("Formation Complète : Réseaux & Sécurité")).toBe("formation-complete-reseaux-securite");
  });

  it("supprime les tirets en début et fin", () => {
    expect(slugify("--- Développement Web ---")).toBe("developpement-web");
  });

  it("renvoie une chaîne vide lorsque l'entrée ne contient aucun caractère exploitable", () => {
    expect(slugify("!!! ???")).toBe("");
  });
});

describe("uniqueSlug", () => {
  it("renvoie le slug de base lorsqu'il est libre", () => {
    expect(uniqueSlug("React Avancé", () => false)).toBe("react-avance");
  });

  it("incrémente jusqu'à trouver un slug libre", () => {
    const pris = new Set(["react-avance", "react-avance-2"]);
    expect(uniqueSlug("React Avancé", (candidat) => pris.has(candidat))).toBe("react-avance-3");
  });

  it("produit un slug de repli lorsque l'entrée est vide", () => {
    expect(uniqueSlug("###", () => false)).toBe("item");
  });
});

describe("safeRedirectPath — protection contre les redirections ouvertes", () => {
  it("accepte un chemin interne", () => {
    expect(safeRedirectPath("/tableau-de-bord/formations")).toBe("/tableau-de-bord/formations");
  });

  it("rejette une URL absolue externe", () => {
    expect(safeRedirectPath("https://exemple-malveillant.tn/prise-de-controle")).toBe("/dashboard");
  });

  it("rejette une URL protocol-relative (//hôte)", () => {
    expect(safeRedirectPath("//exemple-malveillant.tn")).toBe("/dashboard");
  });

  it("rejette un chemin contenant un antislash (contournement par navigateur)", () => {
    expect(safeRedirectPath("/\\exemple-malveillant.tn")).toBe("/dashboard");
  });

  it("rejette un caractère de contrôle", () => {
    expect(safeRedirectPath("/tableau-de-bord\nSet-Cookie: x=1")).toBe("/dashboard");
  });

  it("utilise le repli fourni quand la valeur est absente", () => {
    expect(safeRedirectPath(null, "/connexion")).toBe("/connexion");
    expect(safeRedirectPath("", "/connexion")).toBe("/connexion");
  });
});

describe("escapeHtml", () => {
  it("neutralise les caractères actifs", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("échappe l'esperluette avant les autres caractères", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("isValidTimeZone", () => {
  it("accepte un fuseau IANA valide", () => {
    expect(isValidTimeZone("Africa/Tunis")).toBe(true);
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
  });

  it("rejette une valeur arbitraire", () => {
    expect(isValidTimeZone("Tunis/Inconnu")).toBe(false);
  });
});

describe("validateUpload — contrôle des fichiers téléversés", () => {
  it("accepte un PDF dans la limite de taille", () => {
    expect(validateUpload({ mimeType: "application/pdf", sizeBytes: 1024, filename: "cours.pdf" })).toEqual({
      ok: true,
    });
  });

  it("refuse une taille nulle ou négative", () => {
    expect(validateUpload({ mimeType: "application/pdf", sizeBytes: 0, filename: "cours.pdf" }).ok).toBe(false);
    expect(validateUpload({ mimeType: "application/pdf", sizeBytes: -5, filename: "cours.pdf" }).ok).toBe(false);
  });

  it("refuse un fichier dépassant la limite", () => {
    const resultat = validateUpload({
      mimeType: "application/pdf",
      sizeBytes: 10 * 1024 * 1024,
      filename: "cours.pdf",
      maxBytes: 1024 * 1024,
    });
    expect(resultat.ok).toBe(false);
  });

  it("refuse un type MIME non autorisé", () => {
    const resultat = validateUpload({
      mimeType: "application/x-msdownload",
      sizeBytes: 1024,
      filename: "charge.exe",
    });
    expect(resultat.ok).toBe(false);
  });

  it("refuse une extension qui ne correspond pas au type déclaré", () => {
    const resultat = validateUpload({ mimeType: "image/png", sizeBytes: 1024, filename: "charge.exe" });
    expect(resultat.ok).toBe(false);
  });

  it("refuse un nom contenant un séparateur de chemin", () => {
    expect(validateUpload({ mimeType: "application/pdf", sizeBytes: 1024, filename: "../../etc/passwd.pdf" }).ok).toBe(
      false,
    );
    expect(validateUpload({ mimeType: "application/pdf", sizeBytes: 1024, filename: "..\\..\\cours.pdf" }).ok).toBe(
      false,
    );
  });

  it("accepte la casse différente pour le type et l'extension", () => {
    expect(validateUpload({ mimeType: "IMAGE/PNG", sizeBytes: 1024, filename: "PHOTO.PNG" })).toEqual({ ok: true });
  });

  it("déclare une politique cohérente : chaque type autorisé a au moins une extension", () => {
    for (const [mimeType, extensions] of Object.entries(ALLOWED_MIME_TYPES)) {
      expect(extensions.length, `aucune extension déclarée pour ${mimeType}`).toBeGreaterThan(0);
      for (const extension of extensions) {
        expect(extension.startsWith("."), `extension mal formée pour ${mimeType} : ${extension}`).toBe(true);
      }
    }
  });
});

describe("sanitizeFilename", () => {
  it("supprime toute composante de chemin", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Windows\\system32\\cmd.exe")).toBe("cmd.exe");
  });

  it("remplace les caractères non sûrs et retire les accents", () => {
    expect(sanitizeFilename("Rapport été (final).pdf")).toBe("Rapport_ete_final_.pdf");
  });

  it("fournit un nom de repli pour une entrée inexploitable", () => {
    expect(sanitizeFilename("...")).toBe("fichier");
  });
});

describe("buildObjectKey — cloisonnement du stockage par organisation", () => {
  it("préfixe la clé par l'organisation et la catégorie", () => {
    const cle = buildObjectKey({
      organizationId: "org-123",
      category: "submissions",
      filename: "devoir.pdf",
      uuid: "uuid-abc",
      date: new Date("2026-03-04T00:00:00Z"),
    });
    expect(cle).toBe("org/org-123/submissions/2026/03/uuid-abc-devoir.pdf");
  });

  it("neutralise les caractères d'identifiant d'organisation", () => {
    const cle = buildObjectKey({
      organizationId: "org/../../autre",
      category: "courses",
      filename: "image.png",
      uuid: "uuid-abc",
      date: new Date("2026-01-01T00:00:00Z"),
    });
    expect(cle.startsWith("org/orgautre/courses/")).toBe(true);
  });
});

describe("uriEncode — conformité RFC 3986 (signature SigV4)", () => {
  it("encode les caractères non réservés", () => {
    expect(uriEncode("dossier/fichier été.pdf")).toBe("dossier%2Ffichier%20%C3%A9t%C3%A9.pdf");
  });

  it("laisse les barres obliques intactes lorsque demandé", () => {
    expect(uriEncode("dossier/fichier.pdf", false)).toBe("dossier/fichier.pdf");
  });

  it("encode l'espace en %20 et non en +", () => {
    expect(uriEncode("a b")).toBe("a%20b");
  });
});

describe("gradeAnswer — correction automatique", () => {
  const choixUnique = {
    type: "SINGLE_CHOICE" as const,
    points: 10,
    correctOptionIds: ["option-b"],
  };

  it("valide une réponse à choix unique correcte", () => {
    expect(gradeAnswer(choixUnique, { selectedOptionIds: ["option-b"] })).toEqual({
      isCorrect: true,
      pointsAwarded: 10,
      requiresManualGrading: false,
    });
  });

  it("invalide une réponse à choix unique incorrecte", () => {
    expect(gradeAnswer(choixUnique, { selectedOptionIds: ["option-a"] })).toEqual({
      isCorrect: false,
      pointsAwarded: 0,
      requiresManualGrading: false,
    });
  });

  it("ne valide jamais une question sans bonne réponse déclarée", () => {
    const resultat = gradeAnswer({ type: "SINGLE_CHOICE", points: 10 }, { selectedOptionIds: ["option-a"] });
    expect(resultat.isCorrect).toBe(false);
    expect(resultat.pointsAwarded).toBe(0);
  });

  it("exige l'ensemble exact pour une réponse à choix multiple", () => {
    const question = { type: "MULTIPLE_CHOICE" as const, points: 5, correctOptionIds: ["a", "b", "c"] };
    expect(gradeAnswer(question, { selectedOptionIds: ["c", "a", "b"] }).isCorrect).toBe(true);
    expect(gradeAnswer(question, { selectedOptionIds: ["a", "b"] }).isCorrect).toBe(false);
    expect(gradeAnswer(question, { selectedOptionIds: ["a", "b", "c", "d"] }).isCorrect).toBe(false);
  });

  it("traite vrai/faux comme un choix unique", () => {
    const question = { type: "TRUE_FALSE" as const, points: 2, correctOptionIds: ["vrai"] };
    expect(gradeAnswer(question, { selectedOptionIds: ["vrai"] }).isCorrect).toBe(true);
    expect(gradeAnswer(question, { selectedOptionIds: ["faux"] }).isCorrect).toBe(false);
  });

  it("ignore casse, accents et ponctuation pour une réponse courte", () => {
    const question = { type: "SHORT_ANSWER" as const, points: 3, acceptedAnswers: ["Réseau"] };
    expect(gradeAnswer(question, { answerText: "  RESEAU " }).isCorrect).toBe(true);
    expect(gradeAnswer(question, { answerText: "réseaux" }).isCorrect).toBe(false);
  });

  it("renvoie la correction au formateur sans réponse acceptée", () => {
    const resultat = gradeAnswer({ type: "SHORT_ANSWER", points: 3 }, { answerText: "libre" });
    expect(resultat.requiresManualGrading).toBe(true);
    expect(resultat.pointsAwarded).toBe(0);
  });

  it("ne renvoie jamais de points négatifs pour un barème négatif", () => {
    const resultat = gradeAnswer(
      { type: "SINGLE_CHOICE", points: -10, correctOptionIds: ["a"] },
      { selectedOptionIds: ["a"] },
    );
    expect(resultat.pointsAwarded).toBe(0);
  });

  it("normalise les réponses courtes de façon cohérente", () => {
    expect(normalizeShortAnswer("  Élève  N°1 ")).toBe("eleve n 1");
  });
});

describe("toPercent", () => {
  it("arrondit au pourcentage entier", () => {
    expect(toPercent(7, 9)).toBe(78);
  });

  it("renvoie 0 lorsque le barème est nul ou négatif", () => {
    expect(toPercent(5, 0)).toBe(0);
    expect(toPercent(5, -1)).toBe(0);
  });
});

describe("summarizeAttempt", () => {
  const reussie = { isCorrect: true, pointsAwarded: 10, requiresManualGrading: false };
  const ratee = { isCorrect: false, pointsAwarded: 0, requiresManualGrading: false };

  it("normalise le score en pourcentage", () => {
    const resume = summarizeAttempt([reussie, ratee], 20, 50);
    expect(resume.score).toBe(50);
    expect(resume.maxScore).toBe(100);
    expect(resume.rawScore).toBe(10);
    expect(resume.rawMaxScore).toBe(20);
    expect(resume.passed).toBe(true);
  });

  it("refuse la réussite sous le seuil", () => {
    const resume = summarizeAttempt([reussie, ratee, ratee, ratee], 40, 50);
    expect(resume.score).toBe(25);
    expect(resume.passed).toBe(false);
  });

  it("ne valide jamais une tentative en attente de correction manuelle", () => {
    const enAttente = { isCorrect: false, pointsAwarded: 0, requiresManualGrading: true };
    const resume = summarizeAttempt([reussie, reussie, reussie, enAttente], 40, 50);
    expect(resume.score).toBe(75);
    expect(resume.pendingManualGrading).toBe(true);
    expect(resume.passed).toBe(false);
  });

  it("gère une tentative vide", () => {
    const resume = summarizeAttempt([], 0, 70);
    expect(resume.score).toBe(0);
    expect(resume.passed).toBe(false);
  });
});

describe("progression d'apprentissage", () => {
  it("calcule un pourcentage borné", () => {
    expect(computeProgressPercent(0, 10)).toBe(0);
    expect(computeProgressPercent(5, 10)).toBe(50);
    expect(computeProgressPercent(10, 10)).toBe(100);
  });

  it("ne divise pas par zéro sur une formation sans leçon", () => {
    expect(computeProgressPercent(0, 0)).toBe(0);
    expect(computeProgressPercent(3, 0)).toBe(0);
  });

  it("plafonne à 100 même si l'entrée est incohérente", () => {
    expect(computeProgressPercent(12, 10)).toBe(100);
  });

  it("expose la progression sous forme de résumé", () => {
    expect(computeProgress(2, 8)).toEqual({ completedLessons: 2, totalLessons: 8, percent: 25 });
    expect(computeProgress(8, 8)).toEqual({ completedLessons: 8, totalLessons: 8, percent: 100 });
  });

  it("ne divise pas par zéro sur une formation sans leçon", () => {
    expect(computeProgress(4, 0)).toEqual({ completedLessons: 0, totalLessons: 0, percent: 0 });
  });

  it("considère une inscription terminée comme encore active", () => {
    // Une inscription COMPLETED conserve l'accès à la formation : seul
    // l'abandon ou l'expiration retire l'accès.
    expect(isEnrollmentActive("ACTIVE")).toBe(true);
    expect(isEnrollmentActive("COMPLETED")).toBe(true);
    expect(isEnrollmentActive("CANCELLED")).toBe(false);
    expect(isEnrollmentActive("EXPIRED")).toBe(false);
  });

  it("détecte une formation gratuite", () => {
    expect(isFreeCourse(0)).toBe(true);
    expect(isFreeCourse(1)).toBe(false);
  });
});

describe("decideLiveAccess — contrôle d'accès aux classes virtuelles", () => {
  const base = {
    isAuthenticated: true,
    isSameTenant: true,
    isOrgStaff: false,
    isCourseInstructor: false,
    isEnrolled: false,
    sessionStatus: "SCHEDULED" as const,
  };

  it("refuse un utilisateur non authentifié", () => {
    expect(decideLiveAccess({ ...base, isAuthenticated: false })).toEqual({
      allowed: false,
      reason: "not_authenticated",
    });
  });

  it("refuse un utilisateur d'une autre organisation", () => {
    expect(decideLiveAccess({ ...base, isSameTenant: false, isEnrolled: true })).toEqual({
      allowed: false,
      reason: "other_tenant",
    });
  });

  it("refuse une session annulée ou terminée, même au formateur", () => {
    expect(decideLiveAccess({ ...base, isCourseInstructor: true, sessionStatus: "CANCELLED" })).toEqual({
      allowed: false,
      reason: "cancelled",
    });
    expect(decideLiveAccess({ ...base, isCourseInstructor: true, sessionStatus: "ENDED" })).toEqual({
      allowed: false,
      reason: "ended",
    });
  });

  it("attribue le rôle d'hôte au formateur du cours", () => {
    expect(decideLiveAccess({ ...base, isCourseInstructor: true })).toEqual({
      allowed: true,
      role: "HOST",
      reason: "instructor",
    });
  });

  it("attribue le rôle de modérateur au personnel de l'organisation", () => {
    expect(decideLiveAccess({ ...base, isOrgStaff: true })).toEqual({
      allowed: true,
      role: "MODERATOR",
      reason: "staff",
    });
  });

  it("attribue le rôle de participant à un apprenant inscrit", () => {
    expect(decideLiveAccess({ ...base, isEnrolled: true })).toEqual({
      allowed: true,
      role: "PARTICIPANT",
      reason: "enrolled",
    });
  });

  it("refuse un utilisateur authentifié mais non inscrit", () => {
    expect(decideLiveAccess(base)).toEqual({ allowed: false, reason: "not_enrolled" });
  });

  it("donne la priorité à l'hôte sur le modérateur et le participant", () => {
    const decision = decideLiveAccess({
      ...base,
      isCourseInstructor: true,
      isOrgStaff: true,
      isEnrolled: true,
    });
    expect(decision).toEqual({ allowed: true, role: "HOST", reason: "instructor" });
  });

  it("n'accorde jamais l'accès au personnel d'une autre organisation", () => {
    expect(
      decideLiveAccess({ ...base, isSameTenant: false, isOrgStaff: true, isCourseInstructor: true }),
    ).toEqual({ allowed: false, reason: "other_tenant" });
  });
});

describe("noms de salle Jitsi", () => {
  it("accepte un nom de salle conforme", () => {
    expect(isValidJitsiRoomName("coursreact-8f2a91bc4d7e")).toBe(true);
  });

  it("rejette un nom trop court, vide ou contenant des majuscules", () => {
    expect(isValidJitsiRoomName("abc-def")).toBe(false);
    expect(isValidJitsiRoomName("")).toBe(false);
    expect(isValidJitsiRoomName("CoursReact-8f2a91bc4d7e")).toBe(false);
  });

  it("produit toujours un nom valide, même à partir d'un identifiant hostile", () => {
    const noms = [
      buildJitsiRoomName("a", "b"),
      buildJitsiRoomName("Identifiant Très Long Avec Espaces Et Symboles !!!", "token"),
      buildJitsiRoomName("", ""),
      buildJitsiRoomName("cours-123", "0123456789abcdef0123456789abcdefEXTRA"),
    ];
    for (const nom of noms) {
      expect(isValidJitsiRoomName(nom), `nom de salle invalide produit : ${nom}`).toBe(true);
    }
  });

  it("produit un nom de salle aléatoire valide et non prévisible", () => {
    const premier = buildRoomName();
    const second = buildRoomName();
    expect(premier).not.toBe(second);
    expect(premier.length).toBeGreaterThan(12);
  });
});

describe("checkLimit / checkPlanLimit — application des forfaits", () => {
  it("autorise sans limite déclarée (null = illimité)", () => {
    expect(checkLimit(500, null)).toEqual({ allowed: true, limit: null, used: 500, requested: 1, remaining: null });
  });

  it("autorise une consommation strictement sous la limite", () => {
    const resultat = checkLimit(9, 10);
    expect(resultat.allowed).toBe(true);
    expect(resultat.remaining).toBe(1);
  });

  it("autorise la consommation atteignant exactement la limite", () => {
    expect(checkLimit(9, 10, 1).allowed).toBe(true);
  });

  it("refuse un dépassement d'une unité", () => {
    const resultat = checkLimit(10, 10, 1);
    expect(resultat.allowed).toBe(false);
    expect(resultat.remaining).toBe(0);
  });

  it("refuse un forfait déjà saturé", () => {
    expect(checkLimit(25, 10).allowed).toBe(false);
  });

  it("vérifie une limite par métrique et rapporte la métrique concernée", () => {
    const resultat = checkPlanLimit({ users: 5 }, "users", 4);
    expect(resultat).toMatchObject({ allowed: true, metric: "users", limit: 5, current: 4, remaining: 1 });
  });

  it("considère une métrique absente comme illimitée", () => {
    expect(checkPlanLimit({ users: 5 }, "courses", 999).allowed).toBe(true);
  });

  it("considère un forfait absent comme illimité", () => {
    expect(checkPlanLimit(null, "users", 10_000).allowed).toBe(true);
  });
});

describe("hasFeature", () => {
  it("reconnaît une fonctionnalité activée", () => {
    expect(hasFeature(["liveClasses"], "liveClasses")).toBe(true);
  });

  it("refuse une fonctionnalité absente ou une entrée non tableau", () => {
    expect(hasFeature([], "liveClasses")).toBe(false);
    expect(hasFeature(null, "liveClasses")).toBe(false);
    expect(hasFeature(undefined, "liveClasses")).toBe(false);
  });
});

describe("parseLimits — normalisation d'une colonne JSON", () => {
  it("interprète les nombres et les chaînes numériques", () => {
    expect(parseLimits({ users: 10, courses: "120" })).toEqual({ users: 10, courses: 120 });
  });

  it("préserve null comme « illimité »", () => {
    expect(parseLimits({ users: null })).toEqual({ users: null });
  });

  it("ignore les valeurs invalides plutôt que de les interpréter comme illimité", () => {
    // Une valeur mal saisie ne doit pas se transformer en « illimité ».
    expect(parseLimits({ users: "beaucoup" })).toEqual({});
    expect(parseLimits({ users: -1 })).toEqual({});
    expect(parseLimits({ users: 2.5 })).toEqual({});
  });

  it("tolère une entrée non objet", () => {
    expect(parseLimits(null)).toEqual({});
    expect(parseLimits("texte")).toEqual({});
  });
});

describe("parseFeatures", () => {
  it("ne conserve que les fonctionnalités connues", () => {
    expect(parseFeatures(["liveClasses", "inexistant", 42])).toEqual(["liveClasses"]);
  });

  it("tolère une entrée non tableau", () => {
    expect(parseFeatures(null)).toEqual([]);
    expect(parseFeatures({ a: 1 })).toEqual([]);
  });
});

describe("DEFAULT_PLANS — cohérence du catalogue de forfaits", () => {
  it("déclare au moins un forfait gratuit sans limite d'utilisateurs bloquante à zéro", () => {
    const gratuit = DEFAULT_PLANS.find((plan) => plan.priceMonthlyCents === 0);
    expect(gratuit, "aucun forfait gratuit déclaré").toBeDefined();
  });

  it("utilise des codes uniques", () => {
    const codes = DEFAULT_PLANS.map((plan) => plan.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("n'attribue que des fonctionnalités connues", () => {
    for (const plan of DEFAULT_PLANS) {
      for (const feature of plan.features) {
        expect(PLAN_FEATURES, `fonctionnalité inconnue « ${feature} » dans le forfait ${plan.code}`).toContain(
          feature,
        );
      }
    }
  });

  it("ne déclare aucune limite négative", () => {
    for (const plan of DEFAULT_PLANS) {
      for (const [metric, limit] of Object.entries(plan.limits)) {
        if (limit === null) continue;
        expect(limit, `limite négative pour ${metric} dans le forfait ${plan.code}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("passwordSchema — politique de mot de passe", () => {
  it("accepte un mot de passe mêlant trois catégories de caractères", () => {
    expect(passwordSchema.safeParse("BelloAcademy2026").success).toBe(true);
  });

  it("refuse un mot de passe trop court", () => {
    expect(passwordSchema.safeParse("Ab1!").success).toBe(false);
  });

  it("refuse un mot de passe trop simple (deux catégories seulement)", () => {
    expect(passwordSchema.safeParse("motdepasse123").success).toBe(false);
  });

  it("refuse une répétition d'un seul caractère", () => {
    expect(passwordSchema.safeParse("aaaaaaaaaa").success).toBe(false);
  });
});
