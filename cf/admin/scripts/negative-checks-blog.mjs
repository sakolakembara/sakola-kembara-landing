// The negative checks of the blog (SAKEM-082), in their own file so the shared list in negative-checks.mjs stays
// short: it imports and spreads `blogChecks`. Same rules as there: each check breaks ONE safeguard in the source, runs
// the tests that must notice, expects them to FAIL, and the runner restores the file. A pattern found other than
// exactly once is reported as FAIL, so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only blog
//
// The SPA's side (the read-only affordances, the preview, the publish flow) is negative-checks-spa-blog.mjs.

const API = "test/blog.test.ts";
const SANITIZE = "test/blog-sanitize.test.ts";
const PARITY = "test/blog-render-parity.test.ts";
const IMPORT = "test/blog-import.test.ts";
const CONTRACT = "test/blog-spa-contract.test.ts";
const UPLOADS = "test/uploads-sniff.test.ts test/uploads.test.ts test/crud-spa-contract.test.ts";

export const blogChecks = [
  // ------------------------------------------------------------------ the sanitiser
  {
    name: "blog: the sanitiser is not part of the pipeline",
    file: "src/blog/render.ts",
    from: ".use(rehypeBlogElements).use(rehypeSanitize).use(rehypeStringify)",
    to: ".use(rehypeBlogElements).use(rehypeStringify)",
    tests: `${SANITIZE} ${API}`,
  },
  {
    // Two layers say no to a foreign scheme (the decoded look and the plain one): both go.
    name: "blog: a link may use any scheme (javascript: is published)",
    edits: [
      { file: "src/blog/sanitize.ts", from: "    if (!LINK_SCHEMES.has(scheme)) return false;\n", to: "" },
      { file: "src/blog/sanitize.ts", from: "  return scheme !== undefined && !LINK_SCHEMES.has(scheme);", to: "  return false;" },
    ],
    tests: SANITIZE,
  },
  {
    name: "blog: a scheme hidden behind percent-escapes or tabs is not looked for",
    file: "src/blog/sanitize.ts",
    from: "  if (decodedStartsWithForeignScheme(value)) return false;\n",
    to: "",
    tests: SANITIZE,
  },
  {
    name: "blog: whitespace and control characters are allowed in a link address",
    file: "src/blog/sanitize.ts",
    from: "  if (hasControlOrSpace(value)) return false;\n  // What a browser",
    to: "  // What a browser",
    tests: SANITIZE,
  },
  {
    name: "blog: an image over plain http is allowed",
    edits: [
      { file: "src/blog/sanitize.ts", from: "  if (/^https:\\/\\//i.test(value)) {", to: "  if (/^https?:\\/\\//i.test(value)) {" },
      { file: "src/blog/sanitize.ts", from: '      return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";', to: '      return url.hostname !== "" && url.username === "" && url.password === "";' },
    ],
    tests: SANITIZE,
  },
  {
    name: "blog: an image of another kind of upload is allowed",
    file: "src/blog/sanitize.ts",
    from: '    return key !== null && kindOfKey(key) === "blog-image";',
    to: "    return key !== null;",
    tests: SANITIZE,
  },
  {
    name: "blog: an attribute that is not on the allow-list is kept (onerror, style)",
    file: "src/blog/sanitize.ts",
    from: "    const verdict = rule ? rule(properties[name], node) : false;",
    to: "    const verdict = rule ? rule(properties[name], node) : true;",
    tests: SANITIZE,
  },
  {
    name: "blog: script and style elements are not dropped with their content",
    file: "src/blog/sanitize.ts",
    from: "  if (DROPPED_WITH_CONTENT.has(tag)) {",
    to: "  if (false) {",
    tests: SANITIZE,
  },
  {
    name: "blog: links no longer get rel=noopener noreferrer",
    file: "src/blog/sanitize.ts",
    from: '    properties.rel = ["noopener", "noreferrer"];',
    to: "",
    tests: SANITIZE,
  },
  {
    name: "blog: a link without a safe address keeps its tag",
    file: "src/blog/sanitize.ts",
    from: "    if (!isSafeLinkHref(href)) {\n      // A link with no safe address is text.\n      stats.removed += 1;\n      return node.children;\n    }",
    to: "",
    tests: SANITIZE,
  },

  // ------------------------------------------------------------------ the render equals the build's
  {
    name: "blog: the render pipeline drops the legacy image rules (no srcset, size or wrapper)",
    file: "src/blog/render.ts",
    from: "        ...(info?.srcset ? { srcset: info.srcset, sizes: INLINE_SIZES } : {}),\n",
    to: "",
    tests: PARITY,
  },
  {
    name: "blog: the table of legacy images builds another ladder",
    file: "src/blog/images.ts",
    from: "const WIDTHS = [480, 768, 1200, 1600];",
    to: "const WIDTHS = [480, 1024, 1600];",
    tests: PARITY,
  },

  // ------------------------------------------------------------------ who may
  {
    name: "blog: creating needs only read access",
    file: "src/api/blog.ts",
    from: 'app.post("/", requireArea("konten", "write"), async (c) => {',
    to: 'app.post("/", requireArea("konten", "read"), async (c) => {',
    tests: API,
  },
  {
    name: "blog: updating needs only read access",
    file: "src/api/blog.ts",
    from: 'app.put("/:id", requireArea("konten", "write"), async (c) => {',
    to: 'app.put("/:id", requireArea("konten", "read"), async (c) => {',
    tests: API,
  },
  {
    name: "blog: publishing needs only read access",
    file: "src/api/blog.ts",
    from: 'app.post("/:id/publish", requireArea("konten", "write"), setStatus("published"));',
    to: 'app.post("/:id/publish", requireArea("konten", "read"), setStatus("published"));',
    tests: API,
  },
  {
    name: "blog: unpublishing needs only read access",
    file: "src/api/blog.ts",
    from: 'app.post("/:id/unpublish", requireArea("konten", "write"), setStatus("draft"));',
    to: 'app.post("/:id/unpublish", requireArea("konten", "read"), setStatus("draft"));',
    tests: API,
  },
  {
    name: "blog: deleting needs only read access",
    file: "src/api/blog.ts",
    from: 'app.delete("/:id", requireArea("konten", "write"), kit.remove);',
    to: 'app.delete("/:id", requireArea("konten", "read"), kit.remove);',
    tests: API,
  },
  {
    name: "blog: the preview needs only read access",
    file: "src/api/blog.ts",
    from: 'app.post("/preview", requireArea("konten", "write"), previewLimit, async (c) => {',
    to: 'app.post("/preview", requireArea("konten", "read"), previewLimit, async (c) => {',
    tests: API,
  },
  {
    name: "blog: the preview has no limiter",
    file: "src/api/blog.ts",
    from: 'app.post("/preview", requireArea("konten", "write"), previewLimit, async (c) => {',
    to: 'app.post("/preview", requireArea("konten", "write"), async (c) => {',
    tests: API,
  },
  {
    name: "blog: the preview limiter counts everybody in one bucket (the key has no user id)",
    file: "src/api/blog.ts",
    from: 'key: `blog-preview:${c.get("user").id}`',
    to: 'key: "blog-preview:all"',
    tests: API,
  },
  {
    name: "blog: the preview limiter lets the request through when it cannot count (fail open)",
    file: "src/api/blog.ts",
    from: "    if (!limit.allowed) return limitedResponse(limit);\n    await next();\n  };\n\n  // Before \"/:id\" verbs",
    to: "    if (!limit.allowed && limit.reason !== \"unavailable\") return limitedResponse(limit);\n    await next();\n  };\n\n  // Before \"/:id\" verbs",
    tests: API,
  },
  {
    name: "blog: the list is answered to anyone (no area guard on reads)",
    file: "src/api/blog.ts",
    from: 'app.get("/", requireArea("konten", "read"), async (c) => {',
    to: 'app.get("/", async (c) => {',
    tests: API,
  },
  {
    name: "blog: the one-article read ignores the area",
    file: "src/api/blog.ts",
    from: 'app.get("/:id", requireArea("konten", "read"), kit.get);',
    to: 'app.get("/:id", kit.get);',
    tests: API,
  },
  {
    name: "blog: the routes are not mounted",
    file: "src/worker.ts",
    from: 'app.route("/api/admin/blog", blogRoutes);\n',
    to: "",
    tests: API,
  },

  // ------------------------------------------------------------------ concurrency
  {
    name: "blog: the stale check of an update is removed (the last save silently wins)",
    file: "src/api/blog.ts",
    from: "    if (!matches(precondition, before.updatedAt)) return stale(c);\n\n    // Rules that need the stored row",
    to: "\n    // Rules that need the stored row",
    tests: API,
  },
  {
    name: "blog: the stale check of publish and unpublish is removed",
    file: "src/api/blog.ts",
    from: "    if (!matches(precondition, before.updatedAt)) return stale(c);\n    if (before.status === to) {",
    to: "    if (before.status === to) {",
    tests: API,
  },
  {
    name: "blog: the version is not part of the UPDATE of a save (two saves of one version can both win)",
    file: "src/api/blog.ts",
    from: "          .set({ ...values, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })\n          .where(and(eq(schema.blogPosts.id, id), eq(schema.blogPosts.updatedAt, before.updatedAt)))",
    to: "          .set({ ...values, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })\n          .where(eq(schema.blogPosts.id, id))",
    tests: API,
  },
  {
    name: "blog: If-Match is no longer required on an update",
    file: "src/api/blog.ts",
    from: "    if (!precondition.present) return preconditionRequired(c);\n    const body = await parseBody(c, blogUpdateInput",
    to: "    const body = await parseBody(c, blogUpdateInput",
    tests: API,
  },

  // ------------------------------------------------------------------ the draft and publish rules
  {
    name: "blog: publishing does not date an undated draft",
    file: "src/api/blog.ts",
    from: '    const publishedAt = to === "published" ? (before.publishedAt ?? new Date()) : before.publishedAt;',
    to: "    const publishedAt = before.publishedAt;",
    tests: API,
  },
  {
    name: "blog: unpublishing leaves the article published",
    file: "src/api/blog.ts",
    from: "          .set({ status: to, publishedAt, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })",
    to: '          .set({ status: "published", publishedAt, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })',
    tests: API,
  },
  {
    name: "blog: a new article is published at once",
    file: "src/api/blog.ts",
    from: '      status: "draft" as BlogStatus,',
    to: '      status: "published" as BlogStatus,',
    tests: API,
  },
  {
    name: "blog: the slug of a published article can be changed",
    file: "src/api/blog.ts",
    from: '    if (form.slug !== null && form.slug !== before.slug && before.status === "published") problems.slug = SLUG_LOCKED;\n',
    to: "",
    tests: API,
  },
  {
    name: "blog: a published article can lose its date",
    file: "src/api/blog.ts",
    from: '    if (before.status === "published" && form.date === null) problems.date = DATE_REQUIRED;\n',
    to: "",
    tests: API,
  },
  {
    name: "blog: a slug taken when creating is a 500, not a 409 on the slug",
    file: "src/api/blog.ts",
    from: '      if (isUniqueViolation(error, "blog_posts.slug")) return conflict(c, { slug: "Slug sudah dipakai" });\n      throw error;\n    }\n    if (!created)',
    to: "      throw error;\n    }\n    if (!created)",
    tests: API,
  },
  {
    name: "blog: a slug taken when saving is a 500, not a 409 on the slug",
    file: "src/api/blog.ts",
    from: '      if (isUniqueViolation(error, "blog_posts.slug")) return conflict(c, { slug: "Slug sudah dipakai" });\n      throw error;\n    }\n    if (!updated)',
    to: "      throw error;\n    }\n    if (!updated)",
    tests: API,
  },
  {
    name: "blog: the generated slug is not numbered when taken",
    file: "src/blog/rules.ts",
    from: "  if (!taken.has(base)) return base;\n",
    to: "  return base;\n",
    tests: API,
  },
  {
    name: "blog: the generated slug can end with a hyphen",
    file: "src/blog/rules.ts",
    from: '    .slice(0, GENERATED_SLUG_MAX)\n    .replace(/-+$/g, "");',
    to: "    .slice(0, GENERATED_SLUG_MAX);",
    tests: API,
  },

  // ------------------------------------------------------------------ what is stored
  {
    name: "blog: the markdown is stored as the HTML (nothing is rendered at save)",
    file: "src/api/blog.ts",
    from: "renderArticle(markdown, { images: imageLookup(sizes) }).html;\n  return { ok: true",
    to: "markdown;\n  return { ok: true",
    tests: API,
  },
  {
    name: "blog: the stored HTML is reused even when the text changed",
    file: "src/api/blog.ts",
    from: "const html = before && before.contentMarkdown === markdown ? before.contentHtml :",
    to: "const html = before ? before.contentHtml :",
    tests: API,
  },
  {
    name: "blog: the stored HTML is never reused (every save renders)",
    file: "src/api/blog.ts",
    from: "const html = before && before.contentMarkdown === markdown ? before.contentHtml :",
    to: "const html = false ? before!.contentHtml :",
    tests: API,
  },
  {
    name: "blog: the hero's size is taken from the client's idea of it, not from `media`",
    file: "src/api/blog.ts",
    from: "      imageWidth = size.width;",
    to: "      imageWidth = 1;",
    tests: API,
  },
  {
    name: "blog: an upload with no `media` row is accepted as the hero",
    file: "src/api/blog.ts",
    from: "      if (!size) return { ok: false, fields: { image: IMAGE_INVALID } };\n",
    to: "",
    tests: API,
  },
  {
    name: "blog: the list reads the long columns of every row",
    file: "src/api/blog.ts",
    from: "  publishedAt: schema.blogPosts.publishedAt,\n  createdAt: schema.blogPosts.createdAt,\n  updatedAt: schema.blogPosts.updatedAt,\n} as const;",
    to: "  publishedAt: schema.blogPosts.publishedAt,\n  createdAt: schema.blogPosts.createdAt,\n  updatedAt: schema.blogPosts.updatedAt,\n  contentHtml: schema.blogPosts.contentHtml,\n} as const;",
    tests: API,
  },
  {
    name: "blog: the audit row of a create carries the markdown as its label",
    file: "src/api/blog.ts",
    from: 'key !== "createdBy" && key !== "updatedBy"), label: values.title },',
    to: 'key !== "createdBy" && key !== "updatedBy"), label: values.contentMarkdown },',
    tests: API,
  },
  {
    name: "blog: the body is not limited to what rendering can afford",
    file: "src/blog/rules.ts",
    from: "export const BODY_MAX = 12_000;",
    to: "export const BODY_MAX = 80_000;",
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog: the SPA's limit of the body differs from the Worker's",
    file: "spa/src/pages/blog/rules.ts",
    from: "  bodyMax: 12_000,",
    to: "  bodyMax: 13_000,",
    tests: CONTRACT,
  },

  // ------------------------------------------------------------------ the public site and the uploads
  {
    name: "blog: a change of a published article does not tell the public side",
    file: "src/api/blog.ts",
    from: "    for (const change of publicChanges(before, after)) deps.notify(change, waitUntil);\n",
    to: "",
    tests: API,
  },
  {
    name: "blog: a draft's own edits purge the public caches",
    file: "src/api/blog.ts",
    from: '  for (const row of rows) if (row && row.status === "published") slugs.add(row.slug);',
    to: "  for (const row of rows) if (row) slugs.add(row.slug);",
    tests: API,
  },
  {
    name: "blog: a replaced upload is not removed after the save",
    file: "src/api/blog.ts",
    from: "      const removed = uploadsOf(before).filter((path) => !kept.has(path));",
    to: "      const removed: string[] = [];",
    tests: API,
  },
  {
    name: "blog: uploadsOf forgets the images inside the text",
    file: "src/api/blog.ts",
    from: "  return [...new Set([...(row.image ? [row.image] : []), ...uploadPathsIn(row.contentMarkdown)])];",
    to: "  return [...new Set(row.image ? [row.image] : [])];",
    tests: API,
  },
  {
    name: "blog: GIF is no longer a blog image",
    file: "src/uploads/kinds.ts",
    from: '"blog-image": { area: "konten", purpose: "blog", maxBytes: 5_000_000, types: BLOG_IMAGES },',
    to: '"blog-image": { area: "konten", purpose: "blog", maxBytes: 5_000_000, types: IMAGES },',
    tests: UPLOADS,
  },
  {
    name: "blog: GIF is taken for the team photo too",
    file: "src/uploads/kinds.ts",
    from: '"team-photo": { area: "konten", purpose: "team", maxBytes: 5_000_000, types: IMAGES },',
    to: '"team-photo": { area: "konten", purpose: "team", maxBytes: 5_000_000, types: BLOG_IMAGES },',
    tests: UPLOADS,
  },
  {
    name: "blog: a GIF's size is read from the wrong bytes",
    file: "src/uploads/sniff.ts",
    from: "  return { width: u16le(b, 6), height: u16le(b, 8) };",
    to: "  return { width: u16le(b, 8), height: u16le(b, 6) };",
    tests: UPLOADS,
  },
  {
    name: "blog: the magic bytes of GIF are not checked (any GIF8 text is a GIF)",
    file: "src/uploads/sniff.ts",
    from: '(ascii(b, 3, 3) === "87a" || ascii(b, 3, 3) === "89a")',
    to: "true",
    tests: UPLOADS,
  },

  // ------------------------------------------------------------------ the import
  {
    name: "blog: the import overwrites an article an editor changed in the admin",
    file: "scripts/import-legacy-blog.ts",
    from: " WHERE blog_posts.updated_by IS NULL AND blog_posts.wp_id IS excluded.wp_id;",
    to: ";",
    tests: IMPORT,
  },
  {
    name: "blog: the import writes articles as drafts",
    file: "scripts/import-legacy-blog.ts",
    from: "      \"'published'\",",
    to: "      \"'draft'\",",
    tests: IMPORT,
  },
  {
    name: "blog: the import writes a newline as a real newline (the statement no longer fits on one line)",
    file: "scripts/import-legacy-blog.ts",
    from: '    text = text.replaceAll("\\n", marker);\n    wrap.push(`, \'${marker}\', char(10))`);',
    to: "",
    tests: IMPORT,
  },
  {
    name: "blog: the import orders same-day articles the other way round",
    file: "scripts/import-legacy-blog.ts",
    from: "a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0",
    to: "a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0",
    tests: IMPORT,
  },
  {
    name: "blog: the import takes the cover size from nowhere",
    file: "scripts/import-legacy-blog.ts",
    from: "      imageWidth: entry?.width ?? null,\n      imageHeight: entry?.height ?? null,",
    to: "      imageWidth: null,\n      imageHeight: null,",
    tests: IMPORT,
  },

  // ------------------------------------------------------------------ the excerpt that is already there
  {
    name: "blog: an excerpt the article already has must be lengthened to be saved (the minimum ignores what is stored)",
    file: "src/api/blog.ts",
    from: "if (form.excerpt.length < EXCERPT_MIN && form.excerpt !== before.excerpt.trim()) problems.excerpt = EXCERPT_TOO_SHORT;",
    to: "if (form.excerpt.length < EXCERPT_MIN) problems.excerpt = EXCERPT_TOO_SHORT;",
    tests: `${API} ${IMPORT} ${CONTRACT}`,
  },
  {
    name: "blog: a changed excerpt may be as short as it likes on an update",
    file: "src/api/blog.ts",
    from: "if (form.excerpt.length < EXCERPT_MIN && form.excerpt !== before.excerpt.trim()) problems.excerpt = EXCERPT_TOO_SHORT;\n",
    to: "",
    tests: `${API} ${IMPORT} ${CONTRACT}`,
  },
  {
    name: "blog: a new article gets the exception too (any excerpt will do on create)",
    file: "src/api/blog.ts",
    from: "const blogInput = z.object({ ...blogFields, excerpt: excerptField.min(EXCERPT_MIN, EXCERPT_TOO_SHORT) });",
    to: "const blogInput = z.object({ ...blogFields, excerpt: excerptField.min(1, EXCERPT_TOO_SHORT) });",
    tests: API,
  },

  // ------------------------------------------------------------------ the address of the public site
  {
    name: "blog: the Worker serves the site's address as it is set (no origin check: a quote or javascript: reaches the page)",
    file: "src/worker.ts",
    from: "siteUrl: publicOrigin(c.env.SITE_URL),",
    to: 'siteUrl: (c.env.SITE_URL ?? "").trim(),',
    tests: "test/crud-spa-contract.test.ts",
  },
  {
    name: "blog: the Worker serves the site's address from the files' variable",
    file: "src/worker.ts",
    from: "siteUrl: publicOrigin(c.env.SITE_URL),",
    to: "siteUrl: publicOrigin(c.env.UPLOADS_BASE_URL),",
    tests: "test/crud-spa-contract.test.ts",
  },
];
