/** Profil de l'utilisateur connecté : /api/me */

import { updateProfileSchema } from "@belloacademy/shared";

import { requireAuth } from "@/lib/auth/authorization";
import { jsonOk, parseBody, route } from "@/lib/http/api";
import { listActiveSessions, updateProfile } from "@/server/services/accounts";

export const GET = route(async () => {
  const context = await requireAuth();
  return jsonOk({
    user: context.user,
    memberships: context.memberships,
    sessions: await listActiveSessions(context.user.id),
  });
});

export const PATCH = route(async ({ request }) => {
  const context = await requireAuth();
  const input = await parseBody(request, updateProfileSchema);
  const user = await updateProfile({ userId: context.user.id, ...input });
  return jsonOk({ user });
});
