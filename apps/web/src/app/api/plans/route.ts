/** Forfaits publics : /api/plans */

import { jsonOk, route } from "@/lib/http/api";
import { listPublicPlans } from "@/server/services/billing";

export const GET = route(async () => jsonOk({ plans: await listPublicPlans() }), { csrf: false });
