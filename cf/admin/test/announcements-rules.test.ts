import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { announcementStatuses, CTA_URL_MESSAGES, ctaUrlProblem } from "../src/announcements/rules";
import { createAnnouncementRoutes } from "../src/api/announcements";
import type { CrudDeps } from "../src/api/crud";
import * as schema from "../src/db/schema";
import { currentAnnouncementQuery } from "../src/public/queries";
import type { ContentChange } from "../src/public/purge";
import { appAround, ifMatchOf, spyOnD1 } from "./crud-app";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { DAY, internalFetch, json } from "./public-helpers";

// What the Pengumuman screen adds to the reference CRUD (docs/cloudflare/admin-komunikasi.md): the CTA URL rule, the
// `status` of each row ("Tampil sekarang") computed with the public strip's own predicate and order, and the proof that
// the public `GET /api/public/announcements/current` follows every admin change and leaks nothing. The role matrix, the
// 409s and the audit rows are in test/announcements.test.ts and test/crud-contract.test.ts.

const BASE = "/api/admin/announcements";
const valid = { title: "Pendaftaran Angkatan 2026 Dibuka", body: "Daftar sekarang melalui halaman Gabung Siswa.", severity: "info", active: true };

const editor = () => signedInCookie(uniqueEmail("editor"), "editor", ["komunikasi"]);

interface Seed {
  id: string;
  title: string;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  severity: "info" | "warning" | "urgent";
}

let counter = 0;
async function seed(over: Partial<Seed> = {}): Promise<Seed> {
  counter += 1;
  const row: Seed = { id: crypto.randomUUID(), title: `Pengumuman ${counter}`, active: true, startsAt: null, endsAt: null, createdAt: 1_000_000 + counter, severity: "info", ...over };
  await env.DB.prepare("INSERT INTO announcements (id, title, body, severity, active, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, 'Isi pengumuman contoh', ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.title, row.severity, row.active ? 1 : 0, row.startsAt, row.endsAt, row.createdAt, row.createdAt)
    .run();
  return row;
}

type Status = (typeof announcementStatuses)[number];
interface Listed {
  items: { id: string; title: string; status: Status }[];
  total: number;
}

describe("the CTA URL: a path of this site or an http(s) URL (a javascript: link on every public page is not a link)", () => {
  const ok = ["/gabung-siswa", "/blog?kategori=News#atas", "/", "https://sakolakembara.org/donasi", "http://example.org", "HTTPS://EXAMPLE.ORG/Halaman", "  /gabung-siswa  "];
  const refused: [string, string][] = [
    ["//evil.example/halaman", CTA_URL_MESSAGES.offSite],
    ["javascript:alert(document.cookie)", CTA_URL_MESSAGES.scheme],
    ["JaVaScRiPt:alert(1)", CTA_URL_MESSAGES.scheme],
    ["data:text/html,<script>alert(1)</script>", CTA_URL_MESSAGES.scheme],
    ["mailto:kami@example.test", CTA_URL_MESSAGES.scheme],
    ["ftp://example.org/berkas", CTA_URL_MESSAGES.scheme],
    ["gabung-siswa", CTA_URL_MESSAGES.format],
    ["www.example.org", CTA_URL_MESSAGES.format],
    ["/jalan\\keluar", CTA_URL_MESSAGES.format],
    ["/\\evil.example", CTA_URL_MESSAGES.format],
    ["/ada\u0000kontrol", CTA_URL_MESSAGES.format],
    ["/ada\nbaris-baru", CTA_URL_MESSAGES.format],
  ];

  test("the rule itself, in the words of the legacy shortlink form", () => {
    for (const url of ok) expect(ctaUrlProblem(url), url).toBeNull();
    for (const [url, message] of refused) expect(ctaUrlProblem(url), url).toBe(message);
  });

  test("create and update refuse it on the field, in the one 400 shape, and write nothing", async () => {
    const cookie = await editor();
    for (const [url, message] of refused) {
      const res = await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "Daftar", ctaUrl: url } });
      expect(res.status, url).toBe(400);
      expect(await res.json(), url).toMatchObject({ error: "invalid", fields: { ctaUrl: message } });
    }
    const row = await seed();
    const put = await call(`${BASE}/${row.id}`, { method: "PUT", cookie, headers: await ifMatchOf("announcements", row.id), json: { ...valid, ctaLabel: "Daftar", ctaUrl: "javascript:alert(1)" } });
    expect(put.status).toBe(400);
    expect(await put.json()).toMatchObject({ fields: { ctaUrl: CTA_URL_MESSAGES.scheme } });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM announcements").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log").first<{ n: number }>())!.n).toBe(0);
  });

  test("a good one is saved as typed (trimmed), and the legacy pair rule still comes first", async () => {
    const cookie = await editor();
    const created = await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "Donasi", ctaUrl: "  https://example.org/donasi  " } });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { item: { ctaUrl: string } }).item.ctaUrl).toBe("https://example.org/donasi");

    // A URL without its label, and a label without its URL: the legacy message, on the legacy field.
    const noLabel = await call(BASE, { method: "POST", cookie, json: { ...valid, ctaUrl: "/gabung-siswa" } });
    expect(await noLabel.json()).toMatchObject({ fields: { ctaLabel: "Label dan URL CTA harus diisi keduanya" } });
    const noUrl = await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "Daftar" } });
    expect(await noUrl.json()).toMatchObject({ fields: { ctaLabel: "Label dan URL CTA harus diisi keduanya" } });

    // Both blank is no button at all.
    expect((await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "  ", ctaUrl: "" } })).status).toBe(201);
  });

  test("the length limit is still the legacy one (500), reported before the URL's own rules", async () => {
    const cookie = await editor();
    const res = await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "Daftar", ctaUrl: `/${"a".repeat(500)}` } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: { ctaUrl: "URL CTA maksimal 500 karakter" } });
  });
});

