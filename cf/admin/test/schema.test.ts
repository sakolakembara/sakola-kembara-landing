import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { grantableAreas } from "../src/auth/permissions";
import { userRoles } from "../src/auth/roles";
import * as schema from "../src/db/schema";
import type { StudentApplicationFormData } from "../src/db/schema";
import { TABLES_CHILD_FIRST } from "./tables";

// The D1 schema: constraints are checked against the real SQLite in workerd,
// with raw SQL where the point is that the *database* refuses a value (not
// Drizzle or the API), and with Drizzle where the point is a round trip.

const db = drizzle(env.DB, { schema });

let n = 0;
const uid = () => crypto.randomUUID();
const seq = () => ++n;
// Batch years must be unique and inside 2024..2100; tables are emptied before each test, so wrapping is safe.
let years = 0;
const batchYear = () => 2024 + (years++ % 77);

type Row = Record<string, string | number | null>;

/** Raw INSERT of one row, so only the database's own rules apply. */
async function insert(table: string, row: Row) {
  const columns = Object.keys(row);
  return env.DB.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(...Object.values(row))
    .run();
}

async function scalar<T = unknown>(sql: string, ...binds: unknown[]): Promise<T> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ v: T }>())!.v;
}

const CHECK = /CHECK constraint failed/;
const UNIQUE = /UNIQUE constraint failed/;
const FOREIGN_KEY = /FOREIGN KEY constraint failed/;

/** The smallest valid row of every table. Each test overrides what it is about. */
const minimal = {
  users: (): Row => ({ id: uid(), name: "Contoh Pengguna", email: `contoh-${seq()}@example.test` }),
  session: (user: string): Row => ({ id: uid(), expires_at: Date.now() + 1000, token: uid(), user_id: user }),
  account: (user: string): Row => ({ id: uid(), account_id: uid(), provider_id: "credential", user_id: user }),
  verification: (): Row => ({ id: uid(), identifier: uid(), value: "x", expires_at: Date.now() + 1000 }),
  admin_area_grants: (user: string, area = "konten"): Row => ({ user_id: user, area }),
  audit_log: (): Row => ({ id: uid(), actor_email: "contoh@example.test", action: "announcement.create" }),
  admission_batches: (): Row => ({ id: uid(), year: batchYear(), name: "Contoh Batch", opens_at: 1_000, closes_at: 2_000 }),
  student_applications: (batch: string): Row => ({
    id: uid(),
    batch_id: batch,
    full_name: "Contoh Pendaftar",
    email: "pendaftar@example.test",
    whatsapp: "081200000000",
    school_name: "SMA Contoh",
    graduation_year: "2026",
  }),
  announcements: (): Row => ({ id: uid(), title: "Contoh", body: "Isi contoh" }),
  contact_messages: (): Row => ({ id: uid(), full_name: "Contoh Pengirim", email: "pengirim@example.test", subject: "other", message: "Halo, ini pesan contoh." }),
  reports: (): Row => ({ id: uid(), title: "Contoh", category: "yearly", year: "2025", file_path: "/reports/2025/contoh.pdf", file_size: 1024 }),
  team_members: (): Row => ({ id: uid(), name: "Contoh Anggota", role: "Pengurus" }),
  site_resources: (): Row => ({ id: uid(), title: "Contoh", content_type: "file", file_path: "/resources/contoh.pdf", file_size: 2048 }),
  shortlinks: (): Row => ({ id: uid(), slug: `contoh-${seq()}`, target_url: "/gabung-siswa" }),
  blog_posts: (): Row => ({
    id: uid(),
    slug: `contoh-artikel-${seq()}`,
    title: "Contoh Artikel",
    excerpt: "Ringkasan contoh.",
    content_markdown: "Isi **contoh**.",
    content_html: "<p>Isi <strong>contoh</strong>.</p>",
    category: "Cerita",
    author: "Contoh Penulis",
  }),
  media: (): Row => ({ id: uid(), key: `blog/images/2026/10/contoh-${seq()}.webp`, purpose: "blog", content_type: "image/webp", size: 4096 }),
};

async function aUser(role?: string) {
  const row = minimal.users();
  if (role) row.role = role;
  await insert("users", row);
  return row.id as string;
}

