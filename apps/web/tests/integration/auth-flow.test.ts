/**
 * Parcours d'authentification : inscription, connexion, vérification d'e-mail,
 * réinitialisation de mot de passe et protection contre les tentatives répétées.
 *
 * Les jetons sont lus dans la file de tâches (`email.send`) : ils sont hachés en
 * base, donc le seul endroit où ils existent en clair est l'e-mail programmé.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normalizeEmail } from "@belloacademy/shared";

import { prismaPlatform } from "@/lib/db/prisma";
import {
  authenticate,
  register,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "@/server/services/accounts";

import { closeTestDatabase, ownerPrisma, resetDatabase } from "./helpers";

const PASSWORD = "MotDePasseTest!2026";

async function tokenFromQueuedEmail(template: string): Promise<string> {
  const job = await ownerPrisma.job.findFirst({
    where: { name: "email.send", payload: { path: ["template"], equals: template } },
    orderBy: { createdAt: "desc" },
  });
  if (!job) throw new Error(`Aucun e-mail « ${template} » programmé.`);
  const payload = job.payload as { context?: { token?: string } };
  const token = payload.context?.token;
  if (!token) throw new Error(`Jeton absent de l'e-mail « ${template} ».`);
  return token;
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("inscription et connexion", () => {
  it("crée un compte, hache le mot de passe et programme la vérification d'e-mail", async () => {
    const user = await register({
      name: "Amina Test",
      email: "Amina.Test@Example.TN ",
      password: PASSWORD,
      locale: "fr",
    });

    expect(user.email).toBe("amina.test@example.tn");
    expect(user.emailVerifiedAt).toBeNull();

    const stored = await ownerPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const hash = stored.passwordHash ?? "";
    expect(hash).not.toContain(PASSWORD);
    expect(hash.length).toBeGreaterThan(20);

    await expect(tokenFromQueuedEmail("verify_address")).resolves.toBeTruthy();
  });

  it("refuse un mot de passe trop faible", async () => {
    await expect(
      register({ name: "Faible", email: "faible@example.tn", password: "court", locale: "fr" }),
    ).rejects.toThrow();
  });

  it("refuse une adresse déjà utilisée", async () => {
    await expect(
      register({ name: "Doublon", email: "amina.test@example.tn", password: PASSWORD, locale: "fr" }),
    ).rejects.toThrow();
  });

  it("connecte avec les bons identifiants et refuse les mauvais", async () => {
    const ok = await authenticate({ email: "AMINA.TEST@example.tn", password: PASSWORD });
    expect(ok.id).toBeTruthy();
    expect(ok.email).toBe("amina.test@example.tn");

    await expect(authenticate({ email: "amina.test@example.tn", password: "MauvaisMotDePasse!1" })).rejects.toThrow();
  });

  it("ne révèle jamais si le compte existe lors d'un échec", async () => {
    const inconnu = await authenticate({ email: "inconnu@example.tn", password: PASSWORD }).catch((error: Error) => error);
    const mauvais = await authenticate({ email: "amina.test@example.tn", password: "MauvaisMotDePasse!1" }).catch(
      (error: Error) => error,
    );
    expect(inconnu).toBeInstanceOf(Error);
    expect((inconnu as Error).message).toBe((mauvais as Error).message);
  });
});

describe("vérification d'e-mail", () => {
  it("valide l'adresse avec le jeton reçu", async () => {
    const user = await register({
      name: "Youssef Test",
      email: "youssef.test@example.tn",
      password: PASSWORD,
      locale: "fr",
    });
    const token = await tokenFromQueuedEmail("verify_address");

    const verified = await verifyEmail(token);
    expect(verified.id).toBe(user.id);
    expect(verified.emailVerifiedAt).not.toBeNull();

    // Un jeton à usage unique ne peut pas resservir.
    await expect(verifyEmail(token)).rejects.toThrow();
  });
});

describe("réinitialisation de mot de passe", () => {
  it("remplace le mot de passe et invalide l'ancien", async () => {
    await requestPasswordReset("youssef.test@example.tn");
    const token = await tokenFromQueuedEmail("reset_password");

    await resetPassword({ token, password: "NouveauMotDePasse!2026" });

    await expect(authenticate({ email: "youssef.test@example.tn", password: "NouveauMotDePasse!2026" })).resolves.toBeTruthy();
    await expect(authenticate({ email: "youssef.test@example.tn", password: PASSWORD })).rejects.toThrow();
  });

  it("reste silencieux pour une adresse inconnue", async () => {
    await expect(requestPasswordReset("personne@example.tn")).resolves.toBeUndefined();
  });
});

describe("jetons de vérification", () => {
  it("stocke uniquement l'empreinte du jeton", async () => {
    const token = await tokenFromQueuedEmail("verify_address");
    const stored = await prismaPlatform.authToken.findFirst({
      where: { type: "EMAIL_VERIFICATION" },
      orderBy: { createdAt: "desc" },
      select: { tokenHash: true },
    });
    expect(stored?.tokenHash).toBeTruthy();
    expect(stored?.tokenHash).not.toBe(token);
  });

  it("normalise les adresses avant comparaison", () => {
    expect(normalizeEmail("  Karim.BELLOUMI@Example.TN ")).toBe("karim.belloumi@example.tn");
  });
});
