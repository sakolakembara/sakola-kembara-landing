// The negative checks of the blog's meta description (SAKEM-094), in their own file so the shared lists in
// negative-checks.mjs and negative-checks-spa.mjs stay short: each imports this once and spreads `blogMetaChecks`
// (the Worker's) or `blogMetaSpaChecks` (the SPA's). Same rules as there: each check breaks ONE safeguard in the source,
// runs the tests that must notice, expects them to FAIL, and the runner restores the file. The Worker runner reports a
// pattern found other than exactly once as FAIL, so a refactor cannot turn a check into a no-op; the SPA runner only
// reports a pattern it cannot find, so the patterns below are written to occur once.
//
// This file is not a runner. Run them with:
//   node scripts/negative-checks.mjs --only "blog meta"        (the Worker's)
//   node scripts/negative-checks-spa.mjs --only "blog meta"    (the SPA's)

const API = "test/blog.test.ts";
const CONTRACT = "test/blog-spa-contract.test.ts";
const IMPORT = "test/blog-import.test.ts";

const RULES = "src/blog/rules.ts";
const ROUTES = "src/api/blog.ts";
const SPA_RULES = "spa/src/pages/blog/rules.ts";

export const blogMetaChecks = [
  // ------------------------------------------------------------------ plain text, cleaned
  {
    name: "blog meta: markup is accepted (the plain-text rule is gone)",
    file: ROUTES,
    from: "\n  .refine((value) => !value || !hasMarkup(value), { message: META_DESCRIPTION_MARKUP });",
    to: ";",
    tests: API,
  },
  {
    name: "blog meta: only a complete tag counts as markup (`a<b` is accepted)",
    file: RULES,
    from: "const MARKUP_START = /<[A-Za-z/!?]/;",
    to: "const MARKUP_START = /<[A-Za-z/!?][^>]*>/;",
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog meta: control and format characters are kept",
    file: RULES,
    from: ".replace(/[\\p{Cc}\\p{Cf}\\p{Cs}]/gu, (char)",
    to: ".replace(/[\\p{Cs}]/gu, (char)",
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog meta: whitespace is not collapsed to one space",
    file: RULES,
    from: '    .replace(/\\s+/g, " ")\n    .trim();',
    to: "    .trim();",
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog meta: the text is not trimmed",
    file: RULES,
    from: '    .replace(/\\s+/g, " ")\n    .trim();',
    to: '    .replace(/\\s+/g, " ");',
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog meta: an empty text is stored as an empty string, not NULL",
    file: ROUTES,
    from: "cleanMetaDescription(value) || null))",
    to: "cleanMetaDescription(value)))",
    tests: API,
  },
  {
    name: "blog meta: a raw text of any size is cleaned (the guard before the cleaning is gone)",
    file: ROUTES,
    from: "  .max(META_DESCRIPTION_RAW_MAX, META_DESCRIPTION_TOO_LONG)\n",
    to: "",
    tests: API,
  },

  // ------------------------------------------------------------------ the length
  {
    name: "blog meta: the hard maximum is raised (the form's number and the Worker's differ)",
    file: RULES,
    from: "export const META_DESCRIPTION_MAX = 300;",
    to: "export const META_DESCRIPTION_MAX = 500;",
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog meta: a new article may carry a description of any length",
    file: ROUTES,
    from: 'const blogCreateInput = blogInput.refine((form) => !form.metaDescription || form.metaDescription.length <= META_DESCRIPTION_MAX, { path: ["metaDescription"], message: META_DESCRIPTION_TOO_LONG });',
    to: "const blogCreateInput = blogInput;",
    tests: API,
  },
  {
    name: "blog meta: a changed description may be of any length on an update",
    file: ROUTES,
    from: "    if (form.metaDescription && form.metaDescription.length > META_DESCRIPTION_MAX && form.metaDescription !== before.metaDescription) problems.metaDescription = META_DESCRIPTION_TOO_LONG;\n",
    to: "",
    tests: API,
  },
  {
    name: "blog meta: the description an article already has must fit like a new one (the 28 migrated ones over 300 cannot be saved)",
    file: ROUTES,
    from: " && form.metaDescription !== before.metaDescription) problems.metaDescription",
    to: ") problems.metaDescription",
    tests: `${API} ${IMPORT} ${CONTRACT}`,
  },

  // ------------------------------------------------------------------ what is stored and what is read
  {
    name: "blog meta: a create ignores the description",
    file: ROUTES,
    from: "      metaDescription: form.metaDescription ?? null,\n",
    to: "",
    tests: API,
  },
  {
    name: "blog meta: an update does not write the description",
    file: ROUTES,
    from: "      metaDescription: form.metaDescription === undefined ? before.metaDescription || null : form.metaDescription,\n",
    to: "",
    tests: API,
  },
  {
    name: "blog meta: an update that leaves the key out clears the stored description (a tab of the SPA from before the field wipes it)",
    file: ROUTES,
    from: "form.metaDescription === undefined ? before.metaDescription || null : form.metaDescription,",
    to: "form.metaDescription ?? null,",
    tests: `${API} ${IMPORT}`,
  },
  {
    name: "blog meta: the admin read does not carry the description",
    file: ROUTES,
    from: "    // As the public answer reads it: an empty string is none.\n    metaDescription: row.metaDescription || null,\n",
    to: "",
    tests: `${API} ${IMPORT} ${CONTRACT}`,
  },
  {
    name: "blog meta: an empty string in the column is shown to the form as it is",
    file: ROUTES,
    from: "    metaDescription: row.metaDescription || null,",
    to: "    metaDescription: row.metaDescription,",
    tests: API,
  },
  {
    name: "blog meta: saving none over an empty string in the column counts as a change",
    file: ROUTES,
    from: "changedFields({ ...before, metaDescription: before.metaDescription || null }, values)",
    to: "changedFields(before, values)",
    tests: API,
  },

  // ------------------------------------------------------------------ audit, publish, the public side
  {
    name: "blog meta: the audit row of an update carries the description as its label (content in the log)",
    file: ROUTES,
    from: '{ action: "blog.update", resourceType: "blog", resourceId: id, fields, label: values.title }',
    to: '{ action: "blog.update", resourceType: "blog", resourceId: id, fields, label: values.metaDescription ?? values.title }',
    tests: API,
  },
  {
    name: "blog meta: publishing an article clears its description",
    file: ROUTES,
    from: "          .set({ status: to, publishedAt, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })",
    to: "          .set({ status: to, publishedAt, metaDescription: null, updatedBy: user.id, updatedAt: nextVersion(before.updatedAt) })",
    tests: API,
  },

  // ------------------------------------------------------------------ the form's copy agrees with the Worker's
  {
    name: "blog meta: the form's maximum of the description differs from the Worker's",
    file: SPA_RULES,
    from: "  metaDescriptionMax: 300,",
    to: "  metaDescriptionMax: 350,",
    tests: CONTRACT,
  },
  {
    name: "blog meta: the form's guidance for the description differs from the Worker's constant",
    file: SPA_RULES,
    from: "export const META_DESCRIPTION_IDEAL = { min: 50, max: 160 } as const;",
    to: "export const META_DESCRIPTION_IDEAL = { min: 50, max: 155 } as const;",
    tests: CONTRACT,
  },
  {
    name: "blog meta: the form's cleaning of the description does not collapse whitespace like the Worker's",
    file: SPA_RULES,
    from: '    .replace(/\\s+/g, " ")\n    .trim();',
    to: "    .trim();",
    tests: CONTRACT,
  },
  {
    name: "blog meta: the form's cleaning keeps the invisible characters the Worker removes",
    file: SPA_RULES,
    from: ".replace(/[\\p{Cc}\\p{Cf}\\p{Cs}]/gu, (char)",
    to: ".replace(/[\\p{Cc}\\p{Cs}]/gu, (char)",
    tests: CONTRACT,
  },
];

