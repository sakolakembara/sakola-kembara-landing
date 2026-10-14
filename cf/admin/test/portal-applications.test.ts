import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { RATE_LIMITS } from "../src/security/rate-limit";
import { uniqueEmail } from "./helpers";
import { limiterClock, withFrozenDate } from "./limiter-clock";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { portalCall, portalSignedIn } from "./portal-helpers";
import {
  addFileRow,
  addRequiredFiles,
  CURRENT,
  draftOf,
  get,
  json,
  OVERVIEW,
  openBatch,
  putStep,
  saveAll,
  setStorage,
  STATUS,
  stepPath,
  student,
  SUBMIT,
  submit,
  VALID,
  countRows,
} from "./portal-applications-helpers";
import { DAY } from "./public-helpers";

// The student's application API, the read routes and what every route shares (src/portal/applications.ts,
// docs/cloudflare/portal-api.md, sections 1, 4, 5 and 6): the pipeline of a student route, the overview, the wizard's
// bootstrap and the gate. Saving is in portal-applications-steps.test.ts, the submit in portal-applications-submit.test.ts,
// the status page and its privacy contract in portal-applications-status.test.ts.

interface Route {
  name: string;
  method: "GET" | "PUT" | "POST";
  path: string;
  limiter: keyof typeof RATE_LIMITS;
  /** A body the route takes. */
  body?: unknown;
}

const ROUTES: Route[] = [
  { name: "overview", method: "GET", path: OVERVIEW, limiter: "portalRead" },
  { name: "applications/current", method: "GET", path: CURRENT, limiter: "portalRead" },
  { name: "applications", method: "GET", path: STATUS, limiter: "portalRead" },
  { name: "steps/:step", method: "PUT", path: stepPath("identity"), limiter: "portalSave", body: VALID.identity },
  { name: "submit", method: "POST", path: SUBMIT, limiter: "portalSubmit", body: {} },
];

const call = (route: Route, cookie?: string, init: Parameters<typeof portalCall>[1] = {}) =>
  portalCall(route.path, { method: route.method, ...(route.body !== undefined ? { json: route.body } : {}), ...(cookie ? { cookie } : {}), ...init });

