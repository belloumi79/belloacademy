"use client";

/**
 * Liste des notifications avec marquage « lu ».
 *
 * Les données arrivent du serveur : ce composant ne fait que l'affichage et
 * l'appel de mise à jour, puis rafraîchit la route pour refléter l'état réel.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, Badge, Button } from "@/components/ui";
import { apiFetch } from "@/lib/client/api";

export type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationList({
  notifications,
  unreadCount,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function markRead(payload: { all?: boolean; ids?: string[] }) {
    setError(null);
    setBusyId(payload.all ? "all" : payload.ids?.[0] ?? null);
    try {
      await apiFetch("/api/notifications", { method: "POST", body: payload });
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mise à jour impossible.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || busyId === "all"}
            onClick={() => void markRead({ all: true })}
          >
            {busyId === "all" ? "Marquage…" : "Tout marquer comme lu"}
          </Button>
        </div>
      ) : null}

      <ul className="divide-y divide-ink-200">
        {notifications.map((notification) => (
          <li key={notification.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-ink-900">{notification.title}</p>
                {notification.readAt ? null : <Badge tone="brand">Nouveau</Badge>}
              </div>
              {notification.body ? (
                <p className="mt-1 text-sm text-ink-600">{notification.body}</p>
              ) : null}
              <p className="mt-1 text-xs text-ink-500">
                {DATE_FORMAT.format(new Date(notification.createdAt))}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {notification.href ? (
                <Button variant="ghost" size="sm" onClick={() => router.push(notification.href as string)}>
                  Ouvrir
                </Button>
              ) : null}
              {notification.readAt ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === notification.id}
                  onClick={() => void markRead({ ids: [notification.id] })}
                >
                  {busyId === notification.id ? "…" : "Marquer lu"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
