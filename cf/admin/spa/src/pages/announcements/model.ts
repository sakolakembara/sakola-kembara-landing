import type { TagTone } from "@/components/ui/tag";
import { makeStatusMap } from "~/components/crud/StatusTag";
import type { Announcement, Severity } from "~/lib/api";
import type { ListSpec } from "~/lib/crud/query";

// What the announcements screens share: the types, the labels, the list's spec and the form's values.
// The reference implementation of docs/cloudflare/admin-crud.md; the Komunikasi worker owns it from here.
// Labels, tones and the window text are the legacy page's (app/(admin)/admin/announcements/page.tsx).

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/announcements";
export const ROUTE = "/announcements";

/** An item as the API answers it (`present` in src/api/announcements.ts). */
export type AnnouncementItem = Announcement & { updatedAt: string };

export const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", warning: "Peringatan", urgent: "Mendesak" };
export const SEVERITY_TONE: Record<Severity, TagTone> = { info: "blue", warning: "amber", urgent: "red" };
export const SEVERITY_HINT: Record<Severity, string> = {
  info: "Biru — pengumuman netral",
  warning: "Kuning — perhatian, tapi tidak mendesak",
  urgent: "Merah — perlu segera diperhatikan",
};
export const SEVERITIES = Object.keys(SEVERITY_LABEL) as Severity[];

export const SEVERITY_STATUS = makeStatusMap({
  info: { label: SEVERITY_LABEL.info, tone: SEVERITY_TONE.info },
  warning: { label: SEVERITY_LABEL.warning, tone: SEVERITY_TONE.warning },
  urgent: { label: SEVERITY_LABEL.urgent, tone: SEVERITY_TONE.urgent },
});

/** What the list offers: the same names as the Worker's filters and sorts (src/api/announcements.ts). */
export const LIST_SPEC: ListSpec = {
  filters: ["severity", "active"],
  sorts: ["createdAt", "updatedAt", "title", "startsAt"],
  defaultSort: "-createdAt",
};

export function formatWindow(starts: string | null, ends: string | null): string {
  const fmt = (value: string) => new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  if (!starts && !ends) return "Tanpa batas";
  if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
  return starts ? `Mulai ${fmt(starts)}` : `Berakhir ${fmt(ends!)}`;
}

export function isCurrentlyShown(row: Pick<Announcement, "active" | "startsAt" | "endsAt">, now = Date.now()): boolean {
  return row.active && (!row.startsAt || new Date(row.startsAt).getTime() <= now) && (!row.endsAt || new Date(row.endsAt).getTime() >= now);
}

// ----------------------------------------------------------------------- the form

export interface AnnouncementValues extends Record<string, string | boolean> {
  title: string;
  body: string;
  severity: Severity;
  ctaLabel: string;
  ctaUrl: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
}

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` in local time. */
export function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** The inverse: a local date-time from the input to the ISO string the API takes ("" is no date). */
export function fromLocalDatetime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  // An unreadable value goes through as typed, so the Worker answers "Format tanggal tidak valid".
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function toValues(item: AnnouncementItem | null): AnnouncementValues {
  return {
    title: item?.title ?? "",
    body: item?.body ?? "",
    severity: item?.severity ?? "info",
    ctaLabel: item?.ctaLabel ?? "",
    ctaUrl: item?.ctaUrl ?? "",
    active: item?.active ?? false,
    startsAt: toLocalDatetime(item?.startsAt),
    endsAt: toLocalDatetime(item?.endsAt),
  };
}

/** The body of `POST` and `PUT`. */
export function toBody(values: AnnouncementValues) {
  return {
    title: values.title,
    body: values.body,
    severity: values.severity,
    ctaLabel: values.ctaLabel,
    ctaUrl: values.ctaUrl,
    active: values.active,
    startsAt: fromLocalDatetime(values.startsAt),
    endsAt: fromLocalDatetime(values.endsAt),
  };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Judul",
  body: "Isi",
  severity: "Severity",
  ctaLabel: "Label CTA",
  ctaUrl: "URL CTA",
  active: "Aktifkan",
  startsAt: "Mulai",
  endsAt: "Berakhir",
};
