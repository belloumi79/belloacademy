/**
 * Membres d'une organisation : invitations, rôles, suspension, retrait.
 *
 * Règles de sécurité portées par ce module (et vérifiées par les tests) :
 *  - une organisation ne peut jamais se retrouver sans administrateur actif ;
 *  - un membre ne peut pas modifier son propre rôle ;
 *  - l'invitation respecte la limite « users » du forfait ;
 *  - aucune opération inter-tenant n'est possible : tout passe par `withTenant`.
 */

import type { OrgRole } from "@belloacademy/shared";
import { ROLE_LABELS } from "@belloacademy/shared";

import { prisma, prismaPlatform, withTenant } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { hashToken, generateOpaqueToken } from "@/lib/auth/tokens";
import { assertWithinPlan, incrementUsage } from "@/server/services/organizations";

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type MemberSummary = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  roleLabel: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  title: string | null;
  joinedAt: Date | null;
  lastLoginAt: Date | null;
};

export async function listMembers(
  organizationId: string,
  filters: { role?: OrgRole; status?: "INVITED" | "ACTIVE" | "SUSPENDED"; search?: string } = {},
): Promise<MemberSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId,
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search
        ? {
            user: {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" } },
                { email: { contains: filters.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    roleLabel: ROLE_LABELS[membership.role],
    status: membership.status,
    title: membership.title,
    joinedAt: membership.joinedAt,
    lastLoginAt: membership.user.lastLoginAt,
  }));
}

export async function getMember(organizationId: string, membershipId: string) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
  });
  if (!membership) throw notFound("Membre introuvable.");
  return membership;
}

/** Nombre d'administrateurs actifs : garde-fou contre l'orphelinage d'une organisation. */
async function countActiveAdmins(organizationId: string, excludingMembershipId?: string): Promise<number> {
  return prisma.membership.count({
    where: {
      organizationId,
      role: "ORG_ADMIN",
      status: "ACTIVE",
      ...(excludingMembershipId ? { id: { not: excludingMembershipId } } : {}),
    },
  });
}

export type InviteMemberInput = {
  organizationId: string;
  email: string;
  role: OrgRole;
  invitedById: string;
  title?: string | null;
};

/**
 * Invite un utilisateur. Si l'adresse correspond à un compte existant, une
 * appartenance au statut `INVITED` est créée ; sinon l'invitation reste
 * rattachée à l'adresse e-mail et sera consommée à l'inscription.
 */
export async function inviteMember(input: InviteMemberInput) {
  const email = input.email.trim().toLowerCase();

  await assertWithinPlan(input.organizationId, "users", 1);

  const existingUser = await prismaPlatform.user.findUnique({ where: { email }, select: { id: true } });

  const { token, tokenHash, expiresAt } = (() => {
    const raw = generateOpaqueToken();
    return {
      token: raw,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_SECONDS * 1000),
    };
  })();

  const result = await withTenant(input.organizationId, async (tx) => {
    const duplicate = await tx.membershipInvite.findFirst({
      where: { organizationId: input.organizationId, email, acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    if (duplicate) throw conflict("Une invitation est déjà en attente pour cette adresse.");

    if (existingUser) {
      const alreadyMember = await tx.membership.findFirst({
        where: { organizationId: input.organizationId, userId: existingUser.id },
        select: { id: true },
      });
      if (alreadyMember) throw conflict("Cette personne est déjà membre de l'organisation.");
    }

    const invite = await tx.membershipInvite.create({
      data: {
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash,
        invitedById: input.invitedById,
        expiresAt,
      },
      select: { id: true },
    });

    if (existingUser) {
      await tx.membership.create({
        data: {
          userId: existingUser.id,
          organizationId: input.organizationId,
          role: input.role,
          status: "INVITED",
          title: input.title ?? null,
          invitedById: input.invitedById,
        },
      });
    }

    return invite;
  });

  await recordAudit({
    action: "membership.invited",
    organizationId: input.organizationId,
    actorUserId: input.invitedById,
    entityType: "MembershipInvite",
    entityId: result.id,
    metadata: { email, role: input.role },
  });

  await enqueue("email.send", {
    to: email,
    template: "organization_invite",
    context: { role: input.role, roleLabel: ROLE_LABELS[input.role], inviteToken: token },
  });

  await incrementUsage(input.organizationId, "users", 1).catch((error) => {
    logger.warn("compteur « users » non incrémenté", { organizationId: input.organizationId, error });
  });

  return { inviteId: result.id, token, expiresAt };
}

export async function listPendingInvites(organizationId: string) {
  return prisma.membershipInvite.findMany({
    where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  });
}

export async function revokeInvite(input: { organizationId: string; inviteId: string; actorUserId: string }) {
  const revoked = await withTenant(input.organizationId, async (tx) => {
    const invite = await tx.membershipInvite.findFirst({
      where: { id: input.inviteId, organizationId: input.organizationId },
      select: { id: true, email: true },
    });
    if (!invite) throw notFound("Invitation introuvable.");
    await tx.membershipInvite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });
    await tx.membership.deleteMany({
      where: { organizationId: input.organizationId, status: "INVITED", user: { email: invite.email } },
    });
    return invite;
  });

  await recordAudit({
    action: "membership.removed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "MembershipInvite",
    entityId: revoked.id,
    metadata: { email: revoked.email, reason: "invitation révoquée" },
  });

  return revoked;
}

