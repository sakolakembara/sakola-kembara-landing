// Client-safe constants + zod schemas + default values for the multi-step
// recruitment form (`/gabung-siswa/form`). Shared between the wizard client
// components and the server action so validation stays in one place.

import { z } from "zod";

// ─── Enums / option lists ─────────────────────────────────────────────

export const RELIGIONS = [
  "Islam",
  "Kristen Protestan",
  "Kristen Katolik",
  "Hindu",
  "Budha",
  "Konghucu",
] as const;

export const BRANCHES = [
  "Cililin",
  "Bandung",
  "Cirebon",
  "Cibodas",
  "Bojong",
  "Purbalingga",
  "Samarinda",
  "Online",
] as const;

export const GRADUATION_BATCHES = [
  "2025/2026 (Gap Year)",
  "2027 (Kelas 12)",
] as const;

export const FATHER_OCCUPATIONS = [
  "Tidak bekerja",
  "Buruh harian",
  "Guru Honorer",
  "Pedagang",
  "Petani",
  "PNS",
  "TNI/Polri",
  "Wiraswasta",
  "Wirausaha",
] as const;

export const MOTHER_OCCUPATIONS = [
  "Ibu rumah tangga",
  "Petani",
  "Pedagang",
  "PNS",
  "Wirausaha",
  "Wiraswasta",
] as const;

export const OTHER_EARNER_RELATIONS = [
  "Kakak",
  "Paman/Bibi",
  "Kakek/Nenek",
] as const;

export const RESIDENCE_STATUSES = [
  "Rumah Pribadi",
  "Mengontrak/Menyewa",
  "Menumpang Pada Orang Lain",
] as const;

export const LIVING_WITH_OPTIONS = ["Ayah", "Ibu"] as const;

// ─── Reusable primitive validators ────────────────────────────────────

const nonEmptyString = (max = 200, msg = "Wajib diisi") =>
  z.string().trim().min(1, msg).max(max);

/** WhatsApp number stored as bare digits, must start with 62 (Indonesia). */
export const whatsappSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^62\d{8,14}$/,
        "Gunakan format 62 diikuti 8–14 digit. Contoh: 6281392254544",
      ),
  );

/** Rupiah amount. Accepts "1.200.000" or "1200000". Rejects "Rp", commas, ranges. */
export const rupiahSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Wajib diisi" });
      return z.NEVER;
    }
    // Reject the common wrong-forms mentioned in the doc.
    if (/rp/i.test(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hilangkan "Rp". Contoh benar: 1.200.000',
      });
      return z.NEVER;
    }
    if (/,/.test(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hilangkan koma. Contoh benar: 1.200.000",
      });
      return z.NEVER;
    }
    if (/-/.test(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Isi satu angka pasti, bukan rentang.",
      });
      return z.NEVER;
    }
    const digits = v.replace(/\./g, "");
    if (!/^\d+$/.test(digits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hanya angka. Contoh: 1.200.000",
      });
      return z.NEVER;
    }
    return Number(digits);
  })
  .pipe(z.number().int().min(0).max(1_000_000_000_000));

/** Non-negative integer field (from `<input type="number">`). */
const nonNegativeInt = (max: number, msg = "Isi dengan angka") =>
  z.coerce
    .number({ invalid_type_error: msg })
    .int(msg)
    .min(0, "Tidak boleh negatif")
    .max(max);

const googleDriveUrlSchema = z
  .string()
  .trim()
  .url("Link tidak valid")
  .refine(
    (v) => /drive\.google\.com|s\.id|bit\.ly|drive\.usercontent/i.test(v),
    "Gunakan link Google Drive folder (drive.google.com/…)",
  );

/** Instagram username without leading `@`. */
const instagramUsernameSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(
    z
      .string()
      .min(1, "Wajib diisi")
      .max(30, "Maksimal 30 karakter")
      .regex(
        /^[a-zA-Z0-9._]+$/,
        "Hanya huruf, angka, titik, dan garis bawah.",
      ),
  );

// ─── Per-step zod schemas ─────────────────────────────────────────────

export const identitySchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Nama minimal 3 karakter")
    .max(120)
    .refine(
      (v) => !/^[A-ZÀ-ÿ ]+$/.test(v),
      "Jangan menggunakan huruf kapital semua. Contoh: Dadi Dinan Haris",
    ),
  nickname: nonEmptyString(60),
  gender: z.enum(["laki-laki", "perempuan"], {
    errorMap: () => ({ message: "Pilih jenis kelamin" }),
  }),
  religion: z.enum(RELIGIONS, {
    errorMap: () => ({ message: "Pilih agama" }),
  }),
  schoolName: nonEmptyString(200),
  branch: z.enum(BRANCHES, {
    errorMap: () => ({ message: "Pilih cabang" }),
  }),
  homeAddress: nonEmptyString(500),
  graduationBatch: z.enum(GRADUATION_BATCHES, {
    errorMap: () => ({ message: "Pilih tahun angkatan" }),
  }),
  whatsapp: whatsappSchema,
});

