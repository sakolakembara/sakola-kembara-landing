// The negative checks of the applicants' private files (SAKEM-083, P4), in their own file so the shared lists in
// negative-checks.mjs and negative-checks-spa.mjs stay short: each runner imports and spreads what this file exports
// (`portalFilesChecks` for the Worker's tests, `portalFilesSpaChecks` for the two SPAs'). Same rules as there: each check
// breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the
// file. A pattern found other than exactly once is reported as FAIL, so a refactor cannot turn a check into a no-op.
// A check with `edits` breaks a safeguard that is built in two layers (both must go for the behaviour to change).
//
//   node scripts/negative-checks.mjs --only "portal files:"
//   node scripts/negative-checks-spa.mjs --only "portal files:"

const UPLOAD = "test/private-files-upload.test.ts";
const OWN = "test/private-files-own.test.ts";
const ADMIN = "test/private-files-admin.test.ts";
const HOUSEKEEPING = "test/private-files-housekeeping.test.ts";
const PRIVACY = "test/private-files-privacy.test.ts";
const RULES = "test/private-files-rules.test.ts";
const PLANS = "test/private-files-plans.test.ts";
const CONTRACT = "test/portal-files-spa-contract.test.ts";

export const portalFilesChecks = [
  // ------------------------------------------------ the routes are mounted, and every one is for a student
  {
    name: "portal files: the file routes are not mounted on the portal Worker",
    file: "src/portal/worker.ts",
    // The line after the `// P4:` placeholder comment (a config test pins the comment, so the real line is the one found).
    from: "\napp.route(API, fileRoutes);",
    to: "",
    tests: `${UPLOAD} ${OWN}`,
  },
  {
    name: "portal files: the admin's file routes are not mounted",
    file: "src/worker.ts",
    from: 'app.route("/api/admin/applications", applicationFileRoutes);',
    to: "",
    tests: ADMIN,
  },
  {
    name: "portal files: an upload is limited as a read (60 a minute, not 20)",
    file: "src/portal/files.ts",
    from: 'fileRoutes.put("/applications/current/files/:slot", requireStudent("portalUpload"),',
    to: 'fileRoutes.put("/applications/current/files/:slot", requireStudent("portalRead"),',
    tests: UPLOAD,
  },
  {
    name: "portal files: a delete is limited as a read",
    file: "src/portal/files.ts",
    from: 'fileRoutes.delete("/applications/current/files/:fileId", requireStudent("portalUpload"),',
    to: 'fileRoutes.delete("/applications/current/files/:fileId", requireStudent("portalRead"),',
    tests: OWN,
  },
  {
    name: "portal files: a read is not limited at all",
    file: "src/portal/files.ts",
    from: 'fileRoutes.get("/files/:fileId", requireStudent("portalRead"),',
    to: 'fileRoutes.get("/files/:fileId", requireStudent(),',
    tests: OWN,
  },

  // ------------------------------------------------ ownership: a student touches only their own application's files
  {
    name: "portal files: a student reads a file of another student's DRAFT",
    file: "src/private-files/lookup.ts",
    from: "LEFT JOIN application_drafts d ON d.id = f.application_id AND d.user_id = ?1",
    to: "LEFT JOIN application_drafts d ON d.id = f.application_id AND ?1 IS NOT NULL",
    tests: OWN,
  },
  {
    name: "portal files: a student reads a file of another student's submitted APPLICATION",
    file: "src/private-files/lookup.ts",
    from: "LEFT JOIN student_applications a ON a.id = f.application_id AND a.user_id = ?1",
    to: "LEFT JOIN student_applications a ON a.id = f.application_id AND ?1 IS NOT NULL",
    tests: OWN,
  },
  {
    name: "portal files: a student deletes any file by its id (the draft is not part of the statement)",
    file: "src/private-files/delete.ts",
    from: "WHERE id = ?2 AND application_id = ?3 AND deleted_at IS NULL RETURNING",
    to: "WHERE id = ?2 AND ?3 IS NOT NULL AND deleted_at IS NULL RETURNING",
    tests: OWN,
  },
  {
    name: "portal files: a student replaces another student's file (both layers: the lookup and the insert's guard)",
    edits: [
      { file: "src/private-files/state.ts", from: "WHERE id = ?2 AND application_id = ?1 AND deleted_at IS NULL\";", to: "WHERE id = ?2 AND ?1 IS NOT NULL AND deleted_at IS NULL\";" },
      { file: "src/private-files/upload.ts", from: "AND (?12 IS NULL OR EXISTS (SELECT 1 FROM application_files WHERE id = ?12 AND application_id = ?2 AND slot = ?3 AND deleted_at IS NULL))`;", to: "`;" },
    ],
    tests: `${UPLOAD} ${OWN}`,
  },
  {
    name: "portal files: an admin opens a file of ANOTHER application than the one in the address",
    file: "src/private-files/lookup.ts",
    from: "WHERE f.id = ?1 AND f.application_id = ?2 AND f.deleted_at IS NULL`;",
    to: "WHERE f.id = ?1 AND ?2 IS NOT NULL AND f.deleted_at IS NULL`;",
    tests: ADMIN,
  },
  {
    name: "portal files: an admin opens a file of somebody's DRAFT (the application need not exist)",
    file: "src/private-files/lookup.ts",
    from: "JOIN student_applications a ON a.id = f.application_id\nJOIN admission_batches b ON b.id = a.batch_id\nWHERE f.id = ?1",
    to: "LEFT JOIN student_applications a ON a.id = f.application_id\nLEFT JOIN application_drafts dd ON dd.id = f.application_id\nJOIN admission_batches b ON b.id = COALESCE(a.batch_id, dd.batch_id)\nWHERE f.id = ?1",
    tests: ADMIN,
  },
  {
    name: "portal files: a deleted file is still readable (the deleted_at check of the student's read)",
    file: "src/private-files/lookup.ts",
    from: "WHERE f.id = ?2 AND f.deleted_at IS NULL AND (d.id IS NOT NULL OR a.id IS NOT NULL)`;",
    to: "WHERE f.id = ?2 AND (d.id IS NOT NULL OR a.id IS NOT NULL)`;",
    tests: OWN,
  },

  // ------------------------------------------------ the admin: who may open, and the audit of every open
  {
    name: "portal files: opening a file needs only READ on Pendaftaran (a viewer opens)",
    file: "src/api/application-files.ts",
    from: 'const write = requireArea("pendaftaran", "write");',
    to: 'const write = requireArea("pendaftaran", "read");',
    tests: ADMIN,
  },
  {
    name: "portal files: the purge needs only READ on Pendaftaran",
    file: "src/api/application-files.ts",
    from: 'applicationFileRoutes.post("/:id/files/purge", write, async (c) => {',
    to: 'applicationFileRoutes.post("/:id/files/purge", requireArea("pendaftaran", "read"), async (c) => {',
    tests: ADMIN,
  },
  {
    name: "portal files: an open is not audited",
    file: "src/api/application-files.ts",
    from: "await auditStatement(drizzle(c.env.DB, { schema }), user, {",
    to: "await ((_db: unknown, _actor: unknown, _entry: unknown) => Promise.resolve())(drizzle(c.env.DB, { schema }), user, {",
    tests: ADMIN,
  },
  {
    name: "portal files: a file is served even when its audit row could not be written",
    file: "src/api/application-files.ts",
    from: "    return refusalResponse(c, REFUSALS.auditUnavailable);\n  }\n  return fileResponse(file, object);",
    to: "  }\n  return fileResponse(file, object);",
    tests: ADMIN,
  },
  {
    name: "portal files: the audit row of an open carries the file's size (more than ids)",
    file: "src/api/application-files.ts",
    from: "metadata: { applicationId: file.applicationId, slot: file.slot },",
    to: "metadata: { applicationId: file.applicationId, slot: file.slot, size: file.size },",
    tests: ADMIN,
  },
  {
    name: "portal files: opening files is not limited per admin",
    file: "src/api/application-files.ts",
    from: 'const limit = await checkLimits(c.env, [{ name: "adminFile", key: `adminFile:${user.id}` }]);\n  if (!limit.allowed) return limitedResponse(limit);',
    to: "",
    tests: ADMIN,
  },
  {
    name: "portal files: a HEAD request counts as an open of the admin's file (audited, the bucket read)",
    file: "src/api/application-files.ts",
    from: 'if (c.req.method === "HEAD") return refusalResponse(c, REFUSALS.methodNotAllowed);',
    to: "",
    tests: ADMIN,
  },
  {
    name: "portal files: a HEAD request is a read of the student's file",
    file: "src/portal/files.ts",
    from: 'if (c.req.method === "HEAD") return refusalResponse(c, REFUSALS.methodNotAllowed);',
    to: "",
    tests: OWN,
  },

  // ------------------------------------------------ the purge: a confirmation, one audit row, an honest counter
  {
    name: "portal files: the purge needs no confirmation in the body",
    file: "src/api/application-files.ts",
    from: "const purgeBody = z.object({ confirm: z.literal(true) });",
    to: "const purgeBody = z.object({ confirm: z.boolean().optional() });",
    tests: ADMIN,
  },
  {
    name: "portal files: a purge writes no audit row",
    file: "src/private-files/purge.ts",
    from: "env.DB.prepare(AUDIT_PURGE_SQL).bind(crypto.randomUUID(), actor.id, actor.email.toLowerCase(), applicationId),",
    to: 'env.DB.prepare("SELECT 1").bind(),',
    tests: ADMIN,
  },
  {
    name: "portal files: a purge of nothing still writes an audit row",
    file: "src/private-files/purge.ts",
    from: "FROM application_files WHERE application_id = ?4 AND deleted_at IS NULL\nHAVING COUNT(*) > 0`;",
    to: "FROM application_files WHERE application_id = ?4 AND deleted_at IS NULL`;",
    tests: ADMIN,
  },
  {
    name: "portal files: the audit row of a purge carries what was purged (slots, not only ids and a count)",
    file: "src/private-files/purge.ts",
    from: "json_object('count', COUNT(*), 'fileIds', json(json_group_array(id)))",
    to: "json_object('count', COUNT(*), 'fileIds', json(json_group_array(id)), 'slots', json(json_group_array(slot)))",
    tests: ADMIN,
  },
  {
    name: "portal files: a purge leaves the files' share of the storage counter",
    file: "src/private-files/purge.ts",
    from: '    releaseLiveStatement(env.DB, "application_id = ?1", [applicationId], now),\n',
    to: "",
    tests: ADMIN,
  },
  {
    name: "portal files: a student's delete leaves the file's share of the storage counter",
    file: "src/private-files/delete.ts",
    from: '    releaseLiveStatement(env.DB, "id = ?1 AND application_id = ?2", [fileId, gate.draftId], now),\n',
    to: "",
    tests: OWN,
  },
  {
    name: "portal files: a replaced file leaves its share of the storage counter",
    file: "src/private-files/upload.ts",
    from: "    statements.push(releaseLiveStatement(env.DB, REPLACED_CONDITION, [replaced.id, draftId, slot, fileId], now));\n",
    to: "",
    tests: `${UPLOAD} ${OWN}`,
  },
  {
    name: "portal files: a file already marked is released from the counter a second time (the live-only guard of the release)",
    file: "src/private-files/storage.ts",
    from: "  const live = `${condition} AND deleted_at IS NULL`;\n  return `UPDATE private_storage SET",
    to: "  const live = condition;\n  return `UPDATE private_storage SET",
    tests: `${ADMIN} ${HOUSEKEEPING}`,
  },
  {
    name: "portal files: the rows go although R2 could not delete the objects (nothing left to retry from)",
    file: "src/private-files/remove.ts",
    from: '    console.error("[private-files] the objects of removed files could not be deleted; they stay marked for the daily cleanup");\n    return 0;\n  }',
    to: '    console.error("[private-files] the objects of removed files could not be deleted; they stay marked for the daily cleanup");\n  }',
    tests: `${ADMIN} ${OWN} ${HOUSEKEEPING}`,
  },
  {
    name: "portal files: a live file's row can be deleted with the others (the marked-only guard of the row delete)",
    file: "src/private-files/remove.ts",
    from: "`DELETE FROM application_files WHERE id IN (${marks(ids)}) AND deleted_at IS NOT NULL`",
    to: "`DELETE FROM application_files WHERE id IN (${marks(ids)})`",
    tests: HOUSEKEEPING,
  },

  // ------------------------------------------------ what a file really is, and exactly as long as it says
  {
    name: "portal files: the magic-byte check removed (any file is taken for a PDF)",
    file: "src/private-files/upload.ts",
    from: "const found = sniff(head.head, length);",
    to: 'const found = { ok: true as const, type: "pdf" as const, width: null, height: null };',
    tests: UPLOAD,
  },
  {
    name: "portal files: a slot takes any type (self-photo takes a PDF, a GIF goes in)",
    file: "src/private-files/upload.ts",
    from: 'if (found.type === "gif" || !slotAccepts(slot, found.type)) {',
    to: "if (false) {",
    tests: UPLOAD,
  },
  {
    name: "portal files: no limit on the declared length (a file over 10 MB is read)",
    file: "src/private-files/upload.ts",
    from: "  if (length > MAX_FILE_BYTES) return REFUSALS.tooLarge;\n",
    to: "",
    tests: `${UPLOAD} ${RULES}`,
  },
  {
    name: "portal files: a body of the wrong length is a server error, not an incomplete upload",
    file: "src/private-files/stream.ts",
    from: "const isLengthError = (error: unknown) => error instanceof TypeError && /FixedLengthStream/.test(error.message);",
    to: "const isLengthError = (_error: unknown) => false;",
    tests: UPLOAD,
  },
  {
    name: "portal files: a body that stops short while it is being copied counts as a stored file",
    file: "src/private-files/stream.ts",
    from: "  if (!fed) return { ok: false, reason: \"mismatch\" };\n",
    to: "",
    tests: UPLOAD,
  },
  {
    name: "portal files: a client's declared length is not checked against the bytes (the stream is not fixed-length)",
    file: "src/private-files/stream.ts",
    from: "const fixed = new FixedLengthStream(declared);",
    to: "const fixed = new IdentityTransformStream();",
    tests: UPLOAD,
  },

  // ------------------------------------------------ the budget and the limits of a slot and an application
  {
    name: "portal files: the storage counter takes bytes past the budget",
    file: "src/private-files/storage.ts",
    from: "WHERE id = ?4 AND bytes + ?1 <= ?2\")",
    to: 'WHERE id = ?4 AND ?1 IS NOT NULL AND ?2 IS NOT NULL")',
    tests: UPLOAD,
  },
  {
    name: "portal files: a refused upload keeps its reservation of the budget",
    file: "src/private-files/upload.ts",
    from: "  if (!outcome.ok) await releaseStorage(env, length, now).catch(() => console.error(\"[private-files] could not give a storage reservation back\"));\n  return outcome;",
    to: "  return outcome;",
    tests: UPLOAD,
  },
  {
    name: "portal files: a slot is not full at its maximum (the check before the upload)",
    file: "src/private-files/state.ts",
    from: "if ((counts.bySlot[slot] ?? 0) - (replaced ? 1 : 0) >= max) return slotFull(max);",
    to: "",
    tests: `${UPLOAD} ${RULES}`,
  },
  {
    name: "portal files: two uploads at once both take the last place of a slot (the guard of the insert)",
    file: "src/private-files/upload.ts",
    from: "  AND (SELECT COUNT(*) FROM application_files WHERE application_id = ?2 AND slot = ?3 AND deleted_at IS NULL AND id IS NOT ?12) < ?13\n",
    to: "",
    tests: UPLOAD,
  },
  {
    name: "portal files: an application may hold more than 100,000,000 bytes (the check before the upload)",
    file: "src/private-files/state.ts",
    from: "if (counts.bytes - (replaced ? replaced.size : 0) + size > MAX_BYTES_PER_APPLICATION) return REFUSALS.applicationTooLarge;",
    to: "",
    tests: `${UPLOAD} ${RULES}`,
  },
  {
    name: "portal files: a file is stored for a draft that was submitted meanwhile (the draft's existence in the insert)",
    file: "src/private-files/upload.ts",
    from: "WHERE EXISTS (SELECT 1 FROM application_drafts WHERE id = ?2 AND user_id = ?10 AND batch_id = ?11)\n  AND NOT EXISTS (SELECT 1 FROM student_applications WHERE user_id = ?10 AND batch_id = ?11)\n  AND EXISTS (SELECT 1 FROM admission_batches WHERE id = ?11 AND opens_at <= ?9 AND closes_at > ?9)",
    to: "WHERE ?2 IS NOT NULL AND ?10 IS NOT NULL AND ?11 IS NOT NULL AND ?9 IS NOT NULL",
    tests: UPLOAD,
  },
  {
    name: "portal files: a student with an application already sent is let through the gate (the application API's refusal is not used)",
    file: "src/private-files/state.ts",
    from: "const refusal = writeRefusal(state, state === null && (await anyDraftQuery(db, userId)).length > 0);",
    to: "const refusal = state === null ? writeRefusal(state, false) : null;",
    tests: `${UPLOAD} ${OWN}`,
  },
  {
    name: "portal files: a batch that closed on a draft is told `no_open_batch` (the draft is not looked for)",
    file: "src/private-files/state.ts",
    from: "const refusal = writeRefusal(state, state === null && (await anyDraftQuery(db, userId)).length > 0);",
    to: "const refusal = writeRefusal(state, false);",
    tests: `${UPLOAD} ${OWN}`,
  },
  {
    name: "portal files: an upload whose answer cannot be read is a failed upload although the file is stored",
    file: "src/private-files/upload.ts",
    from: ".catch(() => {\n    const present = { ...state.counts.bySlot,",
    to: ".catch((error: unknown) => {\n    throw error;\n    const present = { ...state.counts.bySlot,",
    tests: UPLOAD,
  },
  {
    name: "portal files: a file write does not move the draft's version (a submit would not see the change)",
    file: "src/private-files/upload.ts",
    from: 'const TOUCH_DRAFT_SQL = "UPDATE application_drafts SET updated_at = MAX(?1, updated_at + 1) WHERE id = ?2',
    to: 'const TOUCH_DRAFT_SQL = "UPDATE application_drafts SET updated_at = updated_at WHERE ?1 IS NOT NULL AND id = ?2',
    tests: UPLOAD,
  },
  {
    name: "portal files: a student's delete does not move the draft's version",
    file: "src/private-files/delete.ts",
    from: 'export const TOUCH_SQL = "UPDATE application_drafts SET updated_at = MAX(?1, updated_at + 1) WHERE id = ?2',
    to: 'export const TOUCH_SQL = "UPDATE application_drafts SET updated_at = updated_at WHERE ?1 IS NOT NULL AND id = ?2',
    tests: OWN,
  },

  // ------------------------------------------------ the key, the headers, and the one bucket
  {
    name: "portal files: the application API builds its own key again (two implementations of the key)",
    file: "src/portal/rules.ts",
    from: 'export { applicationFileKey } from "../private-files/key";',
    to: "export const applicationFileKey = (file: { year: number; applicationId: string; fileId: string; contentType: string }): string | null => `applications/${file.year}/${file.applicationId}/${file.fileId}.${file.contentType.length}`;",
    tests: RULES,
  },
  {
    name: "portal files: the one key throws on an id that is not a UUID instead of answering null (a cleanup or a removal would stop at one bad row)",
    file: "src/private-files/key.ts",
    from: "if (!type || !isUuid(file.applicationId) || !isUuid(file.fileId) ||",
    to: "if (!type ||",
    tests: RULES,
  },
  {
    name: "portal files: the key has no year (and so is not of the shape the dev route and the checks know)",
    file: "src/private-files/key.ts",
    from: "return `applications/${year}/${applicationId}/${fileId}.${STORED_TYPES[type].ext}`;",
    to: "return `applications/${applicationId}/${fileId}.${STORED_TYPES[type].ext}`;",
    tests: `${RULES} ${UPLOAD}`,
  },
  {
    name: "portal files: a served file may be cached (public, max-age)",
    file: "src/private-files/serve.ts",
    from: '"Cache-Control": "private, no-store",',
    to: '"Cache-Control": "public, max-age=3600",',
    tests: `${RULES} ${OWN} ${ADMIN}`,
  },
  {
    name: "portal files: a served file is no longer sandboxed (no CSP)",
    file: "src/private-files/serve.ts",
    from: "\"Content-Security-Policy\": \"default-src 'none'; sandbox\",\n",
    to: "",
    tests: `${RULES} ${OWN} ${ADMIN}`,
  },
  {
    name: "portal files: the browser may sniff a served file",
    file: "src/private-files/serve.ts",
    from: '"X-Content-Type-Options": "nosniff",\n',
    to: "",
    tests: `${RULES} ${OWN} ${ADMIN}`,
  },
  {
    name: "portal files: a PDF is shown inline instead of offered as a download",
    file: "src/private-files/key.ts",
    from: 'return contentType.startsWith("image/");',
    to: "return true;",
    tests: `${RULES} ${OWN} ${ADMIN}`,
  },
  {
    name: "portal files: the admin Worker overwrites `private, no-store` with a plain no-store",
    file: "src/worker.ts",
    from: 'if (c.res.headers.get("Cache-Control") !== "private, no-store") c.header("Cache-Control", "no-store");',
    to: 'c.header("Cache-Control", "no-store");',
    tests: ADMIN,
  },
  {
    name: "portal files: the development route of the public uploads reads the private bucket",
    file: "src/api/dev-uploads.ts",
    from: "const object = await c.env.UPLOADS.get(key);",
    to: "const object = await c.env.PRIVATE_FILES.get(key);",
    tests: PRIVACY,
  },
  {
    name: "portal files: a file route logs the file's key",
    file: "src/portal/files.ts",
    from: 'console.error("[private-files] a file row has no object in the bucket");',
    to: 'console.error(`[private-files] a file row has no object in the bucket: ${file.key}`);',
    tests: `${PRIVACY} ${RULES} ${OWN}`,
  },

  // ------------------------------------------------ the daily chores: nothing live is ever deleted
  {
    name: "portal files: the daily cleanup deletes live files too (the marked-only filter)",
    file: "src/private-files/housekeeping.ts",
    from: "WHERE f.deleted_at IS NOT NULL AND f.deleted_at <= ?1",
    to: "WHERE ?1 IS NOT NULL",
    tests: HOUSEKEEPING,
  },
  {
    name: "portal files: the daily cleanup does not wait an hour for a delete in flight",
    file: "src/private-files/housekeeping.ts",
    from: "const GRACE_MS = 60 * 60 * 1000;",
    to: "const GRACE_MS = 0;",
    tests: HOUSEKEEPING,
  },
  {
    name: "portal files: the storage counter is not recounted",
    file: "src/private-files/housekeeping.ts",
    from: "  await reconcileStorageStatement(env.DB, now).run();\n",
    to: "",
    tests: HOUSEKEEPING,
  },
  {
    name: "portal files: a file whose application is gone is never found (the year of its batch is not tried)",
    file: "src/private-files/housekeeping.ts",
    from: "      years = batchYears;",
    to: "      years = [];",
    tests: HOUSEKEEPING,
  },
  {
    name: "portal files: the daily cleanup runs no file chores",
    file: "src/cron/cleanup.ts",
    from: "    const files = await runFilesHousekeeping(env, controller.scheduledTime);",
    to: "    const files = { removed: 0, pending: 0 };",
    tests: HOUSEKEEPING,
  },

  // ------------------------------------------------ the query plans of a request
  {
    name: "portal files: the files of an application are found without the (application_id, slot) index",
    file: "src/private-files/state.ts",
    from: "FROM application_files WHERE application_id = ?1 AND deleted_at IS NULL GROUP BY slot\";",
    to: "FROM application_files WHERE application_id || '' = ?1 AND deleted_at IS NULL GROUP BY slot\";",
    tests: PLANS,
  },

  // ------------------------------------------------ the SPAs and the Worker agree
  {
    name: "portal files: the portal SPA builds a different address for a replacement",
    file: "portal-spa/src/lib/files/paths.ts",
    from: "${replace ? `?replace=${encodeURIComponent(replace)}` : \"\"}",
    to: "${replace ? `?replaces=${encodeURIComponent(replace)}` : \"\"}",
    tests: CONTRACT,
  },
  {
    name: "portal files: the portal SPA's file input offers every type to every slot (a PDF to self-photo)",
    file: "portal-spa/src/lib/files/accept.ts",
    from: 'return SLOTS[slot].types.map((type) => FILE_TYPE_INFO[type].mime).join(",");',
    to: 'return Object.values(FILE_TYPE_INFO).map((info) => info.mime).join(",");',
    tests: CONTRACT,
  },
  {
    name: "portal files: the admin SPA links a file of another address than the Worker's",
    file: "spa/src/pages/applications/model.ts",
    from: "`${API_PATH}/${encodeURIComponent(applicationId)}/files/${encodeURIComponent(fileId)}`",
    to: "`${API_PATH}/${encodeURIComponent(applicationId)}/file/${encodeURIComponent(fileId)}`",
    tests: CONTRACT,
  },
  {
    name: "portal files: the admin SPA reads the files of the detail from the wrong field",
    file: "spa/src/pages/applications/answers.ts",
    from: "for (const file of application.files ?? [])",
    to: "for (const file of [])",
    tests: CONTRACT,
  },
];