// ------------------------------------------------------------------------------------------------- the SPA

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");
const BLOG = t("blog.test.tsx");
const MOCK = t("blog-mock.test.ts");

const FORM = "spa/src/pages/blog/BlogFormPage.tsx";
const MODEL = "spa/src/pages/blog/form.ts";
const FIELD = "spa/src/pages/blog/MetaDescriptionField.tsx";
const MOCK_SOURCE = "spa/src/mock/resources/blog.ts";

export const blogMetaSpaChecks = [
  // ------------------------------------------------------------------ what the form sends
  {
    name: "blog meta: the form does not send the description",
    file: MODEL,
    from: '    metaDescription: values.metaDescription === "" ? null : values.metaDescription,\n',
    to: "",
    tests: BLOG,
  },
  {
    name: "blog meta: an emptied field is sent as an empty text instead of null",
    file: MODEL,
    from: 'metaDescription: values.metaDescription === "" ? null : values.metaDescription,',
    to: "metaDescription: values.metaDescription,",
    tests: BLOG,
  },
  {
    name: "blog meta: the form does not load the description the article has",
    file: MODEL,
    from: '    metaDescription: item?.metaDescription ?? "",',
    to: '    metaDescription: "",',
    tests: BLOG,
  },
  {
    name: "blog meta: the field is not on the form",
    file: FORM,
    from: '          <MetaDescriptionField field={form.field("metaDescription")} error={fields.metaDescription} stored={item?.metaDescription ?? ""} />\n',
    to: "",
    tests: BLOG,
  },
  {
    name: "blog meta: the Worker's refusal of the description is not shown under the field",
    file: FORM,
    from: 'error={fields.metaDescription} stored=',
    to: "stored=",
    tests: BLOG,
  },

  // ------------------------------------------------------------------ the counter
  {
    name: "blog meta: the counter counts the typed text, not the text the Worker will store",
    file: FIELD,
    from: "  const cleaned = cleanMetaDescription(field.value);",
    to: "  const cleaned = field.value;",
    tests: BLOG,
  },
  {
    name: "blog meta: a description the article already has over the maximum is shown as an error",
    file: FIELD,
    from: "describeCount(cleaned.length, cleaned === stored)",
    to: "describeCount(cleaned.length, false)",
    tests: BLOG,
  },
  {
    name: "blog meta: a text over the maximum is only a warning (nothing says the Worker will refuse it)",
    file: FIELD,
    from: "  if (length > LIMITS.metaDescriptionMax && !kept) return",
    to: "  if (length > LIMITS.metaDescriptionMax * 1000 && !kept) return",
    tests: BLOG,
  },
  {
    name: "blog meta: the counter says nothing in words about a text a search result would cut (colour only)",
    file: FIELD,
    from: "`${guide}. Bagian akhir bisa terpotong di hasil pencarian.`",
    to: "guide",
    tests: BLOG,
  },
  {
    name: "blog meta: the counter is announced at every keystroke (a live region)",
    file: FIELD,
    from: '<div id={countId} className={cn("mt-1.5 text-xs", TONE_CLASS[tone])}>',
    to: '<div id={countId} aria-live="polite" className={cn("mt-1.5 text-xs", TONE_CLASS[tone])}>',
    tests: BLOG,
  },
  {
    name: "blog meta: the counter is not part of what describes the field (a screen reader never hears it)",
    file: FIELD,
    from: '  const describedBy = `${field.id}-${error ? "error" : "hint"} ${countId}`;',
    to: '  const describedBy = `${field.id}-${error ? "error" : "hint"}`;',
    tests: BLOG,
  },
  {
    name: "blog meta: the description is a required field",
    file: FIELD,
    from: "<Textarea rows={3} {...field} aria-describedby={describedBy} />",
    to: "<Textarea required rows={3} {...field} aria-describedby={describedBy} />",
    tests: BLOG,
  },
  {
    name: "blog meta: the error summary has no name for the description field",
    file: MODEL,
    from: '  metaDescription: "Deskripsi meta",\n',
    to: "",
    tests: BLOG,
  },

  // ------------------------------------------------------------------ the mock behaves like the Worker
  {
    name: "blog meta: the mock accepts markup in the description",
    file: MOCK_SOURCE,
    from: "  if (hasMarkup(cleaned)) fields.metaDescription = META_DESCRIPTION_MARKUP;\n",
    to: "",
    tests: MOCK,
  },
  {
    name: "blog meta: the mock does not clean the description",
    file: MOCK_SOURCE,
    from: "  const cleaned = cleanMetaDescription(raw);",
    to: "  const cleaned = raw;",
    tests: MOCK,
  },
  {
    name: "blog meta: the mock clears the description when an update leaves the key out",
    file: MOCK_SOURCE,
    from: "metaDescription: parsed.values.metaDescription === undefined ? row.metaDescription || null : parsed.values.metaDescription,",
    to: "metaDescription: parsed.values.metaDescription ?? null,",
    tests: MOCK,
  },
  {
    name: "blog meta: the mock holds a description it already has to the maximum",
    file: MOCK_SOURCE,
    from: " && metaDescription !== stored?.metaDescription) fields.metaDescription",
    to: ") fields.metaDescription",
    tests: MOCK,
  },
  {
    name: "blog meta: the mock lets a description of any length through on a create",
    file: MOCK_SOURCE,
    from: "metaDescription.length > LIMITS.metaDescriptionMax &&",
    to: "metaDescription.length > LIMITS.metaDescriptionMax * 100 &&",
    tests: MOCK,
  },
  {
    name: "blog meta: the mock reads any text before the guard against a huge one",
    file: MOCK_SOURCE,
    from: "  if (raw.length > META_DESCRIPTION_RAW_MAX) {",
    to: "  if (raw.length > META_DESCRIPTION_RAW_MAX * 100) {",
    tests: MOCK,
  },
];
