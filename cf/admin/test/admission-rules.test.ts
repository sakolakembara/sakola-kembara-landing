import { describe, expect, test } from "vitest";
import { REVIEW_FIELDS, REVIEW_MESSAGES, REVOCATION_NOTES_MIN, isRevocation, reviewAction, reviewInput, revocationProblem } from "../src/admission/review";
import { prefixPattern } from "../src/admission/queries";
import { publishRefusal } from "../src/api/batches";
import { applicationStatus } from "../src/db/schema";

// The pure rules of the Pendaftaran area: the review of an application (a port of the legacy server action:
// app/(admin)/admin/applications/[id]/actions.ts), the prefix search pattern and the publish preconditions.
// The routes that enforce them are tested in test/applications.test.ts and test/batches.test.ts.

describe("the review input", () => {
  test("pending and under_review need no note", () => {
    for (const status of ["pending", "under_review"]) {
      expect(reviewInput.safeParse({ status, reviewNotes: "" }).success).toBe(true);
      expect(reviewInput.safeParse({ status }).success).toBe(true);
      expect(reviewInput.safeParse({ status, reviewNotes: null }).success).toBe(true);
    }
  });

  test("accepted and rejected need a note, in the legacy words, on the note field", () => {
    for (const status of ["accepted", "rejected"]) {
      for (const reviewNotes of ["", "   ", undefined, null]) {
        const parsed = reviewInput.safeParse({ status, reviewNotes });
        expect(parsed.success, `${status} / ${String(reviewNotes)}`).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues).toHaveLength(1);
          expect(parsed.error.issues[0]).toMatchObject({ message: "Catatan review wajib diisi saat menerima atau menolak.", path: ["reviewNotes"] });
        }
      }
      expect(reviewInput.safeParse({ status, reviewNotes: "Berkas lengkap." }).success).toBe(true);
    }
  });

  test("the note is trimmed, and capped at 2000 characters with a message of ours", () => {
    expect(reviewInput.parse({ status: "accepted", reviewNotes: "  ok  " }).reviewNotes).toBe("ok");
    expect(reviewInput.parse({ status: "pending" }).reviewNotes).toBe("");
    expect(reviewInput.safeParse({ status: "pending", reviewNotes: "x".repeat(2000) }).success).toBe(true);
    const long = reviewInput.safeParse({ status: "pending", reviewNotes: "x".repeat(2001) });
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0]?.message).toBe("Catatan review maksimal 2000 karakter");
  });

  test("a status that does not exist is refused in Indonesian", () => {
    const parsed = reviewInput.safeParse({ status: "approved", reviewNotes: "x" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]).toMatchObject({ message: "Status tidak dikenal", path: ["status"] });
    expect(reviewInput.safeParse({ reviewNotes: "x" }).success).toBe(false);
  });
});

describe("the legacy transitions: any status from any other, with one stricter rule", () => {
  test("every pair of statuses is a legal move (the legacy code has no state machine)", () => {
    for (const from of applicationStatus) {
      for (const to of applicationStatus) {
        const noteNeeded = to === "accepted" || to === "rejected";
        const notes = noteNeeded ? "x".repeat(REVOCATION_NOTES_MIN) : "";
        expect(reviewInput.safeParse({ status: to, reviewNotes: notes }).success, `${from} -> ${to}`).toBe(true);
        expect(revocationProblem(from, { status: to, reviewNotes: notes }), `${from} -> ${to}`).toBeNull();
      }
    }
  });

  test("the only revocation is accepted -> rejected", () => {
    const revocations = applicationStatus.flatMap((from) => applicationStatus.filter((to) => isRevocation(from, to)).map((to) => `${from} -> ${to}`));
    expect(revocations).toEqual(["accepted -> rejected"]);
  });

  test("a revocation needs at least 20 characters, and says so in the legacy words", () => {
    const short = revocationProblem("accepted", { status: "rejected", reviewNotes: "x".repeat(REVOCATION_NOTES_MIN - 1) });
    expect(short).toEqual({
      field: "reviewNotes",
      message: "Alasan pencabutan wajib diisi minimal 20 karakter — jelaskan mengapa penerimaan ini dibatalkan.",
    });
    expect(revocationProblem("accepted", { status: "rejected", reviewNotes: "x".repeat(REVOCATION_NOTES_MIN) })).toBeNull();
    // Rejecting someone who was only pending is an ordinary decision: one word of note is enough.
    expect(revocationProblem("pending", { status: "rejected", reviewNotes: "x" })).toBeNull();
    expect(revocationProblem("rejected", { status: "rejected", reviewNotes: "x" })).toBeNull();
    expect(revocationProblem("accepted", { status: "pending", reviewNotes: "" })).toBeNull();
  });

  test("the audit action is application.<status>, and application.revoke for a revocation only", () => {
    expect(reviewAction("pending", "under_review")).toBe("application.under_review");
    expect(reviewAction("under_review", "accepted")).toBe("application.accepted");
    expect(reviewAction("pending", "rejected")).toBe("application.rejected");
    expect(reviewAction("rejected", "accepted")).toBe("application.accepted");
    expect(reviewAction("accepted", "pending")).toBe("application.pending");
    expect(reviewAction("accepted", "rejected")).toBe("application.revoke");
  });

  test("the audit row names the columns a decision writes, and the note is not one of them", () => {
    expect([...REVIEW_FIELDS]).toEqual(["status", "reviewNotes", "reviewedBy", "reviewedAt"]);
    expect(REVIEW_MESSAGES.notFound).toBe("Pendaftar tidak ditemukan.");
  });
});

