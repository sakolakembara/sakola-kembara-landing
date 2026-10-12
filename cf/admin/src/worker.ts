import { Hono } from "hono";
import { adminUserRoutes } from "./api/admin-users";
import { announcementRoutes } from "./api/announcements";
import { auditRoutes } from "./api/audit";
import { applicationRoutes } from "./api/applications";
import { batchRoutes } from "./api/batches";
import { blogRoutes } from "./api/blog";
import { dashboardRoutes } from "./api/dashboard";
import { serveDevUpload } from "./api/dev-uploads";
import { messageRoutes } from "./api/messages";
import { createPublicApp } from "./api/public";
import { reportRoutes } from "./api/reports";
import { shortlinkRoutes } from "./api/shortlinks";
import { teamRoutes } from "./api/team";
import { resourceRoutes } from "./api/resources";
import { uploadRoutes } from "./api/uploads";
import { AUTH_BASE_PATH } from "./auth/factory";
import { authGate } from "./auth/gate";
import { loadAccess } from "./auth/guard";
import { visibleAreas, writableAreas } from "./auth/permissions";
import { registerStudent } from "./auth/register";
import { authContext } from "./auth/session";
import { publicOrigin } from "./config/public-origin";
import type { AppEnv } from "./context";
import { scheduledCleanup } from "./cron/cleanup";
import { mailbox } from "./email/send";
import type { Bindings } from "./env";
import { sameOriginGuard } from "./security/csrf";
import { uploadsBase } from "./uploads/base-url";

// Only /api/* reaches this Worker (`run_worker_first` in wrangler.jsonc). The
// SPA and its assets are served by the assets layer without running any code.

const app = new Hono<AppEnv>();

// The public face of the public API: nothing. /api/public/* (the read
// endpoints and the contact form, docs/cloudflare/public-api.md) is served only
// by the `PublicApi` entrypoint below, to the Astro Worker through its service
// binding, so a request from the internet to /api/public/* is the ordinary JSON
// 404 at the end of this file and never reaches D1 (a cache-busting query
// string cannot spend the daily read budget). createPublicApp() mounts no
// route; test/public-face.test.ts pins that. The contact route is protected
// by the entrypoint split (src/api/public/internal.ts) and by
// src/public/contact-deps.ts.
app.route("/", createPublicApp());

app.use("/api/*", async (c, next) => {
  await next();
  // Session-dependent answers must never be cached by the browser or an edge.
  // Outermost, so the refusals below carry it too.
  c.header("Cache-Control", "no-store");
});

// Before anything reads a cookie or the database: a state-changing request
// must come from this origin (src/security/csrf.ts).
app.use("/api/*", sameOriginGuard);

app.use("/api/*", authContext);

// Public auth surface (src/auth/gate.ts): only the routes in its table exist,
// each with its rate limits and Turnstile. Registration is ours; the rest is
// Better Auth's, whose Response (including every Set-Cookie) is returned as is.
app.use(`${AUTH_BASE_PATH}/*`, authGate);
app.post(`${AUTH_BASE_PATH}/register`, registerStudent);
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => c.get("auth")().handler(c.req.raw));

app.get("/api/config", (c) =>
  c.json({
    google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    // The widget's site key is public by design; the secret never leaves the Worker.
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    // Where uploaded files are served from, so the SPA can show them (docs/cloudflare/admin-crud.md). "" = same origin.
    uploadsBaseUrl: uploadsBase(c.env.UPLOADS_BASE_URL),
    // The public site's origin, for "Lihat di publik" (docs/cloudflare/admin-blog.md). "" = no link.
    siteUrl: publicOrigin(c.env.SITE_URL),
  }),
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

// Local development only (exactly ENVIRONMENT=development, from an untracked
// .dev.vars): the emails this isolate "sent". There is nothing to read from the
// console because tokenised links are never logged. Not in production, not in
// tests (they read `mailbox` directly).
app.get("/api/dev/mailbox", (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not_found" }, 404);
  return c.json({ messages: mailbox.messages });
});

// Local development only: files of the local R2 emulation (404 in production, where R2's own
// public domain serves them and no Worker runs per download). Not under /api.
app.get("/uploads/*", serveDevUpload);

app.route("/api/admin/announcements", announcementRoutes);
app.route("/api/admin/messages", messageRoutes);
app.route("/api/admin/batches", batchRoutes);
app.route("/api/admin/applications", applicationRoutes);
app.route("/api/admin/resources", resourceRoutes);
app.route("/api/admin/blog", blogRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/audit", auditRoutes);
app.route("/api/admin/uploads", uploadRoutes);
app.route("/api/admin/reports", reportRoutes);
app.route("/api/admin/team", teamRoutes);
app.route("/api/admin/shortlinks", shortlinkRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  // Message only: the stack and request can contain tokens.
  console.error(`[worker] unhandled error: ${error.message}`);
  return c.json({ error: "internal" }, 500);
});

export default {
  fetch: app.fetch,
  // Cron Trigger (wrangler.jsonc `triggers.crons`): expired sessions and tokens, old audit rows.
  scheduled: (controller, env, _ctx) => scheduledCleanup(controller, env),
} satisfies ExportedHandler<Bindings>;

// The service-binding face of the public API (the read endpoints and the
// contact form: the only place either is served). Not reachable from the
// internet: see src/api/public/internal.ts.
export { PublicApi } from "./api/public/entrypoint";
