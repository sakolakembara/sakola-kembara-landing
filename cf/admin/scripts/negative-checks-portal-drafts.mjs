// The negative checks of the manual purge of a draft's files (SAKEM-093), in their own file so the shared list in
// negative-checks.mjs stays short: the runner imports and spreads what this file exports (`portalDraftsChecks`). Same rules
// as there: each check breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the
// runner restores the file. A pattern found other than exactly once (in its file) is reported as FAIL, so a refactor cannot
// turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only "portal drafts:"

const MAIN = "test/private-files-drafts.test.ts";
const PLANS = "test/private-files-drafts-plans.test.ts";
const PRIVACY = "test/private-files-drafts-privacy.test.ts";
const CONTRACT = "test/private-files-drafts-spa-contract.test.ts";

const ROUTES = "src/api/application-files.ts";
const DRAFTS = "src/private-files/drafts.ts";

// The text the two purge routes share, so a check on the DRAFT route can name it by what only it calls.
const DRAFT_ROUTE_TAIL = '  if (!body.ok) return body.response;\n\n  if (!c.env.PRIVATE_FILES) return refusalResponse(c, REFUSALS.storageUnavailable);\n  const outcome = await purgeDraftFiles(c.env, user, c.req.param("id"));';

export const portalDraftsChecks = [
  // ------------------------------------------------ who may list and who may purge
  {
    name: "portal drafts: the list of drafts needs only READ on Pendaftaran (a viewer sees it)",
    file: ROUTES,
    from: 'applicationFileRoutes.get("/drafts/files", write, async (c) => {',
    to: 'applicationFileRoutes.get("/drafts/files", requireArea("pendaftaran", "read"), async (c) => {',
    tests: MAIN,
  },
  {
    name: "portal drafts: the purge of a draft's files needs only READ on Pendaftaran",
    file: ROUTES,
    from: 'applicationFileRoutes.post("/drafts/:id/files/purge", write, async (c) => {',
    to: 'applicationFileRoutes.post("/drafts/:id/files/purge", requireArea("pendaftaran", "read"), async (c) => {',
    tests: MAIN,
  },
  {
    name: "portal drafts: the purge of a draft's files needs no confirmation in the body",
    file: ROUTES,
    from: DRAFT_ROUTE_TAIL,
    to: '\n  if (!c.env.PRIVATE_FILES) return refusalResponse(c, REFUSALS.storageUnavailable);\n  const outcome = await purgeDraftFiles(c.env, user, c.req.param("id"));',
    tests: MAIN,
  },
  {
    name: "portal drafts: the purge of a draft's files is not rate limited",
    file: ROUTES,
    from: `  const limit = await checkLimits(c.env, [{ name: "upload", key: \`file-purge:\${user.id}\` }]);\n  if (!limit.allowed) return limitedResponse(limit);\n  const body = await parseBody(c, purgeBody, { maxBytes: 1024 });\n${DRAFT_ROUTE_TAIL}`,
    to: `  const body = await parseBody(c, purgeBody, { maxBytes: 1024 });\n${DRAFT_ROUTE_TAIL}`,
    tests: MAIN,
  },
  {
    name: "portal drafts: a draft's purge has an allowance of its own (the two purges no longer share one)",
    file: ROUTES,
    from: `key: \`file-purge:\${user.id}\` }]);\n  if (!limit.allowed) return limitedResponse(limit);\n  const body = await parseBody(c, purgeBody, { maxBytes: 1024 });\n${DRAFT_ROUTE_TAIL}`,
    to: `key: \`draft-purge:\${user.id}\` }]);\n  if (!limit.allowed) return limitedResponse(limit);\n  const body = await parseBody(c, purgeBody, { maxBytes: 1024 });\n${DRAFT_ROUTE_TAIL}`,
    tests: MAIN,
  },
  {
    name: "portal drafts: the list has no bound on the page size",
    file: ROUTES,
    from: "parsePage(reader(c), { maxPageSize: DRAFTS_MAX_PAGE_SIZE })",
    to: "parsePage(reader(c), { maxPageSize: 100000 })",
    tests: MAIN,
  },

  // ------------------------------------------------ the safety rule: 30 days, to the millisecond, in the checks AND in the writes
  {
    name: "portal drafts: the rule says one day, not thirty",
    file: DRAFTS,
    from: "export const DRAFT_PURGE_MIN_INACTIVE_DAYS = 30;",
    to: "export const DRAFT_PURGE_MIN_INACTIVE_DAYS = 1;",
    tests: `${MAIN} ${CONTRACT}`,
  },
  {
    name: "portal drafts: the boundary is exclusive (exactly thirty days is refused)",
    file: DRAFTS,
    from: "export const isDraftPurgeable = (updatedAt: number, now: number): boolean => updatedAt <= draftPurgeCutoff(now);",
    to: "export const isDraftPurgeable = (updatedAt: number, now: number): boolean => updatedAt < draftPurgeCutoff(now);",
    tests: MAIN,
  },
  {
    name: "portal drafts: the list says every draft may be purged",
    file: DRAFTS,
    from: "    purgeable: isDraftPurgeable(row.updated_at, now),",
    to: "    purgeable: true,",
    tests: MAIN,
  },
  {
    name: "portal drafts: a draft changed yesterday is looked at no differently (the check before the writes removed; the writes still refuse, but the answer is no longer a 409)",
    file: DRAFTS,
    from: "  if (!isDraftPurgeable(draft.updated_at, now)) return { ok: false, refusal: draftActive(DRAFT_PURGE_MIN_INACTIVE_DAYS, purgeableFrom(draft.updated_at)) };\n",
    to: "",
    tests: MAIN,
  },
  {
    name: "portal drafts: the marking has no guard (a student who saves between the check and the write loses the files)",
    file: DRAFTS,
    from: 'deleted_at IS NULL AND ${purgeable("?2", "?3")}`;',
    to: "deleted_at IS NULL AND ?3 IS NOT NULL`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the audit row has no guard (a refused write still leaves a row saying files were purged)",
    file: DRAFTS,
    from: 'AND deleted_at IS NULL AND ${purgeable("?4", "?5")}\nHAVING COUNT(*) > 0`;',
    to: "AND deleted_at IS NULL AND ?5 IS NOT NULL\nHAVING COUNT(*) > 0`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the counter is given back whatever the guard says (bytes released for files that were not marked)",
    file: DRAFTS,
    from: 'export const RELEASE_DRAFT_CONDITION = `application_id = ?1 AND ${purgeable("?1", "?2")}`;',
    to: "export const RELEASE_DRAFT_CONDITION = `application_id = ?1 AND ?2 IS NOT NULL`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the guard of the writes forgets submitted applications (a draft row beside an application is purged)",
    file: DRAFTS,
    from: "AND d.updated_at <= ${cutoff}) AND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = ${id})`;",
    to: "AND d.updated_at <= ${cutoff})`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the first look at the draft forgets submitted applications (a submitted application's id is read as a draft)",
    file: DRAFTS,
    from: "WHERE d.id = ?1 AND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = d.id)`;",
    to: "WHERE d.id = ?1`;",
    tests: MAIN,
  },

  // ------------------------------------------------ the purge itself: the one audit row, the counter, the version, the objects
  {
    name: "portal drafts: a purge writes no audit row",
    file: DRAFTS,
    from: "env.DB.prepare(AUDIT_DRAFT_PURGE_SQL).bind(crypto.randomUUID(), actor.id, actor.email.toLowerCase(), draftId, cutoff),",
    to: 'env.DB.prepare("SELECT 1").bind(),',
    tests: `${MAIN} ${PRIVACY}`,
  },
  {
    name: "portal drafts: a purge of nothing still writes an audit row",
    file: DRAFTS,
    from: 'AND deleted_at IS NULL AND ${purgeable("?4", "?5")}\nHAVING COUNT(*) > 0`;',
    to: 'AND deleted_at IS NULL AND ${purgeable("?4", "?5")}`;',
    tests: MAIN,
  },
  {
    name: "portal drafts: the audit row of a purge carries the slots of the files (more than ids and a count)",
    file: DRAFTS,
    from: "json_object('count', COUNT(*), 'fileIds', json(json_group_array(id)))",
    to: "json_object('count', COUNT(*), 'fileIds', json(json_group_array(id)), 'slots', json(json_group_array(slot)))",
    tests: `${MAIN} ${PRIVACY}`,
  },
  {
    name: "portal drafts: the audit row of a draft's purge names an application (a link to a page that does not exist)",
    file: DRAFTS,
    from: "'application_file.purge', 'application_draft', ?4,",
    to: "'application_file.purge', 'application', ?4,",
    tests: `${MAIN} ${PRIVACY}`,
  },
  {
    name: "portal drafts: a purge leaves the files' share of the storage counter",
    file: DRAFTS,
    from: "    releaseLiveStatement(env.DB, RELEASE_DRAFT_CONDITION, [draftId, cutoff], now),\n",
    to: "",
    tests: MAIN,
  },
  {
    name: "portal drafts: a purge does not move the draft's version (a submit that read the draft a moment ago goes through with the files gone)",
    file: DRAFTS,
    from: 'export const TOUCH_DRAFT_VERSION_SQL = "UPDATE application_drafts SET updated_at = updated_at + 1 WHERE',
    to: 'export const TOUCH_DRAFT_VERSION_SQL = "UPDATE application_drafts SET updated_at = updated_at WHERE',
    tests: MAIN,
  },
  {
    name: "portal drafts: a purge makes the draft look recently used (the version jumps to now, so a repeat is refused for 30 days)",
    file: DRAFTS,
    from: 'export const TOUCH_DRAFT_VERSION_SQL = "UPDATE application_drafts SET updated_at = updated_at + 1 WHERE',
    to: 'export const TOUCH_DRAFT_VERSION_SQL = "UPDATE application_drafts SET updated_at = ?2 WHERE',
    tests: MAIN,
  },
  {
    name: "portal drafts: the objects stay in the bucket after the rows are marked (nothing deletes them)",
    file: DRAFTS,
    from: "pending: await removeMarkedFiles(env, draftId, draft.year) };",
    to: "pending: 0 };",
    tests: MAIN,
  },

  // ------------------------------------------------ the list: opaque, only live files, never a walk of the files, one round trip
  {
    name: "portal drafts: the list hands over the raw row (more than the explicit fields)",
    file: DRAFTS,
    from: "  return {\n    id: row.id,\n    batch: { id: row.batch_id,",
    to: "  return {\n    ...row,\n    id: row.id,\n    batch: { id: row.batch_id,",
    tests: MAIN,
  },
  {
    name: "portal drafts: the list counts files that were removed (marked rows are not live)",
    file: DRAFTS,
    from: "JOIN application_files f ON f.application_id = d.id AND f.deleted_at IS NULL\nWHERE",
    to: "JOIN application_files f ON f.application_id = d.id\nWHERE",
    tests: MAIN,
  },
  {
    name: "portal drafts: the list offers a draft that an application shares its id with",
    file: DRAFTS,
    from: "WHERE NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = d.id)\nGROUP BY d.id",
    to: "GROUP BY d.id",
    tests: MAIN,
  },
  {
    name: "portal drafts: the total counts a draft that an application shares its id with",
    file: DRAFTS,
    from: "AND f.deleted_at IS NULL)\nAND NOT EXISTS (SELECT 1 FROM student_applications a WHERE a.id = d.id)`;",
    to: "AND f.deleted_at IS NULL)`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the list is not in the order of the last change (oldest first)",
    file: DRAFTS,
    from: "ORDER BY d.updated_at, d.id\nLIMIT ?1 OFFSET ?2`;",
    to: "ORDER BY d.id\nLIMIT ?1 OFFSET ?2`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the list ignores the page size it was asked for",
    file: DRAFTS,
    from: "LIMIT ?1 OFFSET ?2`;",
    to: "LIMIT ?1 + 1000 OFFSET ?2`;",
    tests: MAIN,
  },
  {
    name: "portal drafts: the files of a draft are reached by walking them (the index cannot be used)",
    file: DRAFTS,
    from: "JOIN application_files f ON f.application_id = d.id AND f.deleted_at IS NULL\nWHERE",
    to: "JOIN application_files f ON f.application_id || '' = d.id AND f.deleted_at IS NULL\nWHERE",
    tests: PLANS,
  },
  {
    name: "portal drafts: a page and its total take two round trips",
    file: DRAFTS,
    from: "await env.DB.batch<unknown>([env.DB.prepare(DRAFTS_PAGE_SQL).bind(request.pageSize, request.offset), env.DB.prepare(DRAFTS_TOTAL_SQL)]);",
    to: "[await env.DB.prepare(DRAFTS_PAGE_SQL).bind(request.pageSize, request.offset).all(), await env.DB.prepare(DRAFTS_TOTAL_SQL).all()];",
    tests: PLANS,
  },

  // ------------------------------------------------ the Aktivitas page can show the row
  {
    name: "portal drafts: the resource type of a draft's purge is not declared (the Aktivitas filter refuses it)",
    file: "src/audit/lists.ts",
    from: '  "application_draft",\n',
    to: "",
    tests: MAIN,
  },
];
