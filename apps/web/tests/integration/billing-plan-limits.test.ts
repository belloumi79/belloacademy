/**
 * Forfaits, limites et facturation.
 *
 * Vérifie trois critères d'acceptation :
 *  - « les restrictions des forfaits sont appliquées » : une limite de forfait
 *    bloque l'opération métier, côté serveur ;
 *  - « les webhooks de paiement sont authentifiés » : une signature invalide est
 *    rejetée ;
 *  - « et traités de manière idempotente » : un événement rejoué n'est appliqué
 *    qu'une fois.
 *
 * Aucun paiement réel n'est simulé : le mode `MOCK` est explicitement un mode de
 * test local, et la confirmation est une action locale, jamais un webhook.
 */

import { createHmac } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  confirmMockPayment,
  getSubscription,
  handleWebhook,
  listInvoices,
  startSubscription,
  verifyStripeSignature,
} from "@/server/services/billing";
import { createCourse } from "@/server/services/courses";
import { assertWithinPlan, getUsage } from "@/server/services/organizations";

import {
  closeTestDatabase,
  createTenant,
  resetDatabase,
  seedPlans,
  setPlanLimits,
} from "./helpers";

type Tenant = Awaited<ReturnType<typeof createTenant>>;

let tenant: Tenant;

const WEBHOOK_SECRET = "whsec_test_belloacademy";

/** Construit une signature `t=<ts>,v1=<hmac>` comme le fait le prestataire. */
function sign(body: string, secret = WEBHOOK_SECRET, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return { header: `t=${timestampSeconds},v1=${signature}`, timestampSeconds };
}

beforeEach(async () => {
  await resetDatabase();
  await seedPlans();
  tenant = await createTenant("facturation");
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("limites de forfait", () => {
  it("bloque la création au-delà de la limite de formations", async () => {
    await setPlanLimits("business", { courses: 1 });

    await createCourse({
      organizationId: tenant.organization.id,
      instructorId: tenant.admin.id,
      actorUserId: tenant.admin.id,
      title: "Première formation",
      description: "Description.",
    });

    await expect(
      createCourse({
        organizationId: tenant.organization.id,
        instructorId: tenant.admin.id,
        actorUserId: tenant.admin.id,
        title: "Formation de trop",
        description: "Description.",
      }),
    ).rejects.toThrow();
  });

  it("autorise l'opération tant que la limite n'est pas atteinte", async () => {
    await setPlanLimits("business", { courses: 3 });
    await expect(assertWithinPlan(tenant.organization.id, "courses", 1)).resolves.toBeUndefined();
  });

  it("expose la consommation réelle dans l'instantané d'usage", async () => {
    await setPlanLimits("business", { courses: 5 });
    await createCourse({
      organizationId: tenant.organization.id,
      instructorId: tenant.admin.id,
      actorUserId: tenant.admin.id,
      title: "Formation comptée",
      description: "Description.",
    });

    const usage = await getUsage(tenant.organization.id);
    expect(usage.courses).toBe(1);
  });

  it("traite une limite nulle comme une fonctionnalité indisponible", async () => {
    await setPlanLimits("free", { courses: 0 });
    const freeTenant = await createTenant("gratuit", "free");

    await expect(assertWithinPlan(freeTenant.organization.id, "courses", 1)).rejects.toThrow();
  });
});

describe("abonnement et facture locale (mode test)", () => {
  it("ouvre un abonnement, émet une facture puis l'encaisse en mode test", async () => {
    const started = await startSubscription({
      organizationId: tenant.organization.id,
      planCode: "starter",
      interval: "MONTHLY",
      actorUserId: tenant.admin.id,
    });

    expect(started.provider).toBe("MOCK");
    expect(started.invoiceId).toBeTruthy();

    const invoices = await listInvoices(tenant.organization.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.status).toBe("OPEN");

    await confirmMockPayment({
      organizationId: tenant.organization.id,
      invoiceId: started.invoiceId as string,
      actorUserId: tenant.admin.id,
    });

    const paid = await listInvoices(tenant.organization.id);
    expect(paid[0]?.status).toBe("PAID");

    const subscription = await getSubscription(tenant.organization.id);
    expect(subscription?.status).toBe("ACTIVE");
  });

  it("refuse un webhook externe en mode test", async () => {
    const body = JSON.stringify({ id: "evt_mock_1", type: "invoice.paid", data: { object: {} } });
    const { header } = sign(body);

    await expect(
      handleWebhook({ provider: "MOCK", rawBody: body, signatureHeader: header }),
    ).rejects.toThrow();
  });
});

describe("authentification des webhooks", () => {
  it("rejette une signature absente ou falsifiée", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: {} } });

    await expect(
      handleWebhook({ provider: "STRIPE", rawBody: body, signatureHeader: null }),
    ).rejects.toThrow();

    await expect(
      handleWebhook({ provider: "STRIPE", rawBody: body, signatureHeader: "t=1,v1=deadbeef" }),
    ).rejects.toThrow();
  });

  it("rejette une signature rejouée hors tolérance", () => {
    const body = "{}";
    const { header } = sign(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyStripeSignature({ rawBody: body, header, secret: WEBHOOK_SECRET })).toBe(false);
  });

  it("accepte une signature valide et rejette un corps modifié", () => {
    const body = JSON.stringify({ id: "evt_2", type: "invoice.paid" });
    const { header } = sign(body);

    expect(verifyStripeSignature({ rawBody: body, header, secret: WEBHOOK_SECRET })).toBe(true);
    expect(
      verifyStripeSignature({ rawBody: `${body} `, header, secret: WEBHOOK_SECRET }),
    ).toBe(false);
  });
});

describe("idempotence des webhooks", () => {
  it("n'applique qu'une fois un événement rejoué", async () => {
    const body = JSON.stringify({
      id: "evt_idempotent_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_inconnu", status: "active" } },
    });
    const { header } = sign(body);

    const first = await handleWebhook({ provider: "STRIPE", rawBody: body, signatureHeader: header });
    expect(first.received).toBe(true);
    expect(first.duplicate).toBe(false);

    const replay = await handleWebhook({ provider: "STRIPE", rawBody: body, signatureHeader: header });
    expect(replay.duplicate).toBe(true);
  });

  it("rejette un événement sans identifiant", async () => {
    const body = JSON.stringify({ type: "invoice.paid", data: { object: {} } });
    const { header } = sign(body);

    await expect(
      handleWebhook({ provider: "STRIPE", rawBody: body, signatureHeader: header }),
    ).rejects.toThrow();
  });
});
