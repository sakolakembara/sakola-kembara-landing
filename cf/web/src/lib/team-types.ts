// Team data as the content API returns it. The shape mirrors the TeamMember
// row type of the root lib/db/schema/team-members.ts (what /tim renders
// today), with dates as ISO strings because they travel as JSON.
//
// Contract of GET ${CONTENT_API_URL}/api/public/team (to be added to the legacy app):
//   200 application/json  { "members": TeamMember[] }   (a bare array is accepted too)
//   members ordered by category, displayOrder, createdAt; image is a path under the site root.

export const TEAM_CATEGORY_ORDER = ['dewan_pembina', 'dewan_pengawas', 'pengurus'] as const;
export type TeamCategory = (typeof TEAM_CATEGORY_ORDER)[number];

export const TEAM_CATEGORY_LABEL: Record<TeamCategory, string> = {
  dewan_pembina: 'Dewan Pembina',
  dewan_pengawas: 'Dewan Pengawas',
  pengurus: 'Pengurus',
};

export const CATEGORY_DESCRIPTION: Record<TeamCategory, string> = {
  dewan_pembina:
    'Memberi arah strategis dan menjaga misi Sakola Kembara tetap selaras dengan cita-cita pendidikan yang setara.',
  dewan_pengawas:
    'Mengawasi tata kelola dan akuntabilitas, memastikan setiap program berjalan sesuai prinsip dan standar yang kami pegang.',
  pengurus:
    'Menjalankan operasional harian — dari kurasi program, kemitraan, hingga pendampingan siswa di lapangan.',
};

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

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  /** Path under the site root (e.g. /images/team/<slug>.jpg). Optional. */
  image: string | null;
  category: TeamCategory;
  bio: string | null;
  educationHistory: EducationEntry[];
  workHistory: WorkEntry[];
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Turn an API payload into members. Tolerant by design: a malformed entry is
 * dropped rather than failing the page, because this input crosses a network.
 * Returns null when the payload is not a list at all (caller treats it as an error).
 */
export function parseTeamPayload(payload: unknown): TeamMember[] | null {
  const list = Array.isArray(payload) ? payload : isRecord(payload) ? payload.members : undefined;
  if (!Array.isArray(list)) return null;

  const members: TeamMember[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const name = str(raw.name);
    const role = str(raw.role);
    const category = (TEAM_CATEGORY_ORDER as readonly string[]).includes(String(raw.category))
      ? (raw.category as TeamCategory)
      : 'pengurus';
    if (!id || !name || !role) continue;

    const education = (Array.isArray(raw.educationHistory) ? raw.educationHistory : []).flatMap((e) =>
      isRecord(e) && str(e.institution)
        ? [{ institution: String(e.institution), degree: str(e.degree), year: str(e.year) }]
        : [],
    );
    const work = (Array.isArray(raw.workHistory) ? raw.workHistory : []).flatMap((w) =>
      isRecord(w) && str(w.organization) && str(w.role)
        ? [{ organization: String(w.organization), role: String(w.role), period: str(w.period) }]
        : [],
    );

    members.push({
      id,
      name,
      role,
      image: str(raw.image),
      category,
      bio: str(raw.bio),
      educationHistory: education,
      workHistory: work,
      displayOrder: typeof raw.displayOrder === 'number' ? raw.displayOrder : 0,
      createdAt: str(raw.createdAt) ?? '',
      updatedAt: str(raw.updatedAt) ?? '',
    });
  }
  return members;
}

/** Members grouped in display order; an empty category is omitted. */
export function groupTeam(members: TeamMember[]): { category: TeamCategory; members: TeamMember[] }[] {
  return TEAM_CATEGORY_ORDER.map((category) => ({
    category,
    members: members
      .filter((m) => m.category === category)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt)),
  })).filter((g) => g.members.length > 0);
}
