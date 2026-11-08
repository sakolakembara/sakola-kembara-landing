import { makeStatusMap } from "~/components/crud/StatusTag";
import type { ListSpec } from "~/lib/crud/query";

// What the Donasi screens share (SAKEM-128): the paths, the list's spec, the types and the words. The rules of a
// confirmation are the Worker's (src/donations/rules.ts); the API is src/api/donations.ts.

export const API_PATH = "/api/admin/donations";
export const ROUTE = "/donations";

export type DonationKind = "once" | "monthly";
export type DonationStatus = "awaiting_transfer" | "new" | "checked";
export type DonationSource = "instagram" | "twitter" | "whatsapp" | "friend" | "website" | "other";

export const LIST_SPEC: ListSpec = {
  filters: ["kind", "status", "month"],
  sorts: ["createdAt", "amount"],
  defaultSort: "-createdAt",
  pageSize: 50,
};

export const KIND_LABEL: Record<DonationKind, string> = { once: "Sekali", monthly: "Bulanan" };
export const SOURCE_LABEL: Record<DonationSource, string> = {
  instagram: "Instagram",
  twitter: "Twitter/X",
  whatsapp: "WhatsApp",
  friend: "Teman",
  website: "Situs web",
  other: "Lainnya",
};

export const STATUS = makeStatusMap<DonationStatus>({
  awaiting_transfer: { label: "Belum transfer", tone: "gray" },
  new: { label: "Baru", tone: "amber" },
  checked: { label: "Dicek", tone: "green" },
});

export interface DonationListItem {
  id: string;
  kind: DonationKind;
  name: string;
  amount: number;
  remindDay: number | null;
  status: DonationStatus;
  hasProof: boolean;
  createdAt: string;
}

export interface DonationItem {
  id: string;
  kind: DonationKind;
  name: string;
  whatsapp: string;
  amount: number;
  startMonth: string | null;
  remindDay: number | null;
  source: DonationSource | null;
  status: DonationStatus;
  note: string | null;
  proof: { contentType: string; size: number; uploadedAt: string | null } | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function rupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

/** "62812..." as people write it: "0812 3456 7890". */
export function localWhatsapp(digits: string): string {
  const local = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1 $2 $3");
}

/** The chat link of "Hubungi lewat WhatsApp". */
export function waLink(digits: string): string {
  return `https://wa.me/${encodeURIComponent(digits)}`;
}

/** "2026-12" as "Desember 2026". */
export function monthLabel(month: string | null): string {
  if (!month) return "";
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, m! - 1, 1)).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The CSV of the list as filtered now (the same query, minus paging). */
export function exportHref(filters: Record<string, string>, q: string): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
  if (q) params.set("q", q);
  const query = params.toString();
  return `${API_PATH}/export.csv${query ? `?${query}` : ""}`;
}