describe("the prefix pattern of the search", () => {
  test("is the text with its LIKE wildcards escaped, then %", () => {
    expect(prefixPattern("nama")).toBe("nama%");
    expect(prefixPattern("100%")).toBe("100!%%");
    expect(prefixPattern("a_b!c")).toBe("a!_b!!c%");
  });

  test("is cut from the end until it fits D1's 50 bytes for a LIKE pattern, and is never longer", () => {
    const encode = (text: string) => new TextEncoder().encode(text).length;
    for (const text of ["a".repeat(48), "%".repeat(48), "é".repeat(48), "漢".repeat(48), "_!%".repeat(16)]) {
      const pattern = prefixPattern(text);
      expect(pattern, text).not.toBeNull();
      expect(encode(pattern!)).toBeLessThanOrEqual(50);
      expect(pattern!.endsWith("%")).toBe(true);
    }
    // 48 plain characters plus the % are 49 bytes: kept whole.
    expect(prefixPattern("a".repeat(48))).toBe(`${"a".repeat(48)}%`);
    // Escaped, 48 percent signs would be 96 bytes: the first 24 survive (24 x 2 + the closing %).
    expect(prefixPattern("%".repeat(48))).toBe(`${"!%".repeat(24)}%`);
  });

  test("nothing to search for is null", () => {
    expect(prefixPattern("")).toBeNull();
  });
});

describe("when the results of a batch can be published", () => {
  const counts = (over: Partial<Record<(typeof applicationStatus)[number] | "total", number>> = {}) => {
    const base = { pending: 0, under_review: 0, accepted: 0, rejected: 0, ...over };
    return { ...base, total: over.total ?? base.pending + base.under_review + base.accepted + base.rejected };
  };

  test("the checks run in the legacy order: published, nobody applied, undecided ones", () => {
    expect(publishRefusal({ resultsPublishedAt: "2026-10-12T00:00:00.000Z", counts: counts({ pending: 3 }) })).toMatchObject({ code: "already_published", message: "Hasil sudah dipublikasikan" });
    expect(publishRefusal({ resultsPublishedAt: null, counts: counts() })).toMatchObject({ code: "no_applicants", message: "Belum ada pendaftar di batch ini" });
    expect(publishRefusal({ resultsPublishedAt: null, counts: counts({ pending: 2, under_review: 1, accepted: 4 }) })).toMatchObject({
      code: "undecided",
      message: "Masih ada 3 pendaftar yang belum diputuskan",
      extra: { undecided: 3 },
    });
  });

  test("a batch whose applicants are all decided can be published", () => {
    expect(publishRefusal({ resultsPublishedAt: null, counts: counts({ accepted: 5, rejected: 2 }) })).toBeNull();
    expect(publishRefusal({ resultsPublishedAt: null, counts: counts({ rejected: 1 }) })).toBeNull();
  });
});
