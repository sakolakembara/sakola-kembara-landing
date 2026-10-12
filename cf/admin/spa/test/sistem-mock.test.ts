import { describe, expect, test } from "vitest";
import { accessTo } from "~/lib/access";
import { parseMe } from "~/lib/me";
import { mockMeBody } from "~/mock/fixtures";
import { createSistemMock } from "~/mock/handlers/sistem";
import { parsePersona } from "~/mock/persona";
import { createMockTransport } from "~/mock/transport";

// The mock of Aktivitas and Pengaturan (mock/handlers/sistem.ts): `pnpm dev:spa:mock`, the persona super_admin. It
// answers in the Worker's shape and by the Worker's rules, so a screen can be built and looked at without a backend.

function setup(persona = "super_admin") {
  const parsed = parsePersona(persona);
  const me = mockMeBody(parsed);
  const handler = createSistemMock();
  const accessOf = (area: Parameters<typeof accessTo>[1]) => accessTo(parseMe(me), area);
  const raw = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) };
    return handler({ method, url: new URL(path, "http://mock.invalid"), init, accessOf, self: me.user });
  };
  const ask = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = raw(method, path, body, headers);
    if (!response) throw new Error(`the handler did not answer ${method} ${path}`);
    return { status: response.status, headers: response.headers, body: (response.status === 204 ? {} : await response.json()) as Record<string, any> };
  };
  return Object.assign(ask, { answers: (method: string, path: string) => raw(method, path) !== null });
}

describe("who may use it", () => {
  test.each(["viewer", "editor", "editor:konten,komunikasi,pendaftaran", "editor:-", "student"])("%s gets 403 on every route, as from the Worker", async (persona) => {
    const ask = setup(persona);
    for (const [method, path] of [["GET", "/api/admin/audit"], ["GET", "/api/admin/users"], ["GET", "/api/admin/users/mock-admin-dewi"], ["POST", "/api/admin/users"], ["PUT", "/api/admin/users/mock-admin-dewi"], ["POST", "/api/admin/users/mock-admin-dewi/deactivate"]] as const) {
      expect((await ask(method, path, method === "GET" ? undefined : {}))?.status, `${persona} ${method} ${path}`).toBe(403);
    }
  });

  test("a path that is not Sistem's is not answered, so the next handler gets it", async () => {
    const ask = setup();
    expect(ask.answers("GET", "/api/admin/announcements")).toBe(false);
    expect(ask.answers("GET", "/api/me")).toBe(false);
    expect(ask.answers("GET", "/api/admin/audit")).toBe(true);
  });

  test("the transport hands the paths to it: 200 for a super_admin who is signed in, 403 for an editor", async () => {
    const session = { get: () => true, set: () => undefined };
    const asSuper = createMockTransport({ persona: parsePersona("super_admin"), dashboard: "ready", delayMs: 0, session });
    expect((await asSuper("/api/admin/audit", { method: "GET" })).status).toBe(200);
    expect((await asSuper("/api/admin/users", { method: "GET" })).status).toBe(200);
    const asEditor = createMockTransport({ persona: parsePersona("editor"), dashboard: "ready", delayMs: 0, session });
    expect((await asEditor("/api/admin/audit", { method: "GET" })).status).toBe(403);
    expect((await asEditor("/api/nothing", { method: "GET" })).status).toBe(404);
  });
});

