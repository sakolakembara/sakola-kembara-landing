import { Hono } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import { auditStatement } from "../db/audit";
import { getDb } from "../db/client";
import { findApplicationFile } from "../private-files/lookup";
import { purgeApplicationFiles } from "../private-files/purge";
import { REFUSALS } from "../private-files/refusal";
import { refusalResponse } from "../private-files/respond";
import { fileResponse } from "../private-files/serve";
import { checkLimits, limitedResponse } from "../security/rate-limit";
import { parseBody } from "./crud";

// The admin's side of the applicants' private files (SAKEM-083, P4; docs/cloudflare/portal-api.md, 12.2 and 12.3;
// docs/cloudflare/portal-architecture.md, 8.6 and 8.9). Both routes need `pendaftaran` WRITE: an editor with that grant
// or a super_admin. A `viewer` sees the LIST of an applicant's files in the detail (slot, count, size, type) and cannot
// open one: these are scans of identity documents of minors (Dzul, 2026-10-13).
//
//   GET  /api/admin/applications/:id/files/:fileId   open one file: the bytes through this Worker, one audit row each time
//   POST /api/admin/applications/:id/files/purge     delete every file of the application, with a confirmation and an audit row
//
// Never a URL that works without a session, never the public bucket. Nothing here logs a name, an address, a key or a
// file name, and the audit rows hold ids and counts only.

export const applicationFileRoutes = new Hono<AppEnv>();

const write = requireArea("pendaftaran", "write");

// The pipeline of an open, in this order, each step stopping the request: the guard (401, 403), the limiter by ADMIN
// ID (429; it bounds a stolen session's bulk copying), the file (404 for every kind of mismatch: another application's
// file, a draft's file, a deleted one, a malformed id), the object, the audit row, then the body.
applicationFileRoutes.get("/:id/files/:fileId", write, async (c) => {
  // The route also answers HEAD (Hono runs the GET handler for it): an open is audited and a HEAD is not an open.
  if (c.req.method === "HEAD") return refusalResponse(c, REFUSALS.methodNotAllowed);
  const user = c.get("user");
  const limit = await checkLimits(c.env, [{ name: "adminFile", key: `adminFile:${user.id}` }]);
  if (!limit.allowed) return limitedResponse(limit);

  const bucket: R2Bucket | undefined = c.env.PRIVATE_FILES;
  if (!bucket) return refusalResponse(c, REFUSALS.storageUnavailable);
  const file = await findApplicationFile(c.env.DB, c.req.param("id"), c.req.param("fileId"));
  if (!file) return refusalResponse(c, REFUSALS.notFound);

  // The object first: a file that is not there is never "opened", so it leaves no audit row. Its body is a stream
  // nobody has read yet; it is only consumed when the answer is sent.
  const object = await bucket.get(file.key);
  if (!object) {
    console.error("[private-files] a file row has no object in the bucket");
    return refusalResponse(c, REFUSALS.notFound);
  }

  // Accountability before convenience: the row is written before a byte is sent, and if it cannot be written the file
  // is not served. Ids only (the file, the application, the slot): never a name, a size or an address.
  try {
    await auditStatement(getDb(c.env.DB), user, {
      action: "application_file.view",
      resourceType: "application_file",
      resourceId: file.id,
      metadata: { applicationId: file.applicationId, slot: file.slot },
    });
  } catch {
    console.error("[private-files] the audit row of a file open could not be written; the file was not served");
    await object.body.cancel().catch(() => undefined);
    return refusalResponse(c, REFUSALS.auditUnavailable);
  }
  return fileResponse(file, object);
});

const purgeBody = z.object({ confirm: z.literal(true) });

// The manual purge (decided 2026-10-13: nothing is deleted automatically). Every live file of the application goes, the
// audit row `application_file.purge` is written in the same batch that marks them (a count and the file ids), then the
// objects and the rows. The limiter is the admin upload limiter under a key of its own: deleting is rarer than opening.
applicationFileRoutes.post("/:id/files/purge", write, async (c) => {
  const user = c.get("user");
  const limit = await checkLimits(c.env, [{ name: "upload", key: `file-purge:${user.id}` }]);
  if (!limit.allowed) return limitedResponse(limit);
  // The confirmation is in the body, not only in the screen: a call without it deletes nothing.
  const body = await parseBody(c, purgeBody, { maxBytes: 1024 });
  if (!body.ok) return body.response;

  if (!c.env.PRIVATE_FILES) return refusalResponse(c, REFUSALS.storageUnavailable);
  const outcome = await purgeApplicationFiles(c.env, user, c.req.param("id"));
  if (!outcome.ok) return refusalResponse(c, outcome.refusal);
  return c.json({ purged: outcome.purged, pending: outcome.pending });
});
