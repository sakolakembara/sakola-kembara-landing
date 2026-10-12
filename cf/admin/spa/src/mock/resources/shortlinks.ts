import type { ShortlinkItem } from "~/pages/shortlinks/model";
import { validateSlug, validateTarget } from "../../../../src/shortlinks/rules";
import type { MockResource } from "../resources";

// MOCK, local development only. The shortlinks of `GET /api/admin/shortlinks`. The slug and the target are checked
// by the Worker's own functions (src/shortlinks/rules.ts), so the same words and the same refusals show here.
// Not mocked: a slug that is already taken (409), which needs the other rows; try it against `pnpm dev`.

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const text = (value: unknown) => (typeof value === "string" ? value : "");

function seed(): ShortlinkItem[] {
  const row = (n: number, slug: string, targetUrl: string, over: Partial<ShortlinkItem>): ShortlinkItem => ({
    id: `mock-shortlink-${n}`,
    slug,
    targetUrl,
    note: null,
    active: true,
    clickCount: 0,
    lastClickedAt: null,
    createdAt: iso(-n * 7 * DAY),
    updatedAt: iso(-n * 7 * DAY),
    ...over,
  });
  return [
    row(1, "rapat-2026", "https://forms.gle/contoh-rapat", { note: "Dibagikan lewat broadcast WhatsApp angkatan 2026", clickCount: 128, lastClickedAt: iso(-2 * DAY) }),
    row(2, "bio-instagram", "/gabung-siswa", { note: "Dipakai di bio Instagram", clickCount: 2310, lastClickedAt: iso(-1 * DAY / 4) }),
    row(3, "wawancara-lama", "https://example.org/wawancara-2025", { active: false, clickCount: 57, lastClickedAt: iso(-120 * DAY), note: "Kampanye yang sudah selesai" }),
    row(4, "unduh-panduan", "https://example.org/panduan.pdf", {}),
  ];
}

const resource: MockResource<ShortlinkItem> = {
  path: "/api/admin/shortlinks",
  area: "konten",
  seed,
  search: ["slug", "targetUrl", "note"],
  filters: { active: ["true", "false"] },
  sorts: ["createdAt", "updatedAt", "slug", "clickCount", "lastClickedAt"],
  defaultSort: "-createdAt",
  parse(body) {
    const fields: Record<string, string> = {};
    const slug = validateSlug(text(body.slug));
    if (!slug.ok) fields.slug = slug.message;
    const target = validateTarget(text(body.targetUrl), slug.ok ? slug.slug : text(body.slug).trim().toLowerCase());
    if (!target.ok) fields.targetUrl = target.message;
    const note = text(body.note).trim();
    if (note.length > 300) fields.note = "Catatan maksimal 300 karakter";
    if (Object.keys(fields).length > 0 || !slug.ok || !target.ok) return { ok: false, fields };
    return { ok: true, values: { slug: slug.slug, targetUrl: target.url, note: note || null, active: body.active !== false } };
  },
};

export default resource;
