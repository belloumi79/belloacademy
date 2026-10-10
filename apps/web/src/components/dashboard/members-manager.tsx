"use client";

/**
 * Gestion des membres d'une organisation.
 *
 * Le serveur reste seul juge : chaque action rappelle l'API, qui revérifie la
 * permission et l'appartenance au tenant. Le composant ne fait que présenter
 * l'état renvoyé et rafraîchir la page après une mutation réussie.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ORG_ROLES, ROLE_LABELS, type OrgRole } from "@belloacademy/shared";

import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, Table } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/client/api";

export type MemberRow = {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  status: string;
  title: string | null;
  joinedAt: string | null;
  lastLoginAt: string | null;
};

export type InviteRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  INVITED: "Invité",
  SUSPENDED: "Suspendu",
};

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "INVITED") return "warning";
  if (status === "SUSPENDED") return "danger";
  return "neutral";
}

export function MembersManager({
  organizationId,
  canInvite,
  canUpdate,
  canRemove,
  members,
  invites,
}: {
  organizationId: string;
  canInvite: boolean;
  canUpdate: boolean;
  canRemove: boolean;
  members: MemberRow[];
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("LEARNER");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Opération impossible.");
    } finally {
      setPending(false);
    }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await apiFetch(`/api/organizations/${organizationId}/members`, {
        method: "POST",
        organizationId,
        body: { email, role },
      });
      setEmail("");
      setNotice(`Invitation envoyée à ${email}.`);
    });
  }

  async function changeRole(membershipId: string, nextRole: string) {
    await run(async () => {
      await apiFetch(`/api/organizations/${organizationId}/members/${membershipId}`, {
        method: "PATCH",
        organizationId,
        body: { role: nextRole },
      });
      setNotice("Rôle mis à jour.");
    });
  }

  async function toggleStatus(membershipId: string, current: string) {
    const next = current === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    await run(async () => {
      await apiFetch(`/api/organizations/${organizationId}/members/${membershipId}`, {
        method: "PATCH",
        organizationId,
        body: { status: next },
      });
      setNotice(next === "ACTIVE" ? "Accès réactivé." : "Accès suspendu.");
    });
  }

  async function remove(membershipId: string, label: string) {
    if (!window.confirm(`Retirer ${label} de l'organisation ? Cette action est immédiate.`)) return;
    await run(async () => {
      await apiFetch(`/api/organizations/${organizationId}/members/${membershipId}`, {
        method: "DELETE",
        organizationId,
      });
      setNotice("Membre retiré.");
    });
  }

  async function revoke(inviteId: string) {
    await run(async () => {
      await apiFetch(`/api/organizations/${organizationId}/invites/${inviteId}`, {
        method: "DELETE",
        organizationId,
      });
      setNotice("Invitation révoquée.");
    });
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {canInvite ? (
        <Card>
          <CardHeader title="Inviter une personne" description="Un e-mail contenant un lien d'activation est envoyé immédiatement." />
          <CardBody>
            <form className="flex flex-wrap items-end gap-3" onSubmit={invite}>
              <div className="min-w-[220px] flex-1">
                <Field label="Adresse e-mail" name="email" required>
                  <Input
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="prenom.nom@exemple.tn"
                  />
                </Field>
              </div>
              <div className="w-52">
                <Field label="Rôle" name="role" required>
                  <Select name="role" value={role} onChange={(event) => setRole(event.target.value as OrgRole)}>
                    {ORG_ROLES.map((value) => (
                      <option key={value} value={value}>
                        {ROLE_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? "Envoi…" : "Envoyer l'invitation"}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Membres" description={`${members.length} personne(s) rattachée(s) à cette organisation`} />
        <CardBody>
          {members.length === 0 ? (
            <EmptyState title="Aucun membre" description="Invitez un formateur ou un apprenant pour commencer." />
          ) : (
            <Table head={["Personne", "Rôle", "Statut", "Dernière connexion", "Actions"]}>
              {members.map((member) => (
                <tr key={member.membershipId}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink-900">{member.name}</p>
                    <p className="text-xs text-ink-500">{member.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {canUpdate ? (
                      <Select
                        aria-label={`Rôle de ${member.name}`}
                        value={member.role}
                        disabled={pending}
                        onChange={(event) => void changeRole(member.membershipId, event.target.value)}
                      >
                        {ORG_ROLES.map((value) => (
                          <option key={value} value={value}>
                            {ROLE_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      member.roleLabel
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(member.status)}>{STATUS_LABELS[member.status] ?? member.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {member.lastLoginAt ? DATE_FORMAT.format(new Date(member.lastLoginAt)) : "Jamais"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canUpdate ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => void toggleStatus(member.membershipId, member.status)}
                        >
                          {member.status === "SUSPENDED" ? "Réactiver" : "Suspendre"}
                        </Button>
                      ) : null}
                      {canRemove ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => void remove(member.membershipId, member.name)}
                        >
                          Retirer
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </CardBody>
      </Card>

      {invites.length > 0 ? (
        <Card>
          <CardHeader title="Invitations en attente" description={`${invites.length} invitation(s) non acceptée(s)`} />
          <CardBody>
            <Table head={["Adresse", "Rôle", "Expire le", "Actions"]}>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td className="px-4 py-3 text-ink-900">{invite.email}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {ROLE_LABELS[invite.role as OrgRole] ?? invite.role}
                  </td>
                  <td className="px-4 py-3 text-ink-600">{DATE_FORMAT.format(new Date(invite.expiresAt))}</td>
                  <td className="px-4 py-3">
                    {canInvite ? (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void revoke(invite.id)}>
                        Révoquer
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
