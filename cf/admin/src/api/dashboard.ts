import { Hono } from "hono";
import { requireAdmin } from "../auth/guard";
import { visibleAreas } from "../auth/permissions";
import type { AppEnv } from "../context";
import { loadDashboard } from "../dashboard/queries";

// GET /api/dashboard: the "Perlu perhatian" block of the dashboard (the contract
// is at the top of spa/src/lib/dashboard.ts, the rules in src/dashboard/).
//
// Open to every admin role, because the dashboard has no area. What it answers
// is limited to the areas the caller may see: an item of an area they cannot
// open is not computed and not sent (an editor of `konten` alone gets an empty
// `attention` and the database is not asked anything). Counts and links only;
// no name, address or message text ever leaves here. Not cacheable: the answer
// depends on the session (src/worker.ts puts no-store on everything under /api).
export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/", requireAdmin(), async (c) => {
  const user = c.get("user");
  const dashboard = await loadDashboard(c.env.DB, visibleAreas(user.role, c.get("grantedAreas")), new Date());
  return c.json(dashboard);
});
