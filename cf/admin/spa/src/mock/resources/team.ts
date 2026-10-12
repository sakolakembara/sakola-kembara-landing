import { CATEGORY_ORDER, type EducationEntry, MAX_HISTORY, type TeamCategory, type TeamItem, type WorkEntry } from "~/pages/team/model";
import type { MockResource } from "../resources";

// MOCK, local development only. The team of `GET /api/admin/team`, with the Worker's rules (src/api/team.ts) in
// miniature.
//
// The list's default order is the public page's (category, display order, creation), which the Worker sorts with
// one SQL expression. The generic store sorts by a field, so each row here carries that key as `order` (a text of
// the same three parts); it is not part of what the Worker answers.

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const orNull = (value: unknown) => text(value) || null;

type MockTeam = TeamItem & { order: string };

const orderKey = (category: string, displayOrder: number, createdAt: string) => `${category}${String(displayOrder).padStart(4, "0")}${String(Date.parse(createdAt)).padStart(15, "0")}`;

function seed(): MockTeam[] {
  const member = (n: number, name: string, role: string, category: TeamCategory, displayOrder: number, over: Partial<TeamItem> = {}): MockTeam => {
    const createdAt = iso(-(30 - n) * DAY);
    return {
      id: `mock-team-${n}`,
      name,
      role,
      image: null,
      category,
      bio: null,
      educationHistory: [],
      workHistory: [],
      displayOrder,
      createdAt,
      updatedAt: createdAt,
      order: orderKey(category, displayOrder, createdAt),
      ...over,
    };
  };
  return [
    member(1, "Anggota Contoh Satu", "Ketua Pembina", "dewan_pembina", 10, {
      bio: "Biografi contoh untuk uji lokal.\nBaris kedua.",
      educationHistory: [{ institution: "Universitas Contoh", degree: "S1 Contoh", year: "2015" }],
      workHistory: [{ organization: "Organisasi Contoh", role: "Peran Contoh", period: "2018 - sekarang" }],
    }),
    member(2, "Anggota Contoh Dua", "Anggota Pembina", "dewan_pembina", 20),
    member(3, "Anggota Contoh Tiga", "Ketua Pengawas", "dewan_pengawas", 10, { bio: "Pengawas contoh." }),
    member(4, "Anggota Contoh Empat", "Ketua Umum", "pengurus", 10),
    member(5, "Anggota Contoh Lima", "Sekretaris", "pengurus", 20),
    member(6, "Anggota Contoh Enam", "Bendahara", "pengurus", 30),
  ];
}

function entries<T>(raw: unknown, shape: (entry: Record<string, unknown>) => T | null | "invalid"): T[] | "invalid" {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "invalid";
  const out: T[] = [];
  for (const entry of raw) {
    const made = entry !== null && typeof entry === "object" ? shape(entry as Record<string, unknown>) : "invalid";
    if (made === "invalid") return "invalid";
    if (made !== null) out.push(made);
  }
  return out;
}

const resource: MockResource<MockTeam> = {
  path: "/api/admin/team",
  area: "konten",
  seed,
  search: ["name", "role"],
  filters: { category: CATEGORY_ORDER },
  sorts: ["order", "name", "role", "category", "displayOrder", "createdAt", "updatedAt"],
  defaultSort: "order",
  parse(body) {
    const fields: Record<string, string> = {};
    const name = text(body.name);
    const role = text(body.role);
    const bio = text(body.bio);
    if (name.length < 2) fields.name = "Nama minimal 2 karakter";
    else if (name.length > 120) fields.name = "Nama maksimal 120 karakter";
    if (role.length < 2) fields.role = "Peran minimal 2 karakter";
    else if (role.length > 120) fields.role = "Peran maksimal 120 karakter";
    if (!(CATEGORY_ORDER as readonly unknown[]).includes(body.category)) fields.category = "Kategori tidak dikenal";
    if (bio.length > 4000) fields.bio = "Bio maksimal 4000 karakter";
    const order = body.displayOrder;
    if (typeof order !== "number") fields.displayOrder = "Wajib diisi";
    else if (!Number.isInteger(order)) fields.displayOrder = "Harus bilangan bulat";
    else if (order < 0) fields.displayOrder = "Tidak boleh negatif";
    else if (order > 9999) fields.displayOrder = "Maksimal 9999";

    const education = entries<EducationEntry>(body.educationHistory, (entry) =>
      text(entry.institution) === "" ? "invalid" : { institution: text(entry.institution), degree: orNull(entry.degree), year: orNull(entry.year) },
    );
    if (education === "invalid") fields.educationHistory = "Institusi wajib diisi";
    else if (education.length > MAX_HISTORY) fields.educationHistory = "Maksimal 20 entri";
    const work = entries<WorkEntry>(body.workHistory, (entry) =>
      text(entry.organization) === "" || text(entry.role) === "" ? "invalid" : { organization: text(entry.organization), role: text(entry.role), period: orNull(entry.period) },
    );
    if (work === "invalid") fields.workHistory = "Organisasi dan peran wajib diisi";
    else if (work.length > MAX_HISTORY) fields.workHistory = "Maksimal 20 entri";

    if (Object.keys(fields).length > 0 || education === "invalid" || work === "invalid") return { ok: false, fields };
    const category = body.category as TeamCategory;
    const displayOrder = order as number;
    return {
      ok: true,
      values: {
        name,
        role,
        category,
        image: orNull(body.image),
        bio: bio || null,
        educationHistory: education,
        workHistory: work,
        displayOrder,
        // The creation time of a row that already exists is not known here; the sort key only needs to be stable.
        order: orderKey(category, displayOrder, new Date().toISOString()),
      },
    };
  },
};

export default resource;
