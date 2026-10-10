"use client";

/**
 * Inscription.
 *
 * Deux parcours dans le même formulaire :
 *  - avec un nom d'organisation : le compte devient administrateur de sa propre
 *    organisation (essai gratuit du forfait par défaut) ;
 *  - sans nom d'organisation : le compte rejoint la plateforme comme apprenant
 *    et pourra être invité par une organisation.
 *
 * Un jeton d'invitation (`?invitation=…`) rattache le nouveau compte à
 * l'organisation émettrice avec le rôle prévu.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client/api";

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invitation");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    const organizationName = String(data.get("organizationName") ?? "").trim();

    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      setPending(false);
      return;
    }

    try {
      await apiFetch<{ user: { id: string } }>("/api/auth/register", {
        method: "POST",
        body: {
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          password,
          ...(organizationName ? { organizationName } : {}),
          ...(inviteToken ? { inviteToken } : {}),
        },
      });
      router.push("/verifier-email");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "La création du compte a échoué. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert tone="danger" title="Inscription impossible">
          {error}
        </Alert>
      ) : null}

      {inviteToken ? (
        <Alert tone="neutral" title="Invitation détectée">
          Votre compte rejoindra l&apos;organisation qui vous a invité, avec le rôle prévu par l&apos;invitation.
        </Alert>
      ) : null}

      <Field label="Nom complet" name="name" required>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>

      <Field label="Adresse e-mail" name="email" required hint="Un lien de confirmation vous sera envoyé.">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Mot de passe" name="password" required hint="10 caractères minimum.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>

      <Field label="Confirmer le mot de passe" name="confirmation" required>
        <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={10} />
      </Field>

      {inviteToken ? null : (
        <Field
          label="Nom de votre organisation (facultatif)"
          name="organizationName"
          hint="Laissez vide pour un compte apprenant. Vous pourrez créer votre organisation plus tard."
        >
          <Input id="organizationName" name="organizationName" autoComplete="organization" />
        </Field>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Création du compte…" : "Créer mon compte"}
      </Button>

      <p className="text-center text-sm text-ink-600">
        Déjà inscrit ?{" "}
        <Link href="/connexion" className="font-medium text-brand-700 hover:text-brand-600">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
