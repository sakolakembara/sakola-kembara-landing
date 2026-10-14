import { describe, expect, test } from "vitest";
import portalApi from "../../../docs/cloudflare/portal-api.md?raw";
import {
  isLocalDraft,
  isLocalDraftExpired,
  LOCAL_DRAFT_MAX_AGE_MS,
  LOCAL_DRAFT_VERSION,
  localDraftKey,
  readLocalDraft,
  writeLocalDraft,
  type LocalDraft,
} from "../shared/application-form/draft";
import { buildFormData, FORM_DATA_VERSION, identityColumns } from "../shared/application-form/form-data";
import {
  JSON_BODY_MAX_BYTES,
  MAX_BYTES_PER_APPLICATION,
  MAX_FILE_BYTES,
  MAX_FILES_PER_APPLICATION,
  STEP_BODY_MAX_BYTES,
} from "../shared/application-form/limits";
import { INVALID_FORM_MESSAGE, parseRupiah, sanitizeStep, validateStep, type StepValues } from "../shared/application-form/rules";
import { STEP_SCHEMAS, schemaFor } from "../shared/application-form/schemas";
import {
  ALL_FILE_TYPES,
  DTKS_FILE_REQUIRED_MESSAGE,
  IMAGE_FILE_TYPES,
  isSlotId,
  missingFilesMessage,
  missingSlots,
  missingSlotsOfStep,
  requiredSlots,
  SLOT_IDS,
  SLOTS,
  slotAccepts,
  slotLabel,
  slotsOfStep,
} from "../shared/application-form/slots";
import {
  BRANCHES,
  GRADUATION_BATCHES,
  isStepId,
  RELIGIONS,
  RESIDENCE_STATUSES,
  STEP_IDS,
  STEP_NOT_SAVED_MESSAGE,
  UI_STEP_BUCKETS,
  UI_STEP_LABELS,
  UI_STEP_ORDER,
} from "../shared/application-form/steps";

// The shared form module (cf/admin/shared/application-form): the sixteen slots, the limits, the seven buckets' rules
// with every legacy message pinned, and the transformation to form_data version 3. Pure TypeScript, so it runs here
// like the rest; the contract is docs/cloudflare/portal-api.md, sections 7, 9.3, 11 and 14.

type Body = Record<string, unknown>;

/** A body that passes, for each step. The tests below change one thing at a time. */
const VALID: { [K in keyof StepValues]: Body } = {
  identity: {
    fullName: "Sari Dewi Lestari",
    nickname: "Sari",
    gender: "perempuan",
    religion: "Islam",
    schoolName: "SMA Contoh 1",
    branch: "Cililin",
    homeAddress: "Jl. Contoh No. 1, Kota Contoh",
    graduationBatch: "2027 (Kelas 12)",
    whatsapp: "6281392254544",
  },
  household: {
    livingWith: ["Ayah", "Ibu"],
    fatherName: "Bapak Contoh",
    fatherOccupation: "Petani",
    fatherIncome: "1.200.000",
    motherName: "Ibu Contoh",
    motherOccupation: "Ibu rumah tangga",
    motherIncome: "0",
    hasOtherEarner1: false,
    hasOtherEarner2: false,
    familySize: 4,
  },
  housing: { residenceStatus: "Rumah Pribadi", buildingArea: 36, motorcycles: 1, cars: 0, hasDebt: false },
  organizations: { hasOrganizations: false, entries: [] },
  documents: { dtksRegistered: "tidak" },
  marketing: { instagramUsername: "sari.contoh" },
  interview: {
    motivationHigherEducation: "Saya ingin kuliah dan membanggakan keluarga saya.",
    motivationSakem: "Saya ingin belajar bersama teman-teman yang saling mendukung.",
    consistencyPlan: "Belajar rutin setiap hari dan mengikuti jadwal bimbingan.",
    attendanceCommitment: "Saya siap hadir pada seluruh kegiatan yang dijadwalkan.",
    parentResponse: "Orang tua saya mendukung sepenuhnya rencana ini.",
    ifParentChangesMind: "Saya akan berdiskusi baik-baik dan mencari jalan tengah.",
    agreedToSignedStatement: "ya",
  },
};

function fieldsOf(step: keyof StepValues, body: unknown): Record<string, string> | "ok" {
  const result = validateStep(step, body);
  return result.ok ? "ok" : result.fields;
}

/** What the one field says for this body. */
function messageFor(step: keyof StepValues, patch: Body, field: string, base: Body = VALID[step]): string | "ok" {
  const result = validateStep(step, { ...base, ...patch });
  if (result.ok) return "ok";
  return result.fields[field] ?? `(no message for ${field}: ${JSON.stringify(result.fields)})`;
}

/** Each row: the value of the field, then the message it must give ("ok" when it passes). */
function table(step: keyof StepValues, field: string, rows: [unknown, string][], base?: Body) {
  for (const [value, expected] of rows) {
    test(`${step}.${field} = ${JSON.stringify(value)} -> ${expected}`, () => {
      expect(messageFor(step, { [field]: value }, field, base)).toBe(expected);
    });
  }
}

const REQUIRED = "Wajib diisi";
const long = (n: number) => "x".repeat(n);

// ─── The slots ─────────────────────────────────────────────────────────

