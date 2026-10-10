"use client";

/**
 * Réinitialisation du mot de passe à partir du jeton reçu par e-mail.
 *
 * Le jeton est transmis par l'URL ; le serveur vérifie sa validité, son
 * unicité d'usage et sa date d'expiration avant d'accepter le nouveau mot de
 * passe. Les sessions actives sont révoquées après le changement.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client/api";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");

    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      setPending(false);
      return;
    }

    try {
      await apiFetch<{ ok: true }>("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "La réinitialisation a échoué. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <Alert tone="warning" title="Lien incomplet">
        Ce lien ne contient pas de jeton de réinitialisation. Demandez un nouveau lien depuis la page de connexion.
      </Alert>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Mot de passe modifié">
          Votre mot de passe a été remplacé et vos sessions actives ont été déconnectées.
        </Alert>
        <Button size="lg" className="w-full" onClick={() => router.push("/connexion")}>
          Se connecter
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert tone="danger" title="Réinitialisation impossible">
          {error}
        </Alert>
      ) : null}

      <Field label="Nouveau mot de passe" name="password" required hint="10 caractères minimum.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>

      <Field label="Confirmer le mot de passe" name="confirmation" required>
        <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={10} />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Enregistrement…" : "Définir le nouveau mot de passe"}
      </Button>

      <p className="text-center text-sm text-ink-600">
        <Link href="/connexion" className="font-medium text-brand-700 hover:text-brand-600">
          Revenir à la connexion
        </Link>
      </p>
    </form>
  );
}
