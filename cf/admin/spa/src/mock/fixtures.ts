import type { Announcement } from "~/lib/api";
import type { Dashboard } from "~/lib/dashboard";
// The Worker's own rules, so the mock shows the same menus and the same
// dashboard the real API would (this file is only ever bundled in mock mode).
import { visibleAreas, writableAreas } from "../../../src/auth/permissions";
import { buildDashboard, type DashboardRows } from "../../../src/dashboard/payload";
import type { Persona } from "./persona";

// MOCK, local development only. Invented values with reserved example
// addresses; none of it is real data.

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/** The body of `GET /api/me` for this persona, in the Worker's shape. */
export function mockMeBody(persona: Persona) {
  return {
    user: {
      id: "mock-user",
      email: `${persona.role.replace("_", "-")}@contoh.test`,
      name: "Pengguna Contoh",
      role: persona.role,
      emailVerified: true,
    },
    areas: {
      granted: persona.granted,
      visible: visibleAreas(persona.role, persona.granted),
      writable: writableAreas(persona.role, persona.granted),
    },
  };
}

/**
 * The body of `GET /api/dashboard` for this persona. Built by the Worker's own
 * `buildDashboard` from invented rows, so the mock has the real shape, the real
 * links and the real rule that only the areas a role may see have items: an
 * editor of Konten alone gets an empty attention, like the Worker.
 */
export function mockDashboard(persona: Persona, variant: "ready" | "empty"): Dashboard {
  const visible = visibleAreas(persona.role, persona.granted);
  const empty = variant === "empty";
  const rows: DashboardRows = {};
  if (visible.includes("pendaftaran")) {
    rows.undecided = empty
      ? []
      : [
          { batchId: "mock-batch-2026", status: "pending", n: 7 },
          { batchId: "mock-batch-2026", status: "under_review", n: 3 },
        ];
    rows.batches = empty
      ? []
      : [{ id: "mock-batch-2026", year: 2026, opensAt: new Date(Date.now() - 60 * DAY), closesAt: new Date(Date.now() - 10 * DAY), resultsPublishedAt: null, hasApplications: true }];
  }
  if (visible.includes("komunikasi")) rows.unreadMessages = empty ? 0 : 4;
  return buildDashboard(rows, new Date());
}

export function mockAnnouncements(): Announcement[] {
  return [
    { id: "m1", title: "Pendaftaran Angkatan 2026 Dibuka", body: "Pendaftaran siswa baru dibuka sampai akhir bulan depan.", severity: "info", ctaLabel: "Daftar Sekarang", ctaUrl: "/gabung-siswa", active: true, startsAt: null, endsAt: null, createdAt: iso(-5 * DAY) },
    { id: "m2", title: "Jadwal wawancara berubah", body: "Wawancara tahap dua dimajukan satu pekan.", severity: "warning", ctaLabel: null, ctaUrl: null, active: true, startsAt: iso(2 * DAY), endsAt: null, createdAt: iso(-2 * DAY) },
    { id: "m3", title: "Pengumuman lama", body: "Sudah tidak berlaku.", severity: "urgent", ctaLabel: null, ctaUrl: null, active: false, startsAt: null, endsAt: null, createdAt: iso(-90 * DAY) },
  ];
}
