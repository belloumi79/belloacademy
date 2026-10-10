import type { Metadata } from "next";
import Link from "next/link";

import { Badge, ButtonLink, Card, CardBody, EmptyState } from "@/components/ui";
import { LIVE_SESSION_STATUS_LABELS, type LiveSessionStatus } from "@belloacademy/shared";
import { requirePageOrganization } from "@/server/page-context";
import { listUpcomingSessions } from "@/server/services/live";

export const metadata: Metadata = { title: "Classes virtuelles" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "brand" | "success" | "neutral" | "warning"> = {
  SCHEDULED: "brand",
  LIVE: "success",
  ENDED: "neutral",
  CANCELLED: "warning",
};

function formatRange(start: Date, end: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  };
  const formatter = new Intl.DateTimeFormat("fr-TN", { ...options, timeZone: timezone });
  const startLabel = formatter.format(start);
  const endLabel = new Intl.DateTimeFormat("fr-TN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(end);
  return `${startLabel} → ${endLabel} (${timezone})`;
}

export default async function LiveSessionsPage() {
  const page = await requirePageOrganization();
  const sessions = await listUpcomingSessions(page.organizationId, page.user.id, 30);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Classes virtuelles</h1>
        <p className="mt-1 text-sm text-ink-700">
          Vos prochaines sessions en direct, animées avec Jitsi Meet. L&apos;accès à la salle est vérifié côté serveur
          pour chaque participant.
        </p>
      </header>

      {sessions.length === 0 ? (
        <EmptyState
          title="Aucune classe virtuelle programmée"
          description="Les sessions planifiées par vos formateurs apparaîtront ici, avec les rappels envoyés avant chaque cours."
          action={
            <ButtonLink href="/tableau-de-bord/formations" variant="secondary">
              Voir mes formations
            </ButtonLink>
          }
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <Card className="h-full">
                <CardBody className="flex h-full flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONES[session.status] ?? "neutral"}>
                      {LIVE_SESSION_STATUS_LABELS[session.status as LiveSessionStatus] ?? session.status}
                    </Badge>
                    <Badge>{session.course.title}</Badge>
                  </div>
                  <h2 className="text-base font-semibold text-ink-900">{session.title}</h2>
                  <p className="text-sm text-ink-700">
                    {formatRange(session.scheduledStart, session.scheduledEnd, session.timezone)}
                  </p>
                  <p className="text-xs text-ink-500">Animation : {session.host.name}</p>
                  <div className="mt-auto pt-2">
                    <ButtonLink href={`/tableau-de-bord/classes-virtuelles/${session.id}`} size="sm">
                      Ouvrir la session
                    </ButtonLink>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-500">
        Besoin d&apos;un rappel par e-mail ? Les rappels sont envoyés automatiquement 30 minutes avant le début.{" "}
        <Link href="/tableau-de-bord/notifications" className="text-brand-700 hover:text-brand-600">
          Voir mes notifications
        </Link>
      </p>
    </div>
  );
}
