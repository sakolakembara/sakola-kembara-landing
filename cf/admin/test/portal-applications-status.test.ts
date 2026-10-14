import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { applicationStatus } from "../src/db/schema";
import { dbOf, statusQuery } from "../src/portal/queries";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addApplication, addBatch, etagOfRow } from "./pendaftaran-helpers";
import { CURRENT, get, json, OVERVIEW, STATUS, student, type Student } from "./portal-applications-helpers";
import { DAY } from "./public-helpers";

// GET /portal/api/applications and the privacy contract (docs/cloudflare/portal-api.md, section 10; the rule is
// docs/architecture/student-portal.md): a student sees a verdict only after the batch's results are published, and the
// API does not even send a status, a review note or a review time before. The pure rule is in
// test/portal-applications-rules.test.ts; here it is the route, the query and the admin who publishes and cancels.

const NOTE = "Catatan rahasia panitia untuk pendaftar ini";
const PUBLISHED_AT = Date.UTC(2026, 11, 1, 1, 0, 0);

/** A closed batch (so the status page is the only place its applications show), published or not. */
const batchWith = (published: boolean, year?: number) =>
  addBatch({ ...(year ? { year } : {}), opensAt: new Date(Date.now() - 60 * DAY), closesAt: new Date(Date.now() - 30 * DAY), resultsPublishedAt: published ? new Date(PUBLISHED_AT) : null });

async function itemsOf(who: Student) {
  const res = await get(STATUS, who);
  expect(res.status).toBe(200);
  return (await json(res)).items as { id: string; batch: Record<string, unknown>; submittedAt: string; result: Record<string, unknown> }[];
}

describe("the answer", () => {
  test("a student with no application: an empty list (the 'Belum ada pendaftaran' state), and no batch has to be open", async () => {
    const who = await student();
    expect(await json(await get(STATUS, who))).toEqual({ items: [] });
  });

  test("an application and its batch: the id, the batch's id, year and name, the time sent, and `result`: these keys and no others", async () => {
    const who = await student();
    const batch = await batchWith(false);
    const application = await addApplication(batch.id, { userId: who.id, submittedAt: new Date(Date.UTC(2026, 9, 13, 3, 40)) });
    const items = await itemsOf(who);
    expect(items).toEqual([{ id: application.id, batch: { id: batch.id, year: batch.year, name: batch.name }, submittedAt: "2026-10-13T03:40:00.000Z", result: { state: "processing" } }]);
    expect(Object.keys(items[0]!).sort()).toEqual(["batch", "id", "result", "submittedAt"]);
  });

  test("every application of the student, all batches, newest submittedAt first, and not the application of anybody else", async () => {
    const who = await student();
    const other = await student("lain");
    const [one, two, three] = [await batchWith(true, 2031), await batchWith(false, 2032), await batchWith(false, 2033)];
    const a = await addApplication(one!.id, { userId: who.id, status: "accepted", submittedAt: new Date(Date.now() - 90 * DAY) });
    const b = await addApplication(three!.id, { userId: who.id, submittedAt: new Date(Date.now() - 10 * DAY) });
    const c = await addApplication(two!.id, { userId: who.id, submittedAt: new Date(Date.now() - 40 * DAY) });
    await addApplication(two!.id, { userId: other.id });
    expect((await itemsOf(who)).map((item) => item.id)).toEqual([b.id, c.id, a.id]);
    expect((await itemsOf(other)).length).toBe(1);
  });

  test("it does not depend on the open batch: the status of a closed batch is readable while another batch is open", async () => {
    const who = await student();
    const batch = await batchWith(true);
    await addApplication(batch.id, { userId: who.id, status: "accepted" });
    await addBatch({ opensAt: new Date(Date.now() - DAY), closesAt: new Date(Date.now() + 10 * DAY) });
    expect((await itemsOf(who))[0]!.result).toMatchObject({ state: "decided", decision: "accepted" });
  });
});

