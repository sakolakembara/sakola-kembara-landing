import type { Announcement } from "~/lib/api";
import type { Dashboard } from "~/lib/dashboard";
import type { Me } from "~/lib/me";
import type { Persona } from "./persona";

// MOCK, local development only. Invented values with reserved example
// addresses; none of it is real data.

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

export function mockMe(persona: Persona): Me {
  return {
    id: "mock-user",
    email: `${persona.role.replace("_", "-")}@contoh.test`,
    name: "Pengguna Contoh",
    role: persona.role,
    emailVerified: true,
    areas: persona.areas,
  };
}

export function mockDashboard(variant: "ready" | "empty"): Dashboard {
  if (variant === "empty") {
    return {
      attention: { pendingApplications: 0, underReviewApplications: 0, unreadMessages: 0, batch: null },
      recentActivity: [],
    };
  }
  return {
    attention: {
      pendingApplications: 7,
      underReviewApplications: 3,
      unreadMessages: 4,
      batch: {
        id: "mock-batch-2026",
        year: 2026,
        phase: "awaiting_decisions",
        opensAt: iso(-60 * DAY),
        closesAt: iso(-10 * DAY),
        undecided: 10,
      },
    },
    recentActivity: [
      { id: "a1", actorEmail: "editor@contoh.test", action: "announcement.create", resourceType: "announcement", resourceId: "x1", createdAt: iso(-20 * 60 * 1000) },
      { id: "a2", actorEmail: "editor@contoh.test", action: "application.accepted", resourceType: "application", resourceId: "x2", createdAt: iso(-3 * 60 * 60 * 1000) },
      { id: "a3", actorEmail: "super-admin@contoh.test", action: "batch.update", resourceType: "batch", resourceId: "mock-batch-2026", createdAt: iso(-1 * DAY) },
      { id: "a4", actorEmail: "editor@contoh.test", action: "report.delete", resourceType: "report", resourceId: "x4", createdAt: iso(-2 * DAY) },
      { id: "a5", actorEmail: "sistem", action: "contact_message.submit", resourceType: "contact_message", resourceId: "x5", createdAt: iso(-3 * DAY) },
    ],
  };
}

export function mockAnnouncements(): Announcement[] {
  return [
    { id: "m1", title: "Pendaftaran Angkatan 2026 Dibuka", body: "Pendaftaran siswa baru dibuka sampai akhir bulan depan.", severity: "info", ctaLabel: "Daftar Sekarang", ctaUrl: "/gabung-siswa", active: true, startsAt: null, endsAt: null, createdAt: iso(-5 * DAY) },
    { id: "m2", title: "Jadwal wawancara berubah", body: "Wawancara tahap dua dimajukan satu pekan.", severity: "warning", ctaLabel: null, ctaUrl: null, active: true, startsAt: iso(2 * DAY), endsAt: null, createdAt: iso(-2 * DAY) },
    { id: "m3", title: "Pengumuman lama", body: "Sudah tidak berlaku.", severity: "urgent", ctaLabel: null, ctaUrl: null, active: false, startsAt: null, endsAt: null, createdAt: iso(-90 * DAY) },
  ];
}
