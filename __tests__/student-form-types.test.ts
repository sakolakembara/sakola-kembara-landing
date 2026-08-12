import { describe, expect, test } from "vitest";
import {
  documentsSchema,
  householdSchema,
  housingSchema,
  identitySchema,
  interviewSchema,
  marketingSchema,
  organizationsSchema,
  rupiahSchema,
  whatsappSchema,
} from "@/lib/student-form-types";

// Highest-value tests in the codebase — the wizard's Zod schemas are the
// last line of defense between form input and DB. Every branch failure
// would land dirty rows in student_applications.

describe("whatsappSchema", () => {
  test("accepts a well-formed Indonesian mobile", () => {
    expect(whatsappSchema.safeParse("6281234567890").success).toBe(true);
  });
  test("strips whitespace before validating", () => {
    expect(whatsappSchema.safeParse("  6281234567890  ").success).toBe(true);
  });
  test("rejects numbers not starting with 62", () => {
    expect(whatsappSchema.safeParse("081234567890").success).toBe(false);
  });
  test("rejects too-short digit counts", () => {
    expect(whatsappSchema.safeParse("62123").success).toBe(false);
  });
});

describe("rupiahSchema", () => {
  test("parses plain digits", () => {
    const r = rupiahSchema.safeParse("1200000");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe(1_200_000);
  });
  test("parses dot-thousands notation", () => {
    const r = rupiahSchema.safeParse("1.200.000");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe(1_200_000);
  });
  test("rejects Rp prefix with a specific error message", () => {
    const r = rupiahSchema.safeParse("Rp 1.200.000");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message.toLowerCase()).toContain("hilangkan");
    }
  });
  test("rejects comma decimal", () => {
    expect(rupiahSchema.safeParse("1,200,000").success).toBe(false);
  });
  test("rejects ranges (hyphen)", () => {
    expect(rupiahSchema.safeParse("1000000-2000000").success).toBe(false);
  });
  test("rejects letters", () => {
    expect(rupiahSchema.safeParse("dua juta").success).toBe(false);
  });
  test("rejects empty string", () => {
    expect(rupiahSchema.safeParse("").success).toBe(false);
  });
});

describe("identitySchema", () => {
  const validBase = {
    fullName: "Dadi Dinan Haris",
    nickname: "Dadi",
    gender: "laki-laki",
    religion: "Islam",
    schoolName: "SMAN 1 Bandung",
    branch: "Bandung",
    homeAddress: "Jl. Contoh No. 1, Bandung",
    graduationBatch: "2027 (Kelas 12)",
    whatsapp: "6281234567890",
  } as const;

  test("accepts a valid identity payload", () => {
    expect(identitySchema.safeParse(validBase).success).toBe(true);
  });
  test("rejects a name shorter than 3 chars", () => {
    expect(identitySchema.safeParse({ ...validBase, fullName: "AB" }).success).toBe(false);
  });
  test("rejects an all-caps full name", () => {
    // Guardrail against copy-paste from an ID card.
    const r = identitySchema.safeParse({ ...validBase, fullName: "DADI DINAN HARIS" });
    expect(r.success).toBe(false);
  });
  test("rejects an unknown branch", () => {
    expect(identitySchema.safeParse({ ...validBase, branch: "Jakarta" }).success).toBe(false);
  });
  test("rejects a bad WhatsApp number", () => {
    expect(identitySchema.safeParse({ ...validBase, whatsapp: "invalid" }).success).toBe(false);
  });
});

