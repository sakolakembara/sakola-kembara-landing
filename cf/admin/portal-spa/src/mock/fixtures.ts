import type { Me } from "~/lib/me";
import type { Overview } from "~/lib/overview";
import type { Persona } from "./persona";

// MOCK, local development only (see mock/install.ts). Invented people and batches; nothing here is real data.

const DAY = 24 * 60 * 60 * 1000;

const BATCH = { id: "8b7e0c1a-0000-4000-8000-000000000001", year: 2026, name: "Gen 6 - 2026/2027" } as const;
const APPLICATION_ID = "5f1d2c3b-0000-4000-8000-000000000002";

export function mockMe(persona: Persona): Me {
  return {
    id: "mock-student-1",
    name: persona === "admin-account" ? "Rina Pengurus" : "Sari Dewi",
    email: persona === "admin-account" ? "rina.pengurus@contoh.test" : "sari@contoh.test",
    emailVerified: persona !== "unverified",
    role: persona === "admin-account" ? "editor" : "student",
  };
}

/** The personas whose batch is closed and published: the student has an application and the result is out. */
const PUBLISHED = ["published-accepted", "published-rejected", "published-undecided"] as const;

function isPublished(persona: Persona): boolean {
  return (PUBLISHED as readonly string[]).includes(persona);
}

/** `GET /portal/api/overview`, as the Worker answers it. */
export function mockOverview(persona: Persona, now: Date): Overview {
  const open = persona !== "no-batch" && !isPublished(persona);
  const hasApplication = persona === "submitted" || isPublished(persona);
  const submittedAt = new Date(now.getTime() - (isPublished(persona) ? 40 : 3) * DAY).toISOString();

  return {
    now: now.toISOString(),
    student: { name: "Sari Dewi", firstName: "Sari" },
    openBatch: open
      ? {
          id: BATCH.id,
          year: BATCH.year,
          name: BATCH.name,
          description: "Pendaftaran terbuka untuk lulusan SMA/SMK/MA yang ingin melanjutkan ke perguruan tinggi.\nPastikan semua berkas sudah siap sebelum mengisi formulir.",
          opensAt: new Date(now.getTime() - 20 * DAY).toISOString(),
          closesAt: new Date(now.getTime() + 17 * DAY).toISOString(),
        }
      : null,
    current:
      persona === "draft"
        ? { state: "draft", updatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() }
        : persona === "submitted"
          ? { state: "submitted", submittedAt }
          : { state: "none" },
    history: hasApplication
      ? [{ id: APPLICATION_ID, batch: { year: BATCH.year, name: BATCH.name }, submittedAt, published: isPublished(persona) }]
      : [],
  };
}

/** `GET /portal/api/applications`, as the Worker answers it: before publication nothing but `processing`. */
export function mockApplications(persona: Persona, now: Date): { items: unknown[] } {
  if (persona !== "submitted" && !isPublished(persona)) return { items: [] };
  const submittedAt = new Date(now.getTime() - (isPublished(persona) ? 40 : 3) * DAY).toISOString();
  const announcedAt = new Date(now.getTime() - 1 * DAY).toISOString();
  const result =
    persona === "published-accepted"
      ? { state: "decided", decision: "accepted", announcedAt, notes: null }
      : persona === "published-rejected"
        ? {
            state: "decided",
            decision: "rejected",
            announcedAt,
            notes: "Terima kasih sudah mendaftar. Untuk batch ini kuota sudah terpenuhi. Kami mengundang kamu mencoba lagi di batch berikutnya.",
          }
        : persona === "published-undecided"
          ? { state: "awaiting_decision", announcedAt }
          : { state: "processing" };
  return { items: [{ id: APPLICATION_ID, batch: BATCH, submittedAt, result }] };
}
