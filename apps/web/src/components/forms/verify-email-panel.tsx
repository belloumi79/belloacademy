"use client";

/**
 * Vérification de l'adresse e-mail.
 *
 * Le jeton arrive par le lien de l'e-mail (`?token=…`). L'appel est déclenché
 * une seule fois au montage : le jeton est à usage unique, un second appel
 * échouerait et afficherait un faux message d'erreur.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client/api";

type State = { kind: "pending" } | { kind: "success" } | { kind: "error"; message: string };

export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? { kind: "pending" } : { kind: "error", message: "Lien incomplet." });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    apiFetch<{ user: { emailVerified: boolean } }>("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    })
      .then(() => setState({ kind: "success" }))
      .catch((cause: unknown) =>
        setState({
          kind: "error",
          message:
            cause instanceof ApiError
              ? cause.message
              : "La vérification a échoué. Le lien a peut-être expiré.",
        }),
      );
  }, [token]);

  if (state.kind === "pending") {
    return (
      <p role="status" className="text-sm text-ink-600">
        Vérification en cours…
      </p>
    );
  }

  if (state.kind === "success") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Adresse e-mail confirmée">
          Votre compte est vérifié. Vous pouvez désormais vous inscrire aux formations et rejoindre les classes virtuelles.
        </Alert>
        <DashboardLink />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="danger" title="Vérification impossible">
        {state.message}
      </Alert>
      <p className="text-sm text-ink-600">
        Connectez-vous puis demandez un nouvel envoi depuis votre espace personnel, ou{" "}
        <Link href="/connexion" className="font-medium text-brand-700 hover:text-brand-600">
          retournez à la connexion
        </Link>
        .
      </p>
    </div>
  );
}

function DashboardLink() {
  return (
    <Link
      href="/tableau-de-bord"
      className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
    >
      Ouvrir mon espace
    </Link>
  );
}
