import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { SEED_USERS, seed } from "../scripts/seed-data";
import { userRoles } from "../src/auth/roles";
import { call, cookiesOf, signIn } from "./helpers";
import { TABLES_CHILD_FIRST } from "./tables";

// The dev seed has to stay valid as the schema grows: it is what a developer
// runs to get a working local admin. It also must stay free of real data,
// because this repository is public.

const PASSWORD = "seed-test-password-123";
const NOW = Date.UTC(2026, 9, 12, 5, 0, 0);

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of TABLES_CHILD_FIRST) out[table] = (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  return out;
}

describe("dev seed", () => {
  test("writes at least one row to every table, and reports what it wrote", async () => {
    const result = await seed(env.DB, { password: PASSWORD, now: NOW });
    const actual = await counts();
    for (const table of TABLES_CHILD_FIRST) {
      expect(actual[table], table).toBeGreaterThan(0);
      expect(result.counts[table], `reported ${table}`).toBe(actual[table]);
    }
  });

  test("is repeatable: it empties the tables first, so a second run gives the same database", async () => {
    await env.DB.prepare("INSERT INTO announcements (id, title, body) VALUES ('left-over', 'Sisa', 'Sisa dari sebelumnya')").run();
    await seed(env.DB, { password: PASSWORD, now: NOW });
    const first = await counts();
    await seed(env.DB, { password: PASSWORD, now: NOW });
    expect(await counts()).toEqual(first);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM announcements WHERE id = 'left-over'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  test("has one account per role and editors with different areas", async () => {
    await seed(env.DB, { password: PASSWORD, now: NOW });
    const roles = new Set(SEED_USERS.map((u) => u.role));
    expect(roles).toEqual(new Set(userRoles));

    const editorAreas = SEED_USERS.filter((u) => u.role === "editor").map((u) => [...u.areas].sort().join("+") || "(none)");
    expect(new Set(editorAreas).size).toBe(editorAreas.length); // all different
    expect(editorAreas).toEqual(expect.arrayContaining(["pendaftaran", "komunikasi", "konten", "(none)", "konten+pendaftaran"]));

    // What is in the database is what SEED_USERS says.
    const { results } = await env.DB.prepare(
      "SELECT u.email AS email, u.role AS role, group_concat(g.area) AS areas FROM users u LEFT JOIN admin_area_grants g ON g.user_id = u.id GROUP BY u.id",
    ).all<{ email: string; role: string; areas: string | null }>();
    const stored = new Map(results.map((r) => [r.email, r]));
    for (const u of SEED_USERS) {
      expect(stored.get(u.email)?.role, u.email).toBe(u.role);
      expect((stored.get(u.email)?.areas?.split(",") ?? []).sort(), u.email).toEqual([...u.areas].sort());
    }
  });

  test("every verified seeded account can sign in with the seed password, and /api/me matches the model", async () => {
    await seed(env.DB, { password: PASSWORD, now: NOW });
    for (const u of SEED_USERS.filter((u) => u.emailVerified)) {
      const res = await signIn(u.email, PASSWORD);
      expect(res.status, u.email).toBe(200);
      const me = (await (await call("/api/me", { cookie: cookiesOf(res) })).json()) as { user: { role: string }; areas: { granted: string[]; visible: string[]; writable: string[] } };
      expect(me.user.role).toBe(u.role);
      expect([...me.areas.granted].sort(), u.email).toEqual([...u.areas].sort());
      if (u.role === "editor") {
        expect([...me.areas.writable].sort(), u.email).toEqual([...u.areas].sort());
        // An editor sees only the areas they hold.
        expect([...me.areas.visible].sort(), u.email).toEqual([...u.areas].sort());
      }
      if (u.role === "viewer" || u.role === "student") expect(me.areas.writable, u.email).toEqual([]);
    }
  });

  test("the unverified student cannot sign in (verification stays required)", async () => {
    await seed(env.DB, { password: PASSWORD, now: NOW });
    const unverified = SEED_USERS.find((u) => !u.emailVerified)!;
    expect((await signIn(unverified.email, PASSWORD)).status).toBe(403);
  });

  test("a seeded editor can write in their area and only there", async () => {
    await seed(env.DB, { password: PASSWORD, now: NOW });
    const body = { title: "Pengumuman Uji", body: "Isi pengumuman uji.", severity: "info", active: false };
    const post = async (email: string) => (await call("/api/admin/announcements", { method: "POST", cookie: cookiesOf(await signIn(email, PASSWORD)), json: body })).status;
    expect(await post("editor-komunikasi@example.test")).toBe(201);
    expect(await post("editor-multi@example.test")).toBe(403); // pendaftaran and konten, not komunikasi
    expect(await post("editor-baru@example.test")).toBe(403);
    expect(await post("viewer@example.test")).toBe(403);
    expect(await post("super-admin@example.test")).toBe(201);
  });

  test("a seeded editor reads only their area: the other areas answer 403 to a read", async () => {
    await seed(env.DB, { password: PASSWORD, now: NOW });
    const read = async (email: string) => (await call("/api/admin/announcements", { cookie: cookiesOf(await signIn(email, PASSWORD)) })).status;
    expect(await read("editor-komunikasi@example.test")).toBe(200);
    expect(await read("editor-pendaftaran@example.test")).toBe(403);
    expect(await read("editor-konten@example.test")).toBe(403);
    expect(await read("editor-multi@example.test")).toBe(403); // pendaftaran and konten, not komunikasi
    expect(await read("editor-baru@example.test")).toBe(403); // no areas at all
    expect(await read("viewer@example.test")).toBe(200);
    expect(await read("super-admin@example.test")).toBe(200);
  });

  test("contains no real data: every email address is on the reserved example.test domain", async () => {
    await seed(env.DB, { password: PASSWORD, now: NOW });
    for (const [table, column] of [
      ["users", "email"],
      ["contact_messages", "email"],
      ["student_applications", "email"],
      ["audit_log", "actor_email"],
    ] as const) {
      const { results } = await env.DB.prepare(`SELECT ${column} AS email FROM ${table}`).all<{ email: string }>();
      for (const { email } of results) expect(email.endsWith("@example.test"), `${table}.${column}: ${email}`).toBe(true);
    }
    // And no seeded account has a usable session: the one session row is long expired.
    expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE expires_at > ?").bind(NOW).first<{ n: number }>()).toEqual({ n: 0 });
  });
});
