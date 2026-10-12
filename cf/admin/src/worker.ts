import { Hono } from "hono";
import { announcementRoutes } from "./api/announcements";
import { AUTH_BASE_PATH } from "./auth/factory";
import { authRateLimit } from "./auth/rate-limit";
import { authContext, currentUser } from "./auth/session";
import type { AppEnv } from "./context";

// Only /api/* reaches this Worker (`run_worker_first` in wrangler.jsonc). The
// SPA and its assets are served by the assets layer without running any code.

const app = new Hono<AppEnv>();

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

app.get("/api/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ user });
});

app.route("/api/announcements", announcementRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  // Message only: the stack and request can contain tokens.
  console.error(`[worker] unhandled error: ${error.message}`);
  return c.json({ error: "internal" }, 500);
});

export default app;