describe("householdSchema", () => {
  const base = {
    livingWith: ["Ayah", "Ibu"],
    fatherName: "Budi Santoso",
    fatherOccupation: "PNS",
    fatherIncome: "5000000",
    motherName: "Siti Aminah",
    motherOccupation: "Ibu rumah tangga",
    motherIncome: "0",
    hasOtherEarner1: false,
    hasOtherEarner2: false,
    familySize: 4,
  };

  test("accepts the minimal happy path", () => {
    expect(householdSchema.safeParse(base).success).toBe(true);
  });

  test("requires earner1 fields when hasOtherEarner1 = true", () => {
    const r = householdSchema.safeParse({
      ...base,
      hasOtherEarner1: true,
      earner1Relation: "",
      earner1Income: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("earner1Relation");
      expect(paths).toContain("earner1Income");
    }
  });

  test("blocks earner2 when earner1 not filled", () => {
    const r = householdSchema.safeParse({
      ...base,
      hasOtherEarner2: true,
      earner2Relation: "Paman/Bibi",
      earner2Income: "1000000",
    });
    expect(r.success).toBe(false);
  });

  test("rejects familySize < 1", () => {
    expect(householdSchema.safeParse({ ...base, familySize: 0 }).success).toBe(false);
  });
});

describe("housingSchema", () => {
  const base = {
    residenceStatus: "Rumah Pribadi",
    buildingArea: 60,
    motorcycles: 1,
    cars: 0,
    hasDebt: false,
  };

  test("accepts the no-debt happy path", () => {
    expect(housingSchema.safeParse(base).success).toBe(true);
  });

  test("requires all debt fields when hasDebt = true", () => {
    const r = housingSchema.safeParse({
      ...base,
      hasDebt: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("debtType");
      expect(paths).toContain("debtAmount");
      expect(paths).toContain("debtInstallmentMonths");
      expect(paths).toContain("debtDescription");
    }
  });

  test("accepts complete debt block", () => {
    const r = housingSchema.safeParse({
      ...base,
      hasDebt: true,
      debtType: "KPR",
      debtAmount: "200.000.000",
      debtInstallmentMonths: "60",
      debtDescription: "Cicilan rumah",
    });
    expect(r.success).toBe(true);
  });

  test("rejects negative motorcycles", () => {
    expect(housingSchema.safeParse({ ...base, motorcycles: -1 }).success).toBe(false);
  });
});

describe("organizationsSchema", () => {
  test("accepts hasOrganizations = false regardless of entries", () => {
    const r = organizationsSchema.safeParse({
      hasOrganizations: false,
      entries: [],
    });
    expect(r.success).toBe(true);
  });

  test("rejects hasOrganizations = true with no filled entries", () => {
    const r = organizationsSchema.safeParse({
      hasOrganizations: true,
      entries: [
        { name: "", position: "" },
        { name: "", position: "" },
      ],
    });
    expect(r.success).toBe(false);
  });

  test("accepts a filled organization row", () => {
    const r = organizationsSchema.safeParse({
      hasOrganizations: true,
      entries: [{ name: "OSIS", position: "Ketua" }],
    });
    expect(r.success).toBe(true);
  });
});

describe("documentsSchema", () => {
  const validUrls = {
    fatherIncomeUrl: "",
    motherIncomeUrl: "",
    otherEarner1IncomeUrl: "",
    otherEarner2IncomeUrl: "",
    debtProofUrl: "",
    electricityBillUrl: "https://drive.google.com/file/d/abc/view",
    familyCardUrl: "https://drive.google.com/file/d/def/view",
    parentPermissionUrl: "https://drive.google.com/file/d/ghi/view",
    selfPhotoUrl: "https://drive.google.com/file/d/jkl/view",
    dtksRegistered: "tidak",
    dtksUrl: "",
    houseImagesUrl: "https://drive.google.com/file/d/mno/view",
    vehicleImagesUrl: "https://drive.google.com/file/d/pqr/view",
  } as const;

  test("accepts complete valid document payload without DTKS", () => {
    expect(documentsSchema.safeParse(validUrls).success).toBe(true);
  });

  test("rejects a non-Drive URL for a required doc", () => {
    const r = documentsSchema.safeParse({
      ...validUrls,
      familyCardUrl: "https://dropbox.com/xyz",
    });
    expect(r.success).toBe(false);
  });

  test("requires dtksUrl when dtksRegistered = ya", () => {
    const r = documentsSchema.safeParse({
      ...validUrls,
      dtksRegistered: "ya",
      dtksUrl: "",
    });
    expect(r.success).toBe(false);
  });

  test("accepts optional docs when left blank", () => {
    // fatherIncomeUrl is optional (marked with optionalGoogleDriveUrlSchema).
    expect(
      documentsSchema.safeParse({ ...validUrls, fatherIncomeUrl: "" }).success,
    ).toBe(true);
  });
});

describe("marketingSchema", () => {
  test("accepts a valid marketing payload and strips @ from Instagram", () => {
    const r = marketingSchema.safeParse({
      instagramUsername: "@sakola.kembara",
      instagramFollowProofUrl: "https://drive.google.com/file/1",
      broadcastProofUrl: "https://drive.google.com/file/2",
      twibbonUploadUrl: "https://drive.google.com/file/3",
      storyUploadUrl: "https://drive.google.com/file/4",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.instagramUsername).toBe("sakola.kembara");
  });

  test("rejects invalid characters in Instagram username", () => {
    expect(
      marketingSchema.safeParse({
        instagramUsername: "with space",
        instagramFollowProofUrl: "https://drive.google.com/file/1",
        broadcastProofUrl: "https://drive.google.com/file/2",
        twibbonUploadUrl: "https://drive.google.com/file/3",
        storyUploadUrl: "https://drive.google.com/file/4",
      }).success,
    ).toBe(false);
  });
});

describe("interviewSchema", () => {
  const longEnough = "a".repeat(50);
  const base = {
    motivationHigherEducation: longEnough,
    motivationSakem: longEnough,
    consistencyPlan: longEnough,
    attendanceCommitment: longEnough,
    parentResponse: longEnough,
    ifParentChangesMind: longEnough,
    agreedToSignedStatement: "ya",
  } as const;

  test("accepts a full interview with agreedToSignedStatement=ya", () => {
    expect(interviewSchema.safeParse(base).success).toBe(true);
  });

  test("rejects agreedToSignedStatement=tidak", () => {
    expect(
      interviewSchema.safeParse({ ...base, agreedToSignedStatement: "tidak" }).success,
    ).toBe(false);
  });

  test("rejects an answer shorter than 20 chars", () => {
    expect(
      interviewSchema.safeParse({ ...base, motivationSakem: "singkat" }).success,
    ).toBe(false);
  });

  test("rejects an answer longer than 2000 chars", () => {
    expect(
      interviewSchema.safeParse({
        ...base,
        motivationSakem: "a".repeat(2001),
      }).success,
    ).toBe(false);
  });
});