async function aBatch() {
  const row = minimal.admission_batches();
  await insert("admission_batches", row);
  return row.id as string;
}

describe("tables", () => {
  test("every table is listed in test/tables.ts, so setup empties it between tests", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual([...TABLES_CHILD_FIRST].sort());
  });

  test("the legacy tables are all here; accounts and rate_limit_hits are deliberately not", () => {
    const here = new Set<string>(TABLES_CHILD_FIRST);
    for (const legacy of [
      "users",
      "admission_batches",
      "student_applications",
      "announcements",
      "reports",
      "team_members",
      "contact_messages",
      "audit_log",
      "site_resources",
      "shortlinks",
    ]) {
      expect(here.has(legacy), legacy).toBe(true);
    }
    expect(here.has("accounts")).toBe(false); // Better Auth's `account` replaces it
    expect(here.has("rate_limit_hits")).toBe(false); // Cloudflare rate limit bindings replace it
    for (const added of ["admin_area_grants", "blog_posts", "media"]) expect(here.has(added), added).toBe(true);
  });

  test("foreign keys are enforced", async () => {
    await expect(insert("session", minimal.session(uid()))).rejects.toThrow(FOREIGN_KEY);
    expect(await scalar("SELECT count(*) AS v FROM session")).toBe(0);
  });
});

describe("enum CHECK constraints: every allowed value is accepted, anything else is refused by the database", () => {
  const user = () => aUser();
  // [table, column, allowed values, a value that must be refused, a factory for a valid row]
  const enums: [string, string, readonly string[], string, () => Promise<Row>][] = [
    ["users", "role", userRoles, "owner", async () => minimal.users()],
    ["admin_area_grants", "area", grantableAreas, "sistem", async () => minimal.admin_area_grants(await user())],
    ["student_applications", "status", schema.applicationStatus, "approved", async () => minimal.student_applications(await aBatch())],
    ["announcements", "severity", schema.announcementSeverity, "loud", async () => minimal.announcements()],
    ["contact_messages", "subject", schema.contactSubject, "spam", async () => minimal.contact_messages()],
    ["reports", "category", schema.reportCategory, "misc", async () => minimal.reports()],
    ["team_members", "category", schema.teamCategory, "volunteer", async () => minimal.team_members()],
    [
      "site_resources",
      "category",
      schema.resourceCategory,
      "other",
      async () => minimal.site_resources(),
    ],
    ["blog_posts", "category", schema.blogCategories, "Random", async () => minimal.blog_posts()],
    ["blog_posts", "status", schema.blogStatus, "archived", async () => ({ ...minimal.blog_posts(), published_at: 1_000 })],
    ["media", "purpose", schema.mediaPurpose, "avatar", async () => minimal.media()],
  ];

  for (const [table, column, allowed, bad, make] of enums) {
    test(`${table}.${column}`, async () => {
      for (const value of allowed) {
        const row = await make();
        // admin_area_grants has a composite key: a fresh user per row (make() creates one).
        await insert(table, { ...row, [column]: value });
      }
      await expect(insert(table, { ...(await make()), [column]: bad })).rejects.toThrow(CHECK);
      await expect(insert(table, { ...(await make()), [column]: allowed[0]!.toUpperCase() })).rejects.toThrow(CHECK); // case matters
      await expect(insert(table, { ...(await make()), [column]: "" })).rejects.toThrow(CHECK);
    });
  }

  test("site_resources.content_type", async () => {
    const shapes: Record<string, Row> = {
      file: { file_path: "/resources/a.pdf", file_size: 10, external_url: null, body_text: null },
      url: { file_path: null, file_size: null, external_url: "https://example.test/doc", body_text: null },
      text: { file_path: null, file_size: null, external_url: null, body_text: "Teks contoh" },
    };
    for (const value of schema.resourceContentType) await insert("site_resources", { ...minimal.site_resources(), content_type: value, ...shapes[value]! });
    await expect(insert("site_resources", { ...minimal.site_resources(), content_type: "video" })).rejects.toThrow(CHECK);
  });

  test("the CHECK lists in the migrations are the ones the code names (no drift between TypeScript and SQL)", async () => {
    const sql = await scalar<string>("SELECT group_concat(sql, ' ') AS v FROM sqlite_master WHERE type = 'table'");
    for (const [, , allowed] of enums) for (const value of allowed) expect(sql).toContain(`'${value}'`);
    expect(sql).not.toContain("'sistem'"); // only as the *refused* value, never listed as grantable
  });
});

