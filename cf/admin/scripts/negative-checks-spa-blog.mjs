// The SPA side of the blog's negative checks (SAKEM-082), in their own file so the shared list in
// negative-checks-spa.mjs stays short: it imports and spreads `blogSpaChecks`. Same rules as there: each check
// breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner
// restores the file. (`from` and `to` may be lists, for a safeguard with more than one layer.)
//
//   node scripts/negative-checks-spa.mjs      (pnpm test:negative:spa)

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");
const BLOG = t("blog.test.tsx");
const PREVIEW = t("blog-preview.test.ts", "blog.test.tsx");
const MOCK = t("blog-mock.test.ts");

const FORM = "spa/src/pages/blog/BlogFormPage.tsx";
const EDITOR = "spa/src/pages/blog/BodyEditor.tsx";
const HOOK = "spa/src/pages/blog/usePreview.ts";

export const blogSpaChecks = [
  // ------------------------------------------------------------------ who is offered what
  {
    name: "blog: a read-only role is offered 'Terbitkan' and 'Kembalikan ke Draf'",
    file: FORM,
    from: "{canWrite && item && !published && (",
    to: "{item && !published && (",
    tests: BLOG,
  },
  {
    name: "blog: a read-only role gets tabs (inside a disabled fieldset, where they cannot be pressed)",
    file: FORM,
    from: "  const tabbed = canWrite;",
    to: "  const tabbed = true;",
    tests: BLOG,
  },
  {
    name: "blog: a read-only role is offered the preview and the image button",
    file: EDITOR,
    from: "        {!readOnly && (\n          <div className=\"ml-auto flex items-center gap-1\">",
    to: "        {(\n          <div className=\"ml-auto flex items-center gap-1\">",
    tests: BLOG,
  },
  {
    name: "blog: the list is guarded by another area (an editor of Konten is refused, one of Komunikasi gets in)",
    file: "spa/src/pages/blog/BlogPage.tsx",
    from: '      area="konten"',
    to: '      area="komunikasi"',
    tests: BLOG,
  },

  // ------------------------------------------------------------------ saving and publishing
  {
    name: "blog: a save is sent without If-Match",
    file: FORM,
    from: '{ method: "PUT", json: toBody(values), ifMatch: ifMatch(item.updatedAt) }',
    to: '{ method: "PUT", json: toBody(values) }',
    tests: BLOG,
  },
  {
    name: "blog: 'Terbitkan' with edits publishes without saving them first",
    file: FORM,
    from: '    if (action === "save" || form.dirty) {',
    to: '    if (action === "save") {',
    tests: BLOG,
  },
  {
    name: "blog: 'Terbitkan' after a save sends the version that was loaded, not the one the save answered",
    file: FORM,
    from: '{ method: "POST", ifMatch: ifMatch(current.updatedAt) }',
    to: '{ method: "POST", ifMatch: ifMatch(item.updatedAt) }',
    tests: BLOG,
  },
  {
    name: "blog: 'Terbitkan' publishes even when the save before it was refused",
    file: FORM,
    from: '      if (!saved.ok || action === "save") return saved;',
    to: '      if (action === "save") return saved;',
    tests: BLOG,
  },
  {
    name: "blog: the unsaved-changes guard does not see a typed article",
    file: FORM,
    from: "      dirty={form.dirty}",
    to: "      dirty={false}",
    tests: BLOG,
  },
  {
    name: "blog: the slug of a published article can be edited in the form",
    file: FORM,
    from: " disabled={slugLocked}",
    to: "",
    tests: BLOG,
  },
  {
    name: "blog: the date of a published article is not required in the form",
    file: FORM,
    from: '<Input type="date" required={published} {...form.field("date")} />',
    to: '<Input type="date" {...form.field("date")} />',
    tests: BLOG,
  },

  // ------------------------------------------------------------------ errors reach the person
  {
    name: "blog: a refused save does not open the tab that holds the first error",
    file: FORM,
    from: '    setTab(wanted);\n    if (first === "contentMarkdown") setBodyMode("edit");\n  }, [save.failures]',
    to: '    if (first === "contentMarkdown") setBodyMode("edit");\n  }, [save.failures]',
    tests: BLOG,
  },
  {
    name: "blog: a link of the error summary does not show the tab of its field first",
    file: FORM,
    from: '    document.addEventListener("click", reveal, true);',
    to: "",
    tests: BLOG,
  },

  // ------------------------------------------------------------------ the preview
  {
    name: "blog: the preview asks while it is not on screen",
    file: HOOK,
    from: "    if (!active) {\n      wasActive.current = false;",
    to: "    if (false) {\n      wasActive.current = false;",
    tests: PREVIEW,
  },
  {
    name: "blog: the preview asks on every keystroke (no debounce)",
    file: HOOK,
    from: "      first ? 0 : PREVIEW_DELAY_MS,",
    to: "      0,",
    tests: PREVIEW,
  },
  {
    name: "blog: the preview lets the request in flight finish when the text changes",
    file: HOOK,
    from: "      clearTimeout(timer);\n      controller.abort();",
    to: "      clearTimeout(timer);",
    tests: PREVIEW,
  },
  {
    name: "blog: the preview forgets its last answer",
    file: HOOK,
    from: "    if (remembered.current?.markdown === markdown) {",
    to: "    if (false) {",
    tests: PREVIEW,
  },
  {
    name: "blog: the preview of a text above the limit is asked of the Worker anyway",
    file: HOOK,
    from: "    if (text.length > LIMITS.bodyMax) {",
    to: "    if (false) {",
    tests: PREVIEW,
  },
  {
    name: "blog: pictures of uploads are shown from this host in the preview",
    file: EDITOR,
    from: '      image.setAttribute("src", uploadUrl(image.getAttribute("src") ?? "", base));',
    to: "",
    tests: BLOG,
  },

  // ------------------------------------------------------------------ inserting an image
  {
    name: "blog: an inserted image goes to the end of the text instead of the cursor",
    file: "spa/src/pages/blog/editor/RichEditor.tsx",
    from: "if (position === undefined) editor.chain().focus().insertContent(picture).run();",
    to: 'if (position === undefined) editor.chain().focus("end").insertContent(picture).run();',
    tests: BLOG,
  },
  {
    name: "blog: a file the kind does not take is sent to the Worker without a check",
    file: "spa/src/pages/blog/editor/images.ts",
    from: '  const problem = checkUploadFile(file, "blog-image");',
    to: "  const problem: string | null = null;",
    tests: BLOG,
  },

  // ------------------------------------------------------------------ the mock behaves like the Worker
  {
    // The store's own gate runs before `custom`, so the blog's verbs (publish, preview, save) rely on it.
    name: "blog: the mock lets a read-only role publish and write",
    file: "spa/src/mock/resources.ts",
    from: 'if (access === "none" || (writes && access !== "write")) return error(403, "forbidden");',
    to: 'if (access === "none") return error(403, "forbidden");',
    tests: MOCK,
  },
  {
    name: "blog: the mock saves over a stale version",
    file: "spa/src/mock/resources/blog.ts",
    from: '    if (!row) return mockError(404, "not_found", NOT_FOUND);\n    if (precondition !== ifMatch(row.updatedAt)) return mockError(409, "stale", STALE);\n    const problems',
    to: '    if (!row) return mockError(404, "not_found", NOT_FOUND);\n    const problems',
    tests: MOCK,
  },
  {
    name: "blog: the mock lets a published article change its slug",
    file: "spa/src/mock/resources/blog.ts",
    from: '    if (parsed.values.slug && parsed.values.slug !== row.slug && row.status === "published") problems.slug = "Slug tidak bisa diubah setelah artikel terbit";\n',
    to: "",
    tests: MOCK,
  },
  {
    name: "blog: the mock asks a stored excerpt under the minimum to be lengthened",
    file: "spa/src/mock/resources/blog.ts",
    from: "if (parsed.values.excerpt!.length < LIMITS.excerptMin && parsed.values.excerpt !== row.excerpt.trim()) problems.excerpt",
    to: "if (parsed.values.excerpt!.length < LIMITS.excerptMin) problems.excerpt",
    tests: MOCK,
  },

  // ------------------------------------------------------------------ "Lihat di publik"
  {
    name: "blog: a draft is linked to the public site (where it does not exist)",
    file: FORM,
    from: "{published ? (\n        siteUrl !== \"\" && (",
    to: "{true ? (\n        siteUrl !== \"\" && (",
    tests: BLOG,
  },
  {
    name: "blog: the link to the public site is drawn without an address (a relative link into the admin)",
    file: FORM,
    from: 'siteUrl !== "" && (\n          <a href={address}',
    to: 'true && (\n          <a href={address}',
    tests: BLOG,
  },
  {
    name: "blog: the link to the public site opens in the editor's own tab, with the opener",
    file: FORM,
    from: 'target="_blank" rel="noopener noreferrer" className="text-primary hover:underline"',
    to: 'className="text-primary hover:underline"',
    tests: BLOG,
  },
  {
    name: "blog: the SPA puts the site's address into a link as the Worker sent it (not an origin: javascript:)",
    file: "spa/src/lib/config.ts",
    from: "siteUrl: normaliseBase(body.siteUrl) };",
    to: 'siteUrl: typeof body.siteUrl === "string" ? body.siteUrl : "" };',
    tests: BLOG,
  },
  {
    name: "blog: the link to the public site is built from the files' address",
    file: "spa/src/lib/config.ts",
    from: "siteUrl: normaliseBase(body.siteUrl) };",
    to: "siteUrl: normaliseBase(body.uploadsBaseUrl) };",
    tests: BLOG,
  },
];