describe("the pipeline of a student route: session, role, verified address, limiter", () => {
  test("nobody signed in: 401 on every route, and nothing is built or read (no cookie, no session)", async () => {
    for (const route of ROUTES) {
      const res = await call(route);
      expect(res.status, route.name).toBe(401);
      expect(await res.json(), route.name).toEqual({ error: "unauthenticated" });
    }
  });

  test("a request that carries only the admin's cookie name is nobody here either", async () => {
    for (const route of ROUTES) expect((await call(route, "better-auth.session_token=forged.value")).status, route.name).toBe(401);
  });

  test("an admin account on the apex (viewer, editor, super_admin): 403 student_only on every route, and nothing is written", async () => {
    for (const role of ["viewer", "editor", "super_admin"] as const) {
      const cookie = await portalSignedIn(uniqueEmail(role), role);
      for (const route of ROUTES) {
        const res = await call(route, cookie);
        expect(res.status, `${role} ${route.name}`).toBe(403);
        expect(await res.json(), `${role} ${route.name}`).toMatchObject({ error: "student_only" });
      }
    }
    expect(await countRows("application_drafts")).toBe(0);
    expect(await countRows("student_applications")).toBe(0);
  });

  test("a deactivated student has no session: 401", async () => {
    const who = await student();
    expect((await get(OVERVIEW, who)).status).toBe(200);
    await env.DB.prepare("UPDATE users SET deactivated_at = ? WHERE id = ?").bind(Date.now(), who.id).run();
    for (const route of ROUTES) expect((await call(route, who.cookie)).status, route.name).toBe(401);
  });

  test("an address that is not verified: 403 email_not_verified on every route (defence in depth: such a student cannot sign in)", async () => {
    const who = await student();
    await env.DB.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").bind(who.id).run();
    for (const route of ROUTES) {
      const res = await call(route, who.cookie);
      expect(res.status, route.name).toBe(403);
      expect((await json(res)).error, route.name).toBe("email_not_verified");
    }
  });

  test("every refusal and every answer carries the no-store headers", async () => {
    const who = await student();
    for (const route of ROUTES) {
      for (const res of [await call(route), await call(route, who.cookie)]) {
        expect(res.headers.get("cache-control"), route.name).toBe("no-store");
        expect(res.headers.get("x-content-type-options"), route.name).toBe("nosniff");
        expect(res.headers.get("referrer-policy"), route.name).toBe("no-referrer");
      }
    }
  });

  test("a write from another origin, or with no origin signal and a cookie, is refused before anything runs (403 forbidden)", async () => {
    await openBatch();
    const who = await student();
    for (const route of ROUTES.filter((r) => r.method !== "GET")) {
      const wrong = await call(route, who.cookie, { origin: "https://evil.test" });
      expect(wrong.status, route.name).toBe(403);
      expect(await wrong.json(), route.name).toMatchObject({ error: "forbidden", reason: "origin_mismatch" });
      const none = await call(route, who.cookie, { origin: null });
      expect(none.status, route.name).toBe(403);
      expect(await none.json(), route.name).toMatchObject({ error: "forbidden", reason: "no_origin_signal" });
    }
    expect(await countRows("application_drafts")).toBe(0);
  });

  // The three read routes share RL_PORTAL_READ (60 a minute), the step save has RL_PORTAL_SAVE (30), the submit RL_PORTAL_SUBMIT (3).
  for (const limiter of ["portalRead", "portalSave", "portalSubmit"] as const) {
    test(`${limiter}: the limiter runs by USER ID right after the session: the limit passes, the next call is a 429 with Retry-After, and another student has their own count`, async () => {
      // No batch is open, so the writes answer 409 cheaply: what is counted is the call, not the work.
      const one = await student("satu");
      const two = await student("dua");
      const routes = ROUTES.filter((route) => route.limiter === limiter);
      const { limit, message } = RATE_LIMITS[limiter];
      for (let i = 0; i < limit; i++) expect((await call(routes[i % routes.length]!, one.cookie)).status, `${limiter} #${i + 1}`).not.toBe(429);
      for (const route of routes) {
        const refused = await call(route, one.cookie);
        expect(refused.status, route.name).toBe(429);
        expect(refused.headers.get("retry-after"), route.name).toBe("60");
        expect(await refused.json(), route.name).toEqual({ error: "rate_limited", message, retryAfterSeconds: 60 });
        expect((await call(route, two.cookie)).status, `${route.name}, another student`).not.toBe(429);
      }
    });
  }

  test("a new minute gives the limit back", async () => {
    const who = await student();
    const route = ROUTES[0]!;
    for (let i = 0; i < RATE_LIMITS.portalRead.limit; i++) await call(route, who.cookie);
    expect((await call(route, who.cookie)).status).toBe(429);
    limiterClock.advance(61_000);
    expect((await call(route, who.cookie)).status).toBe(200);
  });

  test("an unknown path under /portal/api, an id in a path and a method a route does not have are the JSON 404", async () => {
    const who = await student();
    expect((await get(`${OVERVIEW}/x`, who)).status).toBe(404);
    expect((await get(`${CURRENT}/steps/identity`, who)).status).toBe(404);
    // A method the route does not have is not a route.
    expect((await portalCall(OVERVIEW, { method: "POST", cookie: who.cookie, json: {} })).status).toBe(404);
    expect((await portalCall(STATUS, { method: "DELETE", cookie: who.cookie })).status).toBe(404);
  });
});

