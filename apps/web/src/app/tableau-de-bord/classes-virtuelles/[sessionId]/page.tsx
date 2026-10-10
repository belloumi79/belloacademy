import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, Badge, Card, CardBody, Stat } from "@/components/ui";
import { JitsiRoom } from "@/components/live/jitsi-room";
import { LIVE_SESSION_STATUS_LABELS, type LiveSessionStatus } from "@belloacademy/shared";
import { can, requirePageOrganization } from "@/server/page-context";
import { decideJoin, getLiveSession } from "@/server/services/live";

export const metadata: Metadata = { title: "Classe virtuelle" };
export const dynamic = "force-dynamic";

export default async function LiveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const page = await requirePageOrganization();

  let session: Awaited<ReturnType<typeof getLiveSession>>;
  try {
    session = await getLiveSession(page.organizationId, sessionId);
  } catch {
    notFound();
  }

  const isOrgStaff = can(page, "live:manage");
  const { decision } = await decideJoin({
    organizationId: page.organizationId,
    sessionId,
    userId: page.user.id,
    isOrgStaff,
  });

  const attended = session.attendances.filter((attendance) => attendance.userId === page.user.id);
  const totalMinutes = Math.round(
    attended.reduce((sum, attendance) => sum + attendance.durationSeconds, 0) / 60,
  );

  return (
    <div className="space-y-6">
      <nav aria-label="Fil d'Ariane" className="text-xs text-ink-500">
        <Link href="/tableau-de-bord/classes-virtuelles" className="hover:text-brand-700">
          Classes virtuelles
        </Link>
        <span aria-hidden> / </span>
        <span>{session.title}</span>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={session.status === "LIVE" ? "success" : "brand"}>
            {LIVE_SESSION_STATUS_LABELS[session.status as LiveSessionStatus] ?? session.status}
          </Badge>
          <Badge>{session.course.title}</Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{session.title}</h1>
        {session.description ? <p className="max-w-3xl text-sm text-ink-700">{session.description}</p> : null}
        <p className="text-sm text-ink-500">
          {new Intl.DateTimeFormat("fr-TN", {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: session.timezone,
          }).format(session.scheduledStart)}{" "}
          · {session.timezone} · animation {session.host.name}
        </p>
      </header>

      {decision.allowed ? (
        <JitsiRoom
          sessionId={session.id}
          organizationId={page.organizationId}
          courseSlug={session.course.slug}
          title="Salle de classe virtuelle"
        />
      ) : (
        <Alert tone="warning" title="Accès à la salle indisponible">
          {decision.message ??
            "Vous ne pouvez pas rejoindre cette session pour le moment. Vérifiez votre inscription à la formation."}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Participants enregistrés" value={session.attendances.length} />
        <Stat label="Vos passages" value={attended.length} hint={totalMinutes > 0 ? `${totalMinutes} min au total` : undefined} />
        <Stat label="Votre rôle" value={decision.role === "PARTICIPANT" ? "Participant" : decision.role} />
      </div>

      {isOrgStaff ? (
        <Card>
          <CardBody>
            <h2 className="text-sm font-semibold text-ink-900">Suivi de présence (animateurs)</h2>
            <ul className="mt-3 divide-y divide-ink-100 text-sm">
              {session.attendances.length === 0 ? (
                <li className="py-2 text-ink-500">Aucune connexion enregistrée pour l&apos;instant.</li>
              ) : (
                session.attendances.map((attendance) => (
                  <li key={attendance.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="font-medium text-ink-800">{attendance.user.name}</span>
                    <span className="text-ink-500">
                      {new Intl.DateTimeFormat("fr-TN", { dateStyle: "short", timeStyle: "short" }).format(
                        attendance.joinedAt,
                      )}
                      {attendance.durationSeconds > 0
                        ? ` · ${Math.round(attendance.durationSeconds / 60)} min`
                        : " · en cours"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