describe("other CHECK constraints", () => {
  test("admission_batches: year 2024 to 2100, and the window must close after it opens", async () => {
    for (const year of [2024, 2100]) await insert("admission_batches", { ...minimal.admission_batches(), year });
    for (const year of [2023, 2101]) await expect(insert("admission_batches", { ...minimal.admission_batches(), year })).rejects.toThrow(CHECK);
    await expect(insert("admission_batches", { ...minimal.admission_batches(), opens_at: 2_000, closes_at: 2_000 })).rejects.toThrow(CHECK);
    await expect(insert("admission_batches", { ...minimal.admission_batches(), opens_at: 2_000, closes_at: 1_000 })).rejects.toThrow(CHECK);
  });

  test("announcements: CTA label and URL come as a pair, and the window does not end before it starts", async () => {
    await insert("announcements", { ...minimal.announcements(), cta_label: "Daftar", cta_url: "/gabung-siswa" });
    await expect(insert("announcements", { ...minimal.announcements(), cta_label: "Daftar" })).rejects.toThrow(CHECK);
    await expect(insert("announcements", { ...minimal.announcements(), cta_url: "/x" })).rejects.toThrow(CHECK);
    await insert("announcements", { ...minimal.announcements(), starts_at: 1_000, ends_at: 1_000 });
    await insert("announcements", { ...minimal.announcements(), starts_at: null, ends_at: 5 });
    await expect(insert("announcements", { ...minimal.announcements(), starts_at: 2_000, ends_at: 1_000 })).rejects.toThrow(CHECK);
  });

  test("reports: year is 2025 or 2025/2026; size is not negative", async () => {
    for (const year of ["2025", "2025/2026"]) await insert("reports", { ...minimal.reports(), year });
    for (const year of ["25", "2025-2026", "2025/26", "20255", "abcd", ""]) {
      await expect(insert("reports", { ...minimal.reports(), year }), year).rejects.toThrow(CHECK);
    }
    await expect(insert("reports", { ...minimal.reports(), file_size: -1 })).rejects.toThrow(CHECK);
  });

  test("team_members: display order 0 to 9999; history must be a JSON array", async () => {
    for (const display_order of [0, 9999]) await insert("team_members", { ...minimal.team_members(), display_order });
    for (const display_order of [-1, 10_000]) await expect(insert("team_members", { ...minimal.team_members(), display_order })).rejects.toThrow(CHECK);
    await expect(insert("team_members", { ...minimal.team_members(), education_history: "{nope" })).rejects.toThrow(CHECK);
    await expect(insert("team_members", { ...minimal.team_members(), work_history: "{}" })).rejects.toThrow(CHECK);
    await expect(insert("team_members", { ...minimal.team_members(), education_history: '"text"' })).rejects.toThrow(CHECK);
  });

  test("site_resources: exactly one shape per row (file, url or text), matching content_type", async () => {
    const base = (): Row => ({ id: uid(), title: "Contoh" });
    const refused: Row[] = [
      { content_type: "file", file_path: "/resources/a.pdf" }, // file without size
      { content_type: "file", file_size: 5 }, // file without path
      { content_type: "file", file_path: "/resources/a.pdf", file_size: 5, external_url: "https://example.test" }, // two shapes
      { content_type: "url" }, // url without url
      { content_type: "url", external_url: "https://example.test", file_path: "/resources/a.pdf" },
      { content_type: "url", external_url: "https://example.test", body_text: "x" },
      { content_type: "text" },
      { content_type: "text", body_text: "x", external_url: "https://example.test" },
      { content_type: "text", file_path: "/resources/a.pdf", file_size: 5 }, // shape of a file under another type
      { content_type: "file", external_url: "https://example.test" }, // shape of a url under another type
    ];
    for (const [i, extra] of refused.entries()) await expect(insert("site_resources", { ...base(), ...extra }), `case ${i}`).rejects.toThrow(CHECK);
    await insert("site_resources", { ...base(), content_type: "file", file_path: "/resources/a.pdf", file_size: 5 });
    await insert("site_resources", { ...base(), content_type: "url", external_url: "https://example.test" });
    await insert("site_resources", { ...base(), content_type: "text", body_text: "x" });
  });

  test("shortlinks: slug grammar and target form of the legacy validators", async () => {
    for (const slug of ["daftar-2026", "a", "ig", "a1-b2-c3", "x".repeat(64)]) await insert("shortlinks", { ...minimal.shortlinks(), slug });
    for (const slug of ["Daftar", "a--b", "-a", "a-", "a/b", "a b", "a_b", "", "x".repeat(65), "daftar.html", "é"]) {
      await expect(insert("shortlinks", { ...minimal.shortlinks(), slug }), JSON.stringify(slug)).rejects.toThrow(CHECK);
    }
    for (const target_url of ["/gabung-siswa", "https://example.test/a?b=1", "http://example.test"]) await insert("shortlinks", { ...minimal.shortlinks(), target_url });
    for (const target_url of ["//evil.test", "javascript:alert(1)", "ftp://example.test", "example.test", "data:text/html,x", ""]) {
      await expect(insert("shortlinks", { ...minimal.shortlinks(), target_url }), target_url).rejects.toThrow(CHECK);
    }
    await expect(insert("shortlinks", { ...minimal.shortlinks(), click_count: -1 })).rejects.toThrow(CHECK);
  });

  test("blog_posts: slug grammar; a published article has a date; image size is both or neither and positive", async () => {
    for (const slug of ["tanpa-jasa-ahdan-mewujudkan-murid-masuk-perguruan-tinggi", "8-tips-meraih-nilai-terbaik-di-snbt-nanti", "x".repeat(160)]) {
      await insert("blog_posts", { ...minimal.blog_posts(), slug });
    }
    for (const slug of ["Judul-Besar", "dua--tanda", "-awal", "akhir-", "ada spasi", "garis_bawah", "", "x".repeat(161)]) {
      await expect(insert("blog_posts", { ...minimal.blog_posts(), slug }), JSON.stringify(slug)).rejects.toThrow(CHECK);
    }
    await insert("blog_posts", { ...minimal.blog_posts(), status: "draft", published_at: null });
    await insert("blog_posts", { ...minimal.blog_posts(), status: "published", published_at: 1_000 });
    await expect(insert("blog_posts", { ...minimal.blog_posts(), status: "published", published_at: null })).rejects.toThrow(CHECK);

    await insert("blog_posts", { ...minimal.blog_posts(), image: "/blog/images/a.jpg", image_width: 2560, image_height: 1707 });
    await insert("blog_posts", { ...minimal.blog_posts(), image: "/blog/images/a.jpg" });
    const badSizes: Row[] = [{ image_width: 100 }, { image_height: 100 }, { image_width: 0, image_height: 10 }, { image_width: 10, image_height: -1 }];
    for (const size of badSizes) {
      await expect(insert("blog_posts", { ...minimal.blog_posts(), ...size }), JSON.stringify(size)).rejects.toThrow(CHECK);
    }
  });

  test("media: key has no leading slash; size is not negative; dimensions are both or neither", async () => {
    await insert("media", { ...minimal.media(), width: 800, height: 600 });
    await insert("media", { ...minimal.media(), key: `reports/2025/contoh-${seq()}.pdf`, purpose: "report", content_type: "application/pdf" });
    await expect(insert("media", { ...minimal.media(), key: "/blog/images/a.webp" })).rejects.toThrow(CHECK);
    await expect(insert("media", { ...minimal.media(), key: "" })).rejects.toThrow(CHECK);
    await expect(insert("media", { ...minimal.media(), size: -1 })).rejects.toThrow(CHECK);
    await expect(insert("media", { ...minimal.media(), width: 800 })).rejects.toThrow(CHECK);
    await expect(insert("media", { ...minimal.media(), width: 0, height: 0 })).rejects.toThrow(CHECK);
  });

  test("audit_log metadata must be valid JSON", async () => {
    await insert("audit_log", { ...minimal.audit_log(), metadata: '{"a":1}' });
    await insert("audit_log", { ...minimal.audit_log(), metadata: null });
    await expect(insert("audit_log", { ...minimal.audit_log(), metadata: "{nope" })).rejects.toThrow(CHECK);
  });

  test("student_applications form_data must be valid JSON", async () => {
    const batch = await aBatch();
    await insert("student_applications", { ...minimal.student_applications(batch), form_data: '{"formVersion":2}' });
    await expect(insert("student_applications", { ...minimal.student_applications(batch), form_data: "not json" })).rejects.toThrow(CHECK);
  });
});