describe("GET /overview", () => {
  test("no batch is open: openBatch null, nothing started, no history, and exactly these keys", async () => {
    const who = await student();
    const res = await get(OVERVIEW, who);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body).sort()).toEqual(["current", "history", "now", "openBatch", "student"]);
    expect(body).toMatchObject({ openBatch: null, current: { state: "none" }, history: [], student: { name: "Tester", firstName: "Tester" } });
    expect(Math.abs(Date.parse(body.now) - Date.now())).toBeLessThan(10_000);
    expect(new Date(body.now).toISOString()).toBe(body.now);
  });

  test("an open batch: its public fields only (no created_by, no publication date), dates as ISO strings", async () => {
    const batch = await openBatch({ name: "Gen Uji 1", description: "Pendaftaran terbuka." });
    const who = await student();
    const body = await json(await get(OVERVIEW, who));
    expect(Object.keys(body.openBatch).sort()).toEqual(["closesAt", "description", "id", "name", "opensAt", "year"]);
    expect(body.openBatch).toEqual({ id: batch.id, year: batch.year, name: "Gen Uji 1", description: "Pendaftaran terbuka.", opensAt: batch.opensAt.toISOString(), closesAt: batch.closesAt.toISOString() });
    expect(body.current).toEqual({ state: "none" });
    // A batch without a description says null (the legacy home shows nothing).
    await env.DB.prepare("UPDATE admission_batches SET description = NULL").run();
    expect((await json(await get(OVERVIEW, who))).openBatch.description).toBeNull();
  });

  test("current: a draft says `draft` with its version, an application says `submitted` with its time", async () => {
    await openBatch();
    const who = await student();
    expect(await putStep(who, "identity", VALID.identity)).toHaveProperty("status", 200);
    const draft = (await draftOf(who.id))!;
    const asDraft = await json(await get(OVERVIEW, who));
    expect(asDraft.current).toEqual({ state: "draft", updatedAt: new Date(draft.updated_at).toISOString() });

    // The application takes the draft's place (what the submit does), and the overview follows.
    const batchId = draft.batch_id;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO student_applications (id, user_id, batch_id, full_name, email, whatsapp, school_name, graduation_year, submitted_at) VALUES (?1, ?2, ?3, 'X', 'x@example.test', '62812', 'S', '2027', ?4)").bind(draft.id, who.id, batchId, 1_800_000_000_000),
      env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(draft.id),
    ]);
    const asSubmitted = await json(await get(OVERVIEW, who));
    expect(asSubmitted.current).toEqual({ state: "submitted", submittedAt: new Date(1_800_000_000_000).toISOString() });
  });

  test("the greeting: the first word of the name, 'Sakemers' when there is none", async () => {
    const who = await student();
    for (const [name, first] of [["Sari Dewi Lestari", "Sari"], ["  Budi  Santoso ", "Budi"], ["Ayu", "Ayu"], ["", "Sakemers"], ["   ", "Sakemers"]] as const) {
      await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, who.id).run();
      const body = await json(await get(OVERVIEW, who));
      expect(body.student.firstName, JSON.stringify(name)).toBe(first);
      expect(body.student.name, JSON.stringify(name)).toBe(name);
    }
  });

  test("the history: every application of the student, newest first, with the batch and `published`; no status, no note, no verdict", async () => {
    const who = await student();
    const old = await addBatch({ year: 2031, name: "Gen Lama", resultsPublishedAt: new Date(Date.now() - 5 * DAY) });
    const recent = await addBatch({ year: 2032, name: "Gen Baru", opensAt: new Date(Date.now() - 20 * DAY), closesAt: new Date(Date.now() - 2 * DAY) });
    const first = await addApplication(old.id, { userId: who.id, status: "accepted", reviewNotes: "Catatan rahasia panitia", submittedAt: new Date(Date.now() - 40 * DAY) });
    const second = await addApplication(recent.id, { userId: who.id, status: "rejected", reviewNotes: "Catatan rahasia kedua", submittedAt: new Date(Date.now() - 10 * DAY) });
    const body = await json(await get(OVERVIEW, who));
    expect(body.history).toEqual([
      { id: second.id, batch: { year: 2032, name: "Gen Baru" }, submittedAt: second.submittedAt!.toISOString(), published: false },
      { id: first.id, batch: { year: 2031, name: "Gen Lama" }, submittedAt: first.submittedAt!.toISOString(), published: true },
    ]);
    for (const item of body.history) expect(Object.keys(item).sort()).toEqual(["batch", "id", "published", "submittedAt"]);
    const text = JSON.stringify(body);
    for (const secret of ["accepted", "rejected", "rahasia", "status", "reviewNotes"]) expect(text, secret).not.toContain(secret);
  });
});

