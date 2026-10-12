import { Hono } from "hono";
import { adminUserRoutes } from "./api/admin-users";
import { announcementRoutes } from "./api/announcements";
import { createPublicApp } from "./api/public";
import { AUTH_BASE_PATH } from "./auth/factory";
import { loadAccess } from "./auth/guard";
import { visibleAreas, writableAreas } from "./auth/permissions";
import { authRateLimit } from "./auth/rate-limit";
import { authContext } from "./auth/session";
import type { AppEnv } from "./context";

// Only /api/* reaches this Worker (`run_worker_first` in wrangler.jsonc). The
// SPA and its assets are served by the assets layer without running any code.

const app = new Hono<AppEnv>();

// The public read API (/api/public/*, docs/cloudflare/public-api.md). Mounted
// before the middleware below on purpose: it needs no session, builds no auth
// and sets its own Cache-Control, which the blanket no-store must not replace.
app.route("/", createPublicApp());

app.use("/api/*", authContext, async (c, next) => {
  await next();
  // Session-dependent answers must never be cached by the browser or an edge.
  c.header("Cache-Control", "no-store");
});

// Better Auth owns everything under /api/auth. Its Response (including every
// Set-Cookie) is returned as is.
app.use(`${AUTH_BASE_PATH}/*`, authRateLimit);
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => c.get("auth")().handler(c.req.raw));

app.get("/api/config", (c) =>
  c.json({ google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }),
);

// Who is signed in and what they may do. `areas` is computed by the same
// functions the guards use (src/auth/permissions.ts), so the SPA never has to
// repeat the rules: `visible` are the menus to show, `writable` the ones whose
// buttons to enable, `granted` the editor's raw grants (for Pengaturan).
app.get("/api/me", async (c) => {
  const access = await loadAccess(c);
  if (!access) return c.json({ error: "unauthenticated" }, 401);
  const { user, grantedAreas } = access;
  return c.json({
    user,
    areas: {
      granted: grantedAreas,
      visible: visibleAreas(user.role, grantedAreas),
      writable: writableAreas(user.role, grantedAreas),
    },
  });
});

app.route("/api/announcements", announcementRoutes);
app.route("/api/admin/users", adminUserRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  // Message only: the stack and request can contain tokens.
  console.error(`[worker] unhandled error: ${error.message}`);
  return c.json({ error: "internal" }, 500);
});

export default app;

// The service-binding face of the public API (read endpoints + the contact
// form). Not reachable from the internet: see src/api/public/internal.ts.
export { PublicApi } from "./api/public/entrypoint";