describe("the sixteen slots", () => {
  test("the ids, in the order of the table (twelve documents, then four marketing proofs)", () => {
    expect([...SLOT_IDS]).toEqual([
      "father-income",
      "mother-income",
      "other-earner-1-income",
      "other-earner-2-income",
      "debt-proof",
      "electricity-bill",
      "family-card",
      "parent-permission",
      "self-photo",
      "dtks",
      "house-photos",
      "vehicle-photos",
      "marketing-follow-proof",
      "marketing-broadcast-proof",
      "marketing-twibbon-proof",
      "marketing-story-proof",
    ]);
    expect(slotsOfStep("documents")).toHaveLength(12);
    expect(slotsOfStep("marketing")).toEqual(["marketing-follow-proof", "marketing-broadcast-proof", "marketing-twibbon-proof", "marketing-story-proof"]);
  });

  test("ten are required, an eleventh (dtks) only for a DTKS student, and at most 35 files in all", () => {
    expect(requiredSlots(false)).toHaveLength(10);
    expect(requiredSlots(false)).not.toContain("dtks");
    expect(requiredSlots(true)).toHaveLength(11);
    expect(requiredSlots(true)).toContain("dtks");
    expect(SLOT_IDS.reduce((sum, id) => sum + SLOTS[id].maxFiles, 0)).toBe(35);
    expect(MAX_FILES_PER_APPLICATION).toBeGreaterThanOrEqual(35);
  });

  test("the photo of the student takes images only; every other slot takes the four types", () => {
    expect(SLOTS["self-photo"].types).toEqual(IMAGE_FILE_TYPES);
    expect(slotAccepts("self-photo", "pdf")).toBe(false);
    expect(slotAccepts("self-photo", "jpeg")).toBe(true);
    for (const id of SLOT_IDS.filter((slot) => slot !== "self-photo")) expect(SLOTS[id].types, id).toEqual(ALL_FILE_TYPES);
    // GIF and SVG are not accepted anywhere (the admin's blog takes GIF; an applicant's file never does).
    for (const id of SLOT_IDS) expect(SLOTS[id].types as readonly string[], id).not.toContain("gif");
  });

  test("every label is the legacy wording", () => {
    expect(Object.fromEntries(SLOT_IDS.map((id) => [id, slotLabel(id)]))).toEqual({
      "father-income": "Surat Keterangan Penghasilan Ayah",
      "mother-income": "Surat Keterangan Penghasilan Ibu",
      "other-earner-1-income": "Surat Penghasilan Anggota Keluarga Lain (1)",
      "other-earner-2-income": "Surat Penghasilan Anggota Keluarga Lain (2)",
      "debt-proof": "Bukti Hutang",
      "electricity-bill": "Tagihan/Token Listrik 3 Bulan Terakhir",
      "family-card": "Scan Kartu Keluarga",
      "parent-permission": "Surat Izin Orang Tua (bermaterai)",
      "self-photo": "Foto Diri",
      dtks: "Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS",
      "house-photos": "Foto Rumah: depan, ruang tamu, kamar mandi",
      "vehicle-photos": "Foto Kendaraan yang ada di rumah",
      "marketing-follow-proof": "Bukti Follow Instagram @sakolakembara",
      "marketing-broadcast-proof": "Bukti Share Poster + Broadcast ke 3 Grup WhatsApp",
      "marketing-twibbon-proof": "Bukti Upload Twibbon di Feed Instagram",
      "marketing-story-proof": "Bukti Share Poster di Story Instagram",
    });
  });

  test("the code and the table of docs/cloudflare/portal-api.md, 11.1, say the same thing", () => {
    const section = portalApi.slice(portalApi.indexOf("### 11.1 The slots (authoritative)"), portalApi.indexOf("### 11.2"));
    const rows = section.split("\n").filter((line) => /^\| `[a-z0-9-]+` \|/.test(line));
    expect(rows).toHaveLength(SLOT_IDS.length);
    for (const row of rows) {
      const [, id, , label, required, maxFiles, types] = row.split("|").map((cell) => cell.trim());
      const slot = SLOTS[id!.replaceAll("`", "") as (typeof SLOT_IDS)[number]];
      expect(slot, id).toBeDefined();
      expect(label, id).toBe(slot.label);
      expect(Number(maxFiles), id).toBe(slot.maxFiles);
      expect(required!.startsWith("yes") ? true : required!.startsWith("no") ? false : "dtks", id).toBe(slot.required);
      expect(types === "all four" ? ALL_FILE_TYPES.join(",") : types!.replaceAll("`", "").replaceAll(" ", ""), id).toBe(slot.types.join(","));
    }
  });

  test("isSlotId only accepts the sixteen", () => {
    for (const id of SLOT_IDS) expect(isSlotId(id)).toBe(true);
    for (const other of ["", "family_card", "Family-Card", "family-card ", "family-card/../x", "__proto__", "constructor", 1, null, undefined]) expect(isSlotId(other)).toBe(false);
  });

  test("missingSlots: a required slot with no file is missing; an optional one never is; dtks counts only for ya", () => {
    expect(missingSlots({}, false)).toEqual(requiredSlots(false));
    const complete = Object.fromEntries(requiredSlots(false).map((id) => [id, 1]));
    expect(missingSlots(complete, false)).toEqual([]);
    expect(missingSlots(complete, true)).toEqual(["dtks"]);
    expect(missingSlots({ ...complete, dtks: 1 }, true)).toEqual([]);
    expect(missingSlots({ ...complete, "family-card": 0 }, false)).toEqual(["family-card"]);
    expect(missingSlots({ ...complete, "father-income": 0, "debt-proof": 0 }, false)).toEqual([]); // optional
    expect(missingSlots({ ...complete, "not-a-slot": 3 }, false)).toEqual([]); // ignored
    expect(missingSlots({ ...complete, "self-photo": -1 }, false)).toEqual(["self-photo"]);
  });

  test("missingSlotsOfStep splits the submit's two checks, and the message names the labels", () => {
    expect(missingSlotsOfStep("documents", {}, true)).toEqual(["electricity-bill", "family-card", "parent-permission", "self-photo", "dtks", "house-photos", "vehicle-photos"]);
    expect(missingSlotsOfStep("marketing", {}, false)).toEqual(["marketing-follow-proof", "marketing-broadcast-proof", "marketing-twibbon-proof", "marketing-story-proof"]);
    expect(missingFilesMessage(["family-card", "self-photo"])).toBe("Berkas wajib belum lengkap: Scan Kartu Keluarga, Foto Diri.");
    expect(DTKS_FILE_REQUIRED_MESSAGE).toBe("Wajib diisi karena kamu terdaftar DTKS. Unggah SKTM DTKS-mu.");
  });
});

describe("the limits", () => {
  test("the numbers Dzul and the PM decided (one constant each)", () => {
    expect(MAX_FILE_BYTES).toBe(10_000_000);
    expect(MAX_FILES_PER_APPLICATION).toBe(40);
    expect(MAX_BYTES_PER_APPLICATION).toBe(100_000_000);
    expect(JSON_BODY_MAX_BYTES).toBe(16 * 1024);
    expect(STEP_BODY_MAX_BYTES).toBe(32 * 1024);
  });
});