describe("GET /applications/current (the wizard's bootstrap)", () => {
  test("no batch is open: gate no_open_batch, and the exact key set", async () => {
    const who = await student();
    const body = await json(await get(CURRENT, who));
    expect(Object.keys(body).sort()).toEqual(["application", "batch", "draft", "files", "gate", "now", "user"]);
    expect(body).toMatchObject({ gate: "no_open_batch", batch: null, application: null, draft: null, files: [] });
    expect(body.user).toEqual({ name: "Tester", email: who.email });
  });

  test("a batch is open and nothing is started: gate open, no draft, no files, and NO draft is created by asking", async () => {
    const batch = await openBatch();
    const who = await student();
    const res = await get(CURRENT, who);
    const body = await json(res);
    expect(body).toMatchObject({ gate: "open", application: null, draft: null, files: [] });
    expect(body.batch).toEqual({ id: batch.id, year: batch.year, name: batch.name, description: null, opensAt: batch.opensAt.toISOString(), closesAt: batch.closesAt.toISOString() });
    await get(CURRENT, who);
    expect(await countRows("application_drafts")).toBe(0);
    expect(await countRows("application_files")).toBe(0);
  });

  test("a draft: the buckets exactly as stored, `saved` in the API's order, the resume point, and the required files that are still missing", async () => {
    await openBatch();
    const who = await student();
    // Saved out of order: the answer lists them in the order of the seven buckets.
    for (const step of ["household", "identity", "interview"] as const) expect((await putStep(who, step, VALID[step])).status).toBe(200);
    const draft = (await draftOf(who.id))!;
    const body = await json(await get(CURRENT, who));
    expect(Object.keys(body.draft).sort()).toEqual(["id", "lastStep", "missingFiles", "saved", "steps", "updatedAt"]);
    expect(body.draft.id).toBe(draft.id);
    expect(body.draft.updatedAt).toBe(new Date(draft.updated_at).toISOString());
    expect(body.draft.lastStep).toBe("interview");
    expect(body.draft.saved).toEqual(["identity", "household", "interview"]);
    expect(Object.keys(body.draft.steps)).toEqual(["identity", "household", "interview"]);
    // "As stored": the validated input, whatsapp and income as the student typed them (cleaned), counts as sent.
    expect(body.draft.steps.identity).toMatchObject({ fullName: VALID.identity.fullName, whatsapp: VALID.identity.whatsapp });
    expect(body.draft.steps.household).toMatchObject({ fatherIncome: "1.200.000", familySize: 4 });
    expect(body.draft.missingFiles).toEqual(["electricity-bill", "family-card", "parent-permission", "self-photo", "house-photos", "vehicle-photos", "marketing-follow-proof", "marketing-broadcast-proof", "marketing-twibbon-proof", "marketing-story-proof"]);
  });

  test("missingFiles follows the files, and `dtks` counts only when the student said ya", async () => {
    await openBatch();
    const who = await student();
    await putStep(who, "documents", { dtksRegistered: "tidak" });
    const draft = (await draftOf(who.id))!;
    await addRequiredFiles(draft.id);
    expect((await json(await get(CURRENT, who))).draft.missingFiles).toEqual([]);

    await putStep(who, "documents", { dtksRegistered: "ya" });
    expect((await json(await get(CURRENT, who))).draft.missingFiles).toEqual(["dtks"]);
    await addFileRow(draft.id, "dtks");
    expect((await json(await get(CURRENT, who))).draft.missingFiles).toEqual([]);
    // A file that was deleted does not count.
    await env.DB.prepare("UPDATE application_files SET deleted_at = ? WHERE slot = 'self-photo'").bind(Date.now()).run();
    expect((await json(await get(CURRENT, who))).draft.missingFiles).toEqual(["self-photo"]);
  });

  test("the files: the live ones of THIS draft, in the order of the form's slots and oldest first within a slot, with these keys and nothing else", async () => {
    await openBatch();
    const who = await student();
    await putStep(who, "identity", VALID.identity);
    const draft = (await draftOf(who.id))!;
    const t = Date.now();
    const photoNew = await addFileRow(draft.id, "house-photos", { createdAt: t + 2000, size: 2000 });
    const photoOld = await addFileRow(draft.id, "house-photos", { createdAt: t + 1000, size: 1000 });
    const bill = await addFileRow(draft.id, "electricity-bill", { contentType: "application/pdf", size: 5000, createdAt: t + 3000 });
    await addFileRow(draft.id, "family-card", { deletedAt: t });
    await addFileRow(crypto.randomUUID(), "family-card"); // another application's file
    const body = await json(await get(CURRENT, who));
    expect(body.files.map((f: { id: string }) => f.id)).toEqual([bill, photoOld, photoNew]);
    expect(Object.keys(body.files[0]).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);
    expect(body.files[0]).toEqual({ id: bill, slot: "electricity-bill", contentType: "application/pdf", size: 5000, width: null, height: null, uploadedAt: new Date(t + 3000).toISOString() });
    expect(body.files[1]).toMatchObject({ slot: "house-photos", contentType: "image/jpeg", width: 800, height: 600 });
  });

  test("an application for the open batch: gate submitted, its id and time, no draft, and the application's files", async () => {
    const batch = await openBatch();
    const who = await student();
    const application = await addApplication(batch.id, { userId: who.id, email: who.email, submittedAt: new Date(1_800_000_000_000) });
    await addFileRow(application.id, "family-card");
    await addFileRow(crypto.randomUUID(), "family-card");
    const body = await json(await get(CURRENT, who));
    expect(body.gate).toBe("submitted");
    expect(body.application).toEqual({ id: application.id, submittedAt: new Date(1_800_000_000_000).toISOString() });
    expect(body.draft).toBeNull();
    expect(body.batch.id).toBe(batch.id);
    expect(body.files).toHaveLength(1);
  });

  test("a draft whose batch closed since is not returned and not deleted: the gate says no_open_batch", async () => {
    const batch = await openBatch();
    const who = await student();
    await putStep(who, "identity", VALID.identity);
    const draft = (await draftOf(who.id))!;
    await addFileRow(draft.id, "family-card");
    await env.DB.prepare("UPDATE admission_batches SET opens_at = ?, closes_at = ? WHERE id = ?").bind(Date.now() - 20 * DAY, Date.now() - DAY, batch.id).run();
    const body = await json(await get(CURRENT, who));
    expect(body).toMatchObject({ gate: "no_open_batch", batch: null, draft: null, application: null, files: [] });
    expect(await draftOf(who.id)).not.toBeNull();
    // The overview agrees: nothing is open and nothing is started.
    expect(await json(await get(OVERVIEW, who))).toMatchObject({ openBatch: null, current: { state: "none" } });
  });

  test("an application for an OLD batch does not close the door on the open one; with two batches open the latest opens_at wins", async () => {
    const who = await student();
    const old = await addBatch({ opensAt: new Date(Date.now() - 90 * DAY), closesAt: new Date(Date.now() - 60 * DAY) });
    await addApplication(old.id, { userId: who.id });
    const earlier = await openBatch({ opensAt: new Date(Date.now() - 10 * DAY), name: "Dibuka lebih dulu" });
    const later = await openBatch({ opensAt: new Date(Date.now() - 2 * DAY), name: "Dibuka belakangan" });
    const body = await json(await get(CURRENT, who));
    expect(body.gate).toBe("open");
    expect(body.batch.id).toBe(later.id);
    expect(body.batch.id).not.toBe(earlier.id);
    expect((await json(await get(OVERVIEW, who))).openBatch.id).toBe(later.id);
  });

  test("the edges of the window follow the server's clock: open at opens_at, closed at closes_at (legacy: opens_at <= now < closes_at)", async () => {
    const who = await student();
    await withFrozenDate(async (clock) => {
      const batch = await addBatch({ opensAt: new Date(clock.now), closesAt: new Date(clock.now + DAY) });
      expect((await json(await get(CURRENT, who))).gate, "at opens_at").toBe("open");
      clock.advance(DAY - 1);
      expect((await json(await get(CURRENT, who))).gate, "one ms before closes_at").toBe("open");
      clock.advance(1);
      expect((await json(await get(CURRENT, who))).gate, "at closes_at").toBe("no_open_batch");
      clock.advance(-DAY - 1);
      expect((await json(await get(CURRENT, who))).gate, "one ms before opens_at").toBe("no_open_batch");
      await env.DB.prepare("DELETE FROM admission_batches WHERE id = ?").bind(batch.id).run();
    });
  });
});