describe("unique constraints", () => {
  test("users.email, session.token", async () => {
    const row = minimal.users();
    await insert("users", row);
    await expect(insert("users", { ...minimal.users(), email: row.email! })).rejects.toThrow(UNIQUE);
    const user = row.id as string;
    const session = minimal.session(user);
    await insert("session", session);
    await expect(insert("session", { ...minimal.session(user), token: session.token! })).rejects.toThrow(UNIQUE);
  });

  test("admission_batches.year: one batch per year", async () => {
    const batch = minimal.admission_batches();
    await insert("admission_batches", batch);
    await expect(insert("admission_batches", { ...minimal.admission_batches(), year: batch.year! })).rejects.toThrow(UNIQUE);
  });

  test("student_applications: one application per (user, batch); applications without a user do not collide", async () => {
    const user = await aUser();
    const batch = await aBatch();
    const other = await aBatch();
    await insert("student_applications", { ...minimal.student_applications(batch), user_id: user });
    await expect(insert("student_applications", { ...minimal.student_applications(batch), user_id: user })).rejects.toThrow(UNIQUE);
    await insert("student_applications", { ...minimal.student_applications(other), user_id: user }); // another batch is fine
    await insert("student_applications", { ...minimal.student_applications(batch), user_id: null });
    await insert("student_applications", { ...minimal.student_applications(batch), user_id: null }); // NULL user: several allowed
  });

  test("shortlinks.slug, blog_posts.slug, media.key", async () => {
    const link = minimal.shortlinks();
    await insert("shortlinks", link);
    await expect(insert("shortlinks", { ...minimal.shortlinks(), slug: link.slug! })).rejects.toThrow(UNIQUE);
    const post = minimal.blog_posts();
    await insert("blog_posts", post);
    await expect(insert("blog_posts", { ...minimal.blog_posts(), slug: post.slug! })).rejects.toThrow(UNIQUE);
    const file = minimal.media();
    await insert("media", file);
    await expect(insert("media", { ...minimal.media(), key: file.key! })).rejects.toThrow(UNIQUE);
  });

  test("blog_posts.wp_id is unique for imported articles, and many written in the admin (NULL) are fine", async () => {
    await insert("blog_posts", { ...minimal.blog_posts(), wp_id: 5491 });
    await expect(insert("blog_posts", { ...minimal.blog_posts(), wp_id: 5491 })).rejects.toThrow(UNIQUE);
    await insert("blog_posts", { ...minimal.blog_posts(), wp_id: null });
    await insert("blog_posts", { ...minimal.blog_posts(), wp_id: null });
  });

  test("admin_area_grants: the pair (user, area) is unique", async () => {
    const user = await aUser("editor");
    await insert("admin_area_grants", minimal.admin_area_grants(user, "konten"));
    await expect(insert("admin_area_grants", minimal.admin_area_grants(user, "konten"))).rejects.toThrow(UNIQUE);
    await insert("admin_area_grants", minimal.admin_area_grants(user, "komunikasi"));
    await insert("admin_area_grants", minimal.admin_area_grants(await aUser("editor"), "konten"));
    expect(await scalar("SELECT count(*) AS v FROM admin_area_grants")).toBe(3);
  });
});

