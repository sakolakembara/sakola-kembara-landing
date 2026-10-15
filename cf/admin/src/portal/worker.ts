import { Hono } from "hono";
import { STUDENT_AUDIENCE } from "../auth/audience";
import { createAuthGate } from "../auth/gate";
import { createRegisterStudent } from "../auth/register";
import { publicOrigin } from "../config/public-origin";
import type { AppEnv } from "../context";
import { mailbox } from "../email/send";
import type { Bindings } from "../env";
import { sameOriginGuard } from "../security/csrf";
import { studentAuthContext } from "./auth-context";
import { contactWhatsapp, whatsappGroupUrl } from "./contact";
import { currentStudentUser, hasStudentSessionCookie } from "./guard";
import { apiHeaders } from "./headers";
// Route files, one import per line, alphabetical (docs/cloudflare/portal-architecture.md, 11.3). Each line below is
// reserved for the task that owns the file; replace the comment with the import, nothing else moves.
import { applicationRoutes } from "./applications";
import { fileRoutes } from "./files";

// The student portal's Worker, `sakem-portal` (SAKEM-083; docs/cloudflare/portal-architecture.md, section 4). It is a
// second entry of this package: the same auth, security, email and db code as the admin Worker, its own routes, its
// own configuration (wrangler.portal.jsonc) and no cron. Only /portal/api/* reaches this script (`run_worker_first`
// in wrangler.portal.jsonc); the portal SPA and its assets are served by the assets layer without running any code.
// The Worker keeps the `/portal` prefix in its own paths, so the identical build runs on a workers.dev staging host,
// where routes do not exist.
//
// The admin Worker has no student route and this one has no admin route: a student's cookie is not valid on the admin
// and an admin's is not valid here (a different cookie name AND a different BETTER_AUTH_SECRET per Worker,
// docs/cloudflare/auth.md#base-path-and-audience). Do not import the blog, the public API or the other admin areas
// from here: a test fails when a file under src/portal imports one of them, so the bundle stays small.

const API = "/portal/api";
const AUTH = STUDENT_AUDIENCE.basePath;

const app = new Hono<AppEnv>();

// Every answer of the API: never cached, never sniffed, no referrer (src/portal/headers.ts). Outermost, so the
// refusals below carry them too.
app.use(`${API}/*`, apiHeaders);

// Before anything reads a cookie or the database: a state-changing request must come from this origin
// (src/security/csrf.ts). No CORS at all: the SPA, the API and the public site's navbar are same-origin, and this
// Worker sends no Access-Control-* header and has no OPTIONS handler.
app.use(`${API}/*`, sameOriginGuard);

app.use(`${API}/*`, studentAuthContext);

// Public auth surface (src/auth/gate.ts), the same route table, limits and Turnstile actions as the admin's, under the
// portal's base path: only the routes in the table exist. Registration is ours; the rest is Better Auth's, whose
// Response (including every Set-Cookie) is returned as is.
app.use(`${AUTH}/*`, createAuthGate(AUTH));
// `get-session` without the portal's cookie has no session to read, and Better Auth would answer `null`: answer that
// without building it. It is the public site's navbar asking on every visit of a signed-out reader, so it must cost
// nothing (docs/cloudflare/portal-architecture.md, 6.6). With the cookie it falls through to Better Auth as before.
app.get(`${AUTH}/get-session`, (c, next) => (hasStudentSessionCookie(c) ? next() : c.json(null)));
app.post(`${AUTH}/register`, createRegisterStudent(AUTH));
app.on(["GET", "POST"], `${AUTH}/*`, (c) => c.get("auth")().handler(c.req.raw));

app.get(`${API}/config`, (c) => {
  // Deployment-specific contact values, kept out of the repository (src/portal/contact.ts): a key is in the answer only
  // when its variable is set AND valid, so "absent" is the one way the SPA learns that the deployment has none.
  const contact = contactWhatsapp(c.env.PORTAL_CONTACT_WHATSAPP);
  const group = whatsappGroupUrl(c.env.PORTAL_WHATSAPP_GROUP_URL);
  return c.json({
    google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    // The widget's site key is public by design; the secret never leaves the Worker.
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    // The public site's origin, for the links to /gabung-siswa, its docs and the privacy policy. "" = unset.
    siteUrl: publicOrigin(c.env.SITE_URL),
    // The admin host, where the "this is an admin account" screen links. "" = unset (docs/cloudflare/portal-api.md, 4.1).
    adminUrl: publicOrigin(c.env.ADMIN_URL),
    ...(contact === undefined ? {} : { contactWhatsapp: contact }),
    ...(group === undefined ? {} : { whatsappGroupUrl: group }),
  });
});

// The signed-in account, whatever its role: the one route that does not check `student`, so the SPA can tell an admin
// account (and show the screen that links to the admin) from a student. No limiter: it reads the session and nothing else,
// and not even that when the request carries no portal cookie.
app.get(`${API}/me`, async (c) => {
  const user = await currentStudentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const { id, name, email, emailVerified, role } = user;
  return c.json({ user: { id, name, email, emailVerified, role } });
});

// Local development only (exactly ENVIRONMENT=development, from an untracked .dev.vars): the emails this isolate "sent".
// Nothing is printed to the console (tokenised links are never logged). 404 in production and in tests.
app.get(`${API}/dev/mailbox`, (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not_found" }, 404);
  return c.json({ messages: mailbox.messages });
});

// mounts: one line per route file, alphabetical. Every route in them starts with requireStudent(...)
// (src/portal/guard.ts); a route without it is a route anyone can call.
// P1b: app.route(API, applicationRoutes);
app.route(API, applicationRoutes);

// P4: app.route(API, fileRoutes);
app.route(API, fileRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  // Message only: the stack and the request can contain tokens, names and answers.
  console.error(`[portal] unhandled error: ${error.message}`);
  return c.json({ error: "internal" }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
