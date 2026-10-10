import type { Metadata } from "next";

import { MembersManager } from "@/components/dashboard/members-manager";
import { can, requirePageOrganization } from "@/server/page-context";
import { listMembers, listPendingInvites } from "@/server/services/members";

export const metadata: Metadata = { title: "Membres et invitations" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const page = await requirePageOrganization();

  const [members, invites] = await Promise.all([
    listMembers(page.organizationId),
    listPendingInvites(page.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Membres et invitations</h1>
        <p className="mt-1 text-sm text-ink-600">
          Gérez les personnes rattachées à {page.organizationName ?? "votre organisation"}, leur rôle et leur accès.
        </p>
      </header>

      <MembersManager
        organizationId={page.organizationId}
        canInvite={can(page, "member:invite")}
        canUpdate={can(page, "member:update")}
        canRemove={can(page, "member:remove")}
        members={members.map((member) => ({
          membershipId: member.membershipId,
          name: member.name,
          email: member.email,
          role: member.role,
          roleLabel: member.roleLabel,
          status: member.status,
          title: member.title,
          joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
          lastLoginAt: member.lastLoginAt ? member.lastLoginAt.toISOString() : null,
        }))}
        invites={invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
