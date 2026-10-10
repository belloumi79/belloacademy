"use client";

/**
 * Demande de réinitialisation de mot de passe.
 *
 * La réponse est volontairement identique que l'adresse existe ou non :
 * le serveur ne révèle jamais si un compte est rattaché à un e-mail.
 */

import Link from "next/link";
import { useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client/api";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await apiFetch<{ ok: true }>("/api/auth/forgot-password", {
        method: "POST",
        body: { email: String(data.get("email") ?? "") },
      });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "La demande a échoué. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Demande enregistrée">
          Si un compte est associé à cette adresse, un lien de réinitialisation vient d&apos;être envoyé. Le lien est
          valable une heure.
        </Alert>
        <Link href="/connexion" className="block text-center text-sm font-medium text-brand-700 hover:text-brand-600">
          Revenir à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert tone="danger" title="Demande impossible">
          {error}
        </Alert>
      ) : null}

      <Field
        label="Adresse e-mail"
        name="email"
        required
        hint="Saisissez l'adresse utilisée lors de votre inscription."
      >
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Envoi…" : "Recevoir un lien de réinitialisation"}
      </Button>

      <p className="text-center text-sm text-ink-600">
        <Link href="/connexion" className="font-medium text-brand-700 hover:text-brand-600">
          Revenir à la connexion
        </Link>
      </p>
    </form>
  );
}
