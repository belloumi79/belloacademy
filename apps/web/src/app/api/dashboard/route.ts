/** Tableau de bord adapté au rôle : /api/dashboard */

import { jsonOk, route, searchParams } from "@/lib/http/api";
import { orgAccess } from "@/lib/http/tenant";
import { hasAnyPermission } from "@belloacademy/shared";
import {
  instructorOverview,
  learnerOverview,
  organizationOverview,
  platformOverview,
  type DateRange,
} from "@/server/services/dashboards";

function rangeFrom(params: URLSearchParams): DateRange | undefined {
  const days = Number(params.get("days") ?? 30);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  const to = new Date();
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

export const GET = route(async ({ request }) => {
  const scope = await orgAccess(request);
  const params = searchParams(request);
  const range = rangeFrom(params);
  const view = params.get("view");

  if (view === "platform" || scope.role === "SUPER_ADMIN") {
    return jsonOk({ view: "platform", data: await platformOverview(range) });
  }

  const isInstructor = hasAnyPermission(scope.role, ["course:create", "course:publish"]);

  if (view === "instructor" || (isInstructor && view !== "learner")) {
    return jsonOk({
      view: "instructor",
      data: await instructorOverview(scope.organizationId, scope.userId),
      organization: await organizationOverview(scope.organizationId, range),
    });
  }

  return jsonOk({
    view: "learner",
    data: await learnerOverview(scope.organizationId, scope.userId),
  });
});
