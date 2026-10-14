import { Hono } from "hono";
import { isSlotId } from "../../shared/application-form/slots";
import type { AppEnv } from "../context";
import { deleteOwnFile } from "../private-files/delete";
import { findOwnFile } from "../private-files/lookup";
import { REFUSALS } from "../private-files/refusal";
import { refusalResponse } from "../private-files/respond";
import { fileResponse } from "../private-files/serve";
import { storeFile } from "../private-files/upload";
import { requireStudent } from "./guard";

// The student's side of the private files (SAKEM-083, P4; docs/cloudflare/portal-api.md, section 11 and
// docs/cloudflare/portal-architecture.md, section 8):
//
//   PUT    /portal/api/applications/current/files/:slot     the raw file as the body; `?replace=<file id>`
//   DELETE /portal/api/applications/current/files/:fileId   only the student's own live file, only while a draft
//   GET    /portal/api/files/:fileId                        the student's own file, through this Worker, never a URL
//
// Every route starts with `requireStudent(...)` (src/portal/guard.ts): the session, the role, the verified address and
// the limiter keyed by USER ID, all before the body is read or R2 is touched. Nothing here takes an application id
// from the client: the application is always the one of the signed-in student, found from the session, so there is no
// id to tamper with. The file name and the content type the browser sends are never read, stored or logged.

export const fileRoutes = new Hono<AppEnv>();

fileRoutes.put("/applications/current/files/:slot", requireStudent("portalUpload"), async (c) => {
  const slot = c.req.param("slot");
  if (!isSlotId(slot)) return refusalResponse(c, REFUSALS.unknownSlot);
  const outcome = await storeFile(c.env, {
    userId: c.get("user").id,
    slot,
    replace: c.req.query("replace"),
    contentLength: c.req.header("content-length"),
    body: c.req.raw.body,
  });
  if (!outcome.ok) return refusalResponse(c, outcome.refusal);
  return c.json({ file: outcome.file, usage: outcome.usage, draft: outcome.draft }, 201);
});

fileRoutes.delete("/applications/current/files/:fileId", requireStudent("portalUpload"), async (c) => {
  const outcome = await deleteOwnFile(c.env, c.get("user").id, c.req.param("fileId"));
  if (!outcome.ok) return refusalResponse(c, outcome.refusal);
  return c.body(null, 204);
});

fileRoutes.get("/files/:fileId", requireStudent("portalRead"), async (c) => {
  // The route also answers HEAD (Hono runs the GET handler for it): a read is a read, and this one is not offered.
  if (c.req.method === "HEAD") return refusalResponse(c, REFUSALS.methodNotAllowed);
  const bucket: R2Bucket | undefined = c.env.PRIVATE_FILES;
  if (!bucket) return refusalResponse(c, REFUSALS.storageUnavailable);
  const file = await findOwnFile(c.env.DB, c.get("user").id, c.req.param("fileId"));
  if (!file) return refusalResponse(c, REFUSALS.notFound);
  const object = await bucket.get(file.key);
  if (!object) {
    // The row says there is a file and the bucket says there is not: nothing to serve, and not a thing to show a child.
    console.error("[private-files] a file row has no object in the bucket");
    return refusalResponse(c, REFUSALS.notFound);
  }
  return fileResponse(file, object);
});