describe("foreign keys and their cascade rules", () => {
  test("deleting a user cascades to sessions, accounts and area grants", async () => {
    const user = await aUser("editor");
    const keep = await aUser("editor");
    await insert("session", minimal.session(user));
    await insert("account", minimal.account(user));
    await insert("admin_area_grants", minimal.admin_area_grants(user, "konten"));
    await insert("session", minimal.session(keep));
    await insert("admin_area_grants", minimal.admin_area_grants(keep, "konten"));

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user).run();
    expect(await scalar("SELECT count(*) AS v FROM session WHERE user_id = ?", user)).toBe(0);
    expect(await scalar("SELECT count(*) AS v FROM account WHERE user_id = ?", user)).toBe(0);
    expect(await scalar("SELECT count(*) AS v FROM admin_area_grants WHERE user_id = ?", user)).toBe(0);
    expect(await scalar("SELECT count(*) AS v FROM session WHERE user_id = ?", keep)).toBe(1); // others untouched
    expect(await scalar("SELECT count(*) AS v FROM admin_area_grants WHERE user_id = ?", keep)).toBe(1);
  });

  test("deleting a user keeps everything they made or touched and clears the pointer (SET NULL)", async () => {
    const user = await aUser();
    const batch = minimal.admission_batches();
    await insert("admission_batches", { ...batch, created_by: user });
    const application = minimal.student_applications(batch.id as string);
    await insert("student_applications", { ...application, user_id: user, reviewed_by: user });
    const owned: [table: string, column: string, row: Row][] = [
      ["announcements", "created_by", minimal.announcements()],
      ["audit_log", "actor_id", minimal.audit_log()],
      ["reports", "uploaded_by", minimal.reports()],
      ["site_resources", "updated_by", minimal.site_resources()],
      ["shortlinks", "created_by", minimal.shortlinks()],
      ["blog_posts", "created_by", minimal.blog_posts()],
      ["blog_posts", "updated_by", minimal.blog_posts()],
      ["media", "uploaded_by", minimal.media()],
    ];
    for (const [table, column, row] of owned) await insert(table, { ...row, [column]: user });
    const grantee = await aUser("editor");
    await insert("admin_area_grants", { user_id: grantee, area: "konten", granted_by: user });

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user).run();

    for (const [table, column] of owned) {
      expect(await scalar(`SELECT count(*) AS v FROM ${table} WHERE ${column} IS NULL`), `${table}.${column}`).toBeGreaterThan(0);
      expect(await scalar(`SELECT count(*) AS v FROM ${table} WHERE ${column} = ?`, user), `${table}.${column} still points at the deleted user`).toBe(0);
    }
    expect(await scalar("SELECT created_by AS v FROM admission_batches WHERE id = ?", batch.id)).toBeNull();
    const kept = await env.DB.prepare("SELECT user_id, reviewed_by FROM student_applications WHERE id = ?").bind(application.id).first();
    expect(kept).toEqual({ user_id: null, reviewed_by: null }); // the application survives its owner
    expect(await scalar("SELECT granted_by AS v FROM admin_area_grants WHERE user_id = ?", grantee)).toBeNull(); // the grant survives its granter
    expect(await scalar("SELECT count(*) AS v FROM admin_area_grants WHERE user_id = ?", grantee)).toBe(1);
  });

  test("a batch that has applications cannot be deleted (RESTRICT); an empty one can", async () => {
    const batch = await aBatch();
    await insert("student_applications", minimal.student_applications(batch));
    await expect(env.DB.prepare("DELETE FROM admission_batches WHERE id = ?").bind(batch).run()).rejects.toThrow(FOREIGN_KEY);
    expect(await scalar("SELECT count(*) AS v FROM admission_batches WHERE id = ?", batch)).toBe(1);

    const empty = await aBatch();
    await env.DB.prepare("DELETE FROM admission_batches WHERE id = ?").bind(empty).run();
    expect(await scalar("SELECT count(*) AS v FROM admission_batches WHERE id = ?", empty)).toBe(0);
  });

  test("a row cannot point at a user or batch that does not exist", async () => {
    await expect(insert("announcements", { ...minimal.announcements(), created_by: uid() })).rejects.toThrow(FOREIGN_KEY);
    await expect(insert("student_applications", minimal.student_applications(uid()))).rejects.toThrow(FOREIGN_KEY);
    await expect(insert("admin_area_grants", minimal.admin_area_grants(uid()))).rejects.toThrow(FOREIGN_KEY);
  });

  test("an application must belong to a batch (NOT NULL)", async () => {
    await expect(insert("student_applications", { ...minimal.student_applications(uid()), batch_id: null })).rejects.toThrow(/NOT NULL constraint failed/);
  });
});

