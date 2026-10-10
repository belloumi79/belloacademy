import type { Metadata } from "next";

import { ROLE_LABELS, type OrgRole } from "@belloacademy/shared";

import { PasswordForm, ProfileForm } from "@/components/forms/profile-form";
import { LogoutButton } from "@/components/forms/logout-button";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { requirePageSession } from "@/server/page-context";
import { getUserProfile, listActiveSessions } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Profil et sécurité" };
export const dynamic = "force-dynamic";

const SESSION_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export default async function ProfilePage() {
  const context = await requirePageSession("/tableau-de-bord/profil");
  const [profile, sessions] = await Promise.all([
    getUserProfile(context.user.id),
    listActiveSessions(context.user.id),
  ]);

  if (!profile) {
    return (
      <Alert tone="danger" title="Profil indisponible">
        Votre compte n&apos;a pas pu être chargé. Contactez le support si le problème persiste.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Profil et sécurité</h1>
        <p className="mt-1 text-sm text-ink-600">
          Votre identité, vos préférences et les accès ouverts sur votre compte.
        </p>
      </header>

      {profile.emailVerifiedAt ? null : (
        <Alert tone="warning" title="Adresse e-mail non vérifiée">
          Vérifiez votre adresse e-mail pour débloquer toutes les fonctionnalités de la plateforme.
        </Alert>
      )}

      <Card>
        <CardHeader title="Identité" description={profile.email} />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={profile.status === "ACTIVE" ? "success" : "warning"}>{profile.status}</Badge>
            {profile.isSuperAdmin ? <Badge tone="brand">Superadministrateur</Badge> : null}
            <Badge tone={profile.emailVerifiedAt ? "success" : "warning"}>
              {profile.emailVerifiedAt ? "E-mail vérifié" : "E-mail à vérifier"}
            </Badge>
          </div>
          <ProfileForm
            initial={{ name: profile.name, locale: profile.locale, timezone: profile.timezone }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Organisations"
          description="Vous changez d'organisation depuis l'espace de travail ; vos droits y sont recalculés."
        />
        <CardBody>
          {profile.memberships.length === 0 ? (
            <p className="text-sm text-ink-500">
              Vous n&apos;appartenez encore à aucune organisation. Créez-en une ou attendez une invitation.
            </p>
          ) : (
            <ul className="divide-y divide-ink-200">
              {profile.memberships.map((membership) => (
                <li key={membership.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium text-ink-900">{membership.organization.name}</p>
                    <p className="text-xs text-ink-500">/{membership.organization.slug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{ROLE_LABELS[membership.role as OrgRole] ?? membership.role}</Badge>
                    <Badge tone={membership.status === "ACTIVE" ? "success" : "warning"}>
                      {membership.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mot de passe" description="Le changement ferme toutes vos autres sessions." />
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sessions actives"
          description={`${sessions.length} session(s) ouverte(s) sur votre compte.`}
        />
        <CardBody className="space-y-4">
          <ul className="divide-y divide-ink-200 text-sm">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-800">
                    {session.userAgent ? session.userAgent.slice(0, 80) : "Appareil inconnu"}
                    {session.id === context.sessionId ? " — session courante" : ""}
                  </p>
                  <p className="text-xs text-ink-500">
                    {session.ip ? `IP ${session.ip} · ` : ""}ouverte le{" "}
                    {SESSION_FORMAT.format(new Date(session.createdAt))}
                  </p>
                </div>
                {session.id === context.sessionId ? <Badge tone="brand">Actuelle</Badge> : null}
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-200 pt-4">
            <LogoutButton />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
