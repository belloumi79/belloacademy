"use client";

/**
 * Bouton d'inscription à une formation.
 *
 * La mutation est faite côté navigateur car l'état renvoyé (inscription créée,
 * en attente de paiement, ou quota de forfait atteint) doit être affiché
 * immédiatement. Les droits réels sont revérifiés par l'API.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, ApiError } from "@/lib/client/api";
import { Alert, Button } from "@/components/ui";

type Props = {
  courseId: string;
  organizationId: string;
  isAuthenticated: boolean;
  isEnrolled: boolean;
  priceCents: number;
  courseSlug: string;
};

export function EnrollButton({
  courseId,
  organizationId,
  isAuthenticated,
  isEnrolled,
  priceCents,
  courseSlug,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="space-y-2">
        <Link
          href={`/connexion?suivant=${encodeURIComponent(`/formations/${courseSlug}`)}`}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-base font-medium text-white hover:bg-brand-700"
        >
          Se connecter pour s&apos;inscrire
        </Link>
        <p className="text-xs text-ink-500">Un compte est nécessaire pour suivre la formation.</p>
      </div>
    );
  }

  if (isEnrolled) {
    return (
      <Link
        href={`/tableau-de-bord/formations/${courseSlug}`}
        className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-base font-medium text-white hover:bg-brand-700"
      >
        Continuer la formation
      </Link>
    );
  }

  async function enroll() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch<{ enrollment: { status: string } }>("/api/enrollments", {
        method: "POST",
        body: { courseId, source: "SELF" },
        organizationId,
      });
      if (result.enrollment.status === "PENDING_PAYMENT") {
        setMessage(
          "Inscription enregistrée : le règlement de la formation doit être confirmé avant l'accès aux contenus.",
        );
      } else {
        setMessage("Inscription confirmée. Bon apprentissage !");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "L'inscription a échoué. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button size="lg" onClick={enroll} disabled={pending}>
        {pending ? "Inscription…" : priceCents === 0 ? "S'inscrire gratuitement" : "S'inscrire à cette formation"}
      </Button>
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
