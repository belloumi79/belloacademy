"use client";

/**
 * Formulaires du profil.
 *
 * Les deux formulaires écrivent côté serveur puis rafraîchissent la route :
 * aucune valeur n'est considérée comme appliquée tant que l'API n'a pas
 * confirmé. Le mot de passe suit exactement la politique du serveur (longueur
 * et diversité des caractères) pour éviter un aller-retour inutile.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/client/api";

const LOCALE_OPTIONS = [
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
];

export function ProfileForm({
  initial,
}: {
  initial: { name: string; locale: string; timezone: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [locale, setLocale] = useState(initial.locale);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch("/api/me", {
        method: "PATCH",
        body: { name, locale, timezone },
      });
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Enregistrement impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">Profil mis à jour.</Alert> : null}

      <Field label="Nom complet" name="name" required>
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Langue de l'interface" name="locale">
          <Select id="locale" name="locale" value={locale} onChange={(event) => setLocale(event.target.value)}>
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Fuseau horaire"
          name="timezone"
          hint="Utilisé pour les classes virtuelles et les échéances."
        >
          <Input
            id="timezone"
            name="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Africa/Tunis"
            maxLength={64}
          />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (newPassword !== confirmation) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }

    setPending(true);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Changement impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? (
        <Alert tone="success">Mot de passe modifié. Vos autres sessions ont été fermées.</Alert>
      ) : null}

      <Field label="Mot de passe actuel" name="currentPassword" required>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nouveau mot de passe"
          name="newPassword"
          hint="10 caractères minimum, trois types de caractères."
          required
        >
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={10}
            maxLength={200}
            required
          />
        </Field>

        <Field label="Confirmation" name="confirmation" required>
          <Input
            id="confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Modification…" : "Modifier le mot de passe"}
      </Button>
    </form>
  );
}
