/** Organisations : /api/organizations/[...path] */

import { memberInviteSchema, memberUpdateSchema, organizationCreateSchema, organizationUpdateSchema } from "@belloacademy/shared";

import { requireAuth, requireSuperAdmin } from "@/lib/auth/authorization";
import { prismaPlatform } from "@/lib/db/prisma";
import { jsonCreated, jsonOk, parseBody, searchParams } from "@/lib/http/api";
import { orgScope, orgScopeFor } from "@/lib/http/tenant";
import { listAuditLogs } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import {
  createOrganization,
  getPlanLimits,
  getUsage,
  listOrganizationsForUser,
  updateOrganization,
} from "@/server/services/organizations";
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  setMemberStatus,
} from "@/server/services/members";
import { organizationOverview } from "@/server/services/dashboards";
import { createDispatcher } from "@/lib/http/dispatch";

export const runtime = "nodejs";

const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "",
    handler: async () => {
      const context = await requireAuth();
      const organizations = await listOrganizationsForUser(context.user.id);
      if (context.user.isSuperAdmin) {
        const all = await prismaPlatform.organization.findMany({
          where: { deletedAt: null },
          select: { id: true, slug: true, name: true, createdAt: true, plan: { select: { code: true, name: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
        return jsonOk({ organizations, all, isSuperAdmin: true });
      }
      return jsonOk({ organizations, isSuperAdmin: false });
    },
  },
  {
    method: "POST",
    pattern: "",
    handler: async ({ request }) => {
      const context = await requireAuth();
      const input = await parseBody(request, organizationCreateSchema);
      const organization = await createOrganization({
        name: input.name,
        slug: input.slug,
        ownerUserId: context.user.id,
        country: input.country,
        currency: input.currency,
        timezone: input.timezone,
        locale: input.locale,
      });
      return jsonCreated({ organization });
    },
  },
  {
    method: "GET",
    pattern: ":organizationId",
    handler: async ({ request, params }) => {
      const scope = await orgScope(request, "org:read");
      const organizationId = params.organizationId ?? scope.organizationId;
      const [organization, usage, limits, overview] = await Promise.all([
        prismaPlatform.organization.findFirst({
          where: { id: organizationId, deletedAt: null },
          select: {
            id: true,
            slug: true,
            name: true,
            legalName: true,
            billingEmail: true,
            country: true,
            currency: true,
            timezone: true,
            locale: true,
            logoUrl: true,
            brandColor: true,
            settings: true,
            trialEndsAt: true,
            createdAt: true,
            plan: { select: { id: true, code: true, name: true, limits: true, features: true } },
          },
        }),
        getUsage(organizationId),
        getPlanLimits(organizationId),
        organizationOverview(organizationId),
      ]);
      if (!organization) throw notFound("Organisation introuvable.");
      return jsonOk({ organization, usage, limits, overview });
    },
  },
  {
    method: "PATCH",
    pattern: ":organizationId",
    handler: async ({ request, params }) => {
      const { organizationId } = await orgScopeFor(params.organizationId, "org:update");
      const input = await parseBody(request, organizationUpdateSchema);
      const organization = await updateOrganization(organizationId, input);
      return jsonOk({ organization });
    },
  },
  {
    method: "GET",
    pattern: ":organizationId/members",
    handler: async ({ request, params }) => {
      const { organizationId } = await orgScopeFor(params.organizationId, "member:read");
      const query = searchParams(request);
      const role = query.get("role") ?? undefined;
      const status = query.get("status") ?? undefined;
      const [members, invites] = await Promise.all([
        listMembers(organizationId, {
          role: role as never,
          status: status as never,
          search: query.get("q") ?? undefined,
        }),
        listPendingInvites(organizationId),
      ]);
      return jsonOk({ members, invites });
    },
  },
  {
    method: "POST",
    pattern: ":organizationId/members",
    handler: async ({ request, params }) => {
      const scope = await orgScopeFor(params.organizationId, "member:invite");
      const input = await parseBody(request, memberInviteSchema);
      const result = await inviteMember({
        organizationId: scope.organizationId,
        email: input.email,
        role: input.role,
        title: null,
        invitedById: scope.userId,
      });
      return jsonCreated({ invite: result });
    },
  },
  {
    method: "PATCH",
    pattern: ":organizationId/members/:membershipId",
    handler: async ({ request, params }) => {
      const scope = await orgScopeFor(params.organizationId, "member:update");
      const input = await parseBody(request, memberUpdateSchema);
      const organizationId = scope.organizationId;
      const membershipId = params.membershipId ?? "";

      if (input.status) {
        const updated = await setMemberStatus({
          organizationId,
          membershipId,
          status: input.status,
          actorUserId: scope.userId,
        });
        return jsonOk({ membership: updated });
      }
      if (input.role) {
        const updated = await changeMemberRole({
          organizationId,
          membershipId,
          role: input.role,
          actorUserId: scope.userId,
        });
        return jsonOk({ membership: updated });
      }
      return jsonOk({ membership: null, message: "Aucun changement demandé." });
    },
  },
  {
    method: "DELETE",
    pattern: ":organizationId/members/:membershipId",
    handler: async ({ params }) => {
      const scope = await orgScopeFor(params.organizationId, "member:remove");
      await removeMember({
        organizationId: scope.organizationId,
        membershipId: params.membershipId ?? "",
        actorUserId: scope.userId,
      });
      return jsonOk({ removed: true });
    },
  },
  {
    method: "DELETE",
    pattern: ":organizationId/invites/:inviteId",
    handler: async ({ params }) => {
      const scope = await orgScopeFor(params.organizationId, "member:invite");
      await revokeInvite({
        organizationId: scope.organizationId,
        inviteId: params.inviteId ?? "",
        actorUserId: scope.userId,
      });
      return jsonOk({ revoked: true });
    },
  },
  {
    method: "GET",
    pattern: ":organizationId/audit",
    handler: async ({ request, params }) => {
      const { organizationId } = await orgScopeFor(params.organizationId, "audit:read");
      const query = searchParams(request);
      const logs = await listAuditLogs({
        organizationId,
        action: (query.get("action") ?? undefined) as never,
        limit: Number(query.get("limit") ?? 50) || 50,
      });
      return jsonOk({ logs });
    },
  },
  {
    method: "GET",
    pattern: "platform/all",
    handler: async () => {
      await requireSuperAdmin();
      const organizations = await prismaPlatform.organization.findMany({
        where: { deletedAt: null },
        select: { id: true, slug: true, name: true, createdAt: true, plan: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return jsonOk({ organizations });
    },
  },
]);

export const GET = dispatch.GET;
export const POST = dispatch.POST;
export const PATCH = dispatch.PATCH;
export const DELETE = dispatch.DELETE;
