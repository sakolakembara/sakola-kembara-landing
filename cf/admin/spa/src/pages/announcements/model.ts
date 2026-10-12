import type { TagTone } from "@/components/ui/tag";
import { makeStatusMap } from "~/components/crud/StatusTag";
import type { Announcement, Severity } from "~/lib/api";
import type { AnnouncementStatus } from "./spec";

export { ANNOUNCEMENT_STATUSES, API_PATH, type AnnouncementStatus, LIST_SPEC, ROUTE } from "./spec";

// What the announcements screens share: the types, the labels and the form's values (the API path, the list's spec
// and the status values are in ./spec, which the Worker's tests can read).
// The reference implementation of docs/cloudflare/admin-crud.md; the Komunikasi worker owns it from here.
// Labels, tones and the window text are the legacy page's (app/(admin)/admin/announcements/page.tsx).

/** An item as the API answers it (`present` in src/api/announcements.ts). */
export type AnnouncementItem = Announcement & { updatedAt: string };

/** A row of the list: the item and what the public strip implies for it, worked out by the Worker with the strip's own rule. */
export type AnnouncementListItem = AnnouncementItem & { status: AnnouncementStatus };

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

/**
 * The Status column. The legacy page had three words ("Tampil", "Aktif, di luar jadwal", "Tidak aktif") worked out in
 * the browser, and marked EVERY row inside its window as "Tampil" although the strip shows only one. The Worker now says
 * which one is shown ("Tampil sekarang") and which live ones are covered by a newer one. `tone` is the legacy look:
 * green with a dot for what is on screen, amber for active but not showing, gray for off.
 */
export const STATUS_VIEW: Record<AnnouncementStatus, { label: string; tone: "shown" | "waiting" | "off" }> = {
  current: { label: "Tampil sekarang", tone: "shown" },
  superseded: { label: "Aktif, tertutup yang lebih baru", tone: "waiting" },
  outside_window: { label: "Aktif, di luar jadwal", tone: "waiting" },
  inactive: { label: "Tidak aktif", tone: "off" },
};

export function formatWindow(starts: string | null, ends: string | null): string {
  const fmt = (value: string) => new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  if (!starts && !ends) return "Tanpa batas";
  if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
  return starts ? `Mulai ${fmt(starts)}` : `Berakhir ${fmt(ends!)}`;
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
