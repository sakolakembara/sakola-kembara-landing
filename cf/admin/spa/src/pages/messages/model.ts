import type { TagTone } from "~/components/ui/tag";
import { type Subject } from "./spec";

export { API_PATH, COUNTS_PATH, LIST_SPEC, READ_FILTERS, type ReadFilter, ROUTE, type Subject, SUBJECTS } from "./spec";

// What the Pesan screens share: the types, the labels and the reply link (the API paths, the subjects and the list's
// spec are in ./spec, which the Worker's tests can read).
// Labels, tones and the reply subjects are the legacy page's (lib/messages.ts and app/(admin)/admin/messages/*).

export const SUBJECT_LABEL: Record<Subject, string> = { partnership: "Kerjasama", donation: "Donasi", other: "Lainnya" };
export const SUBJECT_TONE: Record<Subject, TagTone> = { partnership: "purple", donation: "green", other: "gray" };

/** The subject line of "Balas via Email", per subject (the legacy detail page's table). */
export const SUBJECT_LINE: Record<Subject, string> = {
  partnership: "Re: Kerjasama dengan Sakola Kembara",
  donation: "Re: Pertanyaan donasi Sakola Kembara",
  other: "Re: Pesan dari sakolakembara.org",
};

/** A row of the list: a preview of the text, not the text. */
export interface MessageListItem {
  id: string;
  fullName: string;
  email: string;
  subject: Subject;
  preview: string;
  readAt: string | null;
  createdAt: string;
}

/** One message, whole. */
export interface MessageItem {
  id: string;
  fullName: string;
  email: string;
  subject: Subject;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface MessageCounts {
  total: number;
  unread: number;
}

/** The link of "Balas via Email", exactly as the legacy detail page built it. */
export function mailtoFor(email: string, subject: string): string {
  const line = Object.hasOwn(SUBJECT_LINE, subject) ? SUBJECT_LINE[subject as Subject] : "Re: Pesan";
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(line)}`;
}
