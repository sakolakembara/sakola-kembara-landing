import { sharedAuth } from "./auth/session";
import type { Bindings } from "./env";
import { batchAll, publicQueries } from "./public/prepared";
import { serializeBlogArticle, serializeBlogSummary, serializeReport, serializeResource, serializeTeamMember } from "./public/serializers";

// Start-up warm-up: run the code a request is about to need once, against nothing, before the first request.
//
// A V8 isolate compiles a function the first time it runs. In a fresh isolate that is every function of Better Auth
// (its context, its ~40 endpoints and their schemas), of Drizzle and of the serializers, and it lands on the first
// request that touches them: measured locally, with the interpreter only, the first signed-in request costs several
// times a later one (docs/cloudflare/free-plan-audit.md, "CPU on the hot routes", "The first request of an isolate").
// The Free plan counts that CPU against the request. Code that ran during start-up is already compiled when the
// request arrives.
//
// What it runs is the library code behind the routes, with a stand-in environment: a D1 with no rows, a made up
// secret, a made up origin. It reads no real binding, writes nothing, sends nothing and calls nobody, so there is
// nothing to clean up and nothing it can leak. The Better Auth instance it builds belongs to the stand-in binding and
// is thrown away with it; the real one is built by the first real request (building is cheap once the code is
// compiled, and it needs the real configuration).
//
// What it cannot run is a route: Workers refuses to construct a `Response` (and to do I/O, set a timer or draw a
// random number) in global scope, so Hono's own dispatch stays cold. Everything below is pure computation.
//
// It must never get in the way: it runs without being awaited, every step is guarded, and a failure only costs the
// warm-up (one fixed line in the log says so, no value). Whether Cloudflare charges the CPU of start-up to the first
// request is not documented; if it did, the first request would cost what it costs today, not more, because the work
// moves, it does not repeat. `WARM_UP_ENABLED` below is the one switch.

/** Off switch: set to `false` to drop the warm-up without touching anything else. */
export const WARM_UP_ENABLED = true;

/** A D1 binding with an empty database: every statement answers with no rows and no changes. */
function emptyD1(): D1Database {
  const meta = { changes: 0, last_row_id: 0, rows_read: 0, rows_written: 0, duration: 0 };
  const answer = () => ({ success: true, results: [], meta });
  const statement = (): unknown => ({
    bind: () => statement(),
    all: async () => answer(),
    raw: async () => [],
    first: async () => null,
    run: async () => answer(),
  });
  return {
    prepare: () => statement(),
    batch: async (statements: unknown[]) => statements.map(answer),
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

const ORIGIN = "https://warm-up.invalid";

export function standInEnvironment(): Bindings {
  return {
    DB: emptyD1(),
    // Production's code paths (the host-only `__Host-` cookie, the fail-closed mail and captcha rules); a value nobody uses.
    ENVIRONMENT: "production",
    BETTER_AUTH_SECRET: "warm-up-only-secret-0123456789-abcdefghijklmnop",
  } as unknown as Bindings;
}

const summary = { slug: "warm-up", title: "Warm up", category: "News", excerpt: "Ringkasan [&hellip;]", image: "/blog/images/x.jpg", imageWidth: 10, imageHeight: 10, author: "Redaksi", featured: false, publishedAt: new Date(0) };

/** What a Hono app lends the warm-up: its router, which builds its matchers on the first lookup. */
interface Routed {
  router: { match(method: string, path: string): unknown };
}

/** The paths whose lookup builds the matchers of each app (one per route family is enough). */
const ADMIN_PATHS = ["/api/config", "/api/me", "/api/dashboard", "/api/admin/blog", "/api/auth/sign-in/email", "/uploads/x"];
const PUBLIC_API_PATHS = ["/api/public/team", "/api/public/blog", "/api/public/blog/x", "/api/public/shortlinks/x", "/api/public/contact"];

/** Runs the hot paths once. Resolves when done; never rejects. `makeEnvironment` is for the test of the failure path. */
export async function warmUp(makeEnvironment: () => Bindings = standInEnvironment, apps: { admin?: Routed; publicApi?: Routed } = {}): Promise<void> {
  const failed: string[] = [];
  // Each group alone: one that cannot run (a Workers rule, a library change) must not stop the others.
  const step = async (run: () => unknown) => {
    try {
      await run();
    } catch (error) {
      failed.push(error instanceof Error ? error.name : "error");
    }
  };
  const env = makeEnvironment();

  // Hono: the first lookup of a router builds its matchers (the regular expressions of every route). A lookup is not a
  // request: nothing is dispatched and no `Response` is made, which Workers would refuse here.
  await step(() => {
    for (const path of ADMIN_PATHS) apps.admin?.router.match("GET", path);
    for (const path of PUBLIC_API_PATHS) apps.publicApi?.router.match("GET", path);
  });

  // Better Auth: build it as a request does, then ask it for a session with a cookie that names one, which fails the
  // signature check and answers "no session". That compiles its context, tables, endpoints and the session read. Then
  // build the router its HTTP handler builds on every call (the sign-in, sign-out, reset and verification routes).
  const auth = sharedAuth(env, ORIGIN);
  await step(() => auth.api.getSession({ headers: new Headers({ cookie: "__Host-better-auth.session_token=warm-up.not-a-signature" }) }));
  await step(async () => (await import("better-auth/api")).router((await auth.$context) as never, auth.options as never));

  // The public reads: every prepared query built and run against the empty D1, and the serializers on a sample row.
  await step(async () => {
    const queries = publicQueries(env.DB);
    await Promise.all([queries.team.all(), queries.reports.all(), queries.resources.all()]);
    await batchAll(env.DB, [[queries.featured], [queries.count], [queries.page, { limit: 15, offset: 0 }]]);
    await queries.article.all({ slug: "warm-up" });
    await queries.related.all({ id: "x", category: "News", from: 0, to: 1 });
    await queries.newestOthers.all({ id: "x" });
    await queries.shortlink.all({ slug: "warm-up" });
    JSON.stringify({
      featured: serializeBlogSummary(summary as never),
      article: serializeBlogArticle({ ...summary, updatedAt: new Date(0), metaDescription: null, contentMarkdown: "x", contentHtml: "<p>x</p>" } as never),
      team: serializeTeamMember({ id: "x", name: "x", role: "x", image: null, category: "pengurus", bio: null, educationHistory: [{ institution: "x" }], workHistory: [{ organization: "x", role: "x" }] }),
      report: serializeReport({ id: "x", title: "x", description: null, category: "yearly", year: "2025", filePath: "/x.pdf", fileSize: 1 }),
      resource: serializeResource({ id: "x", title: "x", description: null, category: "panduan", contentType: "file", filePath: "/x.pdf", fileSize: 1, externalUrl: null, bodyText: null }),
    });
  });

  // A fixed line: the names of the errors only, never a message (it could carry a value).
  if (failed.length > 0) console.warn(`[warm-up] skipped (${[...new Set(failed)].join(", ")})`);
}

/** Resolved when the warm-up has finished (or was off): the tests and the CPU measurement wait on it. */
export let warmUpDone: Promise<void> = Promise.resolve();

export function startWarmUp(apps: { admin?: Routed; publicApi?: Routed } = {}): void {
  if (!WARM_UP_ENABLED) return;
  warmUpDone = warmUp(standInEnvironment, apps).catch(() => undefined);
}