describe("Aktivitas", () => {
  test("a cursor walk of the whole seed: every row once, newest first, however the equal timestamps fall across pages", async () => {
    const ask = setup();
    for (const pageSize of [7, 50, 100]) {
      const ids: string[] = [];
      const times: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const answer: Awaited<ReturnType<typeof ask>> = await ask("GET", `/api/admin/audit?pageSize=${pageSize}${cursor ? `&cursor=${cursor}` : ""}`);
        expect(answer!.status).toBe(200);
        for (const item of answer!.body.items) {
          ids.push(item.id);
          times.push(item.createdAt);
        }
        cursor = answer!.body.nextCursor;
        if (!cursor) break;
      }
      expect(ids).toHaveLength(130);
      expect(new Set(ids).size).toBe(130);
      expect(times).toEqual([...times].sort().reverse());
    }
  });

  test("the default page is 50, and the same filters as the Worker narrow it", async () => {
    const ask = setup();
    const first = await ask("GET", "/api/admin/audit");
    expect(first!.body.items).toHaveLength(50);
    expect(first!.body.pageSize).toBe(50);
    expect(first!.body.nextCursor).toBeTruthy();
    const filtered = await ask("GET", "/api/admin/audit?action=blog.create&actor=BUDI@contoh.test&pageSize=100");
    expect(filtered!.body.items.length).toBeGreaterThan(0);
    expect(filtered!.body.items.every((item: { action: string; actorEmail: string }) => item.action === "blog.create" && item.actorEmail === "budi@contoh.test")).toBe(true);
    expect((await ask("GET", "/api/admin/audit?action=blog.create&actor=dewi@contoh.test"))!.body.items).toEqual([]); // the two together narrow, never widen
    const today = new Date().toISOString().slice(0, 10);
    expect((await ask("GET", `/api/admin/audit?from=${today}&to=${today}&pageSize=100`))!.status).toBe(200);
    expect((await ask("GET", "/api/admin/audit?from=2099-01-01"))!.body.items).toEqual([]);
  });

  test("the Worker's refusals: an action or a type that is not declared, a malformed day or cursor", async () => {
    const ask = setup();
    for (const [query, param] of [["action=nope", "action"], ["resource=nope", "resource"], ["from=2026-02-30", "from"], ["to=tomorrow", "to"], ["cursor=%21%21", "cursor"], [`actor=${"x".repeat(255)}`, "actor"]] as const) {
      const answer = await ask("GET", `/api/admin/audit?${query}`);
      expect(answer!.status, query).toBe(400);
      expect(answer!.body).toMatchObject({ error: "invalid_query", param });
    }
  });

  test("a row shows what the Worker would show: the allowed keys of the details, an admin's name, a row with a legacy name", async () => {
    const ask = setup();
    const all = (await ask("GET", "/api/admin/audit?pageSize=100"))!.body.items as { action: string; actorName: string | null; details: Record<string, unknown> | null }[];
    expect(all.find((item) => item.action === "upload.create")!.details).toEqual({ kind: "blog-image", contentType: "image/webp", size: 183204, width: 1200, height: 630 }); // never the path
    expect(all.find((item) => item.action === "announcement.update")).toMatchObject({ actorName: expect.any(String), details: { fields: ["title", "body"], label: "Pendaftaran Angkatan 2026 Dibuka" } });
    expect(all.find((item) => item.action === "student.register")).toMatchObject({ actorName: null, details: { via: "email" } });
    expect(all.some((item) => item.action === "admin.delete")).toBe(true); // shown, though it cannot be filtered for
  });

  test("it is read-only", async () => {
    const ask = setup();
    for (const method of ["POST", "PUT", "DELETE"]) expect((await ask(method, "/api/admin/audit", {}))!.status).toBe(404);
  });
});