describe("the privacy contract: before publication, no verdict at all", () => {
  for (const status of applicationStatus) {
    test(`status ${status}, batch NOT published: processing, and the whole answer says nothing of the status, the note or the review`, async () => {
      const who = await student();
      const batch = await batchWith(false);
      await addApplication(batch.id, { userId: who.id, status, reviewNotes: NOTE, reviewedAt: new Date(), reviewedBy: null });
      const res = await get(STATUS, who);
      const text = await res.text();
      expect(JSON.parse(text).items[0].result).toEqual({ state: "processing" });
      expect(Object.keys(JSON.parse(text).items[0].result)).toEqual(["state"]);
      for (const secret of [NOTE, "rahasia", "reviewedAt", "reviewed_at", "reviewedBy", "reviewNotes", "review_notes", '"status"', "accepted", "rejected", "under_review", "pending", "decision", "announcedAt"]) {
        expect(text, `${status}: ${secret}`).not.toContain(secret);
      }
    });
  }

  test("published: an accepted application is `decided` accepted with the announcement time and the note", async () => {
    const who = await student();
    const batch = await batchWith(true);
    await addApplication(batch.id, { userId: who.id, status: "accepted", reviewNotes: NOTE });
    const [item] = await itemsOf(who);
    expect(item!.result).toEqual({ state: "decided", decision: "accepted", announcedAt: new Date(PUBLISHED_AT).toISOString(), notes: NOTE });
    expect(Object.keys(item!.result).sort()).toEqual(["announcedAt", "decision", "notes", "state"]);
  });

  test("published: a rejected application is `decided` rejected; the note is trimmed, and an empty or blank one is null (the page then uses the default text)", async () => {
    const batch = await batchWith(true);
    const cases: [string | null, string | null][] = [[NOTE, NOTE], [`  ${NOTE}  \n`, NOTE], ["", null], ["   \n ", null], [null, null]];
    for (const [stored, shown] of cases) {
      const who = await student();
      await addApplication(batch.id, { userId: who.id, status: "rejected", reviewNotes: stored });
      const [item] = await itemsOf(who);
      expect(item!.result, JSON.stringify(stored)).toEqual({ state: "decided", decision: "rejected", announcedAt: new Date(PUBLISHED_AT).toISOString(), notes: shown });
    }
  });

  test("published but the application is still pending or under review (the admin's guard should prevent it): `awaiting_decision` with the time only, no note, no status", async () => {
    const batch = await batchWith(true);
    for (const status of ["pending", "under_review"] as const) {
      const who = await student();
      await addApplication(batch.id, { userId: who.id, status, reviewNotes: NOTE });
      const [item] = await itemsOf(who);
      expect(item!.result, status).toEqual({ state: "awaiting_decision", announcedAt: new Date(PUBLISHED_AT).toISOString() });
      expect(JSON.stringify(item), status).not.toContain("rahasia");
    }
  });

  test("the same application in two batches: only the published one shows its verdict", async () => {
    const who = await student();
    const published = await batchWith(true, 2031);
    const hidden = await batchWith(false, 2032);
    await addApplication(published.id, { userId: who.id, status: "rejected", reviewNotes: "Belum dulu", submittedAt: new Date(Date.now() - 50 * DAY) });
    await addApplication(hidden.id, { userId: who.id, status: "accepted", reviewNotes: NOTE, submittedAt: new Date(Date.now() - 5 * DAY) });
    const items = await itemsOf(who);
    expect(items.map((item) => item.result.state)).toEqual(["processing", "decided"]);
    expect(JSON.stringify(items)).not.toContain(NOTE);
  });

  test("the query hands over NULL for the status and the note of an unpublished batch (the first of the two places the contract is kept)", async () => {
    const who = await student();
    const hidden = await batchWith(false, 2031);
    const shown = await batchWith(true, 2032);
    await addApplication(hidden.id, { userId: who.id, status: "accepted", reviewNotes: NOTE, submittedAt: new Date(Date.now() - 20 * DAY) });
    await addApplication(shown.id, { userId: who.id, status: "accepted", reviewNotes: NOTE, submittedAt: new Date(Date.now() - 10 * DAY) });
    const rows = await statusQuery(dbOf(env.DB), who.id);
    const byBatch = Object.fromEntries(rows.map((row) => [row.year, row]));
    expect(byBatch[2031]).toMatchObject({ status: null, reviewNotes: null, publishedAt: null });
    expect(byBatch[2032]).toMatchObject({ status: "accepted", reviewNotes: NOTE });
  });

  test("a note never reaches any other route of the student's: not the overview, not the bootstrap, whatever the batch says", async () => {
    const who = await student();
    const batch = await batchWith(true);
    await addApplication(batch.id, { userId: who.id, status: "accepted", reviewNotes: NOTE });
    const open = await addBatch({ opensAt: new Date(Date.now() - DAY), closesAt: new Date(Date.now() + 10 * DAY) });
    await addApplication(open.id, { userId: (await student("lain")).id, status: "accepted", reviewNotes: NOTE });
    for (const path of [OVERVIEW, CURRENT]) {
      const text = await (await get(path, who)).text();
      expect(text, path).not.toContain("rahasia");
      expect(text, path).not.toContain("accepted");
    }
    // The overview history is verdict-free even when the batch is published: it only says the results are out.
    expect((await json(await get(OVERVIEW, who))).history[0].published).toBe(true);
  });
});