// ─── The SPAs' side ─────────────────────────────────────────────────────

const ADMIN_SPA = (...names) => names.map((name) => `spa/test/${name}`).join(" ");
const PORTAL_SPA = (...names) => names.map((name) => `portal-spa/test/${name}`).join(" ");

const FILES_PAGE = "pendaftaran/files.test.tsx";
const ANSWERS_FILES = "pendaftaran/answers-files.test.ts";
const MOCK_FILES = "pendaftaran/mock-files.test.ts";
const XHR = "crud/xhr.test.ts";
const UPLOAD_CLIENT = "crud/upload.test.tsx";
const AUDIT_LABELS = "audit-labels.test.ts";
const FILE_FIELD = "file-slot-field.test.tsx";
const FILES_LIB = "files-lib.test.ts";

export const portalFilesSpaChecks = [
  // ------------------------------------------------ the admin's Pendaftar detail
  {
    name: "portal files: the admin SPA offers every role to open the files (canOpen is always true)",
    file: "spa/src/pages/applications/answers.ts",
    from: "canOpen: application.canOpenFiles === true }",
    to: "canOpen: true }",
    tests: ADMIN_SPA(ANSWERS_FILES, FILES_PAGE),
  },
  {
    name: "portal files: a viewer is not told who can open the files",
    file: "spa/src/pages/applications/FilesSection.tsx",
    from: '{!canOpen && <p className="text-xs text-gray-500">Berkas hanya bisa dibuka oleh tim Pendaftaran.</p>}',
    to: "",
    tests: ADMIN_SPA(FILES_PAGE),
  },
  {
    name: "portal files: a link to a file keeps its opener (no rel=noopener)",
    file: "spa/src/pages/applications/FilesSection.tsx",
    from: 'target="_blank" rel="noopener noreferrer" className={EXTERNAL}>',
    to: 'target="_blank" className={EXTERNAL}>',
    tests: ADMIN_SPA(FILES_PAGE),
  },
  {
    name: "portal files: the purge card is drawn for a role that cannot purge",
    file: "spa/src/pages/applications/ApplicationDetailPage.tsx",
    from: "{application.canOpenFiles && application.files.length > 0 && (",
    to: "{application.files && application.files.length > 0 && (",
    tests: ADMIN_SPA(FILES_PAGE),
  },
  {
    name: "portal files: the purge is sent without its confirmation",
    file: "spa/src/pages/applications/FilesSection.tsx",
    from: 'api(purgePath(applicationId), { method: "POST", json: { confirm: true } })',
    to: 'api(purgePath(applicationId), { method: "POST", json: {} })',
    tests: ADMIN_SPA(FILES_PAGE),
  },
  {
    name: "portal files: the purge goes ahead without asking",
    file: "spa/src/pages/applications/FilesSection.tsx",
    from: "onClick={() => setAsking(true)}",
    to: "onClick={() => void confirm()}",
    tests: ADMIN_SPA(FILES_PAGE),
  },
  {
    name: "portal files: a review answer replaces the whole page (the files and the flag are lost)",
    file: "spa/src/pages/applications/ApplicationDetailPage.tsx",
    from: "item.replace({ ...application, ...next });",
    to: "item.replace(next as never);",
    tests: ADMIN_SPA(FILES_PAGE),
  },
  {
    name: "portal files: a version 2 application is read as uploads (its links disappear)",
    file: "spa/src/pages/applications/answers.ts",
    from: "const uploads = (application.formVersion !== undefined ? application.formVersion : fd?.formVersion) === 3;",
    to: "const uploads = true;",
    tests: ADMIN_SPA(ANSWERS_FILES, "pendaftaran/answers.test.ts", FILES_PAGE),
  },
  {
    name: "portal files: the SKTM slot is asked of every family, not only DTKS ones",
    file: "spa/src/pages/applications/answers.ts",
    from: '.filter((id) => id !== "dtks" || dtksRegistered)',
    to: "",
    tests: ADMIN_SPA(ANSWERS_FILES),
  },
  {
    name: "portal files: the mock answers a review with the files (the Worker does not)",
    file: "spa/src/mock/resources/pendaftaran.ts",
    from: "const { formVersion: _version, files: _files, ...reviewed } = application;",
    to: "const reviewed = application;",
    tests: ADMIN_SPA(MOCK_FILES),
  },
  {
    name: "portal files: the mock purges without a confirmation",
    file: "spa/src/mock/resources/pendaftaran.ts",
    from: "if (bodyOf(init)?.confirm !== true) return failure(",
    to: "if (false) return failure(",
    tests: ADMIN_SPA(MOCK_FILES),
  },
  {
    name: "portal files: Aktivitas has no label for an admin opening an applicant's file",
    file: "spa/src/lib/audit.ts",
    from: '  "application_file.view": "Berkas pendaftar dibuka",\n',
    to: "",
    tests: ADMIN_SPA(AUDIT_LABELS),
  },
  {
    name: "portal files: the shared XMLHttpRequest sends a request that is already aborted",
    file: "shared/spa/xhr.ts",
    from: "if (signal.aborted) return resolve({ kind: \"aborted\" });",
    to: "",
    tests: ADMIN_SPA(XHR, UPLOAD_CLIENT),
  },
  {
    name: "portal files: the shared XMLHttpRequest does not send the session cookie",
    file: "shared/spa/xhr.ts",
    from: "xhr.withCredentials = true;",
    to: "xhr.withCredentials = false;",
    tests: ADMIN_SPA(XHR, UPLOAD_CLIENT),
  },

  // ------------------------------------------------ the portal's file client and field
  {
    name: "portal files: the file input offers any image (image/*), so a phone may hand over a format the Worker refuses",
    file: "portal-spa/src/lib/files/accept.ts",
    from: "return SLOTS[slot].types.map((type) => FILE_TYPE_INFO[type].mime).join(\",\");",
    to: 'return "image/*,application/pdf";',
    tests: PORTAL_SPA(FILES_LIB, FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a PDF over 10 MB is sent to the Worker to be refused",
    file: "portal-spa/src/lib/files/accept.ts",
    from: 'if (type === "pdf" && file.size > MAX_FILE_BYTES) return FILE_MESSAGES.tooBig;',
    to: "",
    tests: PORTAL_SPA(FILES_LIB, FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: what is really sent is not checked against 10 MB",
    file: "portal-spa/src/lib/files/accept.ts",
    from: "return size === 0 ? FILE_MESSAGES.empty : size > MAX_FILE_BYTES ? FILE_MESSAGES.tooBig : null;",
    to: "return null;",
    tests: PORTAL_SPA(FILES_LIB, FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: an image is enlarged to fit, not only reduced (a small photo grows)",
    file: "portal-spa/src/lib/files/compress.ts",
    from: "  if (longSide <= maxLongSide) return { width, height };\n",
    to: "",
    tests: PORTAL_SPA(FILES_LIB),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a PDF is run through the picture codec",
    file: "portal-spa/src/lib/files/compress.ts",
    from: 'return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";',
    to: 'return mime !== "";',
    tests: PORTAL_SPA(FILES_LIB),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a picture that was decoded is not released when it cannot be drawn",
    file: "portal-spa/src/lib/files/compress.ts",
    from: "    } finally {\n      image.release();\n    }",
    to: "    } finally {\n    }",
    tests: PORTAL_SPA(FILES_LIB),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: the upload sends the file under a multipart form (and its name) instead of the raw bytes",
    file: "portal-spa/src/lib/files/client.ts",
    from: 'headers: { "Content-Type": "application/octet-stream", Accept: "application/json" }',
    to: 'headers: { "Content-Type": "multipart/form-data", Accept: "application/json" }',
    tests: PORTAL_SPA(FILES_LIB),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a 401 of an upload is shown as a server error (the wizard is never told the session ended)",
    file: "portal-spa/src/lib/files/client.ts",
    from: "  if (status === 401) return CLIENT_MESSAGES.expired;\n",
    to: "",
    tests: PORTAL_SPA(FILES_LIB, FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a delete that the Worker says is already done is shown as a failure",
    file: "portal-spa/src/lib/files/client.ts",
    from: "if (result.ok || result.status === 404) return { ok: true };",
    to: "if (result.ok) return { ok: true };",
    tests: PORTAL_SPA(FILES_LIB),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: the field removes a file without asking first",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: "onClick={() => setConfirming(file.id)}",
    to: "onClick={() => void remove(file.id)}",
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a double tap on 'Ya, hapus' sends the delete twice",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: "    if (removeLock.current) return;\n    removeLock.current = true;\n",
    to: "",
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: the field sends a replacement without the id of the file it replaces",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: "replace: replaceId ?? undefined,",
    to: "",
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: the first refusal does not stop the files waiting behind it",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: "return stop(outcome.code === \"aborted\" ? null : outcome.message);",
    to: "setLocalError(outcome.code === \"aborted\" ? null : outcome.message); continue;",
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a file that cannot be sent is not refused on the phone first (the type check)",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: "      if (problem) return stop(problem);\n",
    to: "",
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: a stored file's link loses its opener protection",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: 'target="_blank" rel="noopener noreferrer" className="text-xs text-primary-blue hover:underline"',
    to: 'target="_blank" className="text-xs text-primary-blue hover:underline"',
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
  {
    name: "portal files: the field loads the stored files by itself (a thumbnail of every file)",
    file: "portal-spa/src/components/FileSlotField.tsx",
    from: "const preview = previews.current.get(file.id);",
    to: "const preview = previews.current.get(file.id) ?? fileHref(file.id);",
    tests: PORTAL_SPA(FILE_FIELD),
    config: "portal-spa/vitest.config.ts",
  },
];
