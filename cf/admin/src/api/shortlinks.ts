import { z } from "zod";
import * as schema from "../db/schema";
import { normaliseSlug, SLUG_MAX_LENGTH, validateSlug, validateTarget } from "../shortlinks/rules";
import { booleanFilter, crudRoutes } from "./crud";

// Shortlink (area `konten`): `sakolakembara.org/<slug>` to any target. Port of
// app/(admin)/admin/shortlinks/actions.ts and lib/shortlinks.ts, on the admin CRUD convention
// (docs/cloudflare/admin-crud.md). The rules and their messages are in src/shortlinks/rules.ts; the redirect
// itself (the public lookup and the click count) is src/api/public/shortlink.ts, served to the site's Worker.
// What is ported, the three places where the target rule is stricter, and the redirect design:
// docs/cloudflare/admin-konten.md.
//
// `click_count` and `last_clicked_at` belong to the redirect, not to this form: `toRow` leaves them out, so a
// save never resets them, and a click never touches `updated_at`, so counting clicks cannot make an admin's
// save "stale".

const note = z
  .string()
  .trim()
  .max(300, "Catatan maksimal 300 karakter")
  .nullish()
  .transform((value) => value || null);

const shortlinkInput = z
  .object({
    slug: z.string({ error: "Slug wajib diisi." }).max(200, `Slug maksimal ${SLUG_MAX_LENGTH} karakter.`),
    targetUrl: z.string({ error: "URL tujuan wajib diisi." }).max(2000, "URL tujuan terlalu panjang."),
    note,
    // The form's checkbox starts ticked (a new link is live), so that is what a missing value means.
    active: z.boolean({ error: "Status tidak valid" }).default(true),
  })
  .transform((value, context) => {
    const slug = validateSlug(value.slug);
    if (!slug.ok) context.addIssue({ code: "custom", message: slug.message, path: ["slug"] });
    // The target is checked against the slug it will have, even when the slug itself was refused, so the form
    // shows both mistakes at once (the legacy action stopped at the first).
    const target = validateTarget(value.targetUrl, slug.ok ? slug.slug : normaliseSlug(value.slug));
    if (!target.ok) context.addIssue({ code: "custom", message: target.message, path: ["targetUrl"] });
    if (!slug.ok || !target.ok) return z.NEVER;
    return { slug: slug.slug, targetUrl: target.url, note: value.note, active: value.active };
  });

type ShortlinkRow = typeof schema.shortlinks.$inferSelect;

/** What the API returns: an explicit field list (no `createdBy`), dates as ISO strings. */
function present(row: ShortlinkRow) {
  return {
    id: row.id,
    slug: row.slug,
    targetUrl: row.targetUrl,
    note: row.note,
    active: row.active,
    clickCount: row.clickCount,
    lastClickedAt: row.lastClickedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const shortlinkRoutes = crudRoutes({
  area: "konten",
  table: schema.shortlinks,
  version: schema.shortlinks.updatedAt,
  // The slug is on printed material and in bios: a non-personal label, and what makes a deleted row readable.
  audit: { name: "shortlink", type: "shortlink", label: (row) => row.slug },
  schema: shortlinkInput,
  toRow: (input, { user, mode }) => ({
    slug: input.slug,
    targetUrl: input.targetUrl,
    note: input.note,
    active: input.active,
    ...(mode === "create" ? { createdBy: user.id } : {}),
  }),
  present,
  list: {
    search: [schema.shortlinks.slug, schema.shortlinks.targetUrl, schema.shortlinks.note],
    filters: { active: booleanFilter(schema.shortlinks.active) },
    sorts: {
      createdAt: schema.shortlinks.createdAt,
      updatedAt: schema.shortlinks.updatedAt,
      slug: schema.shortlinks.slug,
      clickCount: schema.shortlinks.clickCount,
      lastClickedAt: schema.shortlinks.lastClickedAt,
    },
    // Newest first, as the legacy list.
    defaultSort: "-createdAt",
  },
  // Two admins can pass the check at once; the unique index is the final word (legacy: SQLSTATE 23505).
  unique: { "shortlinks.slug": { field: "slug", message: "Slug ini sudah dipakai shortlink lain." } },
  // No purge: nothing caches a redirect (docs/cloudflare/admin-konten.md, "Why nothing is cached").
});