describe("the steps", () => {
  test("seven buckets in the order the submit checks them; eight screens in the legacy order", () => {
    expect([...STEP_IDS]).toEqual(["identity", "household", "housing", "organizations", "documents", "marketing", "interview"]);
    expect([...UI_STEP_ORDER]).toEqual(["intro", "identity", "household", "housing", "organizations", "interview", "documents", "review"]);
    expect(UI_STEP_LABELS.documents).toBe("Pengumpulan Berkas");
    // The screens save exactly the seven buckets, and the marketing proofs live on the documents screen.
    expect(UI_STEP_ORDER.flatMap((screen) => UI_STEP_BUCKETS[screen]).sort()).toEqual([...STEP_IDS].sort());
    expect(UI_STEP_BUCKETS.documents).toEqual(["documents", "marketing"]);
    for (const id of STEP_IDS) expect(STEP_NOT_SAVED_MESSAGE[id], id).toMatch(/belum lengkap\.$/);
    expect(isStepId("identity")).toBe(true);
    for (const other of ["intro", "review", "Identity", "", "__proto__", 3, null]) expect(isStepId(other)).toBe(false);
  });

  test("the option lists are the legacy ones", () => {
    expect([...RELIGIONS]).toEqual(["Islam", "Kristen Protestan", "Kristen Katolik", "Hindu", "Budha", "Konghucu"]);
    expect([...BRANCHES]).toEqual(["Cililin", "Bandung", "Cirebon", "Cibodas", "Bojong", "Purbalingga", "Samarinda", "Online"]);
    expect([...GRADUATION_BATCHES]).toEqual(["2025/2026 (Gap Year)", "2027 (Kelas 12)"]);
    expect([...RESIDENCE_STATUSES]).toEqual(["Rumah Pribadi", "Mengontrak/Menyewa", "Menumpang Pada Orang Lain"]);
  });
});

// ─── Rupiah ────────────────────────────────────────────────────────────

describe("parseRupiah", () => {
  const rows: [string, number | string][] = [
    ["1.200.000", 1_200_000],
    ["1200000", 1_200_000],
    ["0", 0],
    ["  500  ", 500],
    ["007", 7],
    ["1.2.3", 123], // the legacy takes the dots out and does not check where they were
    ["1000000000000", 1_000_000_000_000],
    ["", "Wajib diisi"],
    ["   ", "Wajib diisi"],
    ["Rp 1.000", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
    ["rp1000", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
    ["RP1000", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
    ["1,5", "Hilangkan koma. Contoh benar: 1.200.000"],
    ["1.500.000,00", "Hilangkan koma. Contoh benar: 1.200.000"],
    ["1.000-2.000", "Isi satu angka pasti, bukan rentang."],
    ["-5", "Isi satu angka pasti, bukan rentang."],
    ["abc", "Hanya angka. Contoh: 1.200.000"],
    ["1 000", "Hanya angka. Contoh: 1.200.000"],
    ["1e6", "Hanya angka. Contoh: 1.200.000"],
    ["0x10", "Hanya angka. Contoh: 1.200.000"],
    ["١٢٣", "Hanya angka. Contoh: 1.200.000"], // Arabic-Indic digits are not digits here
    ["1000000000001", "Angka terlalu besar"],
    ["9".repeat(400), "Angka terlalu besar"],
    // The order of the checks: Rp first, then a comma, then a dash, then digits.
    ["Rp 1,5", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
    ["1,5-2", "Hilangkan koma. Contoh benar: 1.200.000"],
  ];
  for (const [input, expected] of rows) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      const result = parseRupiah(input);
      if (typeof expected === "number") expect(result).toEqual({ ok: true, value: expected });
      else expect(result).toEqual({ ok: false, message: expected });
    });
  }
});

// ─── identity ──────────────────────────────────────────────────────────

describe("identity", () => {
  test("a valid body is stored as it is (strings trimmed, unknown keys dropped)", () => {
    const result = validateStep("identity", { ...VALID.identity, fullName: "  Sari Dewi Lestari  ", whatsapp: "62 813 9225 4544", extra: "dropped", role: "super_admin" });
    expect(result).toEqual({ ok: true, value: { ...VALID.identity, whatsapp: "6281392254544" } });
  });

  table("identity", "fullName", [
    ["", "Nama minimal 3 karakter"],
    [undefined, "Nama minimal 3 karakter"],
    [5, "Nama minimal 3 karakter"],
    ["ab", "Nama minimal 3 karakter"],
    ["  ab  ", "Nama minimal 3 karakter"],
    ["abc", "ok"],
    [long(120), "ok"],
    [long(121), "Maksimal 120 karakter"],
    ["DADI DINAN HARIS", "Jangan menggunakan huruf kapital semua. Contoh: Dadi Dinan Haris"],
    ["DADI", "Jangan menggunakan huruf kapital semua. Contoh: Dadi Dinan Haris"],
    ["Dadi DINAN", "ok"],
    ["dadi dinan haris", "ok"],
    ["Éric Contoh", "ok"],
  ]);
  table("identity", "nickname", [
    ["", REQUIRED],
    [undefined, REQUIRED],
    [null, REQUIRED],
    [5, "Isian tidak valid"],
    ["   ", REQUIRED],
    [long(60), "ok"],
    [long(61), "Maksimal 60 karakter"],
  ]);
  table("identity", "gender", [
    ["laki-laki", "ok"],
    ["perempuan", "ok"],
    [" perempuan ", "ok"],
    ["", "Pilih jenis kelamin"],
    ["Perempuan", "Pilih jenis kelamin"],
    ["lainnya", "Pilih jenis kelamin"],
    [undefined, "Pilih jenis kelamin"],
    [1, "Pilih jenis kelamin"],
  ]);
  table("identity", "religion", [
    ...RELIGIONS.map((religion): [string, string] => [religion, "ok"]),
    ["Atheis", "Pilih agama"],
    ["islam", "Pilih agama"],
    ["", "Pilih agama"],
  ]);
  table("identity", "schoolName", [
    ["", REQUIRED],
    [long(200), "ok"],
    [long(201), "Maksimal 200 karakter"],
  ]);
  table("identity", "branch", [
    ...BRANCHES.map((branch): [string, string] => [branch, "ok"]),
    ["Jakarta", "Pilih cabang"],
    ["", "Pilih cabang"],
  ]);
  table("identity", "homeAddress", [
    ["", REQUIRED],
    [long(500), "ok"],
    [long(501), "Maksimal 500 karakter"],
  ]);
  table("identity", "graduationBatch", [
    ...GRADUATION_BATCHES.map((batch): [string, string] => [batch, "ok"]),
    ["2026", "Pilih tahun angkatan"],
    ["", "Pilih tahun angkatan"],
  ]);

  const WHATSAPP = "Gunakan format 62 diikuti 8–14 digit. Contoh: 6281392254544";
  table("identity", "whatsapp", [
    ["6281392254544", "ok"],
    ["62 813 9225 4544", "ok"],
    ["62\t813\n9225 4544", "ok"],
    ["6212345678", "ok"], // 62 and 8 digits
    ["62" + "1".repeat(14), "ok"],
    ["62" + "1".repeat(15), WHATSAPP],
    ["621234567", WHATSAPP], // 62 and 7 digits
    ["081392254544", WHATSAPP],
    ["+6281392254544", WHATSAPP],
    ["62813922545a4", WHATSAPP],
    ["", WHATSAPP],
    [undefined, WHATSAPP],
    [6281392254544, WHATSAPP], // a JSON number is not text
  ]);

  test("every field is reported at once, and the first failure is what the submit prints", () => {
    const result = validateStep("identity", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fields)).toEqual(["fullName", "nickname", "gender", "religion", "schoolName", "branch", "homeAddress", "graduationBatch", "whatsapp"]);
    expect(result.message).toBe("Nama minimal 3 karakter");
    expect(result.issues[0]).toEqual({ path: ["fullName"], message: "Nama minimal 3 karakter" });
  });
});

