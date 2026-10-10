"use client";

/**
 * Marquage d'une leçon comme terminée.
 *
 * L'écriture est faite côté navigateur pour que la progression affichée
 * corresponde immédiatement à l'état serveur ; l'API revérifie l'inscription
 * avant d'enregistrer quoi que ce soit.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/client/api";

export function LessonCompleteButton({
  enrollmentId,
  lessonId,
  organizationId,
  completed,
}: {
  enrollmentId: string;
  lessonId: string;
  organizationId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/enrollments/${enrollmentId}`, {
        method: "PATCH",
        organizationId,
        body: { lessonId, completed: !completed },
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Enregistrement impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={toggle} disabled={pending} variant={completed ? "secondary" : "primary"}>
        {pending ? "Enregistrement…" : completed ? "Marquer comme non terminée" : "Marquer comme terminée"}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