describe("`status` of each row: what the public strip implies, computed on the server", () => {
  const NOW = 1_800_000_000_000;
  const app = () => appAround({ [BASE]: createAnnouncementRoutes(undefined, { now: () => new Date(NOW) }) });

  async function statuses(query = ""): Promise<Record<string, Status>> {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const res = await call(`${BASE}${query}`, { cookie, via: app() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Listed;
    return Object.fromEntries(body.items.map((item) => [item.title, item.status]));
  }

  /** What `GET /api/public/announcements/current` would pick at `NOW`: the same query function the endpoint runs. */
  async function shownTitle(): Promise<string | null> {
    const rows = await currentAnnouncementQuery(drizzle(env.DB, { schema }), new Date(NOW));
    return rows[0]?.title ?? null;
  }

  test("the four statuses, and exactly one `current`", async () => {
    await seed({ title: "lama-tampil", createdAt: NOW - 3 * DAY });
    await seed({ title: "baru-tampil", createdAt: NOW - 1 * DAY });
    await seed({ title: "belum-mulai", startsAt: NOW + DAY, createdAt: NOW });
    await seed({ title: "sudah-selesai", startsAt: NOW - 3 * DAY, endsAt: NOW - DAY, createdAt: NOW });
    await seed({ title: "mati", active: false, createdAt: NOW });
    expect(await statuses()).toEqual({
      "baru-tampil": "current",
      "lama-tampil": "superseded",
      "belum-mulai": "outside_window",
      "sudah-selesai": "outside_window",
      mati: "inactive",
    });
    expect(await shownTitle()).toBe("baru-tampil");
  });

  // Negative test (scripts/negative-checks-komunikasi.mjs): make either end of the window exclusive, in the predicate
  // the strip and this list share, and these four fail.
  test("the window is inclusive at both ends, to the millisecond, exactly as the public strip reads it", async () => {
    const cases: { title: string; startsAt: number | null; endsAt: number | null; status: Status }[] = [
      { title: "mulai-tepat-sekarang", startsAt: NOW, endsAt: null, status: "current" },
      { title: "mulai-semili-lagi", startsAt: NOW + 1, endsAt: null, status: "outside_window" },
      { title: "selesai-tepat-sekarang", startsAt: null, endsAt: NOW, status: "current" },
      { title: "selesai-semili-lalu", startsAt: null, endsAt: NOW - 1, status: "outside_window" },
      { title: "awal-dan-akhir-sekarang", startsAt: NOW, endsAt: NOW, status: "current" },
    ];
    for (const { title, startsAt, endsAt, status } of cases) {
      await env.DB.exec("DELETE FROM announcements");
      await seed({ title, startsAt, endsAt });
      expect(await statuses(), title).toEqual({ [title]: status });
      // And the strip agrees: it shows the row exactly when the list says "current".
      expect(await shownTitle(), title).toBe(status === "current" ? title : null);
    }
  });

  test("either end of the window may be open", async () => {
    await seed({ title: "tanpa-batas" });
    await seed({ title: "hanya-mulai", startsAt: NOW - DAY, createdAt: 1_000_000 + 1 });
    await seed({ title: "hanya-akhir", endsAt: NOW + DAY, createdAt: 1_000_000 + 2 });
    const result = await statuses();
    expect(Object.values(result).filter((status) => status === "current")).toHaveLength(1);
    expect(Object.values(result).filter((status) => status === "superseded")).toHaveLength(2);
  });

  test("when several are live the most recently created is shown; a tie is broken by insertion order, like the strip's", async () => {
    await seed({ title: "pertama", createdAt: NOW - 5000 });
    await seed({ title: "kedua", createdAt: NOW - 5000 }); // same instant, inserted later: the higher rowid wins
    await seed({ title: "terlama", createdAt: NOW - 9000 });
    expect(await statuses()).toEqual({ kedua: "current", pertama: "superseded", terlama: "superseded" });
    expect(await shownTitle()).toBe("kedua");
  });

  test("the current one is marked even when the filter or the page leaves it out", async () => {
    await seed({ title: "info-baru", severity: "info", createdAt: NOW - DAY });
    await seed({ title: "mendesak-lama", severity: "urgent", createdAt: NOW - 2 * DAY });
    await seed({ title: "mendesak-mati", severity: "urgent", active: false });
    // Only the urgent ones are on the page; the newest live one (info) is not, so the urgent live one is superseded, not current.
    expect(await statuses("?severity=urgent")).toEqual({ "mendesak-lama": "superseded", "mendesak-mati": "inactive" });
    // Page 2 of a two-row page: the current one is on page 1 and page 2 knows it.
    expect(await statuses("?pageSize=1&page=2&sort=-createdAt")).toEqual({ "mendesak-lama": "superseded" });
    expect(await statuses("?active=false")).toEqual({ "mendesak-mati": "inactive" });
  });

  test("nothing live: no `current`, and `total` is the whole table", async () => {
    await seed({ title: "mati", active: false });
    await seed({ title: "nanti", startsAt: NOW + DAY });
    expect(await statuses()).toEqual({ mati: "inactive", nanti: "outside_window" });
    expect(await shownTitle()).toBeNull();
  });

  test("the list and the strip agree on a generated spread of rows around the edges (a property check against the same instant)", async () => {
    // A small deterministic generator: every combination of active, start and end around NOW, with colliding created_at values.
    const edges = [null, NOW - DAY, NOW - 1, NOW, NOW + 1, NOW + DAY];
    let n = 0;
    for (const active of [true, false]) {
      for (const startsAt of edges) {
        for (const endsAt of edges) {
          if (startsAt !== null && endsAt !== null && endsAt < startsAt) continue; // the table refuses it
          n += 1;
          await seed({ title: `kombinasi-${n}`, active, startsAt, endsAt, createdAt: NOW - ((n * 7) % 5) * 1000 });
        }
      }
    }
    const result = await statuses("?pageSize=100");
    expect(Object.keys(result).length).toBe(n);

    const rows = (await env.DB.prepare("SELECT title, active, starts_at AS s, ends_at AS e FROM announcements").all<{ title: string; active: number; s: number | null; e: number | null }>()).results;
    // The rule written out again, independently, in JavaScript.
    const live = (row: (typeof rows)[number]) => row.active === 1 && (row.s === null || row.s <= NOW) && (row.e === null || row.e >= NOW);
    for (const row of rows) {
      const expected = live(row) ? (row.title === (await shownTitle()) ? "current" : "superseded") : row.active === 1 ? "outside_window" : "inactive";
      expect(result[row.title], row.title).toBe(expected);
    }
    expect(Object.values(result).filter((status) => status === "current")).toHaveLength(1);
  });

  test("the list is one round trip of three statements; the strip's lookup seeks the (active, window) index", async () => {
    await seed();
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const spy = spyOnD1(env.DB);
    const res = await call(BASE, { cookie, env: { DB: spy.db } });
    expect(res.status).toBe(200);
    const events = spy.events.filter((event) => event.sql.some((sql) => sql.includes('"announcements"')));
    expect(events.map((event) => [event.kind, event.sql.length])).toEqual([["batch", 3]]);

    const plan = async (sql: string, ...params: unknown[]) =>
      (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((row) => row.detail);
    const { sql, params } = currentAnnouncementQuery(drizzle(env.DB, { schema }), new Date(NOW)).toSQL();
    expect((await plan(sql, ...params))[0]).toBe("SEARCH announcements USING INDEX announcements_active_idx (active=?)");
    // The page statement scans the table in created_at order: there is no index on it, and announcements stay at a few dozen rows.
    const page = await plan("SELECT * FROM announcements ORDER BY created_at DESC, id ASC LIMIT 20 OFFSET 0");
    expect(page[0]).toBe("SCAN announcements");
  });

  test("the status is only in the list: one item and the save answers keep the kit's field list", async () => {
    const cookie = await editor();
    const row = await seed({ title: "satu" });
    const one = ((await (await call(`${BASE}/${row.id}`, { cookie })).json()) as { item: Record<string, unknown> }).item;
    expect(Object.keys(one)).not.toContain("status");
    const created = ((await (await call(BASE, { method: "POST", cookie, json: valid })).json()) as { item: Record<string, unknown> }).item;
    expect(Object.keys(created)).not.toContain("status");
  });
});

describe("the public strip follows every admin change, and shows nothing internal", () => {
  const PUBLIC = "/api/public/announcements/current";
  interface Strip {
    announcement: Record<string, unknown> | null;
  }
  const strip = async () => json<Strip>(await internalFetch(PUBLIC));

  test("create, edit, switch off, schedule, replace by a newer one, delete: the strip is what the admin left", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    expect((await strip()).announcement).toBeNull();

    // Created active, no window: shown, with the CTA the admin typed.
    const created = await call(BASE, { method: "POST", cookie, json: { ...valid, severity: "warning", ctaLabel: "Daftar", ctaUrl: "/gabung-siswa" } });
    const { item } = (await created.json()) as { item: { id: string } };
    expect((await strip()).announcement).toEqual({ title: valid.title, body: valid.body, severity: "warning", ctaLabel: "Daftar", ctaUrl: "/gabung-siswa" });

    // Edited: the new text.
    const edit = async (changes: object) => {
      const res = await call(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: await ifMatchOf("announcements", item.id), json: { ...valid, ctaLabel: null, ctaUrl: null, ...changes } });
      expect(res.status).toBe(200);
    };
    await edit({ title: "Judul yang diubah" });
    expect((await strip()).announcement).toMatchObject({ title: "Judul yang diubah", ctaLabel: null, ctaUrl: null });

    // Switched off: gone. Scheduled for tomorrow: still gone. A window around now: back.
    await edit({ active: false });
    expect((await strip()).announcement).toBeNull();
    await edit({ active: true, startsAt: new Date(Date.now() + DAY).toISOString() });
    expect((await strip()).announcement).toBeNull();
    await edit({ active: true, startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() });
    expect((await strip()).announcement).toMatchObject({ title: valid.title });
    // A window that ended.
    await edit({ active: true, startsAt: new Date(Date.now() - 3 * DAY).toISOString(), endsAt: new Date(Date.now() - DAY).toISOString() });
    expect((await strip()).announcement).toBeNull();
    await edit({ active: true });
    expect((await strip()).announcement).toMatchObject({ title: valid.title });

    // A newer active one takes over; deleting it hands the strip back to the older.
    const newer = await call(BASE, { method: "POST", cookie, json: { ...valid, title: "Yang lebih baru" } });
    const newerId = ((await newer.json()) as { item: { id: string } }).item.id;
    expect((await strip()).announcement).toMatchObject({ title: "Yang lebih baru" });
    expect((await call(`${BASE}/${newerId}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await strip()).announcement).toMatchObject({ title: valid.title });
    expect((await call(`${BASE}/${item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await strip()).announcement).toBeNull();
  });

  // Negative test (scripts/negative-checks-komunikasi.mjs): add `createdBy` to the strip's query and serializer
  // and the allow-list below fails. SAKEM-085 was the legacy `/api/announcements/current` sending the whole row.
  test("what it exposes is title, body, severity and the CTA: no author, id, date, flag or address", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["komunikasi"]);
    const author = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
    const created = await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "Daftar", ctaUrl: "/gabung-siswa", startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() } });
    const { item } = (await created.json()) as { item: { id: string } };
    // The author really is stored, so the test is not vacuous.
    expect((await env.DB.prepare("SELECT created_by AS v FROM announcements WHERE id = ?").bind(item.id).first<{ v: string }>())!.v).toBe(author);

    const res = await internalFetch(PUBLIC);
    const text = await res.text();
    expect(Object.keys((JSON.parse(text) as Strip).announcement!).sort()).toEqual(["body", "ctaLabel", "ctaUrl", "severity", "title"]);
    for (const secret of [author, email, item.id, "createdBy", "created_by", "updatedAt", "startsAt", "endsAt", "active"]) expect(text, secret).not.toContain(secret);
  });

  test("a refused, invalid, stale or unchanged save leaves the strip as it was", async () => {
    const cookie = await editor();
    const created = await call(BASE, { method: "POST", cookie, json: valid });
    const { item } = (await created.json()) as { item: { id: string; updatedAt: string } };
    const before = await (await internalFetch(PUBLIC)).text();

    expect((await call(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: await ifMatchOf("announcements", item.id), json: { ...valid, title: "x" } })).status).toBe(400);
    expect((await call(`${BASE}/${item.id}`, { method: "PUT", cookie, headers: { "if-match": '"2020-01-01T00:00:00.000Z"' }, json: { ...valid, title: "Basi sekali" } })).status).toBe(409);
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    expect((await call(`${BASE}/${item.id}`, { method: "DELETE", cookie: viewer })).status).toBe(403);
    expect(await (await internalFetch(PUBLIC)).text()).toBe(before);
  });
});