// ─── household ─────────────────────────────────────────────────────────

describe("household", () => {
  test("a valid body is stored as typed (a rupiah amount stays text until the submit), and an off toggle drops its fields", () => {
    const result = validateStep("household", {
      ...VALID.household,
      livingWith: [" Ayah ", "Kakek"],
      fatherIncome: " 1.200.000 ",
      earner1Relation: "Kakak",
      earner1Income: "999",
      familySize: " 5 ",
    });
    expect(result).toEqual({
      ok: true,
      value: { ...VALID.household, livingWith: ["Ayah", "Kakek"], fatherIncome: "1.200.000", familySize: "5" },
    });
    if (result.ok) {
      expect("earner1Relation" in result.value).toBe(false);
      expect("earner1Income" in result.value).toBe(false);
    }
  });

  test("the example of docs/cloudflare/portal-api.md, section 15, gives exactly the documented fields", () => {
    expect(
      fieldsOf("household", {
        livingWith: ["Ayah", "Ibu"],
        fatherName: "Bapak Contoh",
        fatherOccupation: "Petani",
        fatherIncome: "Rp1.200.000",
        motherName: "Ibu Contoh",
        motherOccupation: "Ibu rumah tangga",
        motherIncome: "0",
        hasOtherEarner1: true,
        earner1Relation: "",
        earner1Income: "1.500.000,00",
        hasOtherEarner2: false,
        familySize: 0,
      }),
    ).toEqual({
      fatherIncome: 'Hilangkan "Rp". Contoh benar: 1.200.000',
      earner1Relation: "Wajib diisi",
      earner1Income: "Hilangkan koma. Contoh benar: 1.200.000",
      familySize: "Minimal 1 (termasuk kamu)",
    });
  });

  table("household", "livingWith", [
    [[], "Pilih minimal satu"],
    [undefined, "Pilih minimal satu"],
    ["Ayah", "Pilih minimal satu"],
    [["Ayah"], "ok"],
    [["Ibu"], "ok"],
    [["Ayah", "Bibi"], "ok"], // free text: the legacy "Other"
    [Array.from({ length: 10 }, (_, i) => `Orang ${i}`), "ok"],
    [Array.from({ length: 11 }, (_, i) => `Orang ${i}`), "Pilih maksimal 10"],
  ]);
  test("an item of livingWith is checked on its own path", () => {
    expect(fieldsOf("household", { ...VALID.household, livingWith: ["Ayah", "  ", long(61), 7] })).toEqual({
      "livingWith.1": REQUIRED,
      "livingWith.2": "Maksimal 60 karakter",
      "livingWith.3": REQUIRED,
    });
    expect(messageFor("household", { livingWith: ["x".repeat(60)] }, "livingWith")).toBe("ok");
  });

  for (const field of ["fatherName", "fatherOccupation", "motherName", "motherOccupation"]) {
    table("household", field, [
      ["", REQUIRED],
      [undefined, REQUIRED],
      [long(120), "ok"],
      [long(121), "Maksimal 120 karakter"],
    ]);
  }
  for (const field of ["fatherIncome", "motherIncome"]) {
    table("household", field, [
      ["1.200.000", "ok"],
      ["0", "ok"],
      ["", REQUIRED],
      [undefined, REQUIRED],
      [null, REQUIRED],
      ["Rp1.000", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
      ["1,5", "Hilangkan koma. Contoh benar: 1.200.000"],
      ["1-2", "Isi satu angka pasti, bukan rentang."],
      ["x", "Hanya angka. Contoh: 1.200.000"],
      [1200000, "Hanya angka. Contoh: 1.200.000"], // a rupiah field is text
      ["1000000000001", "Angka terlalu besar"],
    ]);
  }
  table("household", "hasOtherEarner1", [
    [true, "ok"],
    [false, "ok"],
    [undefined, "ok"], // a missing toggle is off
  ], { ...VALID.household, earner1Relation: "Kakak", earner1Income: "1" });
  table("household", "hasOtherEarner1", [
    ["ya", "Pilih Ya atau Tidak"],
    [1, "Pilih Ya atau Tidak"],
    [null, "Pilih Ya atau Tidak"],
  ]);

  describe("familySize", () => {
    table("household", "familySize", [
      [1, "ok"],
      [20, "ok"],
      ["4", "ok"],
      [" 4 ", "ok"],
      [0, "Minimal 1 (termasuk kamu)"],
      ["0", "Minimal 1 (termasuk kamu)"],
      ["", "Minimal 1 (termasuk kamu)"], // the legacy coerced "" to 0
      [-3, "Minimal 1 (termasuk kamu)"],
      [21, "Maksimal 20"],
      [2.5, "Isi dengan angka bulat"],
      ["2.5", "Isi dengan angka bulat"],
      ["empat", REQUIRED],
      ["4 orang", REQUIRED],
      [undefined, REQUIRED],
      [null, REQUIRED],
      [true, REQUIRED],
      [[4], REQUIRED],
      ["1e1", REQUIRED],
      [Number.NaN, REQUIRED],
    ]);
  });

  describe("the first other earner", () => {
    const on = { ...VALID.household, hasOtherEarner1: true };
    table("household", "earner1Relation", [
      ["Kakak", "ok"],
      ["", REQUIRED],
      [undefined, REQUIRED],
      [long(120), "ok"],
      [long(121), "Maksimal 120 karakter"],
    ], { ...on, earner1Income: "1.500.000" });
    table("household", "earner1Income", [
      ["1.500.000", "ok"],
      ["", REQUIRED],
      [undefined, REQUIRED],
      ["Rp1", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
      ["1,5", "Hilangkan koma. Contoh benar: 1.200.000"],
    ], { ...on, earner1Relation: "Kakak" });
    test("while the toggle is off nothing about the earner is checked or stored", () => {
      const result = validateStep("household", { ...VALID.household, earner1Relation: long(500), earner1Income: "Rp,-" });
      expect(result.ok).toBe(true);
    });
  });

  describe("the second other earner", () => {
    const first = { hasOtherEarner1: true, earner1Relation: "Kakak", earner1Income: "1.500.000" };
    test("with the first filled in, the second needs a relation and an amount", () => {
      expect(fieldsOf("household", { ...VALID.household, ...first, hasOtherEarner2: true })).toEqual({ earner2Relation: REQUIRED, earner2Income: REQUIRED });
      expect(validateStep("household", { ...VALID.household, ...first, hasOtherEarner2: true, earner2Relation: "Paman", earner2Income: "700.000" })).toMatchObject({
        ok: true,
        value: { hasOtherEarner2: true, earner2Relation: "Paman", earner2Income: "700.000" },
      });
    });
    test("the second without the first: 'Isi anggota pertama dulu.' on the relation, first of the messages for that field", () => {
      expect(fieldsOf("household", { ...VALID.household, hasOtherEarner2: true, earner2Relation: "Paman", earner2Income: "700.000" })).toEqual({ earner2Relation: "Isi anggota pertama dulu." });
      // With the relation empty too the legacy still says the first message for the field.
      expect(fieldsOf("household", { ...VALID.household, hasOtherEarner2: true, earner2Income: "1" })).toEqual({ earner2Relation: "Isi anggota pertama dulu." });
    });
    test("an invalid amount of the second earner has its own message", () => {
      expect(fieldsOf("household", { ...VALID.household, ...first, hasOtherEarner2: true, earner2Relation: "Paman", earner2Income: "7,5" })).toEqual({
        earner2Income: "Hilangkan koma. Contoh benar: 1.200.000",
      });
    });
  });

  test("the plain fields come first, then the conditional ones (what the submit prints is issues[0])", () => {
    const result = validateStep("household", { ...VALID.household, hasOtherEarner1: true, familySize: 0, fatherName: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path[0])).toEqual(["fatherName", "familySize", "earner1Relation", "earner1Income"]);
    expect(result.message).toBe(REQUIRED);
  });
});

// ─── housing ───────────────────────────────────────────────────────────

describe("housing", () => {
  const debt = { hasDebt: true, debtType: "Pinjaman bank", debtAmount: "5.000.000", debtInstallmentMonths: 12, debtDescription: "Untuk modal usaha." };

  test("a valid body, with and without a debt", () => {
    expect(validateStep("housing", VALID.housing)).toEqual({ ok: true, value: VALID.housing });
    expect(validateStep("housing", { ...VALID.housing, ...debt, debtType: " Pinjaman bank " })).toEqual({ ok: true, value: { ...VALID.housing, ...debt } });
    // A debt that is switched off is not stored.
    const off = validateStep("housing", { ...VALID.housing, debtType: "x", debtAmount: "y" });
    expect(off).toEqual({ ok: true, value: VALID.housing });
  });

  table("housing", "residenceStatus", [
    ...RESIDENCE_STATUSES.map((status): [string, string] => [status, "ok"]),
    ["Milik sendiri", "Pilih status tempat tinggal"], // the seed's old wording is not a choice
    ["", "Pilih status tempat tinggal"],
  ]);
  table("housing", "buildingArea", [
    [0, "ok"],
    [36, "ok"],
    ["36", "ok"],
    [10_000, "ok"],
    [10_001, "Maksimal 10000"],
    [-1, "Tidak boleh negatif"],
    ["-1", "Tidak boleh negatif"],
    ["", "Isi luas dalam meter persegi"], // the legacy coerced "" to 0 and passed an untouched field
    [undefined, "Isi luas dalam meter persegi"],
    ["36 m2", "Isi luas dalam meter persegi"],
    ["36,5", "Isi luas dalam meter persegi"],
    [36.5, "Isi luas dalam meter persegi"],
    [null, "Isi luas dalam meter persegi"],
  ]);
  for (const field of ["motorcycles", "cars"]) {
    table("housing", field, [
      [0, "ok"],
      ["2", "ok"],
      [50, "ok"],
      [51, "Maksimal 50"],
      [-1, "Tidak boleh negatif"],
      ["", "Isi dengan angka"],
      [undefined, "Isi dengan angka"],
      ["dua", "Isi dengan angka"],
      [1.5, "Isi dengan angka"],
    ]);
  }

  describe("a debt", () => {
    table("housing", "debtType", [
      ["Pinjaman", "ok"],
      ["", REQUIRED],
      [undefined, REQUIRED],
      [long(200), "ok"],
      [long(201), "Maksimal 200 karakter"],
    ], { ...VALID.housing, ...debt });
    table("housing", "debtAmount", [
      ["5.000.000", "ok"],
      ["", REQUIRED],
      [undefined, REQUIRED],
      ["Rp5", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
    ], { ...VALID.housing, ...debt });
    table("housing", "debtInstallmentMonths", [
      [1, "ok"],
      ["12", "ok"],
      [600, "ok"],
      [601, "Maksimal 600 bulan"],
      [0, "Minimal 1 bulan"],
      ["", "Minimal 1 bulan"], // the legacy coerced "" to 0
      [-2, "Minimal 1 bulan"],
      [1.5, "Isi dalam angka bulan tanpa satuan"],
      ["1.5", "Isi dalam angka bulan tanpa satuan"],
      ["12 bulan", REQUIRED],
      [undefined, REQUIRED],
      [null, REQUIRED],
    ], { ...VALID.housing, ...debt });
    table("housing", "debtDescription", [
      ["Keterangan", "ok"],
      ["", REQUIRED],
      [undefined, REQUIRED],
      [long(500), "ok"],
      [long(501), "Maksimal 500 karakter"],
    ], { ...VALID.housing, ...debt });
    test("nothing about a debt is checked while the toggle is off", () => {
      expect(validateStep("housing", { ...VALID.housing, hasDebt: false, debtInstallmentMonths: "banyak", debtAmount: "Rp,", debtType: long(999) }).ok).toBe(true);
    });
  });
});

// ─── organizations ─────────────────────────────────────────────────────

describe("organizations", () => {
  test("none: the entries are ignored, whatever they hold", () => {
    expect(validateStep("organizations", { hasOrganizations: false, entries: [{ name: "OSIS", position: "Ketua" }] })).toEqual({ ok: true, value: { hasOrganizations: false, entries: [] } });
    expect(validateStep("organizations", { hasOrganizations: false })).toEqual({ ok: true, value: { hasOrganizations: false, entries: [] } });
    expect(validateStep("organizations", { hasOrganizations: false, entries: "not a list" }).ok).toBe(true);
    expect(validateStep("organizations", { hasOrganizations: false, entries: Array.from({ length: 50 }, () => ({})) }).ok).toBe(true);
  });

  test("some: the filled entries are stored, trimmed; an empty row is not an entry", () => {
    expect(
      validateStep("organizations", {
        hasOrganizations: true,
        entries: [
          { name: " OSIS ", position: " Ketua " },
          { name: "", position: "" },
          { name: "Karang Taruna", position: "Anggota" },
        ],
      }),
    ).toEqual({
      ok: true,
      value: {
        hasOrganizations: true,
        entries: [
          { name: "OSIS", position: "Ketua" },
          { name: "Karang Taruna", position: "Anggota" },
        ],
      },
    });
  });

  test("none filled in: 'Tambahkan minimal satu organisasi' on entries", () => {
    for (const entries of [[], [{ name: "", position: "" }], [{ name: "  ", position: " " }, {}], undefined]) {
      expect(fieldsOf("organizations", { hasOrganizations: true, entries })).toEqual({ entries: "Tambahkan minimal satu organisasi" });
    }
  });

  test("every filled entry needs both, on the row it is in (the legacy counted among the filled rows)", () => {
    expect(
      fieldsOf("organizations", {
        hasOrganizations: true,
        entries: [{ name: "", position: "" }, { name: "", position: "Ketua" }, { name: "OSIS", position: "" }, { name: "PMR", position: "Anggota" }],
      }),
    ).toEqual({ "entries.1.name": "Nama organisasi wajib diisi", "entries.2.position": "Jabatan wajib diisi" });
  });

  test("bounds: 20 entries, 200 characters a field, entries must be objects", () => {
    const entry = { name: "OSIS", position: "Ketua" };
    expect(validateStep("organizations", { hasOrganizations: true, entries: Array.from({ length: 20 }, () => entry) }).ok).toBe(true);
    expect(fieldsOf("organizations", { hasOrganizations: true, entries: Array.from({ length: 21 }, () => entry) })).toEqual({ entries: "Maksimal 20 organisasi" });
    expect(fieldsOf("organizations", { hasOrganizations: true, entries: [{ name: long(201), position: long(200) }] })).toEqual({ "entries.0.name": "Maksimal 200 karakter" });
    expect(fieldsOf("organizations", { hasOrganizations: true, entries: [entry, "OSIS", null, [1]] })).toEqual({ "entries.1": "Isian tidak valid", "entries.2": "Isian tidak valid", "entries.3": "Isian tidak valid" });
    expect(fieldsOf("organizations", { hasOrganizations: true, entries: "OSIS" })).toEqual({ entries: "Isian tidak valid" });
    expect(fieldsOf("organizations", { hasOrganizations: "ya", entries: [] })).toEqual({ hasOrganizations: "Pilih Ya atau Tidak" });
  });
});

// ─── documents and marketing ───────────────────────────────────────────

describe("documents", () => {
  table("documents", "dtksRegistered", [
    ["ya", "ok"],
    ["tidak", "ok"],
    [" ya ", "ok"],
    ["Ya", "Pilih Ya atau Tidak"],
    ["", "Pilih Ya atau Tidak"],
    [true, "Pilih Ya atau Tidak"],
    [undefined, "Pilih Ya atau Tidak"],
  ]);
  test("the legacy link fields are gone: they are dropped, never stored", () => {
    const result = validateStep("documents", { dtksRegistered: "ya", fatherIncomeUrl: "https://drive.google.com/x", dtksUrl: "https://drive.google.com/y" });
    expect(result).toEqual({ ok: true, value: { dtksRegistered: "ya" } });
  });
});

describe("marketing", () => {
  test("one leading @ is dropped and the rest is stored", () => {
    expect(validateStep("marketing", { instagramUsername: " @sakolakembara " })).toEqual({ ok: true, value: { instagramUsername: "sakolakembara" } });
    expect(validateStep("marketing", { instagramUsername: "@@x" })).toMatchObject({ ok: false }); // only one
  });
  table("marketing", "instagramUsername", [
    ["sakolakembara", "ok"],
    ["a.b_c9", "ok"],
    ["A", "ok"],
    [long(30), "ok"],
    [long(31), "Maksimal 30 karakter"],
    ["@" + long(30), "ok"],
    ["@" + long(31), "Maksimal 30 karakter"],
    ["", REQUIRED],
    ["@", REQUIRED],
    [undefined, REQUIRED],
    ["sakola kembara", "Hanya huruf, angka, titik, dan garis bawah."],
    ["sakola-kembara", "Hanya huruf, angka, titik, dan garis bawah."],
    ["sakola@kembara", "Hanya huruf, angka, titik, dan garis bawah."],
    ["émile", "Hanya huruf, angka, titik, dan garis bawah."],
  ]);
  test("the proofs are files: the legacy URL fields are dropped", () => {
    expect(validateStep("marketing", { instagramUsername: "x", instagramFollowProofUrl: "https://drive.google.com/x" })).toEqual({ ok: true, value: { instagramUsername: "x" } });
  });
});

// ─── interview ─────────────────────────────────────────────────────────

describe("interview", () => {
  const ANSWERS = ["motivationHigherEducation", "motivationSakem", "consistencyPlan", "attendanceCommitment", "parentResponse", "ifParentChangesMind"];

  test("a valid body is stored with trimmed answers and 'ya'", () => {
    expect(validateStep("interview", { ...VALID.interview, motivationSakem: `   ${VALID.interview.motivationSakem}   ` })).toEqual({ ok: true, value: VALID.interview });
  });

  for (const field of ANSWERS) {
    table("interview", field, [
      [long(20), "ok"],
      [long(19), "Tulis minimal 20 karakter"],
      [` ${long(19)} `, "Tulis minimal 20 karakter"], // spaces do not count
      ["", "Tulis minimal 20 karakter"],
      [undefined, "Tulis minimal 20 karakter"],
      [long(2000), "ok"],
      [long(2001), "Maksimal 2000 karakter"],
      [`${long(2000)}   `, "ok"],
    ]);
  }

  describe("agreedToSignedStatement", () => {
    table("interview", "agreedToSignedStatement", [
      ["ya", "ok"],
      ["tidak", "Pendaftaran hanya dapat dilanjutkan jika kamu bersedia menandatangani surat pernyataan bermaterai."],
      ["", "Pilih Ya atau Tidak"],
      ["Ya", "Pilih Ya atau Tidak"],
      [true, "Pilih Ya atau Tidak"],
      [undefined, "Pilih Ya atau Tidak"],
    ]);
  });
});

// ─── The shape of the validation, for every step ───────────────────────

describe("validateStep and sanitizeStep", () => {
  test("a body that is not an object is a failure with no field and the generic message", () => {
    for (const body of [null, undefined, "text", 5, true, [], [VALID.identity]]) {
      for (const step of STEP_IDS) {
        const result = validateStep(step, body);
        expect(result.ok, `${step} ${JSON.stringify(body)}`).toBe(false);
        if (!result.ok) {
          expect(result.fields).toEqual({});
          expect(result.message).toBe(INVALID_FORM_MESSAGE);
        }
      }
    }
    expect(INVALID_FORM_MESSAGE).toBe("Periksa kembali isian formulir.");
  });

  test("an empty object fails every step that has a required field", () => {
    for (const step of STEP_IDS) {
      const result = validateStep(step, {});
      // `organizations` is the one that passes: nothing to say is a valid answer.
      expect(result.ok, step).toBe(step === "organizations");
    }
  });

  test("a valid sample passes every step, and validating the stored value again gives the same value (the submit does this)", () => {
    for (const step of STEP_IDS) {
      const first = validateStep(step, VALID[step]);
      expect(first.ok, step).toBe(true);
      if (!first.ok) continue;
      const again = validateStep(step, JSON.parse(JSON.stringify(first.value)));
      expect(again, step).toEqual(first);
      expect(sanitizeStep(step, VALID[step]), step).toEqual(first.value);
    }
    expect(sanitizeStep("identity", {})).toBeNull();
  });

  test("hostile input never throws and never stores a prototype key", () => {
    const hostile = JSON.parse('{"__proto__": {"admin": true}, "constructor": {"prototype": {"x": 1}}, "fullName": "Sari Dewi", "toString": "x"}');
    for (const step of STEP_IDS) expect(() => validateStep(step, hostile), step).not.toThrow();
    const stored = sanitizeStep("identity", { ...VALID.identity, ...hostile });
    expect(stored).not.toBeNull();
    expect(Object.keys(stored!).sort()).toEqual(Object.keys(VALID.identity).sort());
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  test("a body at the limit of what the API reads (32 KiB) validates in a blink: nothing here loops over the input", () => {
    const huge = { ...VALID.household, livingWith: Array.from({ length: 5000 }, () => "Ayah") };
    const started = performance.now();
    expect(fieldsOf("household", huge)).toEqual({ livingWith: "Pilih maksimal 10" });
    expect(performance.now() - started).toBeLessThan(200);
  });
});

// ─── zod ───────────────────────────────────────────────────────────────

describe("the zod schemas say what the rules say", () => {
  test("parsing gives the stored value", () => {
    for (const step of STEP_IDS) {
      const parsed = STEP_SCHEMAS[step].safeParse(VALID[step]);
      expect(parsed.success, step).toBe(true);
      if (parsed.success) expect(parsed.data, step).toEqual(sanitizeStep(step, VALID[step]));
    }
  });

  test("a failure has the same messages, paths and order as validateStep", () => {
    const bodies: [keyof StepValues, unknown][] = [
      ["identity", {}],
      ["household", { ...VALID.household, hasOtherEarner1: true, hasOtherEarner2: true, familySize: "x", livingWith: ["Ayah", ""] }],
      ["housing", { ...VALID.housing, hasDebt: true, buildingArea: "" }],
      ["organizations", { hasOrganizations: true, entries: [{ name: "", position: "Ketua" }] }],
      ["documents", {}],
      ["marketing", { instagramUsername: "a b" }],
      ["interview", { ...VALID.interview, agreedToSignedStatement: "tidak", motivationSakem: "pendek" }],
      ["identity", "not an object"],
    ];
    for (const [step, body] of bodies) {
      const parsed = STEP_SCHEMAS[step].safeParse(body);
      const direct = validateStep(step, body);
      expect(parsed.success, step).toBe(false);
      expect(direct.ok, step).toBe(false);
      if (parsed.success || direct.ok) continue;
      expect(parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })), step).toEqual(direct.issues);
    }
  });

  test("schemaFor finds a schema by name, and only the seven", () => {
    for (const step of STEP_IDS) expect(schemaFor(step)).toBe(STEP_SCHEMAS[step]);
    for (const other of ["intro", "review", "", "__proto__", "toString"]) expect(schemaFor(other)).toBeNull();
  });
});

// ─── form_data version 3 ───────────────────────────────────────────────

describe("buildFormData and identityColumns", () => {
  function buckets(patch: Partial<{ [K in keyof StepValues]: Body }> = {}): StepValues {
    const out: Partial<StepValues> = {};
    for (const step of STEP_IDS) {
      const result = validateStep(step, patch[step] ?? VALID[step]);
      if (!result.ok) throw new Error(`${step}: ${JSON.stringify(result.fields)}`);
      (out as Record<string, unknown>)[step] = result.value;
    }
    return out as StepValues;
  }

  test("the version is 3", () => {
    expect(FORM_DATA_VERSION).toBe(3);
  });

  test("a whole application becomes exactly the shape of docs/cloudflare/portal-api.md, 9.3 (rupiah to numbers, earners, debt, organizations)", () => {
    const formData = buildFormData(
      buckets({
        household: {
          ...VALID.household,
          fatherIncome: "1.200.000",
          motherIncome: "0",
          hasOtherEarner1: true,
          earner1Relation: "Kakak",
          earner1Income: "1500000",
          hasOtherEarner2: true,
          earner2Relation: "Paman",
          earner2Income: "700.000",
          familySize: "5",
        },
        housing: { ...VALID.housing, buildingArea: "36", hasDebt: true, debtType: "Pinjaman bank", debtAmount: "5.000.000", debtInstallmentMonths: "12", debtDescription: "Untuk modal usaha." },
        organizations: { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }, { name: "", position: "" }, { name: "PMR", position: "Anggota" }] },
        documents: { dtksRegistered: "ya" },
      }),
    );
    expect(formData).toEqual({
      formVersion: 3,
      identity: { nickname: "Sari", gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh No. 1, Kota Contoh" },
      household: {
        livingWith: ["Ayah", "Ibu"],
        father: { name: "Bapak Contoh", occupation: "Petani", income: 1_200_000 },
        mother: { name: "Ibu Contoh", occupation: "Ibu rumah tangga", income: 0 },
        otherEarners: [
          { relation: "Kakak", income: 1_500_000 },
          { relation: "Paman", income: 700_000 },
        ],
        familySize: 5,
      },
      housing: {
        residenceStatus: "Rumah Pribadi",
        buildingArea: 36,
        motorcycles: 1,
        cars: 0,
        debt: { type: "Pinjaman bank", amount: 5_000_000, installmentMonths: 12, description: "Untuk modal usaha." },
      },
      organizations: [
        { name: "OSIS", position: "Ketua" },
        { name: "PMR", position: "Anggota" },
      ],
      documents: { dtksRegistered: true },
      marketing: { instagramUsername: "sari.contoh" },
      interview: VALID.interview,
    });
  });

  test("no earners, no debt and no organizations: empty lists and null, and no link field anywhere", () => {
    const formData = buildFormData(buckets());
    expect(formData.household.otherEarners).toEqual([]);
    expect(formData.housing.debt).toBeNull();
    expect(formData.organizations).toEqual([]);
    expect(formData.documents).toEqual({ dtksRegistered: false });
    expect(Object.keys(formData.marketing)).toEqual(["instagramUsername"]);
    expect(JSON.stringify(formData)).not.toMatch(/Url"|drive\.google/);
    // The output is JSON-clean (it goes into a json column).
    expect(JSON.parse(JSON.stringify(formData))).toEqual(formData);
  });

  test("a bucket that was not validated throws instead of writing a wrong number", () => {
    const good = buckets();
    const bad = { ...good, household: { ...good.household, fatherIncome: "banyak" } };
    expect(() => buildFormData(bad)).toThrow("buildFormData");
    expect(() => buildFormData({ ...good, housing: { ...good.housing, buildingArea: "" } })).toThrow("buildFormData");
  });

  test("the five columns come out of the identity bucket (the email is the account's)", () => {
    const identity = buckets().identity;
    expect(identityColumns(identity)).toEqual({
      fullName: "Sari Dewi Lestari",
      whatsapp: "6281392254544",
      schoolName: "SMA Contoh 1",
      graduationYear: "2027 (Kelas 12)",
      branchPreference: "Cililin",
    });
  });
});

// ─── The draft the browser keeps ───────────────────────────────────────

describe("the local draft (localStorage)", () => {
  const NOW = Date.UTC(2026, 9, 13, 5, 0, 0);
  const draft = (patch: Partial<LocalDraft> = {}): LocalDraft => ({
    version: LOCAL_DRAFT_VERSION,
    savedAt: NOW - 1000,
    stepIndex: 2,
    visited: ["intro", "identity", "household"],
    values: { identity: { fullName: "Sari Dew" }, household: { fatherName: "" } },
    ...patch,
  });

  test("the key carries the version, the user id and the batch id, and nothing personal", () => {
    const user = "5f1d2c3b-0000-4000-8000-000000000001";
    const batch = "8b7e0c1a-0000-4000-8000-000000000002";
    expect(localDraftKey(user, batch)).toBe(`sakem-portal:v1:${user}:${batch}`);
    expect(LOCAL_DRAFT_VERSION).toBe(1);
  });

  test("savedAt is part of the type and is a finite, positive number of epoch milliseconds", () => {
    expect(isLocalDraft(draft())).toBe(true);
    for (const savedAt of [undefined, null, "1760331600000", "", 0, -5, Number.NaN, Number.POSITIVE_INFINITY, true, [], {}]) {
      expect(isLocalDraft({ ...draft(), savedAt }), String(savedAt)).toBe(false);
    }
    const { savedAt: _omitted, ...without } = draft();
    expect(isLocalDraft(without)).toBe(false);
  });

  test("the rest of the shape: version, step index inside the eight screens, known screens, known buckets that are objects", () => {
    expect(isLocalDraft(draft({ stepIndex: 0 }))).toBe(true);
    expect(isLocalDraft(draft({ stepIndex: UI_STEP_ORDER.length - 1 }))).toBe(true);
    for (const stepIndex of [-1, UI_STEP_ORDER.length, 1.5, "2" as never, Number.NaN]) expect(isLocalDraft(draft({ stepIndex })), String(stepIndex)).toBe(false);
    expect(isLocalDraft({ ...draft(), version: 2 })).toBe(false);
    expect(isLocalDraft(draft({ visited: ["intro", "marketing" as never] }))).toBe(false); // marketing has no screen of its own
    expect(isLocalDraft(draft({ visited: "intro" as never }))).toBe(false);
    expect(isLocalDraft(draft({ values: { review: {} } as never }))).toBe(false);
    expect(isLocalDraft(draft({ values: { identity: "x" } as never }))).toBe(false);
    expect(isLocalDraft(draft({ values: [] as never }))).toBe(false);
    expect(isLocalDraft(draft({ values: {} }))).toBe(true);
    for (const junk of [null, undefined, "draft", 5, [], true]) expect(isLocalDraft(junk)).toBe(false);
  });

  test("a copy is too old at 30 days, not before; a clock that was wrong (savedAt in the future) is not old", () => {
    expect(LOCAL_DRAFT_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(isLocalDraftExpired({ savedAt: NOW - LOCAL_DRAFT_MAX_AGE_MS + 1 }, NOW)).toBe(false);
    expect(isLocalDraftExpired({ savedAt: NOW - LOCAL_DRAFT_MAX_AGE_MS }, NOW)).toBe(true);
    expect(isLocalDraftExpired({ savedAt: NOW + 86_400_000 }, NOW)).toBe(false);
  });

  test("readLocalDraft: the draft, or null for everything that is not worth keeping", () => {
    expect(readLocalDraft(JSON.stringify(draft()), NOW)).toEqual(draft());
    expect(readLocalDraft(null, NOW)).toBeNull();
    expect(readLocalDraft(undefined, NOW)).toBeNull();
    expect(readLocalDraft("", NOW)).toBeNull();
    expect(readLocalDraft("{not json", NOW)).toBeNull();
    expect(readLocalDraft("null", NOW)).toBeNull();
    expect(readLocalDraft(JSON.stringify({ ...draft(), savedAt: "1760331600000" }), NOW)).toBeNull(); // the shell purges a draft without a numeric savedAt
    expect(readLocalDraft(JSON.stringify({ ...draft(), savedAt: undefined }), NOW)).toBeNull();
    expect(readLocalDraft(JSON.stringify(draft({ savedAt: NOW - LOCAL_DRAFT_MAX_AGE_MS - 1 })), NOW)).toBeNull();
  });

  test("writeLocalDraft stamps the time and reads back", () => {
    const { savedAt: _savedAt, version: _version, ...typed } = draft();
    const text = writeLocalDraft(typed, NOW);
    expect(JSON.parse(text)).toMatchObject({ version: 1, savedAt: NOW });
    expect(readLocalDraft(text, NOW + 1)).toEqual({ ...typed, version: 1, savedAt: NOW });
    // A caller cannot smuggle another time in.
    expect(JSON.parse(writeLocalDraft({ ...typed, savedAt: 1 } as never, NOW)).savedAt).toBe(NOW);
  });
});
