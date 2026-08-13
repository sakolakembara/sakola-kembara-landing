import { beforeEach, describe, expect, test, vi } from "vitest";

// The updateApplicationStatus action mixes Zod validation, Drizzle
// queries, next/navigation redirects, and audit writes. Tests exercise
// the revocation branch specifically — the M3 checkbox — since the
// happy-path status changes already had implicit coverage from
// live-testing.

// Hoist mock helpers above the vi.mock hoisting so factories can see them.
const { redirectMock, requireAdminMock, writeAuditMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((to: string) => {
    const err = new Error(`REDIRECT:${to}`);
    (err as unknown as { digest: string }).digest =
      `NEXT_REDIRECT;replace;${to};307;`;
    throw err;
  }),
  requireAdminMock: vi.fn(),
  writeAuditMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    query: {
      studentApplications: { findFirst: vi.fn() },
    },
    update: vi.fn(),
  };
  return { db: chain };
});

import { db } from "@/lib/db";
import { updateApplicationStatus } from "@/app/(admin)/admin/applications/[id]/actions";

const dbMock = db as unknown as {
  query: {
    studentApplications: { findFirst: ReturnType<typeof vi.fn> };
  };
  update: ReturnType<typeof vi.fn>;
};

const ADMIN = { email: "admin@example.com", userId: "admin-1", role: "editor" as const };

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function primeSuccessfulUpdate() {
  dbMock.update.mockImplementationOnce(() => ({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  }));
}

const APP_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN);
});

describe("updateApplicationStatus — regular transitions", () => {
  test("accepted from under_review — normal audit action, no min-length rule", async () => {
    dbMock.query.studentApplications.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      status: "under_review",
    });
    primeSuccessfulUpdate();

    await updateApplicationStatus(
      makeForm({
        id: APP_ID,
        status: "accepted",
        reviewNotes: "OK", // short note fine for regular accept
      }),
    );

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.accepted" }),
    );
  });

  test("rejected from pending — action = application.rejected, not revoke", async () => {
    dbMock.query.studentApplications.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      status: "pending",
    });
    primeSuccessfulUpdate();

    await updateApplicationStatus(
      makeForm({
        id: APP_ID,
        status: "rejected",
        reviewNotes: "Berkas tidak lengkap",
      }),
    );

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.rejected" }),
    );
  });
});

describe("updateApplicationStatus — revocation (accepted → rejected)", () => {
  test("redirects with error when notes shorter than 20 chars", async () => {
    dbMock.query.studentApplications.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      status: "accepted",
    });

    await expect(
      updateApplicationStatus(
        makeForm({
          id: APP_ID,
          status: "rejected",
          reviewNotes: "short",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/applications\//);

    // The redirect URL should carry the "minimal 20 karakter" message.
    // encodeURIComponent uses %20 for spaces, not '+'.
    const lastCall = redirectMock.mock.calls.at(-1)![0] as string;
    expect(lastCall).toContain("Alasan%20pencabutan");
    expect(lastCall).toContain("20%20karakter");

    // No DB update on validation failure.
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  test("succeeds with long-enough notes → emits application.revoke", async () => {
    dbMock.query.studentApplications.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      status: "accepted",
    });
    primeSuccessfulUpdate();

    await updateApplicationStatus(
      makeForm({
        id: APP_ID,
        status: "rejected",
        reviewNotes:
          "Siswa mengundurkan diri via WhatsApp pada 12 Sep. Bukti percakapan di Drive.",
      }),
    );

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application.revoke",
        metadata: expect.objectContaining({
          previousStatus: "accepted",
          revocationReason: expect.stringMatching(/mengundurkan diri/),
        }),
      }),
    );
  });

  test("rejected → rejected (idempotent) is NOT treated as revocation", async () => {
    dbMock.query.studentApplications.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      status: "rejected",
    });
    primeSuccessfulUpdate();

    await updateApplicationStatus(
      makeForm({
        id: APP_ID,
        status: "rejected",
        reviewNotes: "note update",
      }),
    );

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.rejected" }),
    );
  });
});
