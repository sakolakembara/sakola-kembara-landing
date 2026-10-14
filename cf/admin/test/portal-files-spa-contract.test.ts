import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { MAX_FILE_BYTES } from "../shared/application-form/limits";
import { SLOT_IDS, SLOTS, slotLabel, slotsOfStep } from "../shared/application-form/slots";
import { acceptFor, checkSendSize, FILE_MESSAGES, FILE_TYPE_INFO, typesHint } from "../portal-spa/src/lib/files/accept";
import { fileHref, FILES_API, removePath, uploadPath } from "../portal-spa/src/lib/files/paths";
import { parseStoredFile, parseUploadResponse } from "../portal-spa/src/lib/files/types";
import { type ProfileSource, profileSections } from "../spa/src/pages/applications/answers";
import { filePath, purgePath } from "../spa/src/pages/applications/model";
import { call, signedInCookie, uniqueEmail } from "./helpers";
import { addApplication } from "./pendaftaran-helpers";
import { portalCall } from "./portal-helpers";
import { bytes, emptyBucketBeforeEach, openBatch, student, type Student } from "./private-files-helpers";
import { disguises } from "./uploads-helpers";

// What the two SPAs send and expect for the applicants' files, checked against the real Worker in workerd (the SPA tests
// stub the network, so these are what keep the two sides honest). Same idea as test/pendaftaran-spa-contract.test.ts:
//
//   * the portal's file client (portal-spa/src/lib/files): the addresses it calls, the shape of the answers it parses,
//     the sentences it shows before the Worker is asked, and the types its file input offers;
//   * the admin's Pendaftar detail (spa/src/pages/applications): the `files` and `canOpenFiles` of the real detail
//     read into the page's sections, the address of a file's "Lihat" link and of the purge.

emptyBucketBeforeEach();

