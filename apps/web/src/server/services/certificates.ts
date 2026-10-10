/**
 * Certificats de réussite : génération PDF, stockage objet, vérification publique.
 *
 * Le PDF est produit avec `pdf-lib` (pur TypeScript, aucune dépendance native) et
 * déposé via la couche de stockage (local ou S3/MinIO). La vérification publique
 * s'appuie sur un code opaque : elle n'expose ni adresse e-mail, ni identifiant
 * interne, ni organisation propriétaire des données.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { CERTIFICATE_PREFIX } from "@belloacademy/shared";

import { prismaPlatform, withTenant } from "@/lib/db/prisma";
import { env } from "@/env";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { certificateObjectKey, getStorage } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { generateVerificationCode } from "@/lib/auth/tokens";

export type IssueCertificateInput = {
  organizationId: string;
  courseId: string;
  userId: string;
  finalScore?: number | null;
  actorUserId?: string | null;
};

function formatDate(date: Date, locale = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
}

/** Numéro de série lisible et unique : `BA-2026-XXXXXXXX`. */
function buildSerial(year: number, random: string): string {
  return `${CERTIFICATE_PREFIX}-${year}-${random}`;
}

type CertificatePdfInput = {
  learnerName: string;
  courseTitle: string;
  organizationName: string;
  issuedAt: Date;
  serial: string;
  finalScore: number | null;
  verifyUrl: string;
};

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificat ${input.serial}`);
  pdf.setAuthor(input.organizationName);
  pdf.setSubject(`Certificat de réussite — ${input.courseTitle}`);
  pdf.setProducer("BelloAcademy");

  const page = pdf.addPage([842, 595]); // A4 paysage
  const { width, height } = page.getSize();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const ink = rgb(0.07, 0.09, 0.15);
  const accent = rgb(0.11, 0.31, 0.85);
  const muted = rgb(0.42, 0.45, 0.5);

  page.drawRectangle({
    x: 24,
    y: 24,
    width: width - 48,
    height: height - 48,
    borderColor: accent,
    borderWidth: 2,
  });
  page.drawRectangle({
    x: 36,
    y: 36,
    width: width - 72,
    height: height - 72,
    borderColor: rgb(0.85, 0.87, 0.92),
    borderWidth: 1,
  });

  const center = (text: string, y: number, size: number, font = helvetica, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  center(input.organizationName.toUpperCase(), height - 92, 11, bold, accent);
  center("CERTIFICAT DE RÉUSSITE", height - 150, 30, bold, ink);
  center("Ce document atteste que", height - 196, 12, oblique, muted);
  center(input.learnerName, height - 240, 26, bold, ink);
  center("a suivi et validé avec succès la formation", height - 276, 12, oblique, muted);
  center(input.courseTitle, height - 316, 18, bold, accent);

  if (input.finalScore !== null) {
    center(`Score final : ${input.finalScore} %`, height - 348, 12, helvetica, muted);
  }

  center(`Délivré le ${formatDate(input.issuedAt)}`, height - 384, 11, helvetica, muted);

  page.drawLine({
    start: { x: 90, y: 118 },
    end: { x: width - 90, y: 118 },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.92),
  });
  page.drawText(`Numéro de série : ${input.serial}`, {
    x: 90,
    y: 98,
    size: 9,
    font: helvetica,
    color: muted,
  });
  const verifyLabel = `Vérification : ${input.verifyUrl}`;
  const verifyWidth = helvetica.widthOfTextAtSize(verifyLabel, 9);
  page.drawText(verifyLabel, { x: width - 90 - verifyWidth, y: 98, size: 9, font: helvetica, color: muted });

  return pdf.save();
}

/**
 * Émet un certificat si les conditions sont réunies. Idempotent : un certificat
 * déjà émis pour ce couple (formation, apprenant) est renvoyé tel quel.
 */
export async function issueCertificate(input: IssueCertificateInput) {
  const prepared = await withTenant(input.organizationId, async (tx) => {
    const [course, enrollment, existing] = await Promise.all([
      tx.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          title: true,
          certificateEnabled: true,
          certificateMinScore: true,
          organization: { select: { name: true, slug: true } },
        },
      }),
      tx.enrollment.findUnique({
        where: { courseId_userId: { courseId: input.courseId, userId: input.userId } },
        select: { id: true, status: true },
      }),
      tx.certificate.findFirst({
        where: { courseId: input.courseId, userId: input.userId, revokedAt: null },
        select: { id: true, serial: true, verificationCode: true, issuedAt: true, finalScore: true },
      }),
    ]);

    if (!course) throw notFound("Formation introuvable.");
    if (existing) return { alreadyIssued: true as const, certificate: existing, course, enrollment };

    if (!course.certificateEnabled) {
      throw conflict("Cette formation ne délivre pas de certificat.");
    }
    if (!enrollment || enrollment.status === "CANCELLED" || enrollment.status === "EXPIRED") {
      throw forbidden("Aucune inscription active pour cette formation.");
    }

    const issuedAt = new Date();
    const serial = buildSerial(issuedAt.getUTCFullYear(), generateVerificationCode(8));
    const verificationCode = generateVerificationCode(20);

    const certificate = await tx.certificate.create({
      data: {
        organizationId: input.organizationId,
        courseId: input.courseId,
        userId: input.userId,
        serial,
        verificationCode,
        finalScore: input.finalScore ?? null,
        issuedAt,
        metadata: { courseTitle: course.title, organizationName: course.organization.name },
      },
      select: { id: true, serial: true, verificationCode: true, issuedAt: true, finalScore: true },
    });

    await recordAudit(
      {
        action: "certificate.issued",
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        entityType: "Certificate",
        entityId: certificate.id,
        metadata: { serial, courseId: input.courseId, userId: input.userId },
      },
      tx,
    );

    return { alreadyIssued: false as const, certificate, course, enrollment };
  });

  if (prepared.alreadyIssued) {
    return prepared.certificate;
  }

  const { certificate, course } = prepared;

  const learner = await prismaPlatform.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true },
  });

  const verifyUrl = `${env().APP_URL.replace(/\/+$/, "")}/verify/${certificate.verificationCode}`;

  try {
    const pdfBytes = await renderCertificatePdf({
      learnerName: learner?.name ?? "Apprenant",
      courseTitle: course.title,
      organizationName: course.organization.name,
      issuedAt: certificate.issuedAt,
      serial: certificate.serial,
      finalScore: certificate.finalScore,
      verifyUrl,
    });

    const key = certificateObjectKey(input.organizationId, certificate.serial);
    const storage = getStorage();
    await storage.putObject({ key, body: pdfBytes, contentType: "application/pdf" });

    await withTenant(input.organizationId, async (tx) => {
      const current = await tx.certificate.findUnique({
        where: { id: certificate.id },
        select: { metadata: true },
      });
      const metadata =
        current && typeof current.metadata === "object" && current.metadata !== null && !Array.isArray(current.metadata)
          ? (current.metadata as Record<string, unknown>)
          : {};
      await tx.certificate.update({
        where: { id: certificate.id },
        data: {
          metadata: {
            ...metadata,
            objectKey: key,
            driver: storage.kind,
            sizeBytes: pdfBytes.byteLength,
          },
        },
      });
    });
  } catch (error) {
    logger.error("génération du PDF de certificat impossible", { certificateId: certificate.id, error });
    // Le certificat reste valide : le PDF peut être régénéré à la demande.
  }

  await notify({
    userId: input.userId,
    organizationId: input.organizationId,
    type: "CERTIFICATE_ISSUED",
    title: "Votre certificat est disponible",
    body: `Certificat délivré pour « ${course.title} ».`,
    href: `/certificates/${certificate.id}`,
  });

  return certificate;
}

/** Vérification publique : aucune donnée personnelle inutile n'est exposée. */
export async function verifyCertificate(code: string) {
  const certificate = await prismaPlatform.certificate.findUnique({
    where: { verificationCode: code },
    select: {
      serial: true,
      issuedAt: true,
      revokedAt: true,
      finalScore: true,
      course: { select: { title: true, slug: true } },
      organization: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  if (!certificate) return { found: false as const };
  return {
    found: true as const,
    valid: certificate.revokedAt === null,
    revokedAt: certificate.revokedAt,
    serial: certificate.serial,
    issuedAt: certificate.issuedAt,
    finalScore: certificate.finalScore,
    courseTitle: certificate.course.title,
    organizationName: certificate.organization.name,
    recipientName: certificate.user.name,
  };
}

export async function revokeCertificate(input: {
  organizationId: string;
  certificateId: string;
  actorUserId: string;
  reason?: string | null;
}) {
  return withTenant(input.organizationId, async (tx) => {
    const certificate = await tx.certificate.update({
      where: { id: input.certificateId },
      data: { revokedAt: new Date() },
      select: { id: true, serial: true },
    });
    await recordAudit(
      {
        action: "certificate.revoked",
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: "Certificate",
        entityId: certificate.id,
        metadata: { reason: input.reason ?? null },
      },
      tx,
    );
    return certificate;
  });
}

/** Contenu PDF du certificat (régénéré si absent du stockage). */
export async function getCertificatePdf(input: {
  organizationId: string;
  certificateId: string;
  viewerUserId: string;
  canReview: boolean;
}): Promise<{ filename: string; body: Uint8Array }> {
  const certificate = await withTenant(input.organizationId, async (tx) =>
    tx.certificate.findUnique({
      where: { id: input.certificateId },
      select: {
        id: true,
        serial: true,
        verificationCode: true,
        issuedAt: true,
        finalScore: true,
        userId: true,
        revokedAt: true,
        metadata: true,
        course: { select: { title: true } },
        organization: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
  );

  if (!certificate) throw notFound("Certificat introuvable.");
  if (certificate.userId !== input.viewerUserId && !input.canReview) {
    throw forbidden("Ce certificat ne vous appartient pas.");
  }

  const metadata =
    typeof certificate.metadata === "object" && certificate.metadata !== null && !Array.isArray(certificate.metadata)
      ? (certificate.metadata as Record<string, unknown>)
      : {};
  const key = typeof metadata.objectKey === "string" ? metadata.objectKey : null;
  const filename = `certificat-${certificate.serial}.pdf`;

  if (key) {
    const stored = await getStorage().getObject(key);
    if (stored) return { filename, body: stored.body };
  }

  const body = await renderCertificatePdf({
    learnerName: certificate.user.name,
    courseTitle: certificate.course.title,
    organizationName: certificate.organization.name,
    issuedAt: certificate.issuedAt,
    serial: certificate.serial,
    finalScore: certificate.finalScore,
    verifyUrl: `${env().APP_URL.replace(/\/+$/, "")}/verify/${certificate.verificationCode}`,
  });
  return { filename, body };
}

export async function listMyCertificates(input: { organizationId: string; userId: string }) {
  return withTenant(input.organizationId, async (tx) =>
    tx.certificate.findMany({
      where: { userId: input.userId },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        serial: true,
        issuedAt: true,
        revokedAt: true,
        finalScore: true,
        course: { select: { slug: true, title: true } },
      },
    }),
  );
}

export async function listCourseCertificates(organizationId: string, courseId: string) {
  return withTenant(organizationId, async (tx) =>
    tx.certificate.findMany({
      where: { courseId },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        serial: true,
        issuedAt: true,
        revokedAt: true,
        finalScore: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  );
}