export async function changeMemberRole(input: {
  organizationId: string;
  membershipId: string;
  role: OrgRole;
  actorUserId: string;
}) {
  const membership = await getMember(input.organizationId, input.membershipId);

  if (membership.userId === input.actorUserId) {
    throw forbidden("Vous ne pouvez pas modifier votre propre rôle.");
  }

  if (membership.role === "ORG_ADMIN" && input.role !== "ORG_ADMIN") {
    const remaining = await countActiveAdmins(input.organizationId, membership.id);
    if (remaining === 0) {
      throw conflict("L'organisation doit conserver au moins un administrateur actif.");
    }
  }

  const updated = await withTenant(input.organizationId, (tx) =>
    tx.membership.update({
      where: { id: membership.id },
      data: { role: input.role },
      select: { id: true, role: true, userId: true },
    }),
  );

  await recordAudit({
    action: "membership.role_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Membership",
    entityId: membership.id,
    metadata: { from: membership.role, to: input.role, targetUserId: membership.userId },
  });

  return updated;
}

export async function setMemberStatus(input: {
  organizationId: string;
  membershipId: string;
  status: "ACTIVE" | "SUSPENDED";
  actorUserId: string;
}) {
  const membership = await getMember(input.organizationId, input.membershipId);

  if (membership.userId === input.actorUserId && input.status === "SUSPENDED") {
    throw forbidden("Vous ne pouvez pas suspendre votre propre compte.");
  }

  if (membership.role === "ORG_ADMIN" && input.status === "SUSPENDED") {
    const remaining = await countActiveAdmins(input.organizationId, membership.id);
    if (remaining === 0) {
      throw conflict("L'organisation doit conserver au moins un administrateur actif.");
    }
  }

  const updated = await withTenant(input.organizationId, (tx) =>
    tx.membership.update({
      where: { id: membership.id },
      data: { status: input.status },
      select: { id: true, status: true },
    }),
  );

  await recordAudit({
    action: input.status === "SUSPENDED" ? "membership.removed" : "membership.role_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Membership",
    entityId: membership.id,
    metadata: { status: input.status, targetUserId: membership.userId },
  });

  return updated;
}

export async function removeMember(input: {
  organizationId: string;
  membershipId: string;
  actorUserId: string;
}) {
  const membership = await getMember(input.organizationId, input.membershipId);

  if (membership.userId === input.actorUserId) {
    throw forbidden("Vous ne pouvez pas vous retirer vous-même de l'organisation.");
  }
  if (membership.role === "ORG_ADMIN") {
    const remaining = await countActiveAdmins(input.organizationId, membership.id);
    if (remaining === 0) {
      throw conflict("L'organisation doit conserver au moins un administrateur actif.");
    }
  }

  await withTenant(input.organizationId, (tx) =>
    tx.membership.delete({ where: { id: membership.id } }),
  );

  await recordAudit({
    action: "membership.removed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: "Membership",
    entityId: membership.id,
    metadata: { targetUserId: membership.userId, role: membership.role },
  });

  return { removed: true };
}

/**
 * Consomme une invitation à l'inscription : rattache l'utilisateur à
 * l'organisation avec le rôle prévu. Idempotent si l'appartenance existe déjà.
 */
export async function consumeInvite(input: { token: string; userId: string; userEmail: string }) {
  const tokenHash = hashToken(input.token);
  const invite = await prismaPlatform.membershipInvite.findFirst({
    where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, organizationId: true, email: true, role: true },
  });
  if (!invite) throw notFound("Invitation invalide ou expirée.");

  if (invite.email.toLowerCase() !== input.userEmail.trim().toLowerCase()) {
    throw forbidden("Cette invitation ne correspond pas à votre adresse e-mail.");
  }

  await withTenant(invite.organizationId, async (tx) => {
    const existing = await tx.membership.findFirst({
      where: { organizationId: invite.organizationId, userId: input.userId },
      select: { id: true, status: true },
    });
    if (existing) {
      await tx.membership.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", joinedAt: new Date(), role: invite.role },
      });
    } else {
      await tx.membership.create({
        data: {
          userId: input.userId,
          organizationId: invite.organizationId,
          role: invite.role,
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      });
    }
    await tx.membershipInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  });

  await recordAudit({
    action: "membership.invite_accepted",
    organizationId: invite.organizationId,
    actorUserId: input.userId,
    entityType: "MembershipInvite",
    entityId: invite.id,
    metadata: { role: invite.role },
  });

  return { organizationId: invite.organizationId, role: invite.role };
}