const put = (s: Student, path: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  portalCall(path, { method: "PUT", body, cookie: s.cookie, headers: { "content-type": "application/octet-stream", "content-length": String(body.byteLength), ...headers } });

describe("the portal SPA's file client against the Worker", () => {
  test("the addresses it builds are the Worker's routes: upload, replace, read, delete", async () => {
    await openBatch();
    const s = await student();
    expect(FILES_API).toBe("/portal/api/applications/current/files");

    const created = await put(s, uploadPath("family-card"), bytes.png(500));
    expect(created.status).toBe(201);
    const first = parseUploadResponse(await created.json());
    expect(first).not.toBeNull();
    expect(first!.file).toMatchObject({ slot: "family-card", contentType: "image/png", size: 500 });
    expect(first!.usage).toEqual({ slotCount: 1, slotMax: 2, applicationFiles: 1, applicationBytes: 500 });

    const replaced = await put(s, uploadPath("family-card", first!.file.id), bytes.pdf(700));
    expect(replaced.status).toBe(201);
    const second = parseUploadResponse(await replaced.json())!;
    expect(second.file.contentType).toBe("application/pdf");
    expect(second.usage.slotCount).toBe(1);

    const read = await portalCall(fileHref(second.file.id), { cookie: s.cookie });
    expect(read.status).toBe(200);
    expect((await read.arrayBuffer()).byteLength).toBe(700);

    const removed = await portalCall(removePath(second.file.id), { method: "DELETE", cookie: s.cookie });
    expect(removed.status).toBe(204);
    expect((await portalCall(fileHref(second.file.id), { cookie: s.cookie })).status).toBe(404);
  });

  test("the answer parses to exactly what the Worker sent, and a stored file of the draft parses the same way", async () => {
    await openBatch();
    const s = await student();
    const body = (await (await put(s, uploadPath("self-photo"), bytes.jpeg(900))).json()) as { file: unknown; usage: unknown; draft: unknown };
    expect(parseUploadResponse(body)).toEqual(body);
    expect(parseStoredFile(body.file)).toEqual(body.file);
    expect(Object.keys(body.file as object).sort()).toEqual(["contentType", "height", "id", "size", "slot", "uploadedAt", "width"]);
  });

  test("every slot of the shared table is one the Worker takes, and the SPA's list of them is the Worker's", async () => {
    await openBatch();
    const s = await student();
    for (const slot of SLOT_IDS) {
      const res = await put(s, uploadPath(slot), bytes.png(100));
      expect(res.status, slot).toBe(201);
      // 16 uploads in one go: the limiter is 20 a minute, and the test clock does not move.
    }
    expect((await put(s, `${FILES_API}/not-a-slot`, bytes.png(100))).status).toBe(404);
  });

  test("the sentences the field shows before asking are the Worker's own words", async () => {
    await openBatch();
    const s = await student();
    const tooBig = await put(s, uploadPath("family-card"), bytes.png(10), { "content-length": String(MAX_FILE_BYTES + 1) });
    expect(((await tooBig.json()) as { message: string }).message).toBe(FILE_MESSAGES.tooBig);
    const empty = await put(s, uploadPath("family-card"), new Uint8Array(0));
    expect(((await empty.json()) as { message: string }).message).toBe(FILE_MESSAGES.empty);
    for (const slot of ["family-card", "self-photo"] as const) {
      const refused = await put(s, uploadPath(slot), disguises.exe);
      const answer = (await refused.json()) as { message: string; allowed: string[] };
      expect(answer.message, slot).toBe(FILE_MESSAGES.type(slot));
      // The types the input offers are the types the Worker says it takes.
      expect(answer.allowed.sort(), slot).toEqual(acceptFor(slot).split(",").sort());
    }
  });

  test("the file input offers exactly what each slot takes: a PDF is not offered, and is refused, where only images go", async () => {
    await openBatch();
    const s = await student();
    expect(acceptFor("self-photo")).not.toContain("application/pdf");
    expect((await put(s, uploadPath("self-photo"), bytes.pdf(100))).status).toBe(415);
    expect(acceptFor("family-card")).toContain("application/pdf");
    expect((await put(s, uploadPath("family-card"), bytes.pdf(100))).status).toBe(201);
    for (const slot of SLOT_IDS) expect(typesHint(slot), slot).toBe(SLOTS[slot].types.map((type) => FILE_TYPE_INFO[type].label).join(", "));
  });

  test("the size the field checks on what it sends is the Worker's limit, to the byte", async () => {
    await openBatch();
    const s = await student();
    expect(checkSendSize(MAX_FILE_BYTES)).toBeNull();
    expect(checkSendSize(MAX_FILE_BYTES + 1)).not.toBeNull();
    expect((await put(s, uploadPath("family-card"), bytes.pdf(MAX_FILE_BYTES))).status).toBe(201);
    expect((await put(s, uploadPath("electricity-bill"), bytes.pdf(10), { "content-length": String(MAX_FILE_BYTES + 1) })).status).toBe(413);
  });
});

describe("the admin SPA's Pendaftar detail against the Worker", () => {
  async function applicationOfAStudent() {
    const batch = await openBatch();
    const s = await student();
    const first = parseUploadResponse(await (await put(s, uploadPath("family-card"), bytes.pdf(900))).json())!;
    const second = parseUploadResponse(await (await put(s, uploadPath("family-card"), bytes.png(800))).json())!;
    const third = parseUploadResponse(await (await put(s, uploadPath("marketing-follow-proof"), bytes.png(700))).json())!;
    // The submit: the draft goes and an application with the same id comes (what the application API does).
    await env.DB.prepare("DELETE FROM application_drafts WHERE id = ?").bind(first.draft.id).run();
    const application = await addApplication(batch.id, {
      id: first.draft.id,
      userId: s.id,
      email: s.email,
      formData: { formVersion: 3, documents: { dtksRegistered: true }, marketing: { instagramUsername: "contoh" } } as never,
    });
    return { application, files: [first.file, second.file, third.file] };
  }

  test("the files and the flag of the real detail read into the page's sections: a `files` row per slot, `canOpen` as the Worker says", async () => {
    const { application, files } = await applicationOfAStudent();
    for (const [who, canOpen] of [["editor", true], ["viewer", false]] as const) {
      const cookie = await signedInCookie(uniqueEmail(who), who, who === "editor" ? ["pendaftaran"] : []);
      const res = await call(`/api/admin/applications/${application.id}`, { cookie });
      const { item } = (await res.json()) as { item: ProfileSource };
      expect(item.formVersion).toBe(3);
      expect(item.canOpenFiles).toBe(canOpen);

      const sections = profileSections(item);
      const berkas = sections.find((section) => section.id === "berkas")!;
      expect(berkas.title).toBe("Berkas");
      expect(berkas.rows.map((row) => row.label)).toEqual(["Terdaftar DTKS", ...slotsOfStep("documents").map((id) => slotLabel(id))]);
      const family = berkas.rows.find((row) => row.label === slotLabel("family-card"))!;
      expect(family.value).toMatchObject({ type: "files", applicationId: application.id, canOpen });
      expect((family.value as { files: { id: string }[] }).files.map((file) => file.id)).toEqual([files[0]!.id, files[1]!.id]);
      const marketing = sections.find((section) => section.id === "marketing")!;
      expect(marketing.rows.find((row) => row.label === slotLabel("marketing-follow-proof"))!.value).toMatchObject({ type: "files" });
    }
  });

  test("the address of 'Lihat' and of the purge are the Worker's routes", async () => {
    const { application, files } = await applicationOfAStudent();
    const cookie = await signedInCookie(uniqueEmail("editor"), "editor", ["pendaftaran"]);
    const opened = await call(filePath(application.id, files[1]!.id), { cookie });
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-disposition")).toMatch(/^inline; filename="family-card-/);
    const purged = await call(purgePath(application.id), { method: "POST", cookie, json: { confirm: true } });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toEqual({ purged: 3, pending: 0 });
    const after = await call(`/api/admin/applications/${application.id}`, { cookie });
    expect(((await after.json()) as { item: { files: unknown[] } }).item.files).toEqual([]);
  });
});