export const livingWithSchema = z
  .array(z.string().trim().min(1))
  .min(1, "Pilih minimal satu");

export const householdSchema = z
  .object({
    livingWith: livingWithSchema,
    fatherName: nonEmptyString(120),
    fatherOccupation: nonEmptyString(120),
    fatherIncome: rupiahSchema,
    motherName: nonEmptyString(120),
    motherOccupation: nonEmptyString(120),
    motherIncome: rupiahSchema,
    /** Toggle — determines whether the earner blocks are required. */
    hasOtherEarner1: z.boolean(),
    earner1Relation: z.string().trim().max(120).optional().or(z.literal("")),
    earner1Income: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    hasOtherEarner2: z.boolean(),
    earner2Relation: z.string().trim().max(120).optional().or(z.literal("")),
    earner2Income: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    familySize: z.coerce
      .number({ invalid_type_error: "Wajib diisi" })
      .int()
      .min(1, "Minimal 1 (termasuk kamu)")
      .max(20, "Maksimal 20"),
  })
  .superRefine((data, ctx) => {
    if (data.hasOtherEarner1) {
      if (!data.earner1Relation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Wajib diisi",
          path: ["earner1Relation"],
        });
      }
      const parsedIncome = rupiahSchema.safeParse(data.earner1Income);
      if (!parsedIncome.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsedIncome.error.issues[0]?.message ?? "Wajib diisi",
          path: ["earner1Income"],
        });
      }
    }
    if (data.hasOtherEarner2) {
      if (!data.hasOtherEarner1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Isi anggota pertama dulu.",
          path: ["earner2Relation"],
        });
      }
      if (!data.earner2Relation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Wajib diisi",
          path: ["earner2Relation"],
        });
      }
      const parsedIncome = rupiahSchema.safeParse(data.earner2Income);
      if (!parsedIncome.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsedIncome.error.issues[0]?.message ?? "Wajib diisi",
          path: ["earner2Income"],
        });
      }
    }
  });

export const housingSchema = z
  .object({
    residenceStatus: z.enum(RESIDENCE_STATUSES, {
      errorMap: () => ({ message: "Pilih status tempat tinggal" }),
    }),
    buildingArea: nonNegativeInt(10_000, "Isi luas dalam meter persegi"),
    motorcycles: nonNegativeInt(50),
    cars: nonNegativeInt(50),
    hasDebt: z.boolean(),
    debtType: z.string().trim().max(200).optional().or(z.literal("")),
    debtAmount: z.string().trim().optional().or(z.literal("")),
    debtInstallmentMonths: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    debtDescription: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (!data.hasDebt) return;
    if (!data.debtType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Wajib diisi",
        path: ["debtType"],
      });
    }
    const amount = rupiahSchema.safeParse(data.debtAmount);
    if (!amount.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: amount.error.issues[0]?.message ?? "Wajib diisi",
        path: ["debtAmount"],
      });
    }
    const months = z.coerce
      .number({ invalid_type_error: "Wajib diisi" })
      .int("Isi dalam angka bulan tanpa satuan")
      .min(1, "Minimal 1 bulan")
      .max(600, "Maksimal 600 bulan")
      .safeParse(data.debtInstallmentMonths);
    if (!months.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: months.error.issues[0]?.message ?? "Wajib diisi",
        path: ["debtInstallmentMonths"],
      });
    }
    if (!data.debtDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Wajib diisi",
        path: ["debtDescription"],
      });
    }
  });

export const organizationsSchema = z
  .object({
    hasOrganizations: z.boolean(),
    entries: z.array(
      z.object({
        name: z.string().trim().max(200).optional().or(z.literal("")),
        position: z.string().trim().max(200).optional().or(z.literal("")),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    if (!data.hasOrganizations) return;
    const filled = data.entries.filter(
      (e) => (e.name?.trim().length ?? 0) > 0 || (e.position?.trim().length ?? 0) > 0,
    );
    if (filled.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tambahkan minimal satu organisasi",
        path: ["entries"],
      });
      return;
    }
    filled.forEach((e, i) => {
      if (!e.name || e.name.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nama organisasi wajib diisi",
          path: ["entries", i, "name"],
        });
      }
      if (!e.position || e.position.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Jabatan wajib diisi",
          path: ["entries", i, "position"],
        });
      }
    });
  });

