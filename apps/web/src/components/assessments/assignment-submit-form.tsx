"use client";

/**
 * Dépôt d'un devoir par un apprenant.
 *
 * Le texte et les pièces jointes sont envoyés au serveur, qui revalide
 * l'éligibilité (inscription, échéance, taille et type des fichiers). Les
 * fichiers passent d'abord par un ticket de dépôt (`/api/assignment-files`)
 * réservé aux apprenants, puis l'identifiant obtenu est joint à la soumission.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_UPLOAD_BYTES, formatBytes } from "@belloacademy/shared";

import { Alert, Button, Field, Textarea } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/client/api";

type UploadedFile = { assetId: string; filename: string; sizeBytes: number };

export function AssignmentSubmitForm({
  assignmentId,
  organizationId,
  initialText,
}: {
  assignmentId: string;
  organizationId: string;
  initialText: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function uploadOne(file: File): Promise<UploadedFile> {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        `« ${file.name} » dépasse la taille maximale de ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        413,
        "PAYLOAD_TOO_LARGE",
      );
    }

    const ticket = await apiFetch<{ assetId: string; uploadUrl: string }>("/api/assignment-files", {
      method: "POST",
      organizationId,
      body: { filename: file.name, mimeType: file.type, sizeBytes: file.size },
    });

    const response = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type, "x-organization-id": organizationId },
      credentials: "same-origin",
      body: file,
    });

    if (!response.ok) {
      throw new ApiError("Le transfert du fichier a échoué.", response.status, "UPLOAD_FAILED");
    }

    return { assetId: ticket.assetId, filename: file.name, sizeBytes: file.size };
  }

  async function onFilesSelected(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of Array.from(selected)) {
        uploaded.push(await uploadOne(file));
      }
      setFiles((current) => [...current, ...uploaded].slice(0, 10));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transfert impossible.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);
    try {
      await apiFetch(`/api/assignments/${assignmentId}/submissions`, {
        method: "POST",
        organizationId,
        body: { assignmentId, textContent: text, assetIds: files.map((file) => file.assetId) },
      });
      setSuccess(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Dépôt impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {success ? <Alert tone="success">Votre dépôt a été enregistré.</Alert> : null}

      <Field label="Votre travail" name="textContent" hint="Vous pouvez expliquer votre démarche ou coller votre réponse.">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          maxLength={20000}
          placeholder="Saisissez votre réponse…"
        />
      </Field>

      <Field label="Pièces jointes" name="files" hint="10 fichiers maximum, 25 Mo par fichier.">
        <input
          type="file"
          multiple
          onChange={(event) => void onFilesSelected(event.target.files)}
          className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-md file:border file:border-ink-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink-700"
        />
      </Field>

      {uploading ? <p className="text-sm text-ink-500">Transfert en cours…</p> : null}

      {files.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {files.map((file) => (
            <li key={file.assetId} className="flex items-center justify-between gap-3 rounded-md bg-ink-100 px-3 py-2">
              <span className="truncate text-ink-700">{file.filename}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-ink-500">{formatBytes(file.sizeBytes)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFiles((current) => current.filter((entry) => entry.assetId !== file.assetId))}
                >
                  Retirer
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Button type="submit" disabled={pending || uploading}>
        {pending ? "Envoi…" : "Déposer mon travail"}
      </Button>
    </form>
  );
}
