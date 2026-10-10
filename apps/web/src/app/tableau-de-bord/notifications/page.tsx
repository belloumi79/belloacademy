import type { Metadata } from "next";
import Link from "next/link";

import { formatDateTime } from "@belloacademy/shared";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { requirePageSession } from "@/server/page-context";
import { listNotifications, countUnreadNotifications } from "@/server/services/notifications";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const context = await requirePageSession("/tableau-de-bord/notifications");
  const [{ notifications, unreadCount }] = await Promise.all([
    listNotifications(context.user.id, { limit: 50 }),
    countUnreadNotifications(context.user.id),
  ]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Notifications</h1>
          <p className="mt-1 text-sm text-ink-600">
            Suivi des inscriptions, devoirs, classes virtuelles et opérations de facturation.
          </p>
        </div>
        {unreadCount > 0 ? <Badge tone="brand">{unreadCount} non lue(s)</Badge> : null}
      </header>

      {notifications.length === 0 ? (
        <EmptyState
          title="Aucune notification"
          description="Vous serez averti ici dès qu'une activité vous concerne : résultat d'évaluation, nouveau devoir, rappel de classe virtuelle ou facture."
        />
      ) : (
        <ul className="space-y-3">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <Card>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={notification.readAt ? "neutral" : "brand"}>
                      {notification.readAt ? "Lue" : "Nouvelle"}
                    </Badge>
                    <span className="text-xs text-ink-500">
                      {formatDateTime(notification.createdAt)}
                    </span>
                  </div>
                  <p className="font-medium text-ink-900">{notification.title}</p>
                  {notification.body ? (
                    <p className="text-sm text-ink-600">{notification.body}</p>
                  ) : null}
                  {notification.href ? (
                    <Link
                      href={notification.href}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Ouvrir
                    </Link>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader
          title="Préférences d'envoi"
          description="Les notifications sont créées côté serveur par les tâches applicatives. Les e-mails transactionnels reprennent le même contenu."
        />
      </Card>
    </div>
  );
}