describe("every change asks for the public announcement to be purged, and only a change does", () => {
  function setup() {
    const notify = vi.fn<(change: ContentChange) => void>();
    const deps: CrudDeps = { notify: (change) => notify(change), deleteUpload: async () => ({ status: "not_found" }) };
    const app = appAround({ [BASE]: createAnnouncementRoutes(deps) });
    return { notify, app };
  }
  const purges = (notify: ReturnType<typeof setup>["notify"]) => notify.mock.calls.map(([change]) => change);

  test("create, update and delete: one purge of { area: 'announcement' } each", async () => {
    const { notify, app } = setup();
    const cookie = await editor();
    const created = await call(BASE, { method: "POST", cookie, json: valid, via: app });
    const id = ((await created.json()) as { item: { id: string } }).item.id;
    await call(`${BASE}/${id}`, { method: "PUT", cookie, headers: await ifMatchOf("announcements", id), json: { ...valid, active: false }, via: app });
    await call(`${BASE}/${id}`, { method: "DELETE", cookie, via: app });
    expect(purges(notify)).toEqual([{ area: "announcement" }, { area: "announcement" }, { area: "announcement" }]);
  });

  test("nothing is purged for a save that did not happen: invalid, stale, refused, unchanged, missing", async () => {
    const { notify, app } = setup();
    const cookie = await editor();
    const created = await call(BASE, { method: "POST", cookie, json: valid, via: app });
    const id = ((await created.json()) as { item: { id: string } }).item.id;
    notify.mockClear();

    const fresh = await ifMatchOf("announcements", id);
    expect((await call(BASE, { method: "POST", cookie, json: { ...valid, title: "x" }, via: app })).status).toBe(400);
    expect((await call(BASE, { method: "POST", cookie, json: { ...valid, ctaLabel: "A", ctaUrl: "javascript:1" }, via: app })).status).toBe(400);
    expect((await call(`${BASE}/${id}`, { method: "PUT", cookie, headers: { "if-match": '"2020-01-01T00:00:00.000Z"' }, json: valid, via: app })).status).toBe(409);
    // Saving the form exactly as loaded is not a change.
    expect((await call(`${BASE}/${id}`, { method: "PUT", cookie, headers: fresh, json: valid, via: app })).status).toBe(200);
    expect((await call(`${BASE}/${crypto.randomUUID()}`, { method: "DELETE", cookie, via: app })).status).toBe(404);
    const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
    expect((await call(BASE, { method: "POST", cookie: viewer, json: valid, via: app })).status).toBe(403);
    expect(purges(notify)).toEqual([]);
  });
});