describe("a student reaches their own rows and nobody else's", () => {
  test("two students on one batch: each overview, bootstrap, draft, files and status shows only the caller's", async () => {
    const batch = await openBatch();
    const ana = await student("ana");
    const budi = await student("budi");
    await putStep(ana, "identity", { ...VALID.identity, fullName: "Ana Penanda Satu", whatsapp: "6281111111111" });
    await putStep(budi, "identity", { ...VALID.identity, fullName: "Budi Penanda Dua", whatsapp: "6282222222222" });
    const anaDraft = (await draftOf(ana.id))!;
    const budiDraft = (await draftOf(budi.id))!;
    await addFileRow(anaDraft.id, "family-card");
    await addFileRow(budiDraft.id, "family-card");
    await addFileRow(budiDraft.id, "family-card");
    const submitted = await addApplication(batch.id, { userId: (await student("cici")).id, fullName: "Cici Penanda Tiga" });

    for (const [who, mine, theirs] of [[ana, "Ana Penanda Satu", ["Budi Penanda Dua", "Cici Penanda Tiga", "6282222222222"]], [budi, "Budi Penanda Dua", ["Ana Penanda Satu", "Cici Penanda Tiga", "6281111111111"]]] as const) {
      const current = await get(CURRENT, who);
      const text = await current.text();
      expect(text).toContain(mine);
      for (const other of theirs) expect(text, `${mine} sees ${other}`).not.toContain(other);
      expect(JSON.parse(text).draft.id).toBe(who === ana ? anaDraft.id : budiDraft.id);
      expect(JSON.parse(text).files).toHaveLength(who === ana ? 1 : 2);
      for (const path of [OVERVIEW, STATUS]) {
        const body = await (await get(path, who)).text();
        expect(body, path).not.toContain(submitted.id);
        for (const other of theirs) expect(body, `${path} ${other}`).not.toContain(other);
      }
    }
    // The status list holds only the caller's own applications.
    expect((await json(await get(STATUS, ana))).items).toEqual([]);
    // Somebody else's application for the open batch is not mine: the gate stays open and my state is my draft.
    expect((await json(await get(OVERVIEW, ana))).current.state).toBe("draft");
    expect((await json(await get(CURRENT, ana))).gate).toBe("open");
    const newcomer = await student("baru");
    expect((await json(await get(OVERVIEW, newcomer))).current).toEqual({ state: "none" });
    expect((await json(await get(CURRENT, newcomer))).gate).toBe("open");
    expect((await putStep(newcomer, "identity", { ...VALID.identity, whatsapp: "6283333333333" })).status).toBe(200);
  });

  test("a student cannot save into, submit, or read the draft of another by any id: no route takes one, and a saved step lands on the caller's own draft only", async () => {
    await openBatch();
    const ana = await student("ana");
    const budi = await student("budi");
    await putStep(budi, "identity", { ...VALID.identity, fullName: "Budi Penanda Dua" });
    const before = (await draftOf(budi.id))!;
    // Ana saves another bucket and submits (she has nothing complete): Budi's row does not move.
    expect((await putStep(ana, "household", VALID.household)).status).toBe(200);
    expect((await submit(ana)).status).toBe(422);
    const after = (await draftOf(budi.id))!;
    expect(after).toEqual(before);
    expect(await countRows("application_drafts")).toBe(2);
    // Ids in the path are not routes.
    for (const path of [`${CURRENT}/${before.id}`, `${STATUS}/${before.id}`, `/portal/api/applications/${before.id}/steps/identity`]) {
      expect((await get(path, ana)).status, path).toBe(404);
    }
  });
});

describe("reading is not writing", () => {
  test("the overview, the bootstrap and the status page write no row anywhere", async () => {
    await openBatch();
    const who = await student();
    await setStorage(10, 1);
    const tables = ["application_drafts", "application_files", "student_applications", "audit_log", "private_storage", "email_daily"];
    const snapshot = async () => Promise.all(tables.map(async (t) => [t, JSON.stringify((await env.DB.prepare(`SELECT * FROM ${t}`).all()).results)]));
    const before = await snapshot();
    for (const path of [OVERVIEW, CURRENT, STATUS]) expect((await get(path, who)).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});
