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
];
