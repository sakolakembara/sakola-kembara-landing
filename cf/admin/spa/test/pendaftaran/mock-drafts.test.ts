import { describe, expect, test } from "vitest";
import type { Access } from "~/lib/access";
import { DRAFT_FILES_PATH, DRAFT_PURGE_MIN_DAYS, draftPurgePath } from "~/pages/applications/model";
import { MOCK_RESOURCES } from "~/mock/registry";
import { createMockResources } from "~/mock/resources";

// The mock of the drafts that hold files (`pnpm dev:spa:mock`) answers the way the Worker does, in miniature
// (test/private-files-drafts.test.ts is the Worker's side): the list is for who may write, opaque, oldest change first, and
// says by the clock which draft may be purged; the purge needs its confirmation and the 30 days.

function mock(access: Access = "write") {
  const resources = createMockResources(
    MOCK_RESOURCES.filter((spec) => spec.path.startsWith("/api/admin/batches") || spec.path.startsWith("/api/admin/applications")),
    () => access,
  );
  const call = async (method: string, path: string, init: { json?: unknown } = {}) => {
    const response = resources.handle(method, new URL(path, "http://mock.invalid"), { method, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
    if (!response) throw new Error(`nobody handled ${method} ${path}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  return { call };
}

describe("the list", () => {
  test("opaque, oldest change first, with the flag the Worker's clock gives; the same keys as the Worker's answer", async () => {
    const { status, body } = await mock("write").call("GET", DRAFT_FILES_PATH);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["items", "page", "pageSize", "total"]);
    expect(body.total).toBe(4);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(["batch", "bytes", "files", "id", "purgeable", "purgeableAt", "updatedAt"]);
    expect(body.items.map((item: { purgeable: boolean }) => item.purgeable)).toEqual([true, true, false, false]);
    const updated = body.items.map((item: { updatedAt: string }) => Date.parse(item.updatedAt));
    expect(updated).toEqual([...updated].sort((a, b) => a - b));
    expect(Date.parse(body.items[0].purgeableAt) - Date.parse(body.items[0].updatedAt)).toBe(DRAFT_PURGE_MIN_DAYS * 86_400_000);
    expect(JSON.stringify(body)).not.toMatch(/@|fullName|email|slot/);
  });

  test("a role that cannot write gets nothing, not even the list (the Worker's list is write-only too)", async () => {
    expect((await mock("read").call("GET", DRAFT_FILES_PATH)).status).toBe(403);
  });
});

describe("the purge", () => {
  test("without { confirm: true } nothing happens; an old draft's files go and it leaves the list; a second purge finds nothing", async () => {
    const { call } = mock("write");
    const [oldest] = (await call("GET", DRAFT_FILES_PATH)).body.items;
    expect((await call("POST", draftPurgePath(oldest.id), { json: {} })).status).toBe(400);
    expect((await call("POST", draftPurgePath(oldest.id), { json: { confirm: "true" } })).status).toBe(400);
    expect((await call("GET", DRAFT_FILES_PATH)).body.total).toBe(4);

    const purged = await call("POST", draftPurgePath(oldest.id), { json: { confirm: true } });
    expect([purged.status, purged.body]).toEqual([200, { purged: oldest.files, pending: 0 }]);
    const after = await call("GET", DRAFT_FILES_PATH);
    expect(after.body.items.map((item: { id: string }) => item.id)).not.toContain(oldest.id);
    expect((await call("POST", draftPurgePath(oldest.id), { json: { confirm: true } })).body).toEqual({ purged: 0, pending: 0 });
  });

  test("a draft changed less than 30 days ago is refused with the Worker's code, sentence and numbers", async () => {
    const { call } = mock("write");
    const young = (await call("GET", DRAFT_FILES_PATH)).body.items.find((item: { purgeable: boolean }) => !item.purgeable);
    const refused = await call("POST", draftPurgePath(young.id), { json: { confirm: true } });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: "draft_active",
      message: "Draf ini baru diubah. Berkasnya baru bisa dihapus setelah 30 hari tanpa perubahan.",
      minInactiveDays: 30,
      purgeableAt: young.purgeableAt,
    });
  });

  test("a role that cannot write is refused, and a draft nobody has is 404", async () => {
    const oldest = (await mock("write").call("GET", DRAFT_FILES_PATH)).body.items[0];
    expect((await mock("read").call("POST", draftPurgePath(oldest.id), { json: { confirm: true } })).status).toBe(403);
    expect((await mock("write").call("POST", draftPurgePath("nobody"), { json: { confirm: true } })).status).toBe(404);
  });
});
