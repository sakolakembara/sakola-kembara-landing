import { describe, expect, test } from "vitest";
import { daysLeft, parseOverview } from "../portal-spa/src/lib/overview";
import { announcedAt, parseResult, parseStatusItems, statusView } from "../portal-spa/src/lib/status";
import { addApplication, addBatch } from "./pendaftaran-helpers";
import { addRequiredFiles, draftOf, get, json, openBatch, OVERVIEW, putStep, saveAll, STATUS, student, submit, VALID } from "./portal-applications-helpers";
import { DAY } from "./public-helpers";

// The contract with the portal SPA (docs/cloudflare/portal-api.md, section 16, last bullet): the SPA's own pure parsers
// (portal-spa/src/lib/overview.ts and status.ts: the files the home page and the status page read their answers with)
// run against what the real Worker sends, in every state, so a key renamed on either side fails here and not on a
// child's phone. A parser answers null (an error screen) for a body that does not have the shape.

describe("GET /overview is what the home page parses", () => {
  test("no batch open: the page reads `openBatch: null`, nothing started, no history", async () => {
    const who = await student();
    const overview = parseOverview(await json(await get(OVERVIEW, who)));
    expect(overview).not.toBeNull();
    expect(overview).toMatchObject({ student: { name: "Tester", firstName: "Tester" }, openBatch: null, current: { state: "none" }, history: [] });
  });

  test("an open batch with a draft, then with the application sent: the states and the batch the page shows", async () => {
    const batch = await openBatch({ name: "Gen Kontrak", description: "Baris satu.\nBaris dua." });
    const who = await student();
    const first = parseOverview(await json(await get(OVERVIEW, who)))!;
    expect(first.openBatch).toEqual({ id: batch.id, year: batch.year, name: "Gen Kontrak", description: "Baris satu.\nBaris dua.", opensAt: batch.opensAt.toISOString(), closesAt: batch.closesAt.toISOString() });
    expect(first.current).toEqual({ state: "none" });
    // The server's clock counts the days left (30 days from a day and a bit ago: the legacy ceil).
    expect(daysLeft(first.openBatch!.closesAt, first.now)).toBe(30);

    await putStep(who, "identity", VALID.identity);
    const draft = (await draftOf(who.id))!;
    expect(parseOverview(await json(await get(OVERVIEW, who)))!.current).toEqual({ state: "draft", updatedAt: new Date(draft.updated_at).toISOString() });

    await saveAll(who);
    await addRequiredFiles(draft.id);
    const sent = await json(await submit(who));
    const after = parseOverview(await json(await get(OVERVIEW, who)))!;
    expect(after.current).toEqual({ state: "submitted", submittedAt: sent.submittedAt });
    expect(after.history).toEqual([{ id: draft.id, batch: { year: batch.year, name: "Gen Kontrak" }, submittedAt: sent.submittedAt, published: false }]);
  });

  test("a body that is not the overview is null (an error screen, never a page of blanks)", async () => {
    expect(parseOverview({})).toBeNull();
    expect(parseOverview(null)).toBeNull();
    expect(parseOverview({ now: "2026-10-13T00:00:00.000Z", student: { name: "A" }, openBatch: undefined, current: { state: "none" }, history: [] })).toBeNull();
  });
});

describe("GET /applications is what the status page parses", () => {
  async function items(who: Awaited<ReturnType<typeof student>>) {
    const body = await json(await get(STATUS, who));
    const parsed = parseStatusItems(body);
    expect(parsed, JSON.stringify(body)).not.toBeNull();
    return parsed!;
  }

  const closed = (published: boolean, year: number) => addBatch({ year, opensAt: new Date(Date.now() - 60 * DAY), closesAt: new Date(Date.now() - 30 * DAY), resultsPublishedAt: published ? new Date(Date.UTC(2026, 11, 1, 1)) : null });

  test("no application: `{ items: [] }` parses to an empty list", async () => {
    expect(await items(await student())).toEqual([]);
  });

  test("not published: the page reads `processing` and says 'Sedang Diproses', whatever the admin already decided", async () => {
    const who = await student();
    const batch = await closed(false, 2031);
    await addApplication(batch.id, { userId: who.id, status: "accepted", reviewNotes: "Catatan rahasia" });
    const [item] = await items(who);
    expect(item!.result).toEqual({ state: "processing" });
    expect(statusView(item!.result)).toMatchObject({ tone: "pending", eyebrow: "Sedang Diproses", headline: "Pendaftaran kamu sedang diproses" });
    expect(announcedAt(item!.result)).toBeNull();
  });

  test("published: accepted and rejected are decisions the page words, with the note as the body; pending is 'Menunggu keputusan'", async () => {
    const batch = await closed(true, 2032);
    const accepted = await student("a");
    const rejected = await student("b");
    const waiting = await student("c");
    await addApplication(batch.id, { userId: accepted.id, status: "accepted", reviewNotes: "Selamat bergabung." });
    await addApplication(batch.id, { userId: rejected.id, status: "rejected", reviewNotes: null });
    await addApplication(batch.id, { userId: waiting.id, status: "pending" });

    const [yes] = await items(accepted);
    expect(yes!.result).toMatchObject({ state: "decided", decision: "accepted", notes: "Selamat bergabung." });
    expect(statusView(yes!.result)).toMatchObject({ tone: "accepted", headline: "Kamu diterima", body: "Selamat bergabung." });
    expect(announcedAt(yes!.result)).toBe(new Date(Date.UTC(2026, 11, 1, 1)).toISOString());

    const [no] = await items(rejected);
    expect(no!.result).toMatchObject({ state: "decided", decision: "rejected", notes: null });
    expect(statusView(no!.result)).toMatchObject({ tone: "rejected", headline: "Belum lolos tahun ini" });

    const [pending] = await items(waiting);
    expect(pending!.result.state).toBe("awaiting_decision");
    expect(statusView(pending!.result)).toMatchObject({ tone: "pending", headline: "Menunggu keputusan" });
  });

  test("the items carry the batch (id, year, name) and the time sent, newest first", async () => {
    const who = await student();
    const older = await closed(true, 2031);
    const newer = await closed(false, 2032);
    const a = await addApplication(older.id, { userId: who.id, status: "rejected", submittedAt: new Date(Date.now() - 80 * DAY) });
    const b = await addApplication(newer.id, { userId: who.id, submittedAt: new Date(Date.now() - 40 * DAY) });
    const list = await items(who);
    expect(list.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(list[0]!.batch).toEqual({ id: newer.id, year: 2032, name: newer.name });
    expect(list[0]!.submittedAt).toBe(b.submittedAt!.toISOString());
  });

  test("the parser reads ONLY `result`: what it does not recognise is 'processing', so a state this Worker never sends cannot become a verdict", () => {
    expect(parseResult({ state: "decided", decision: "approved", announcedAt: "2026-12-01T01:00:00.000Z", notes: null })).toEqual({ state: "processing" });
    expect(parseResult({ state: "decided", decision: "accepted", notes: null })).toEqual({ state: "processing" });
    expect(parseResult({ status: "accepted" })).toEqual({ state: "processing" });
  });
});