describe("with the admin: publish, cancel, revoke (the real admin routes around the same application)", () => {
  async function admin() {
    return signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
  }

  async function decide(cookie: string, id: string, body: Record<string, unknown>) {
    const res = await call(`/api/admin/applications/${id}/status`, { method: "POST", cookie, json: body, headers: await etagOfRow("student_applications", id) });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  }

  test("accepted but not published: processing; published: the verdict; cancelled: processing again; the exact key sets of every state", async () => {
    const editor = await admin();
    const who = await student();
    const batch = await batchWith(false);
    const application = await addApplication(batch.id, { userId: who.id });
    const keys = async () => Object.keys((await itemsOf(who))[0]!.result).sort();

    expect(await keys()).toEqual(["state"]);
    await decide(editor, application.id, { status: "accepted", reviewNotes: NOTE });
    // The admin already decided; the student still sees nothing.
    expect(await keys()).toEqual(["state"]);
    expect((await itemsOf(who))[0]!.result).toEqual({ state: "processing" });
    expect(await (await get(STATUS, who)).text()).not.toContain("rahasia");

    const published = await call(`/api/admin/batches/${batch.id}/publish`, { method: "POST", cookie: editor });
    expect(published.status).toBe(200);
    const [shown] = await itemsOf(who);
    expect(shown!.result).toMatchObject({ state: "decided", decision: "accepted", notes: NOTE });
    expect(await keys()).toEqual(["announcedAt", "decision", "notes", "state"]);
    expect(Date.parse(shown!.result.announcedAt as string)).toBeGreaterThan(Date.now() - 60_000);

    // The admin cancels the publication: the next read is `processing` again.
    expect((await call(`/api/admin/batches/${batch.id}/unpublish`, { method: "POST", cookie: editor })).status).toBe(200);
    expect((await itemsOf(who))[0]!.result).toEqual({ state: "processing" });
    expect(await keys()).toEqual(["state"]);
    expect(await (await get(STATUS, who)).text()).not.toContain("rahasia");
  });

  test("a revocation (accepted to rejected, with its note) is what the student reads after publication, as the legacy page showed it", async () => {
    const editor = await admin();
    const who = await student();
    const batch = await batchWith(false);
    const application = await addApplication(batch.id, { userId: who.id });
    await decide(editor, application.id, { status: "accepted", reviewNotes: "Diterima." });
    expect((await call(`/api/admin/batches/${batch.id}/publish`, { method: "POST", cookie: editor })).status).toBe(200);
    expect((await itemsOf(who))[0]!.result).toMatchObject({ decision: "accepted", notes: "Diterima." });
    const reason = "Siswa mengundurkan diri lewat WhatsApp pada tanggal ini.";
    await decide(editor, application.id, { status: "rejected", reviewNotes: reason });
    expect((await itemsOf(who))[0]!.result).toMatchObject({ state: "decided", decision: "rejected", notes: reason });
  });
});
