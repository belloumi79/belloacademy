/**
 * Tests unitaires du domaine partagé.
 *
 * Ces tests ne touchent ni la base de données ni le réseau : ils vérifient la
 * logique métier sur laquelle reposent les règles de sécurité (limites de
 * forfait, correction des quiz, accès aux classes virtuelles, validation des
 * fichiers) et les utilitaires utilisés partout ailleurs.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLANS,
  addInterval,
  checkPlanLimit,
  computeProgress,
  computeProgressPercent,
  decideLiveAccess,
  escapeHtml,
  formatAmount,
  gradeAnswer,
  hasFeature,
  initials,
  isEnrollmentActive,
  isValidJitsiRoomName,
  normalizeEmail,
  normalizeShortAnswer,
  parseFeatures,
  parseLimits,
  percent,
  safeRedirectPath,
  sanitizeFilename,
  slugify,
  summarizeAttempt,
  truncate,
  validateUpload,
  buildJitsiRoomName,
  isFreeCourse,
} from "@belloacademy/shared";

describe("correction des évaluations", () => {
  it("accepte une réponse courte malgré la casse, les accents et la ponctuation", () => {
    const result = gradeAnswer(
      { type: "SHORT_ANSWER", points: 2, acceptedAnswers: ["Réseau de neurones"] },
      { answerText: "  reseau de NEURONES. " },
    );

    expect(result.isCorrect).toBe(true);
    expect(result.pointsAwarded).toBe(2);
    expect(result.requiresManualGrading).toBe(false);
  });

  it("n'accorde aucun point lorsque la réponse courte est fausse", () => {
    const result = gradeAnswer(
      { type: "SHORT_ANSWER", points: 2, acceptedAnswers: ["Paris"] },
      { answerText: "Tunis" },
    );

    expect(result.isCorrect).toBe(false);
    expect(result.pointsAwarded).toBe(0);
  });

  it("exige toutes les bonnes options pour un choix multiple", () => {
    const question = { type: "MULTIPLE_CHOICE" as const, points: 3, correctOptionIds: ["a", "b"] };

    expect(gradeAnswer(question, { selectedOptionIds: ["a", "b"] }).isCorrect).toBe(true);
    expect(gradeAnswer(question, { selectedOptionIds: ["a"] }).isCorrect).toBe(false);
    expect(gradeAnswer(question, { selectedOptionIds: ["a", "b", "c"] }).isCorrect).toBe(false);
  });

  it("ne sanctionne pas l'ordre des options sélectionnées", () => {
    const question = { type: "MULTIPLE_CHOICE" as const, points: 3, correctOptionIds: ["a", "b"] };
    expect(gradeAnswer(question, { selectedOptionIds: ["b", "a"] }).isCorrect).toBe(true);
  });

  it("corrige une question vrai/faux", () => {
    const question = { type: "TRUE_FALSE" as const, points: 1, correctOptionIds: ["vrai"] };
    expect(gradeAnswer(question, { selectedOptionIds: ["vrai"] }).pointsAwarded).toBe(1);
    expect(gradeAnswer(question, { selectedOptionIds: ["faux"] }).pointsAwarded).toBe(0);
  });

  it("signale une question à correction manuelle", () => {
    const result = gradeAnswer(
      { type: "SHORT_ANSWER", points: 5, acceptedAnswers: [] },
      { answerText: "réponse libre" },
    );

    expect(result.requiresManualGrading).toBe(true);
    expect(result.pointsAwarded).toBe(0);
  });

  it("calcule le score global et bloque la réussite tant qu'une copie n'est pas corrigée", () => {
    const results = [
      { isCorrect: true, pointsAwarded: 6, requiresManualGrading: false },
      { isCorrect: false, pointsAwarded: 0, requiresManualGrading: true },
    ];

    const summary = summarizeAttempt(results, 10, 70);
    expect(summary.score).toBe(60);
    expect(summary.maxScore).toBe(100);
    expect(summary.rawScore).toBe(6);
    expect(summary.rawMaxScore).toBe(10);
    expect(summary.pendingManualGrading).toBe(true);
    expect(summary.passed).toBe(false);
  });

  it("valide la réussite au seuil exact (seuil exprimé en pourcentage)", () => {
    const summary = summarizeAttempt(
      [{ isCorrect: true, pointsAwarded: 7, requiresManualGrading: false }],
      10,
      70,
    );
    expect(summary.score).toBe(70);
    expect(summary.passed).toBe(true);
  });

  it("compare le seuil en pourcentage, pas en points bruts", () => {
    // 3 points sur 4 = 75 % : au-dessus d'un seuil de 70 %.
    const summary = summarizeAttempt(
      [
        { isCorrect: true, pointsAwarded: 2, requiresManualGrading: false },
        { isCorrect: false, pointsAwarded: 1, requiresManualGrading: false },
      ],
      4,
      70,
    );
    expect(summary.score).toBe(75);
    expect(summary.passed).toBe(true);
  });
});

describe("normalisation des réponses courtes", () => {
  it("supprime accents, casse et ponctuation", () => {
    expect(normalizeShortAnswer("ÉLÈVE, n°1 !")).toBe("eleve n 1");
  });
});

describe("limites de forfait", () => {
  it("autorise tout dépassement lorsque la limite est indéfinie", () => {
    const result = checkPlanLimit({}, "users", 500, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeNull();
  });

  it("bloque au-delà de la limite et calcule le reste", () => {
    expect(checkPlanLimit({ users: 5 }, "users", 4, 1).allowed).toBe(true);
    expect(checkPlanLimit({ users: 5 }, "users", 5, 1).allowed).toBe(false);
    expect(checkPlanLimit({ users: 5 }, "users", 3, 1).remaining).toBe(2);
  });

  it("interprète la valeur nulle comme illimitée", () => {
    expect(checkPlanLimit({ users: null }, "users", 10_000).allowed).toBe(true);
  });

  it("lit des limites stockées en JSON de façon défensive", () => {
    expect(parseLimits({ users: 3, storageMb: "120" })).toEqual({ users: 3, storageMb: 120 });
    expect(parseLimits("invalide")).toEqual({});
    expect(parseLimits(null)).toEqual({});
    expect(parseLimits({ users: -4 })).toEqual({});
  });

  it("filtre les fonctionnalités inconnues", () => {
    expect(parseFeatures(["certificates", "inconnue", "auditLog"])).toEqual(["certificates", "auditLog"]);
    expect(hasFeature(["certificates"], "certificates")).toBe(true);
    expect(hasFeature(["certificates"], "sso")).toBe(false);
    expect(hasFeature(null, "certificates")).toBe(false);
  });

  it("propose un référentiel de forfaits cohérent", () => {
    expect(DEFAULT_PLANS.length).toBeGreaterThanOrEqual(3);
    const codes = DEFAULT_PLANS.map((plan) => plan.code);
    expect(new Set(codes).size).toBe(codes.length);
    const free = DEFAULT_PLANS.find((plan) => plan.code === "free");
    expect(free?.priceMonthlyCents).toBe(0);
  });
});

describe("facturation", () => {
  it("formate un montant en dinars", () => {
    expect(formatAmount(25_000, "TND")).toContain("250");
    expect(formatAmount(0, "TND")).toContain("0");
  });

  it("avance d'un mois en conservant l'heure", () => {
    const start = new Date("2026-01-31T10:00:00.000Z");
    const next = addInterval(start, "MONTHLY");
    expect(next.getTime()).toBeGreaterThan(start.getTime());
    expect(next.getUTCHours()).toBe(10);
  });

  it("avance d'une année complète", () => {
    const start = new Date("2026-03-15T00:00:00.000Z");
    expect(addInterval(start, "YEARLY").getUTCFullYear()).toBe(2027);
  });
});

describe("progression pédagogique", () => {
  it("calcule un pourcentage borné", () => {
    expect(computeProgressPercent(0, 0)).toBe(0);
    expect(computeProgressPercent(1, 4)).toBe(25);
    expect(computeProgressPercent(4, 4)).toBe(100);
    expect(computeProgressPercent(9, 4)).toBe(100);
  });

  it("expose le détail de progression", () => {
    expect(computeProgress(2, 8)).toEqual({ completedLessons: 2, totalLessons: 8, percent: 25 });
  });

  it("distingue une formation gratuite d'une formation payante", () => {
    expect(isFreeCourse(0)).toBe(true);
    expect(isFreeCourse(19_900)).toBe(false);
  });

  it("considère une inscription terminée comme active", () => {
    expect(isEnrollmentActive("ACTIVE")).toBe(true);
    expect(isEnrollmentActive("COMPLETED")).toBe(true);
    expect(isEnrollmentActive("CANCELLED")).toBe(false);
    expect(isEnrollmentActive("EXPIRED")).toBe(false);
  });
});

describe("accès aux classes virtuelles", () => {
  const base = {
    isAuthenticated: true,
    isSameTenant: true,
    isOrgStaff: false,
    isCourseInstructor: false,
    isEnrolled: true,
    sessionStatus: "SCHEDULED" as const,
  };

  it("refuse un visiteur anonyme", () => {
    expect(decideLiveAccess({ ...base, isAuthenticated: false }).allowed).toBe(false);
  });

  it("refuse un membre d'une autre organisation", () => {
    const decision = decideLiveAccess({ ...base, isSameTenant: false });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("other_tenant");
  });

  it("refuse un apprenant non inscrit", () => {
    const decision = decideLiveAccess({ ...base, isEnrolled: false });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not_enrolled");
  });

  it("refuse une session annulée ou terminée, même pour l'animateur", () => {
    expect(decideLiveAccess({ ...base, isCourseInstructor: true, sessionStatus: "CANCELLED" }).allowed).toBe(false);
    expect(decideLiveAccess({ ...base, isCourseInstructor: true, sessionStatus: "ENDED" }).allowed).toBe(false);
  });

  it("attribue le rôle animateur au formateur et modérateur au personnel", () => {
    // Le rôle n'est lisible qu'après avoir vérifié `allowed` : c'est la
    // garantie de type qui empêche d'afficher un rôle pour un accès refusé.
    const instructor = decideLiveAccess({ ...base, isCourseInstructor: true });
    const staff = decideLiveAccess({ ...base, isOrgStaff: true });
    const learner = decideLiveAccess(base);
    expect(instructor.allowed && instructor.role).toBe("HOST");
    expect(staff.allowed && staff.role).toBe("MODERATOR");
    expect(learner.allowed && learner.role).toBe("PARTICIPANT");
  });
});

describe("noms de salle Jitsi", () => {
  it("reconnaît un nom de salle conforme", () => {
    expect(isValidJitsiRoomName(buildJitsiRoomName("cours-1", "abcdef0123456789"))).toBe(true);
  });

  it("rejette un nom prévisible ou trop court", () => {
    expect(isValidJitsiRoomName("cours-1")).toBe(false);
    expect(isValidJitsiRoomName("belloacademy-salle")).toBe(false);
    expect(isValidJitsiRoomName("")).toBe(false);
  });

  it("produit des noms différents pour un même cours", () => {
    const first = buildJitsiRoomName("cours-1", "aaaaaaaaaaaaaaaa");
    const second = buildJitsiRoomName("cours-1", "bbbbbbbbbbbbbbbb");
    expect(first).not.toBe(second);
  });
});

describe("validation des fichiers téléversés", () => {
  it("accepte un PDF dans la limite de taille", () => {
    expect(validateUpload({ filename: "support.pdf", mimeType: "application/pdf", sizeBytes: 1024 }).ok).toBe(true);
  });

  it("rejette un type non autorisé", () => {
    const result = validateUpload({ filename: "script.exe", mimeType: "application/x-msdownload", sizeBytes: 10 });
    expect(result.ok).toBe(false);
  });

  it("rejette un fichier trop volumineux", () => {
    const result = validateUpload({
      filename: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 5_000_000_000,
      maxBytes: 1_000_000,
    });
    expect(result.ok).toBe(false);
  });

  it("neutralise les traversées de répertoire dans les noms de fichier", () => {
    const sanitized = sanitizeFilename("../../etc/passwd");
    expect(sanitized).not.toContain("..");
    expect(sanitized).not.toContain("/");
  });
});

describe("utilitaires", () => {
  it("normalise une adresse e-mail", () => {
    expect(normalizeEmail("  Karim.BELLOUMI@Example.TN ")).toBe("karim.belloumi@example.tn");
  });

  it("génère des identifiants d'URL lisibles", () => {
    expect(slugify("Développer une application Next.js")).toBe("developper-une-application-next-js");
    expect(slugify("École & Formation — 2026")).toBe("ecole-formation-2026");
  });

  it("échappe le HTML injecté dans les gabarits d'e-mail", () => {
    expect(escapeHtml('<script>alert("x")</script>')).not.toContain("<script>");
  });

  it("ne redirige jamais vers un domaine externe", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/tableau-de-bord")).toBe("/tableau-de-bord");
  });

  it("tronque un texte trop long", () => {
    expect(truncate("a".repeat(300), 10)).toHaveLength(10);
  });

  it("calcule un pourcentage sans division par zéro", () => {
    expect(percent(1, 0)).toBe(0);
    expect(percent(1, 4)).toBe(25);
  });

  it("déduit des initiales", () => {
    expect(initials("Karim Belloumi")).toBe("KB");
    expect(initials(null)).toBe("?");
  });
});
