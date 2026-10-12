import { sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import { teamCategory } from "../db/schema";
import { crudRoutes, enumFilter, uploadPath, type CrudDeps } from "./crud";
import { asSortKey } from "./sort-expression";

// Tim (area `konten`): the people of /tim. Port of app/(admin)/admin/team/actions.ts, on the admin CRUD
// convention (docs/cloudflare/admin-crud.md); what is ported, and where it differs from the legacy admin, is in
// docs/cloudflare/admin-konten.md.
//
// The legacy rules that carry over, with their messages:
//   - name 2 to 120, role 2 to 120, category (dewan_pembina, dewan_pengawas, pengurus, default pengurus);
//   - a photo (optional): uploaded first (`team-photo`: PNG, JPEG or WebP, at most 5 MB), then its path is saved;
//   - bio up to 4000 characters;
//   - education and work history, at most 20 entries each; an entry needs its institution (or organization, and
//     role); degree, year and period are optional;
//   - the display order is a NUMBER from 0 to 9999, lower first within a category (the legacy form has no move
//     up or down), and the list is shown in the order of the public page: category, display order, creation;
//   - deleting removes the row and then its photo (here: `deleteUploadByPath`, which keeps a file another row uses).
//
// The table has no image width and height, so none is recorded: the public page fixes the photo at 112 by 112.

const requiredText = (min: number, max: number, label: string, tooShort: string) =>
  z.string({ error: `${label} wajib diisi` }).trim().min(min, tooShort).max(max, `${label} maksimal ${max} karakter`);

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullish()
    .transform((value) => value || null);

const educationEntry = z.object({
  institution: z.string({ error: "Institusi wajib diisi" }).trim().min(1, "Institusi wajib diisi").max(200, "Institusi maksimal 200 karakter"),
  degree: optionalText(200, "Gelar maksimal 200 karakter"),
  year: optionalText(50, "Tahun maksimal 50 karakter"),
});

const workEntry = z.object({
  organization: z.string({ error: "Organisasi wajib diisi" }).trim().min(1, "Organisasi wajib diisi").max(200, "Organisasi maksimal 200 karakter"),
  role: z.string({ error: "Peran wajib diisi" }).trim().min(1, "Peran wajib diisi").max(200, "Peran maksimal 200 karakter"),
  period: optionalText(50, "Periode maksimal 50 karakter"),
});

const teamInput = z.object({
  name: requiredText(2, 120, "Nama", "Nama minimal 2 karakter"),
  role: requiredText(2, 120, "Peran", "Peran minimal 2 karakter"),
  category: z.enum(teamCategory, { error: "Kategori tidak dikenal" }),
  // "" and null are no photo. A photo is the path of an upload of kind `team-photo` or, for a member who predates
  // the admin, a legacy static path (/images/team/...), which must survive being saved again.
  image: z.preprocess((value) => (value === "" || value === null ? undefined : value), uploadPath(["team-photo"]).optional()).transform((value) => value ?? null),
  bio: optionalText(4000, "Bio maksimal 4000 karakter"),
  educationHistory: z.array(educationEntry, { error: "Riwayat pendidikan tidak valid" }).max(20, "Maksimal 20 entri").default([]),
  workHistory: z.array(workEntry, { error: "Riwayat pekerjaan tidak valid" }).max(20, "Maksimal 20 entri").default([]),
  displayOrder: z.number({ error: "Wajib diisi" }).int("Harus bilangan bulat").min(0, "Tidak boleh negatif").max(9999, "Maksimal 9999"),
});

type TeamRow = typeof schema.teamMembers.$inferSelect;

/** What the API returns for one member: an explicit field list, dates as ISO strings. */
function present(row: TeamRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    image: row.image,
    category: row.category,
    bio: row.bio,
    educationHistory: row.educationHistory,
    workHistory: row.workHistory,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A row of the list: no bio and no histories, which the table does not show. */
function presentInList(row: TeamRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    image: row.image,
    category: row.category,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The public page's order as ONE sort key: the category (the three names happen to sort in the page's order, as
 * the legacy `order by category` relied on), then the display order padded to 4 digits, then the creation time
 * padded to 15. Ascending, it is `category, display_order, created_at`, the order of the legacy admin list.
 */
const publicOrder = asSortKey(sql`${schema.teamMembers.category} || printf('%04d%015d', ${schema.teamMembers.displayOrder}, ${schema.teamMembers.createdAt})`);

/** `deps` is for tests only (spies for the purge hook and the upload cleanup); production uses `teamRoutes` below. */
export function createTeamRoutes(deps?: CrudDeps) {
  return crudRoutes(
    {
      area: "konten",
      table: schema.teamMembers,
      version: schema.teamMembers.updatedAt,
      // A member's name is on the public /tim page already, and the legacy audit row kept it (metadata.name):
      // the only resource of this area whose label is a person's name. It is what makes a deleted row readable.
      audit: { name: "team", type: "team_member", label: (row) => row.name },
      schema: teamInput,
      toRow: (input) => ({
        name: input.name,
        role: input.role,
        category: input.category,
        image: input.image,
        bio: input.bio,
        educationHistory: input.educationHistory,
        workHistory: input.workHistory,
        displayOrder: input.displayOrder,
      }),
      present,
      list: {
        present: presentInList,
        search: [schema.teamMembers.name, schema.teamMembers.role],
        filters: { category: enumFilter(schema.teamMembers.category, teamCategory) },
        sorts: {
          order: publicOrder,
          name: schema.teamMembers.name,
          role: schema.teamMembers.role,
          category: schema.teamMembers.category,
          displayOrder: schema.teamMembers.displayOrder,
          createdAt: schema.teamMembers.createdAt,
          updatedAt: schema.teamMembers.updatedAt,
        },
        defaultSort: "order",
      },
      // /tim.
      purge: { area: "team" },
      // The photo goes with the row, and when a save replaces or removes it.
      uploads: (row) => [row.image],
    },
    deps,
  );
}

export const teamRoutes = createTeamRoutes();