describe("Pengaturan", () => {
  const dewi = "mock-admin-dewi";
  const version = async (ask: ReturnType<typeof setup>, id: string) => (await ask("GET", `/api/admin/users/${id}`))!.body.item.updatedAt as string;

  test("the list: the seed's six admins in every state, filters, an email prefix, sort and the envelope", async () => {
    const ask = setup();
    const list = await ask("GET", "/api/admin/users");
    expect(list!.body).toMatchObject({ page: 1, pageSize: 50, total: 6 });
    expect(list!.body.users).toEqual(list!.body.items);
    expect(list!.body.items.map((item: { status: string }) => item.status).sort()).toEqual(["active", "active", "active", "active", "deactivated", "invited"]);
    expect((await ask("GET", "/api/admin/users?status=invited"))!.body.items.map((item: { email: string }) => item.email)).toEqual(["guru-baru@contoh.test"]);
    expect((await ask("GET", "/api/admin/users?role=editor"))!.body.total).toBe(3);
    expect((await ask("GET", "/api/admin/users?q=BU"))!.body.items.map((item: { email: string }) => item.email)).toEqual(["budi@contoh.test"]);
    expect((await ask("GET", "/api/admin/users?q=contoh"))!.body.items).toEqual([]); // a prefix, not a substring
    expect((await ask("GET", "/api/admin/users?sort=-email"))!.body.items[0].email).toBe("super-admin@contoh.test");
    expect((await ask("GET", "/api/admin/users?sort=password"))!.body).toMatchObject({ error: "invalid_query", param: "sort" });
    expect((await ask("GET", "/api/admin/users?pageSize=2&page=3"))!.body.items).toHaveLength(2);
  });

  test("one admin has an ETag, an unknown one is 404", async () => {
    const ask = setup();
    const answer = await ask("GET", `/api/admin/users/${dewi}`);
    expect(answer!.headers.get("ETag")).toBe(`"${answer!.body.item.updatedAt}"`);
    expect(answer!.body.item).toMatchObject({ email: "dewi@contoh.test", role: "editor", areas: ["komunikasi", "konten"], status: "active" });
    expect((await ask("GET", "/api/admin/users/none"))!.status).toBe(404);
  });

  test("the edit form: 428 without If-Match, 409 stale for an old version, a new version for a save, nothing for a save that changes nothing", async () => {
    const ask = setup();
    const form = { name: "Dewi Pengurus", role: "editor", areas: ["konten"] };
    expect((await ask("PUT", `/api/admin/users/${dewi}`, form))!.status).toBe(428);
    const v0 = await version(ask, dewi);
    expect((await ask("PUT", `/api/admin/users/${dewi}`, form, { "If-Match": '"2020-01-01T00:00:00.000Z"' }))!.status).toBe(409);
    const saved = await ask("PUT", `/api/admin/users/${dewi}`, form, { "If-Match": `"${v0}"` });
    expect(saved!.status).toBe(200);
    expect(saved!.body.item).toMatchObject({ areas: ["konten"] });
    expect(saved!.body.item.updatedAt > v0).toBe(true);
    expect(saved!.headers.get("ETag")).toBe(`"${saved!.body.item.updatedAt}"`);
    const again = await ask("PUT", `/api/admin/users/${dewi}`, form, { "If-Match": `"${saved!.body.item.updatedAt}"` });
    expect(again!.body.item.updatedAt).toBe(saved!.body.item.updatedAt);
  });

  test("the form's rules, in the Worker's words", async () => {
    const ask = setup();
    const v = await version(ask, dewi);
    const bad = async (form: unknown) => (await ask("PUT", `/api/admin/users/${dewi}`, form, { "If-Match": `"${v}"` }))!;
    expect((await bad({ name: "", role: "editor", areas: [] })).body.fields).toEqual({ name: "Nama wajib diisi" });
    expect((await bad({ name: "A", role: "root", areas: [] })).body.fields).toEqual({ role: "Peran tidak dikenal" });
    expect((await bad({ name: "A", role: "editor", areas: ["sistem"] })).body.fields).toEqual({ areas: "Area tidak dikenal" });
    expect((await bad({ name: "A", role: "viewer", areas: ["konten"] })).body.fields).toEqual({ areas: "Area hanya untuk peran Editor." });
    expect((await ask("PUT", "/api/admin/users/none", { name: "A", role: "viewer", areas: [] }, { "If-Match": '"x"' }))!.status).toBe(404);
  });

  test("the last super_admin is the last one who can sign in: an invitation nobody opened does not count; with a second who can, the first can step down", async () => {
    const ask = setup();
    const self = "mock-user";
    const v = await version(ask, self);
    const refused = await ask("PUT", `/api/admin/users/${self}`, { name: "Pengguna Contoh", role: "viewer", areas: [] }, { "If-Match": `"${v}"` });
    expect(refused!.status).toBe(409);
    expect(refused!.body).toEqual({
      error: "last_super_admin",
      message: "Tidak dapat menurunkan peran super admin terakhir. Tambah super admin lain terlebih dahulu.",
      fields: { role: "Minimal satu super admin harus tersedia" },
    });
    expect((await ask("POST", `/api/admin/users/${self}/deactivate`, {}))!.body.error).toBe("cannot_deactivate_self");

    // An invitation is an account that exists and cannot be signed in to: it is not "another".
    const invited = await ask("POST", "/api/admin/users", { email: "undangan@contoh.test", name: "Undangan", role: "super_admin" });
    expect(invited!.status).toBe(201);
    expect(invited!.body.item).toMatchObject({ status: "invited", emailVerified: false });
    const stillRefused = await ask("PUT", `/api/admin/users/${self}`, { name: "Pengguna Contoh", role: "viewer", areas: [] }, { "If-Match": `"${v}"` });
    expect(stillRefused!.status).toBe(409);
    // ...and one who has opened it (a made-up address of the mock) is.
    const second = await ask("POST", "/api/admin/users", { email: "sudah-masuk@contoh.test", name: "Kedua", role: "super_admin" });
    expect(second!.status).toBe(201);
    expect(second!.body.item).toMatchObject({ status: "active", emailVerified: true });
    const allowed = await ask("PUT", `/api/admin/users/${self}`, { name: "Pengguna Contoh", role: "viewer", areas: [] }, { "If-Match": `"${v}"` });
    expect(allowed!.status).toBe(200);
    // And now the new one is the last: it cannot be deactivated by anyone.
    const last = await ask("POST", `/api/admin/users/${second!.body.item.id}/deactivate`, {});
    expect(last!.body.error).toBe("last_super_admin");
  });

  test("create: validation, a taken address, the areas of a new editor, an invitation or a password; the account is in the list at once", async () => {
    const ask = setup();
    expect((await ask("POST", "/api/admin/users", { email: "bukan email", role: "editor" }))!.body.fields).toEqual({ email: "Format email tidak valid" });
    expect((await ask("POST", "/api/admin/users", { email: "a@b.test", role: "editor", password: "pendek" }))!.body.fields).toEqual({ password: "Password minimal 8 karakter" });
    expect((await ask("POST", "/api/admin/users", { email: "a@b.test", role: "viewer", areas: ["konten"] }))!.body.fields).toEqual({ areas: "Area hanya untuk peran Editor." });
    const taken = await ask("POST", "/api/admin/users", { email: "DEWI@contoh.test", role: "viewer" });
    expect(taken!.status).toBe(409);
    expect(taken!.body).toMatchObject({ error: "email_taken", fields: { email: "Email sudah digunakan" } });

    const invite = await ask("POST", "/api/admin/users", { email: "guru@contoh.test", name: "Guru", role: "editor", areas: ["konten", "pendaftaran"] });
    expect(invite!.status).toBe(201);
    expect(invite!.body.item).toMatchObject({ status: "invited", role: "editor", areas: ["pendaftaran", "konten"], emailVerified: false });
    expect(invite!.body.email).toEqual({ sent: true, kind: "invite" });
    const password = await ask("POST", "/api/admin/users", { email: "sandi@contoh.test", role: "viewer", password: "kata sandi awal" });
    expect(password!.body.email).toEqual({ sent: true, kind: "verification" });
    expect((await ask("GET", "/api/admin/users"))!.body.total).toBe(8);
  });

  test("an address that plays up: the account is made and the email fails (502), or there is no email service (503, nothing made)", async () => {
    const ask = setup();
    const failed = await ask("POST", "/api/admin/users", { email: "email-gagal@contoh.test", role: "viewer" });
    expect(failed!.status).toBe(502);
    expect(failed!.body).toMatchObject({ error: "email_failed", message: "Email belum terkirim. Akun sudah dibuat; kirim ulang undangannya nanti." });
    expect((await ask("GET", "/api/admin/users?q=email-gagal"))!.body.total).toBe(1);
    const down = await ask("POST", "/api/admin/users", { email: "email-tidak-tersedia@contoh.test", role: "viewer" });
    expect(down!.status).toBe(503);
    expect((await ask("GET", "/api/admin/users?q=email-tidak"))!.body.total).toBe(0);
  });

  test("deactivate, reactivate and resend: the state changes, the guards answer as the Worker does", async () => {
    const ask = setup();
    expect((await ask("POST", `/api/admin/users/${dewi}/resend-invite`, {}))!.body.error).toBe("not_pending_invite");
    expect((await ask("POST", "/api/admin/users/mock-admin-baru/resend-invite", {}))!.body.email).toEqual({ sent: true, kind: "invite" });
    expect((await ask("POST", `/api/admin/users/${dewi}/deactivate`, {}))!.status).toBe(200);
    expect((await ask("GET", `/api/admin/users/${dewi}`))!.body.item).toMatchObject({ status: "deactivated", lastSessionAt: null });
    expect((await ask("POST", `/api/admin/users/${dewi}/reactivate`, {}))!.status).toBe(200);
    expect((await ask("GET", `/api/admin/users/${dewi}`))!.body.item.status).toBe("active");
    expect((await ask("POST", "/api/admin/users/none/deactivate", {}))!.status).toBe(404);
  });

  test("what is done here is in Aktivitas at once, newest first, as the super_admin, with only the allowed details", async () => {
    const ask = setup();
    await ask("POST", "/api/admin/users", { email: "guru@contoh.test", name: "Guru", role: "editor", areas: ["konten"], password: "kata sandi awal" });
    const v = await version(ask, dewi);
    await ask("PUT", `/api/admin/users/${dewi}`, { name: "Dewi Pengurus", role: "viewer", areas: [] }, { "If-Match": `"${v}"` });
    await ask("POST", `/api/admin/users/${dewi}/deactivate`, {});
    const items = (await ask("GET", "/api/admin/audit?pageSize=3"))!.body.items as { action: string; actorEmail: string; actorName: string; details: Record<string, unknown> }[];
    expect(items.map((item) => item.action)).toEqual(["admin.deactivate", "admin.update", "admin.create"]);
    expect(items.every((item) => item.actorEmail === "super-admin@contoh.test" && item.actorName === "Pengguna Contoh")).toBe(true);
    expect(items[1]!.details).toEqual({ email: "dewi@contoh.test", roleFrom: "editor", roleTo: "viewer", areasBefore: ["komunikasi", "konten"], areasAfter: [] });
    expect(items[2]!.details).toEqual({ email: "guru@contoh.test", role: "editor", mode: "password", areasAfter: ["konten"] });
    expect(JSON.stringify(items)).not.toContain("kata sandi awal");
  });
});
