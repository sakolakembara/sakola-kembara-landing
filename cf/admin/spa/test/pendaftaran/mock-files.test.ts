import { describe, expect, test } from "vitest";
import type { Access } from "~/lib/access";
import { ifMatch } from "~/lib/crud/etag";
import { MOCK_RESOURCES } from "~/mock/registry";
import { createMockResources } from "~/mock/resources";

// The mock of the Pendaftaran area (`pnpm dev:spa:mock`) answers the applicants' files the way the Worker does, in
// miniature (test/private-files-admin.test.ts is the Worker's side): the detail has the list of files, the version and
// the caller's right to open them; the answer of a review does not; the purge needs its confirmation.

function mock(access: Access = "write") {
  const resources = createMockResources(
    MOCK_RESOURCES.filter((spec) => spec.path.startsWith("/api/admin/batches") || spec.path.startsWith("/api/admin/applications")),
    () => access,
  );
  const call = async (method: string, path: string, init: { json?: unknown; ifMatch?: string } = {}) => {
    const response = resources.handle(method, new URL(path, "http://mock.invalid"), {
      method,
      headers: init.ifMatch ? { "If-Match": init.ifMatch } : undefined,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
    if (!response) throw new Error(`nobody handled ${method} ${path}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as Record<string, any> };
  };
  return { call };
}

const APPLICATIONS = "/api/admin/applications";
const WITH_FILES = `${APPLICATIONS}/mock-app-1`;

describe("the detail", () => {
  test("a version 3 application has files and the caller's right to open them; a version 2 one has none", async () => {
    const full = await mock("write").call("GET", WITH_FILES);
    expect(full.status).toBe(200);
    expect(full.body.item).toMatchObject({ formVersion: 3, canOpenFiles: true });
    expect(full.body.item.files.length).toBeGreaterThan(5);
    expect(Object.keys(full.body.item.files[0]).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);

    const old = await mock("write").call("GET", `${APPLICATIONS}/mock-app-3`);
    expect(old.body.item).toMatchObject({ formVersion: 2, files: [], canOpenFiles: true });
  });

  test("a role that can only read sees the list and cannot open: canOpenFiles false", async () => {
    const { body } = await mock("read").call("GET", WITH_FILES);
    expect(body.item.canOpenFiles).toBe(false);
    expect(body.item.files.length).toBeGreaterThan(5);
  });

  test("the answer of a review has no files, no version and no flag (the Worker's does not either)", async () => {
    const { call } = mock("write");
    const before = await call("GET", WITH_FILES);
    const { status, body } = await call("POST", `${WITH_FILES}/status`, { json: { status: "under_review", reviewNotes: "" }, ifMatch: ifMatch(before.body.item.updatedAt) });
    expect(status).toBe(200);
    expect("files" in body.item || "formVersion" in body.item || "canOpenFiles" in body.item).toBe(false);
    expect(body.item.status).toBe("under_review");
  });
});

describe("the purge", () => {
  test("without { confirm: true } nothing happens; with it every file goes and the detail has none", async () => {
    const { call } = mock("write");
    const count = (await call("GET", WITH_FILES)).body.item.files.length;
    expect((await call("POST", `${WITH_FILES}/files/purge`, { json: {} })).status).toBe(400);
    expect((await call("POST", `${WITH_FILES}/files/purge`, { json: { confirm: "true" } })).status).toBe(400);
    expect((await call("GET", WITH_FILES)).body.item.files).toHaveLength(count);

    const purged = await call("POST", `${WITH_FILES}/files/purge`, { json: { confirm: true } });
    expect([purged.status, purged.body]).toEqual([200, { purged: count, pending: 0 }]);
    expect((await call("GET", WITH_FILES)).body.item.files).toEqual([]);
    expect((await call("POST", `${WITH_FILES}/files/purge`, { json: { confirm: true } })).body).toEqual({ purged: 0, pending: 0 });
  });

  test("a role that cannot write is refused, and an applicant nobody has is 404", async () => {
    expect((await mock("read").call("POST", `${WITH_FILES}/files/purge`, { json: { confirm: true } })).status).toBe(403);
    expect((await mock("write").call("POST", `${APPLICATIONS}/nobody/files/purge`, { json: { confirm: true } })).status).toBe(404);
  });
});