export const documentsSchema = z.object({
  folderUrl: googleDriveUrlSchema,
  dtksRegistered: z.enum(["ya", "tidak"], {
    errorMap: () => ({ message: "Pilih Ya atau Tidak" }),
  }),
});

export const marketingSchema = z.object({
  instagramUsername: instagramUsernameSchema,
  folderUrl: googleDriveUrlSchema,
});

const longAnswer = (max = 4000) =>
  z.string().trim().min(20, "Tulis minimal 20 karakter").max(max);

export const interviewSchema = z.object({
  motivationHigherEducation: longAnswer(),
  motivationSakem: longAnswer(),
  consistencyPlan: longAnswer(),
  attendanceCommitment: longAnswer(),
  parentResponse: longAnswer(),
  ifParentChangesMind: longAnswer(),
  agreedToSignedStatement: z
    .enum(["ya", "tidak"], {
      errorMap: () => ({ message: "Pilih Ya atau Tidak" }),
    })
    .refine((v) => v === "ya", {
      message:
        "Pendaftaran hanya dapat dilanjutkan jika kamu bersedia menandatangani surat pernyataan bermaterai.",
    }),
});

// ─── Form values (client-side, before transformation) ─────────────────

export type IdentityValues = z.input<typeof identitySchema>;
export type HouseholdValues = z.input<typeof householdSchema>;
export type HousingValues = z.input<typeof housingSchema>;
export type OrganizationsValues = z.input<typeof organizationsSchema>;
export type DocumentsValues = z.input<typeof documentsSchema>;
export type MarketingValues = z.input<typeof marketingSchema>;
export type InterviewValues = z.input<typeof interviewSchema>;

export type FormValues = {
  identity: IdentityValues;
  household: HouseholdValues;
  housing: HousingValues;
  organizations: OrganizationsValues;
  documents: DocumentsValues;
  marketing: MarketingValues;
  interview: InterviewValues;
};

// ─── Defaults ─────────────────────────────────────────────────────────

export const emptyFormValues: FormValues = {
  identity: {
    fullName: "",
    nickname: "",
    gender: "" as IdentityValues["gender"],
    religion: "" as IdentityValues["religion"],
    schoolName: "",
    branch: "" as IdentityValues["branch"],
    homeAddress: "",
    graduationBatch: "" as IdentityValues["graduationBatch"],
    whatsapp: "",
  },
  household: {
    livingWith: [],
    fatherName: "",
    fatherOccupation: "",
    fatherIncome: "",
    motherName: "",
    motherOccupation: "",
    motherIncome: "",
    hasOtherEarner1: false,
    earner1Relation: "",
    earner1Income: "",
    hasOtherEarner2: false,
    earner2Relation: "",
    earner2Income: "",
    familySize: "" as unknown as number,
  },
  housing: {
    residenceStatus: "" as HousingValues["residenceStatus"],
    buildingArea: "" as unknown as number,
    motorcycles: 0,
    cars: 0,
    hasDebt: false,
    debtType: "",
    debtAmount: "",
    debtInstallmentMonths: "",
    debtDescription: "",
  },
  organizations: {
    hasOrganizations: false,
    entries: [{ name: "", position: "" }],
  },
  documents: {
    folderUrl: "",
    dtksRegistered: "" as DocumentsValues["dtksRegistered"],
  },
  marketing: {
    instagramUsername: "",
    folderUrl: "",
  },
  interview: {
    motivationHigherEducation: "",
    motivationSakem: "",
    consistencyPlan: "",
    attendanceCommitment: "",
    parentResponse: "",
    ifParentChangesMind: "",
    agreedToSignedStatement: "" as InterviewValues["agreedToSignedStatement"],
  },
};

// ─── Step wiring ──────────────────────────────────────────────────────

export const STEPS = [
  { id: "intro", label: "Sebelum Mulai" },
  { id: "identity", label: "Identitas Pribadi" },
  { id: "household", label: "Keluarga & Ekonomi" },
  { id: "housing", label: "Tempat Tinggal & Hutang" },
  { id: "organizations", label: "Organisasi" },
  { id: "documents", label: "Berkas Pendaftaran" },
  { id: "marketing", label: "Berkas Marketing" },
  { id: "interview", label: "Interview Tertulis" },
  { id: "review", label: "Tinjau & Kirim" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

/** Format 1200000 → "1.200.000" for previewing / recap. */
export function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}
