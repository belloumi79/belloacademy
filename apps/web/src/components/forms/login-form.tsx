"use client";

/**
 * Connexion.
 *
 * Le serveur applique un verrouillage progressif par couple (adresse, IP) et
 * ne distingue jamais « compte inconnu » de « mot de passe incorrect ». Le
 * formulaire se contente d'afficher le message renvoyé.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client/api";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("suivant");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await apiFetch<{ user: { name: string } }>("/api/auth/login", {
        method: "POST",
        body: {
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        },
      });
      // `suivant` est une route interne : on n'accepte jamais d'URL absolue.
      const target = next && next.startsWith("/") ? next : "/tableau-de-bord";
      router.push(target);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "La connexion a échoué. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert tone="danger" title="Connexion refusée">
          {error}
        </Alert>
      ) : null}

      <Field label="Adresse e-mail" name="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>

      <Field label="Mot de passe" name="password" required>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>

      <div className="flex items-center justify-between text-sm">
        <Link href="/mot-de-passe-oublie" className="font-medium text-brand-700 hover:text-brand-600">
          Mot de passe oublié ?
        </Link>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>

      <p className="text-center text-sm text-ink-600">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="font-medium text-brand-700 hover:text-brand-600">
          Créer un compte
        </Link>
      </p>
    </form>
  );
}
