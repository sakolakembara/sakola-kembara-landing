import { type AnnouncementItem, SEVERITIES } from "~/pages/announcements/model";
import { mockAnnouncements } from "../fixtures";
import type { MockResource } from "../resources";

// MOCK, local development only. The announcements of `GET /api/admin/announcements`, with the same rules as the
// Worker's schema (src/api/announcements.ts), in miniature. The worked example of mock/resources.ts.

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const resource: MockResource<AnnouncementItem> = {
  path: "/api/admin/announcements",
  area: "komunikasi",
  seed: () => mockAnnouncements().map((row) => ({ ...row, updatedAt: row.createdAt })),
  search: ["title", "body"],
  filters: { severity: SEVERITIES, active: ["true", "false"] },
  sorts: ["createdAt", "updatedAt", "title", "startsAt"],
  defaultSort: "-createdAt",
  parse(body) {
    const fields: Record<string, string> = {};
    const title = text(body.title);
    const bodyText = text(body.body);
    if (title.length < 3) fields.title = "Judul minimal 3 karakter";
    else if (title.length > 200) fields.title = "Judul maksimal 200 karakter";
    if (bodyText.length < 5) fields.body = "Isi minimal 5 karakter";
    else if (bodyText.length > 500) fields.body = "Isi maksimal 500 karakter";
    if (!(SEVERITIES as readonly unknown[]).includes(body.severity)) fields.severity = "Tingkat tidak dikenal";
    const ctaLabel = text(body.ctaLabel) || null;
    const ctaUrl = text(body.ctaUrl) || null;
    if ((ctaLabel === null) !== (ctaUrl === null)) fields.ctaLabel = "Label dan URL CTA harus diisi keduanya";
    const date = (value: unknown) => (typeof value === "string" && value !== "" ? new Date(value) : null);
    const startsAt = date(body.startsAt);
    const endsAt = date(body.endsAt);
    if (startsAt && Number.isNaN(startsAt.getTime())) fields.startsAt = "Format tanggal tidak valid";
    if (endsAt && Number.isNaN(endsAt.getTime())) fields.endsAt = "Format tanggal tidak valid";
    if (!fields.endsAt && !fields.startsAt && startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) fields.endsAt = "Tanggal selesai harus setelah tanggal mulai";
    if (Object.keys(fields).length > 0) return { ok: false, fields };
    return {
      ok: true,
      values: {
        title,
        body: bodyText,
        severity: body.severity as AnnouncementItem["severity"],
        ctaLabel,
        ctaUrl,
        active: body.active === true,
        startsAt: startsAt?.toISOString() ?? null,
        endsAt: endsAt?.toISOString() ?? null,
      },
    };
  },
};

export default resource;
