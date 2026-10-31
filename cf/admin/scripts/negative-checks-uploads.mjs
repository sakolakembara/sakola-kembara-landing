// The negative checks of the upload API (SAKEM-082), in their own file so the
// shared list in negative-checks.mjs stays short: it imports and spreads
// `uploadChecks`. Same rules as there: each check breaks ONE safeguard in the
// source, runs the tests that must notice, expects them to FAIL, and the
// runner restores the file. A pattern found other than exactly once is
// reported as FAIL, so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only upload

const UPLOADS = "test/uploads.test.ts";
const SNIFF = "test/uploads-sniff.test.ts";
const REFERENCES = "test/uploads-references.test.ts";
const LIBRARY = "test/media-library.test.ts";

export const uploadChecks = [
  // ------------------------------------------------ what a file really is
  {
    name: "upload: the magic-byte check removed (a file of unknown type passes as a PDF)",
    file: "src/uploads/sniff.ts",
    from: 'const type = detectType(head);\n  if (!type) return { ok: false, reason: "unknown_type" };',
    to: 'const type = detectType(head) ?? "pdf";',
    tests: `${UPLOADS} ${SNIFF}`,
  },
  {
    name: "upload: the client's claimed content type is stored instead of the one found in the bytes",
    file: "src/uploads/store.ts",
    from: "const { contentType, ext } = FILE_TYPES[type];",
    to: "const { ext } = FILE_TYPES[type];\n  const contentType = file.type;",
    tests: UPLOADS,
  },
  {
    name: "upload: the limits on image dimensions removed",
    file: "src/uploads/sniff.ts",
    from: "if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) return",
    to: "if (false) return",
    tests: `${UPLOADS} ${SNIFF}`,
  },

  // --------------------------------------------------------------- areas
  {
    name: "upload: the area of the kind is no longer checked (any upload writer uploads any kind)",
    file: "src/api/uploads.ts",
    from: 'return can(access.user.role, access.grantedAreas, KIND_RULES[kind].area, "write");',
    to: "return true;",
    tests: UPLOADS,
  },
  {
    name: "upload: the check before the body (can write at least one upload area) removed",
    file: "src/api/uploads.ts",
    from: 'if (!uploadAreas.some((area) => can(access.user.role, access.grantedAreas, area, "write"))) return c.json({ error: "forbidden" }, 403);',
    to: "",
    tests: UPLOADS,
  },
  {
    name: "upload: listing no longer checks read access to the kind's area (an editor of another area lists it)",
    file: "src/api/uploads.ts",
    from: 'if (!can(access.user.role, access.grantedAreas, KIND_RULES[kind].area, "read")) return c.json({ error: "forbidden" }, 403);',
    to: "",
    tests: UPLOADS,
  },
  {
    name: "upload: deleting a file no longer checks the area it was uploaded for",
    file: "src/api/uploads.ts",
    from: 'if (!can(access.user.role, access.grantedAreas, areaOfPurpose(media.purpose), "write")) return c.json({ error: "forbidden" }, 403);',
    to: "",
    tests: UPLOADS,
  },

  // -------------------------------------------------------------- limits
  {
    name: "upload: the per-kind size limit removed",
    file: "src/api/uploads.ts",
    from: 'if (file.size > rule.maxBytes) return refuse(c, 413, "too_large", MESSAGES.tooBig(rule.maxBytes), { maxBytes: rule.maxBytes });',
    to: "",
    tests: UPLOADS,
  },
  {
    name: "upload: the declared length is no longer checked before the body is read",
    file: "src/api/uploads.ts",
    from: "} else if (length > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {",
    to: "} else if (false) {",
    tests: UPLOADS,
  },
  {
    name: "upload: a request without a declared length is read anyway",
    file: "src/api/uploads.ts",
    from: 'if (!declared || !/^\\d{1,12}$/.test(declared)) return refuse(c, 411, "length_required", "Panjang permintaan tidak diketahui.");',
    to: "",
    tests: UPLOADS,
  },
  {
    name: "upload: the rate limiter is not consulted",
    file: "src/api/uploads.ts",
    from: "if (!limit.allowed) return limitedResponse(limit);",
    to: "",
    tests: UPLOADS,
  },

  // ----------------------------------------------------------------- keys
  {
    name: "upload: the file name is no longer reduced to [a-z0-9-] in the key (traversal-safe key removed)",
    file: "src/uploads/key.ts",
    from: '.replace(/[^a-z0-9]+/g, "-")',
    to: '.replace(/[\\u0000]+/g, "-")',
    tests: `${SNIFF} ${UPLOADS}`,
  },
  {
    name: "upload: an existing key can be overwritten (the conditional put removed)",
    file: "src/uploads/store.ts",
    from: '    onlyIf: { etagDoesNotMatch: "*" },\n',
    to: "",
    tests: UPLOADS,
  },

  // ------------------------------------------------------- the dev route
  {
    name: "upload: the production guard of GET /uploads/* removed (production serves the bucket)",
    file: "src/api/dev-uploads.ts",
    from: 'if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not_found" }, 404);',
    to: "",
    tests: UPLOADS,
  },
  {
    name: "upload: GET /uploads/* looks up any key, not only the shape we write",
    file: "src/api/dev-uploads.ts",
    from: 'if (!KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);',
    to: "",
    tests: UPLOADS,
  },

  // ------------------------------------------------- records and cleanup
  {
    name: "upload: no audit row for an upload",
    file: "src/uploads/store.ts",
    from: '      auditStatement(db, actor, {\n        action: "upload.create",\n        resourceType: "media",\n        resourceId: id,\n        metadata: { kind, path: pathForKey(key), contentType, size: file.size, width, height },\n      }),\n',
    to: "",
    tests: UPLOADS,
  },
  {
    name: "upload: the object of an upload whose row failed to commit is left behind",
    file: "src/uploads/store.ts",
    from: 'await env.UPLOADS.delete(key).catch(() => console.error("[uploads] could not remove the object of a failed upload"));',
    to: "",
    tests: UPLOADS,
  },

  // ---------------------------------------------------------- references
  {
    name: "upload: a delete no longer checks whether a content row references the file",
    file: "src/uploads/store.ts",
    from: "AND NOT ${referenced.text} RETURNING id`).bind(media.id, ...referenced.params),",
    to: "RETURNING id`).bind(media.id),",
    tests: `${UPLOADS} ${REFERENCES}`,
  },
  {
    name: "upload: the blog's HTML is no longer searched for the file (registry entry removed)",
    file: "src/uploads/references.ts",
    from: '  { label: "Blog", column: schema.blogPosts.contentHtml },\n',
    to: "",
    tests: `${UPLOADS} ${REFERENCES}`,
  },
  {
    name: "upload: the audit row of a delete is written even when the delete was refused",
    file: "src/uploads/store.ts",
    from: "WHERE NOT EXISTS (SELECT 1 FROM media WHERE id = ?)`;",
    to: "WHERE ? IS NOT NULL`;",
    tests: UPLOADS,
  },

  // ------------------------------------------ the Media library (SAKEM-117): the list, the detail, the text alternative
  {
    name: "upload: the library lists every purpose, whatever areas the caller may read",
    file: "src/api/uploads.ts",
    from: 'const purposes = schema.mediaPurpose.filter((purpose) => can(access.user.role, access.grantedAreas, areaOfPurpose(purpose), "read"));',
    to: "const purposes = [...schema.mediaPurpose];",
    tests: LIBRARY,
  },
  {
    name: "upload: someone who may read no area is not refused by the library (empty list, or an error, instead of 403)",
    file: "src/api/uploads.ts",
    from: "if (purposes.length === 0) return c.json({ error: \"forbidden\" }, 403);",
    to: "if (purposes.length === -1) return c.json({ error: \"forbidden\" }, 403);",
    tests: LIBRARY,
  },
  {
    name: "upload: the search looks at the whole key, so a folder name (\"blog\") finds every file in it",
    file: "src/api/uploads.ts",
    from: "sql`instr(lower(${fileNameSql}), ${needle}) > 0`",
    to: "sql`instr(lower(${schema.media.key}), ${needle}) > 0`",
    tests: LIBRARY,
  },
  {
    name: "upload: the search is a LIKE pattern, so a % finds everything",
    file: "src/api/uploads.ts",
    from: "sql`instr(lower(${fileNameSql}), ${needle}) > 0`",
    to: "sql`lower(${fileNameSql}) like ${`%${needle}%`}`",
    tests: LIBRARY,
  },
  {
    name: "upload: the search does not look at the text alternative",
    file: "src/api/uploads.ts",
    from: "sql`instr(lower(coalesce(${schema.media.altText}, '')), ${needle}) > 0`",
    to: "sql`0 = 1`",
    tests: LIBRARY,
  },
  {
    name: "upload: the search text has no length limit",
    file: "src/api/uploads.ts",
    from: 'if (q.length > MAX_SEARCH_LENGTH) return { ok: false, param: "q" };',
    to: 'if (q.length > 100_000) return { ok: false, param: "q" };',
    tests: LIBRARY,
  },
  {
    name: "upload: the image filter takes what is not an image",
    file: "src/api/uploads.ts",
    from: "conditions.push(sql`${schema.media.contentType} like 'image/%'`)",
    to: "conditions.push(sql`${schema.media.contentType} not like 'image/%'`)",
    tests: LIBRARY,
  },
  {
    name: "upload: an unknown type filter is ignored instead of refused",
    file: "src/api/uploads.ts",
    from: 'else return { ok: false, param: "type" };',
    to: "else conditions.push(sql`1 = 1`);",
    tests: LIBRARY,
  },
  {
    name: "upload: `to` includes the instant it names",
    file: "src/api/uploads.ts",
    from: '["to", (at: Date) => lt(schema.media.createdAt, at)]',
    to: '["to", (at: Date) => lt(schema.media.createdAt, new Date(at.getTime() + 1))]',
    tests: LIBRARY,
  },
  {
    name: "upload: `from` leaves out the instant it names",
    file: "src/api/uploads.ts",
    from: '["from", (at: Date) => gte(schema.media.createdAt, at)]',
    to: '["from", (at: Date) => gte(schema.media.createdAt, new Date(at.getTime() + 1))]',
    tests: LIBRARY,
  },
  {
    name: "upload: any text JavaScript can read is a date (a bare 1 is a year)",
    file: "src/api/uploads.ts",
    from: "const at = INSTANT.test(raw) ? new Date(raw) : null;",
    to: "const at = new Date(raw);",
    tests: LIBRARY,
  },
  {
    name: "upload: the detail of a file is read by someone outside its area",
    file: "src/api/uploads.ts",
    from: 'if (!can(access.user.role, access.grantedAreas, areaOfPurpose(row.purpose), "read")) return c.json({ error: "forbidden" }, 403);',
    to: 'if (false) return c.json({ error: "forbidden" }, 403);',
    tests: LIBRARY,
  },
  {
    name: "upload: the detail says nothing about where the file is used",
    file: "src/api/uploads.ts",
    from: "usedBy: await menusUsing(c.env.DB, `/${row.key}`)",
    to: "usedBy: []",
    tests: LIBRARY,
  },
  {
    name: "upload: the text alternative is written by someone outside the file's area (a viewer, an editor of another area)",
    file: "src/api/uploads.ts",
    from: 'if (!can(access.user.role, access.grantedAreas, areaOfPurpose(found.purpose), "write")) return c.json({ error: "forbidden" }, 403);',
    to: 'if (false) return c.json({ error: "forbidden" }, 403);',
    tests: LIBRARY,
  },
  {
    name: "upload: the text alternative is saved with the spaces around it",
    file: "src/api/uploads.ts",
    from: '    .trim()\n    .max(300, "Teks alternatif maksimal 300 karakter.")',
    to: '    .max(300, "Teks alternatif maksimal 300 karakter.")',
    tests: LIBRARY,
  },
  {
    name: "upload: the text alternative may be ten times as long",
    file: "src/api/uploads.ts",
    from: '.max(300, "Teks alternatif maksimal 300 karakter.")',
    to: '.max(3000, "Teks alternatif maksimal 300 karakter.")',
    tests: LIBRARY,
  },
  {
    name: "upload: the audit row of a text change carries the text",
    file: "src/uploads/store.ts",
    from: 'JSON.stringify({ fields: ["altText"] })',
    to: 'JSON.stringify({ fields: ["altText"], altText })',
    tests: LIBRARY,
  },
  {
    name: "upload: the audit row of a text change is written even when there was no row to change",
    file: "src/uploads/store.ts",
    from: "SELECT ?, ?, ?, 'upload.update', 'media', ?, ?\nWHERE EXISTS (SELECT 1 FROM media WHERE id = ?)`;",
    to: "SELECT ?, ?, ?, 'upload.update', 'media', ?, ?\nWHERE ? IS NOT NULL`;",
    tests: LIBRARY,
  },
];
