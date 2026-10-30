import type { TagTone } from "~/components/ui/tag";
import { makeStatusMap } from "~/components/crud/StatusTag";
import type { ListSpec } from "~/lib/crud/query";

// What the Tim screens share: the types, the labels, the list's spec and the form's values. Labels, tones and the
// rules are the legacy admin's (lib/team-types.ts, app/(admin)/admin/team/*).

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/team";
export const ROUTE = "/team";

export type TeamCategory = "dewan_pembina" | "dewan_pengawas" | "pengurus";

export interface EducationEntry {
  institution: string;
  degree?: string | null;
  year?: string | null;
}

export interface WorkEntry {
  organization: string;
  role: string;
  period?: string | null;
}

/** A row of the list (src/api/team.ts, `presentInList`): no bio and no histories. */
export interface TeamListItem {
  id: string;
  name: string;
  role: string;
  image: string | null;
  category: TeamCategory;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** One member as `GET /:id`, `POST` and `PUT` answer it. */
export interface TeamItem extends TeamListItem {
  bio: string | null;
  educationHistory: EducationEntry[];
  workHistory: WorkEntry[];
}

/** The order of the sections on /tim. */
export const CATEGORY_ORDER: readonly TeamCategory[] = ["dewan_pembina", "dewan_pengawas", "pengurus"];
export const CATEGORY_LABEL: Record<TeamCategory, string> = { dewan_pembina: "Dewan Pembina", dewan_pengawas: "Dewan Pengawas", pengurus: "Pengurus" };
export const CATEGORY_TONE: Record<TeamCategory, TagTone> = { dewan_pembina: "amber", dewan_pengawas: "purple", pengurus: "blue" };

export const CATEGORY_STATUS = makeStatusMap({
  dewan_pembina: { label: CATEGORY_LABEL.dewan_pembina, tone: CATEGORY_TONE.dewan_pembina },
  dewan_pengawas: { label: CATEGORY_LABEL.dewan_pengawas, tone: CATEGORY_TONE.dewan_pengawas },
  pengurus: { label: CATEGORY_LABEL.pengurus, tone: CATEGORY_TONE.pengurus },
});

/**
 * What the list offers: the same names as the Worker's filters and sorts (src/api/team.ts). `order` is the public
 * page's order (category, display order, creation), the default, as in the legacy list. The legacy list showed
 * every member on one page, so a page holds as many as the API allows.
 */
export const LIST_SPEC: ListSpec = {
  filters: ["category"],
  sorts: ["order", "name", "role", "category", "displayOrder", "createdAt", "updatedAt"],
  defaultSort: "order",
  pageSize: 100,
};

/** A history never has more entries than this (the Worker's limit, the legacy form's). */
export const MAX_HISTORY = 20;

// ------------------------------------------------------------------------ the histories

/** A row of the education editor: every box is text, "" when empty. */
export interface EducationRow {
  institution: string;
  degree: string;
  year: string;
}

export interface WorkRow {
  organization: string;
  role: string;
  period: string;
}

export const blankEducation = (): EducationRow => ({ institution: "", degree: "", year: "" });
export const blankWork = (): WorkRow => ({ organization: "", role: "", period: "" });

export const educationRows = (entries: readonly EducationEntry[]): EducationRow[] =>
  entries.map((entry) => ({ institution: entry.institution ?? "", degree: entry.degree ?? "", year: entry.year ?? "" }));

export const workRows = (entries: readonly WorkEntry[]): WorkRow[] =>
  entries.map((entry) => ({ organization: entry.organization ?? "", role: entry.role ?? "", period: entry.period ?? "" }));

const orNull = (value: string) => value.trim() || null;

/**
 * The rows as the form saves them: a row with no institution is dropped ("Kosongkan institusi untuk menghapus baris
 * saat disimpan."), the other boxes are trimmed and an empty one is null. The legacy form decoded its FormData the
 * same way; here the screen does it, and the Worker still refuses an entry without an institution.
 */
export function cleanEducation(rows: readonly EducationRow[]): EducationEntry[] {
  return rows.filter((row) => row.institution.trim() !== "").map((row) => ({ institution: row.institution.trim(), degree: orNull(row.degree), year: orNull(row.year) }));
}

export function cleanWork(rows: readonly WorkRow[]): WorkEntry[] {
  return rows.filter((row) => row.organization.trim() !== "").map((row) => ({ organization: row.organization.trim(), role: row.role.trim(), period: orNull(row.period) }));
}

// ----------------------------------------------------------------------------- the form

export interface TeamValues extends Record<string, string | boolean> {
  name: string;
  role: string;
  category: TeamCategory;
  /** Text, because it is typed into a number box; "" is "not filled in". */
  displayOrder: string;
  /** The path of the photo ("" for none). */
  image: string;
  bio: string;
}

/** What a new member's order box starts with (legacy: 100, so a new one lands after the ones numbered by tens). */
export const DEFAULT_DISPLAY_ORDER = 100;

export function toValues(item: TeamItem | null): TeamValues {
  return {
    name: item?.name ?? "",
    role: item?.role ?? "",
    category: item?.category ?? "pengurus",
    displayOrder: String(item?.displayOrder ?? DEFAULT_DISPLAY_ORDER),
    image: item?.image ?? "",
    bio: item?.bio ?? "",
  };
}

/** The body of `POST` and `PUT`. An empty or unreadable order goes as null, which the Worker answers with "Wajib diisi". */
export function toBody(values: TeamValues, education: readonly EducationRow[], work: readonly WorkRow[]) {
  const order = values.displayOrder.trim() === "" ? null : Number(values.displayOrder);
  return {
    name: values.name,
    role: values.role,
    category: values.category,
    image: values.image === "" ? null : values.image,
    bio: values.bio,
    educationHistory: cleanEducation(education),
    workHistory: cleanWork(work),
    displayOrder: order !== null && Number.isFinite(order) ? order : null,
  };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export function fieldLabels(): Record<string, string> {
  const labels: Record<string, string> = {
    name: "Nama Lengkap",
    role: "Peran",
    category: "Kategori",
    displayOrder: "Urutan Tampil",
    image: "Foto",
    bio: "Bio",
    educationHistory: "Riwayat Pendidikan",
    workHistory: "Riwayat Pekerjaan",
  };
  for (let index = 0; index < MAX_HISTORY; index++) {
    for (const [field, label] of [["institution", "Institusi"], ["degree", "Gelar / jurusan"], ["year", "Tahun"]] as const) labels[`educationHistory.${index}.${field}`] = `Pendidikan ${index + 1}, ${label}`;
    for (const [field, label] of [["organization", "Organisasi"], ["role", "Peran"], ["period", "Periode"]] as const) labels[`workHistory.${index}.${field}`] = `Pekerjaan ${index + 1}, ${label}`;
  }
  return labels;
}
