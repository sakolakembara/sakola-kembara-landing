import { describe, expect, test } from "vitest";
import { DRAFT_PURGE_MIN_INACTIVE_DAYS } from "../src/private-files/drafts";
import { parseListQuery, toApiQuery } from "../spa/src/lib/crud/query";
import { type BatchRef, DRAFT_FILES_PATH, DRAFT_PURGE_MIN_DAYS, type DraftFilesRow, DRAFTS_LIST_SPEC, DRAFTS_ROUTE, draftPurgePath, ROUTE, shortDraftId } from "../spa/src/pages/applications/model";
import { call } from "./helpers";
import { emptyBucketBeforeEach, privateKeys } from "./private-files-helpers";
import { DAY, draftWithFiles, editor } from "./private-files-drafts-helpers";

// What the admin SPA sends and expects for the drafts that hold files, checked against the real Worker in workerd (the SPA
// tests stub the network, so this is what keeps the two sides honest; same idea as test/portal-files-spa-contract.test.ts).

emptyBucketBeforeEach();

describe("the admin SPA's tab of drafts against the Worker", () => {
  test("the address it lists from, the query it sends and the number it says are the Worker's", async () => {
    expect(ROUTE).toBe("/applications");
    expect(DRAFTS_ROUTE).toBe("/applications/drafts");
    // The SPA says 30 days on the screen; the Worker's rule is the number of record.
    expect(DRAFT_PURGE_MIN_DAYS).toBe(DRAFT_PURGE_MIN_INACTIVE_DAYS);

    const draft = await draftWithFiles({ slots: ["family-card", "self-photo"], size: 300 });
    const query = toApiQuery(parseListQuery(new URLSearchParams(), DRAFTS_LIST_SPEC), DRAFTS_LIST_SPEC);
    expect(query).toBe("?page=1&pageSize=20");
    const res = await call(`${DRAFT_FILES_PATH}${query}`, { cookie: await editor() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: DraftFilesRow[]; page: number; pageSize: number; total: number };
    expect([body.page, body.pageSize, body.total]).toEqual([1, DRAFTS_LIST_SPEC.pageSize, 1]);
    expect(body.items[0]!.id).toBe(draft.id);
  });

  test("a row of the real list has exactly the keys of the SPA's type, and its batch those of a batch reference: nothing the screen does not draw", async () => {
    await draftWithFiles({ slots: ["family-card"] });
    const row = ((await (await call(DRAFT_FILES_PATH, { cookie: await editor() })).json()) as { items: DraftFilesRow[] }).items[0]!;
    // Written as the type: a key the SPA's type gains or loses fails the compiler here, and a key the Worker adds fails this.
    const sample: DraftFilesRow = { id: "", batch: { id: "", year: 0, name: "" }, files: 0, bytes: 0, updatedAt: "", purgeable: true, purgeableAt: "" };
    const batch: BatchRef = sample.batch;
    expect(Object.keys(row).sort()).toEqual(Object.keys(sample).sort());
    expect(Object.keys(row.batch).sort()).toEqual(Object.keys(batch).sort());
    expect(typeof row.purgeable).toBe("boolean");
    expect(Number.isNaN(Date.parse(row.updatedAt))).toBe(false);
    expect(Date.parse(row.purgeableAt) - Date.parse(row.updatedAt)).toBe(DRAFT_PURGE_MIN_DAYS * DAY);
  });

  test("the address of the purge and the body the SPA sends are the Worker's; its 200 and its 409 read as the screen reads them", async () => {
    const cookie = await editor();
    const old = await draftWithFiles({ slots: ["family-card", "self-photo"] });
    const young = await draftWithFiles({ ageDays: 3, slots: ["family-card"] });

    const refused = await call(draftPurgePath(young.id), { method: "POST", cookie, json: { confirm: true } });
    expect(refused.status).toBe(409);
    const refusal = (await refused.json()) as { error: string; message: string; minInactiveDays: number; purgeableAt: string };
    expect(refusal.error).toBe("draft_active");
    // The sentence the screen shows is the Worker's, and says the number the page says.
    expect(refusal.message).toBe(`Draf ini baru diubah. Berkasnya baru bisa dihapus setelah ${DRAFT_PURGE_MIN_DAYS} hari tanpa perubahan.`);
    expect(refusal.minInactiveDays).toBe(DRAFT_PURGE_MIN_DAYS);

    const done = await call(draftPurgePath(old.id), { method: "POST", cookie, json: { confirm: true } });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ purged: 2, pending: 0 });
    expect(await privateKeys()).toEqual(young.files.map((file) => file.key));
    expect(shortDraftId(old.id)).toBe(old.id.slice(0, 8));
  });
});
