/**
 * Envoi d'e-mails et gabarits transactionnels.
 *
 * Trois pilotes (`MAIL_DRIVER`) :
 *  - `smtp`    : envoi réel via `SMTP_URL` (production) ;
 *  - `file`    : écriture des messages dans `MAIL_SPOOL_DIR` (développement) ;
 *  - `console` : journalisation uniquement.
 *
 * Le mode `file`/`console` est un **mode de test explicite** : rien n'est envoyé
 * à un destinataire réel. Chaque tentative est historisée dans `email_messages`
 * (sans secret), ce qui rend les parcours vérifiables en développement et en test.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/env";
import { prismaPlatform } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { escapeHtml } from "@belloacademy/shared";

export type MailTemplateName =
  | "verify_address"
  | "reset_password"
  | "organization_invite"
  | "enrollment_confirmation"
  | "assignment_posted"
  | "assignment_graded"
  | "quiz_result"
  | "live_session_reminder"
  | "billing_notice";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  template: MailTemplateName;
};

export type MailResult = { status: "SENT" | "FAILED"; error?: string };

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>
       <p style="color:#6b7280;font-size:12px;word-break:break-all">${escapeHtml(cta.url)}</p>`
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0">
      <tr><td>
        <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1d4ed8;font-weight:700">BelloAcademy</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(title)}</h1>
        ${bodyHtml}
        ${button}
      </td></tr>
    </table>
    <p style="max-width:560px;color:#6b7280;font-size:12px;margin:16px auto 0;text-align:center">
      Vous recevez ce message dans le cadre de votre compte BelloAcademy.
    </p>
  </td></tr></table>
</body></html>`;
}

function paragraph(value: string): string {
  return `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(value)}</p>`;
}

export type TemplateContext = {
  appUrl: string;
  name?: string;
  [key: string]: unknown;
};

/** Construit le message à partir d'un gabarit. Fonction pure (testable). */
export function renderTemplate(
  template: MailTemplateName,
  context: Record<string, unknown>,
): { subject: string; text: string; html: string } {
  const appUrl = String(context.appUrl ?? "");
  const name = typeof context.name === "string" && context.name.trim() ? context.name : "Bonjour";
  const link = (suffix: string, token?: unknown) =>
    token ? `${appUrl}${suffix}${suffix.includes("?") ? "&" : "?"}token=${encodeURIComponent(String(token))}` : appUrl;

  switch (template) {
    case "verify_address": {
      const url = link("/verify-email", context.token);
      return {
        subject: "Confirmez votre adresse e-mail",
        text: `${name},\n\nConfirmez votre adresse e-mail pour activer votre compte BelloAcademy :\n${url}\n\nCe lien expire dans 72 heures.`,
        html: layout(
          "Confirmez votre adresse e-mail",
          paragraph(`${name}, confirmez votre adresse e-mail pour activer votre compte. Ce lien expire dans 72 heures.`),
          { label: "Confirmer mon adresse", url },
        ),
      };
    }
    case "reset_password": {
      const url = link("/reset-password", context.token);
      return {
        subject: "Réinitialisation de votre mot de passe",
        text: `${name},\n\nVous avez demandé la réinitialisation de votre mot de passe :\n${url}\n\nCe lien expire dans une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
        html: layout(
          "Réinitialisation du mot de passe",
          paragraph(`${name}, utilisez le lien ci-dessous pour choisir un nouveau mot de passe. Il expire dans une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`),
          { label: "Choisir un nouveau mot de passe", url },
        ),
      };
    }
    case "organization_invite": {
      const url = link("/invitations", context.token);
      const organizationName = String(context.organizationName ?? "une organisation");
      return {
        subject: `Invitation à rejoindre ${organizationName}`,
        text: `${name},\n\nVous êtes invité(e) à rejoindre ${organizationName} sur BelloAcademy.\n${url}`,
        html: layout(
          `Invitation à rejoindre ${organizationName}`,
          paragraph(`${name}, vous êtes invité(e) à rejoindre ${organizationName} sur BelloAcademy.`),
          { label: "Accepter l'invitation", url },
        ),
      };
    }
    case "enrollment_confirmation": {
      const courseTitle = String(context.courseTitle ?? "une formation");
      const url = `${appUrl}/dashboard/learn/${String(context.courseId ?? "")}`;
      return {
        subject: `Inscription confirmée : ${courseTitle}`,
        text: `${name},\n\nVotre inscription à « ${courseTitle} » est confirmée.\nAccéder à la formation : ${url}`,
        html: layout(
          "Inscription confirmée",
          paragraph(`${name}, votre inscription à « ${courseTitle} » est confirmée. Bon apprentissage !`),
          { label: "Accéder à la formation", url },
        ),
      };
    }
    case "assignment_posted": {
      const title = String(context.title ?? "un devoir");
      const dueAt = context.dueAt ? `Échéance : ${new Date(String(context.dueAt)).toLocaleString("fr-TN")}.` : "";
      const url = `${appUrl}/dashboard/courses/${String(context.courseId ?? "")}`;
      return {
        subject: `Nouveau devoir : ${title}`,
        text: `${name},\n\nUn nouveau devoir a été publié : « ${title} ». ${dueAt}\n${url}`,
        html: layout("Nouveau devoir", paragraph(`${name}, un nouveau devoir a été publié : « ${title} ». ${dueAt}`), {
          label: "Ouvrir la formation",
          url,
        }),
      };
    }
    case "assignment_graded": {
      const title = String(context.assignmentTitle ?? "votre devoir");
      const score = context.score === null || context.score === undefined ? "corrigé" : `noté ${String(context.score)}`;
      const url = `${appUrl}/dashboard/assessments`;
      return {
        subject: `Devoir corrigé : ${title}`,
        text: `${name},\n\nVotre devoir « ${title} » a été ${score}.\n${url}`,
        html: layout("Devoir corrigé", paragraph(`${name}, votre devoir « ${title} » a été ${score}.`), {
          label: "Voir mes résultats",
          url,
        }),
      };
    }
    case "quiz_result": {
      const title = String(context.quizTitle ?? "votre évaluation");
      const score = `${String(context.score ?? 0)}/${String(context.maxScore ?? 0)}`;
      const passed = Boolean(context.passed);
      const url = `${appUrl}/dashboard/assessments`;
      return {
        subject: `Résultat : ${title} — ${score}`,
        text: `${name},\n\nVotre résultat pour « ${title} » est de ${score} (${passed ? "réussi" : "non validé"}).\n${url}`,
        html: layout(
          "Résultat d'évaluation",
          paragraph(`${name}, votre résultat pour « ${title} » est de ${score} — ${passed ? "réussi" : "non validé"}.`),
          { label: "Voir mes résultats", url },
        ),
      };
    }
    case "live_session_reminder": {
      const title = String(context.title ?? "une classe virtuelle");
      const startsAt = context.startsAt
        ? new Date(String(context.startsAt)).toLocaleString("fr-TN", { timeZone: String(context.timezone ?? "Africa/Tunis") })
        : "";
      const url = `${appUrl}/dashboard/live`;
      return {
        subject: `Rappel : ${title}`,
        text: `${name},\n\nRappel : « ${title} » commence le ${startsAt} (${String(context.timezone ?? "Africa/Tunis")}).\n${url}`,
        html: layout(
          "Rappel de classe virtuelle",
          paragraph(`${name}, « ${title} » commence le ${startsAt}. La salle ouvre 15 minutes avant le début.`),
          { label: "Voir le calendrier", url },
        ),
      };
    }
    case "billing_notice": {
      const subject = String(context.subject ?? "Information de facturation");
      const message = String(context.message ?? "");
      return {
        subject,
        text: `${name},\n\n${message}\n\n${appUrl}/dashboard/billing`,
        html: layout(subject, paragraph(message), { label: "Gérer mon abonnement", url: `${appUrl}/dashboard/billing` }),
      };
    }
    default: {
      const exhaustive: never = template;
      throw new Error(`Gabarit d'e-mail inconnu : ${String(exhaustive)}`);
    }
  }
}

async function sendWithSmtp(message: MailMessage): Promise<void> {
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport(env().SMTP_URL ?? "");
  await transport.sendMail({
    from: env().MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

async function writeToSpool(message: MailMessage): Promise<void> {
  const dir = path.resolve(process.cwd(), env().MAIL_SPOOL_DIR);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTo = message.to.replace(/[^a-zA-Z0-9._-]/g, "_");
  const base = path.join(dir, `${stamp}_${message.template}_${safeTo}`);
  await writeFile(`${base}.html`, message.html, "utf8");
  await writeFile(`${base}.txt`, `À: ${message.to}\nSujet: ${message.subject}\n\n${message.text}\n`, "utf8");
}

/**
 * Envoie un message et historise le résultat. Ne lève jamais : l'échec d'un
 * e-mail ne doit pas faire échouer la transaction métier qui l'a déclenché.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const driver = env().MAIL_DRIVER;
  try {
    if (driver === "smtp") await sendWithSmtp(message);
    else if (driver === "file") await writeToSpool(message);
    else logger.info("e-mail (mode console)", { to: message.to, subject: message.subject, template: message.template });

    await prismaPlatform.emailMessage.create({
      data: {
        toAddress: message.to,
        subject: message.subject,
        template: message.template,
        bodyText: message.text,
        bodyHtml: message.html,
        status: "SENT",
        driver,
        sentAt: new Date(),
      },
    });
    return { status: "SENT" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("échec d'envoi d'e-mail", { template: message.template, error: errorMessage });
    try {
      await prismaPlatform.emailMessage.create({
        data: {
          toAddress: message.to,
          subject: message.subject,
          template: message.template,
          status: "FAILED",
          driver,
          error: errorMessage.slice(0, 1000),
        },
      });
    } catch (loggingError) {
      logger.error("historisation d'e-mail impossible", { error: loggingError });
    }
    return { status: "FAILED", error: errorMessage };
  }
}

/** Construit puis envoie un message à partir d'un gabarit. */
export async function sendTemplateMail(input: {
  to: string;
  template: MailTemplateName;
  context: Record<string, unknown>;
}): Promise<MailResult> {
  const rendered = renderTemplate(input.template, { appUrl: env().APP_URL, ...input.context });
  return sendMail({ to: input.to, template: input.template, ...rendered });
}
