// The negative checks of the blog's SEO title and noindex (SAKEM-109), in their own file like the meta description's
// (negative-checks-blog-meta.mjs): negative-checks.mjs spreads `blogSeoChecks` (the Worker's) and negative-checks-spa.mjs
// `blogSeoSpaChecks` (the SPA's). Each check breaks ONE safeguard in the source, runs the tests that must notice, expects
// them to FAIL, and the runner restores the file; a pattern found other than exactly once is a FAIL.
//
// This file is not a runner. Run them with:
//   node scripts/negative-checks.mjs --only "blog seo"        (the Worker's)
//   node scripts/negative-checks-spa.mjs --only "blog seo"    (the SPA's)

const API = "test/blog.test.ts";
const LEAK = "test/public-leak.test.ts";
const CONTRACT = "test/blog-spa-contract.test.ts";

const RULES = "src/blog/rules.ts";
const ROUTES = "src/api/blog.ts";
const SERIALIZERS = "src/public/serializers.ts";
const QUERIES = "src/public/queries.ts";

export const blogSeoChecks = [
  // ------------------------------------------------------------------ the SEO title
  {
    name: "blog seo: markup is accepted in the SEO title",
    file: ROUTES,
    from: "\n  .refine((value) => !value || !hasMarkup(value), { message: SEO_TITLE_MARKUP })",
    to: "",
    tests: API,
  },
  {
    name: "blog seo: the SEO title's maximum is not enforced",
    file: ROUTES,
    from: "\n  .refine((value) => !value || value.length <= SEO_TITLE_MAX, { message: SEO_TITLE_TOO_LONG });",
    to: ";",
    tests: API,
  },
  {
    name: "blog seo: the SEO title's maximum is raised (the form's number and the Worker's differ)",
    file: RULES,
    from: "export const SEO_TITLE_MAX = 70;",
    to: "export const SEO_TITLE_MAX = 80;",
    tests: `${API} ${CONTRACT}`,
  },
  {
    name: "blog seo: an empty SEO title is stored as an empty string, not NULL",
    file: ROUTES,
    from: "cleanSeoTitle(value) || null))",
    to: "cleanSeoTitle(value)))",
    tests: API,
  },
  {
    name: "blog seo: an update without the key clears the SEO title",
    file: ROUTES,
    from: "seoTitle: form.seoTitle === undefined ? before.seoTitle || null : form.seoTitle,",
    to: "seoTitle: form.seoTitle ?? null,",
    tests: API,
  },
  {
    name: "blog seo: the admin read leaves the SEO title out",
    file: ROUTES,
    from: "    seoTitle: row.seoTitle || null,\n",
    to: "",
    tests: API,
  },

  // ------------------------------------------------------------------ noindex
  {
    name: "blog seo: noindex takes anything truthy (a string, a number)",
    file: ROUTES,
    from: 'noindex: z.boolean({ error: "Isian belum benar." }).optional(),',
    to: "noindex: z.coerce.boolean().optional(),",
    tests: API,
  },
  {
    name: "blog seo: a new article is hidden from search by default",
    file: ROUTES,
    from: "      noindex: form.noindex ?? false,\n",
    to: "      noindex: form.noindex ?? true,\n",
    tests: API,
  },
  {
    name: "blog seo: an update without the key resets noindex",
    file: ROUTES,
    from: "noindex: form.noindex ?? before.noindex,",
    to: "noindex: form.noindex ?? false,",
    tests: API,
  },

  // ------------------------------------------------------------------ the public answers
  {
    name: "blog seo: every public entry carries noindex, even false (the other entries change shape)",
    file: SERIALIZERS,
    from: "    ...(row.noindex ? { noindex: true as const } : {}),\n",
    to: "    noindex: row.noindex,\n",
    tests: `${API} ${LEAK}`,
  },
  {
    name: "blog seo: the public index does not read noindex",
    file: QUERIES,
    from: "  noindex: blogPosts.noindex,\n",
    to: "",
    tests: API,
  },
  {
    name: "blog seo: the article answer drops the SEO title",
    file: SERIALIZERS,
    from: "    seoTitle: optionalText(row.seoTitle),\n",
    to: "    seoTitle: null,\n",
    tests: `${API} ${LEAK}`,
  },
];

const FORM = "spa/test/blog.test.tsx";
const MOCK = "spa/test/blog-mock.test.ts";

const SPA_RULES = "spa/src/pages/blog/rules.ts";
const SPA_FORM = "spa/src/pages/blog/form.ts";
const SPA_PAGE = "spa/src/pages/blog/BlogFormPage.tsx";
const SPA_FIELD = "spa/src/pages/blog/SeoTitleField.tsx";
const MOCK_SOURCE = "spa/src/mock/resources/blog.ts";

export const blogSeoSpaChecks = [
  {
    name: "blog seo: the form does not send noindex",
    file: SPA_FORM,
    from: "    noindex: values.noindex,\n",
    to: "",
    tests: FORM,
  },
  {
    name: "blog seo: an emptied SEO title is sent as an empty string, not null",
    file: SPA_FORM,
    from: 'seoTitle: values.seoTitle === "" ? null : values.seoTitle,',
    to: "seoTitle: values.seoTitle,",
    tests: FORM,
  },
  {
    name: "blog seo: the form's SEO title maximum is raised",
    file: SPA_RULES,
    from: "  seoTitleMax: 70,",
    to: "  seoTitleMax: 80,",
    tests: `${FORM} ${MOCK}`,
  },
  {
    name: "blog seo: the SEO title field is not on the form",
    file: SPA_PAGE,
    from: '          <SeoTitleField field={form.field("seoTitle")} error={fields.seoTitle} />\n',
    to: "",
    tests: FORM,
  },
  {
    name: "blog seo: the 'Sembunyikan dari Google' box is not bound to the form",
    file: SPA_PAGE,
    from: '{...form.checkbox("noindex")} ',
    to: "",
    tests: FORM,
  },
  {
    name: "blog seo: the counter counts the raw text, not what the Worker stores",
    file: SPA_FIELD,
    from: "describeSeoTitleCount(cleanSeoTitle(field.value).length)",
    to: "describeSeoTitleCount(field.value.length)",
    tests: FORM,
  },
  {
    name: "blog seo: the mock clears the SEO title when an update leaves the key out",
    file: MOCK_SOURCE,
    from: "seoTitle: parsed.values.seoTitle === undefined ? row.seoTitle || null : parsed.values.seoTitle",
    to: "seoTitle: parsed.values.seoTitle ?? null",
    tests: MOCK,
  },
];