describe("types and defaults, through Drizzle", () => {
  test("ids are UUIDs made by the app when omitted", async () => {
    const [row] = await db.insert(schema.shortlinks).values({ slug: `uuid-${seq()}`, targetUrl: "/x" }).returning();
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("timestamps are epoch milliseconds; the database defaults created_at and the ORM refreshes updated_at", async () => {
    const opensAt = new Date("2026-08-01T00:00:00.000Z");
    const closesAt = new Date("2026-09-30T16:59:59.999Z");
    const [batch] = await db
      .insert(schema.admissionBatches)
      .values({ year: batchYear(), name: "Contoh", opensAt, closesAt })
      .returning();
    const raw = await env.DB.prepare("SELECT opens_at, closes_at, created_at, updated_at FROM admission_batches WHERE id = ?")
      .bind(batch!.id)
      .first<{ opens_at: number; closes_at: number; created_at: number; updated_at: number }>();
    expect(raw!.opens_at).toBe(opensAt.getTime());
    expect(raw!.closes_at).toBe(closesAt.getTime()); // milliseconds survive
    expect(Math.abs(raw!.created_at - Date.now())).toBeLessThan(10_000); // default applied, in ms (not s)
    expect(batch!.opensAt).toEqual(opensAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.update(schema.admissionBatches).set({ name: "Contoh 2" }).where(eq(schema.admissionBatches.id, batch!.id));
    const after = await db.query.admissionBatches.findFirst({ where: eq(schema.admissionBatches.id, batch!.id) });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(raw!.updated_at);
    expect(after!.createdAt.getTime()).toBe(raw!.created_at);
  });

  test("booleans are stored as 0 and 1 and come back as booleans", async () => {
    const [on] = await db.insert(schema.announcements).values({ title: "Aktif", body: "Isi", active: true }).returning();
    const [off] = await db.insert(schema.announcements).values({ title: "Mati", body: "Isi" }).returning(); // default false
    expect(on!.active).toBe(true);
    expect(off!.active).toBe(false);
    expect(await scalar("SELECT active AS v FROM announcements WHERE id = ?", on!.id)).toBe(1);
    expect(await scalar("SELECT active AS v FROM announcements WHERE id = ?", off!.id)).toBe(0);
    const [link] = await db.insert(schema.shortlinks).values({ slug: `bool-${seq()}`, targetUrl: "/x" }).returning();
    expect(link!.active).toBe(true); // shortlinks default to active
  });

  test("JSON columns round-trip objects, arrays, nested nulls and unicode", async () => {
    const [member] = await db
      .insert(schema.teamMembers)
      .values({
        name: "Contoh Anggota",
        role: "Ketua",
        educationHistory: [{ institution: "Institut Contoh", degree: "S1", year: "2012" }, { institution: "SMA Contoh", degree: null }],
        workHistory: [{ organization: "Lembaga Contoh", role: "Staf", period: "2013 - 2018" }],
      })
      .returning();
    const read = await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, member!.id) });
    expect(read!.educationHistory).toEqual([{ institution: "Institut Contoh", degree: "S1", year: "2012" }, { institution: "SMA Contoh", degree: null }]);
    expect(read!.workHistory).toEqual([{ organization: "Lembaga Contoh", role: "Staf", period: "2013 - 2018" }]);
    expect(typeof (await scalar("SELECT education_history AS v FROM team_members WHERE id = ?", member!.id))).toBe("string"); // text on disk

    const [bare] = await db.insert(schema.teamMembers).values({ name: "Tanpa Riwayat", role: "Anggota" }).returning();
    expect(bare!.educationHistory).toEqual([]); // default '[]'
    expect(bare!.workHistory).toEqual([]);

    const [audit] = await db
      .insert(schema.auditLog)
      .values({ actorEmail: "contoh@example.test", action: "admin.update", metadata: { before: ["konten"], after: [], nama: "Ünïcode ✓", nested: { a: [1, 2, { b: null }] } } })
      .returning();
    const back = await db.query.auditLog.findFirst({ where: eq(schema.auditLog.id, audit!.id) });
    expect(back!.metadata).toEqual({ before: ["konten"], after: [], nama: "Ünïcode ✓", nested: { a: [1, 2, { b: null }] } });
  });

  test("a full application form_data survives a round trip, including the optional groups set to null", async () => {
    const formData: StudentApplicationFormData = {
      formVersion: 2,
      identity: { nickname: "Contoh", gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh No. 1" },
      household: {
        livingWith: ["Ayah", "Ibu"],
        father: { name: "Contoh Ayah", occupation: "Petani", income: 1_500_000 },
        mother: { name: "Contoh Ibu", occupation: "Ibu rumah tangga", income: 0 },
        otherEarners: [{ relation: "Kakak", income: 800_000 }],
        familySize: 5,
      },
      housing: { residenceStatus: "Milik sendiri", buildingArea: 36, motorcycles: 1, cars: 0, debt: null },
      organizations: [{ name: "OSIS", position: "Anggota" }],
      documents: {
        fatherIncomeUrl: null,
        motherIncomeUrl: null,
        otherEarner1IncomeUrl: null,
        otherEarner2IncomeUrl: null,
        debtProofUrl: null,
        electricityBillUrl: "https://example.test/listrik",
        familyCardUrl: "https://example.test/kk",
        parentPermissionUrl: "https://example.test/izin",
        selfPhotoUrl: "https://example.test/foto",
        dtksRegistered: false,
        dtksUrl: null,
        houseImagesUrl: "https://example.test/rumah",
        vehicleImagesUrl: "https://example.test/kendaraan",
      },
      marketing: {
        instagramUsername: "contoh",
        instagramFollowProofUrl: "https://example.test/ig",
        broadcastProofUrl: "https://example.test/bc",
        twibbonUploadUrl: "https://example.test/tw",
        storyUploadUrl: "https://example.test/st",
      },
      interview: {
        motivationHigherEducation: "Ingin kuliah.",
        motivationSakem: "Ingin belajar.",
        consistencyPlan: "Belajar rutin.",
        attendanceCommitment: "Hadir.",
        parentResponse: "Mendukung.",
        ifParentChangesMind: "Berdiskusi.",
        agreedToSignedStatement: true,
      },
    };
    const batch = await aBatch();
    const [row] = await db
      .insert(schema.studentApplications)
      .values({ batchId: batch, fullName: "Contoh Pendaftar", email: "pendaftar@example.test", whatsapp: "081200000000", schoolName: "SMA Contoh", graduationYear: "2026", formData })
      .returning();
    const read = await db.query.studentApplications.findFirst({ where: eq(schema.studentApplications.id, row!.id) });
    expect(read!.formData).toEqual(formData);
    expect(read!.status).toBe("pending"); // default

    const [without] = await db
      .insert(schema.studentApplications)
      .values({ batchId: batch, fullName: "Tanpa Form", email: "x@example.test", whatsapp: "0812", schoolName: "SMA", graduationYear: "2026", formData: null })
      .returning();
    expect(without!.formData).toBeNull();
  });
});

describe("the constraints hold for the legacy-shaped sample the blog and uploads will use", () => {
  test("a blog article with its hero image size and a media row for it", async () => {
    const [post] = await db
      .insert(schema.blogPosts)
      .values({
        slug: "contoh-artikel-baru",
        title: "Contoh Artikel Baru",
        excerpt: "Ringkasan.",
        contentMarkdown: "# Judul\n\nIsi.",
        contentHtml: "<h1>Judul</h1>\n<p>Isi.</p>",
        image: "/blog/images/2026/10/contoh-ab12cd.webp",
        imageWidth: 1600,
        imageHeight: 900,
        category: "Cerita",
        author: "Contoh Penulis",
        status: "published",
        publishedAt: new Date("2026-10-11T17:00:00.000Z"), // 12 Oktober 2026, 00:00 WIB
      })
      .returning();
    expect(post!.featured).toBe(false);
    expect(post!.wpId).toBeNull();
    await db.insert(schema.media).values({ key: "blog/images/2026/10/contoh-ab12cd.webp", purpose: "blog", contentType: "image/webp", size: 120_000, width: 1600, height: 900 });
    const found = await db.query.media.findFirst({ where: eq(schema.media.key, post!.image!.slice(1)) }); // path minus the leading slash is the R2 key
    expect(found).toMatchObject({ width: post!.imageWidth, height: post!.imageHeight });
  });
});
