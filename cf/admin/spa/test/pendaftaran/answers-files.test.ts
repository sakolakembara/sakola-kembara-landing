import { slotLabel, slotsOfStep } from "@shared/application-form/slots";
import { describe, expect, test } from "vitest";
import { fileTypeLabel, formatBytes, type ProfileSection, profileSections, type ProfileSource } from "~/pages/applications/answers";
import type { ApplicationDetail, ApplicationFile } from "~/pages/applications/model";

// Version 3 of the applicant detail (SAKEM-083, docs/cloudflare/portal-architecture.md, 8.8): the answers hold UPLOADS,
// not pasted links. The sections are 'Berkas' and 'Bukti Marketing', a row per slot in the order of the slot table
// (shared/application-form/slots.ts), the count and size of what a slot holds, and who may open it. Version 2 keeps its
// links (answers.test.ts). Pure data: the page draws it (FilesSection.tsx).

function application(over: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: "app-1",
    batch: { id: "b1", year: 2026, name: "Gen 7" },
    fullName: "Siti Contoh",
    email: "siti@contoh.test",
    whatsapp: "0812-3456-7890",
    schoolName: "SMAN 1 Contoh",
    graduationYear: "2026",
    branchPreference: "Bandung",
    motivation: null,
    economicBackground: null,
    formData: null,
    status: "pending",
    reviewNotes: null,
    reviewedAt: null,
    submittedAt: "2026-10-01T03:00:00.000Z",
    updatedAt: "2026-10-01T03:00:00.000Z",
    ...over,
  };
}

const upload = (id: string, slot: ApplicationFile["slot"], over: Partial<ApplicationFile> = {}): ApplicationFile => ({
  id,
  slot,
  contentType: "image/png",
  size: 1000,
  width: 40,
  height: 30,
  uploadedAt: "2026-10-01T03:00:00.000Z",
  ...over,
});

const formV3 = {
  formVersion: 3,
  identity: { nickname: "Siti", gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh 1" },
  household: { livingWith: ["Ayah"], father: { name: "Bapak", occupation: "Petani", income: 1_200_000 }, mother: { name: "Ibu", occupation: "IRT", income: 0 }, otherEarners: [], familySize: 4 },
  housing: { residenceStatus: "Milik sendiri", buildingArea: 36, motorcycles: 1, cars: 0, debt: null },
  organizations: [],
  documents: { dtksRegistered: true },
  marketing: { instagramUsername: "siti.contoh" },
  interview: { motivationSakem: "Ingin belajar", agreedToSignedStatement: true },
};

const formV2 = { formVersion: 2, documents: { familyCardUrl: "https://drive.contoh.test/kk", dtksRegistered: false }, marketing: { instagramUsername: "@siti" } };

const section = (sections: ProfileSection[], id: string) => sections.find((candidate) => candidate.id === id);
const labels = (sections: ProfileSection[], id: string) => section(sections, id)?.rows.map((row) => row.label);

const files = [
  upload("f1", "family-card", { contentType: "application/pdf", size: 812_345, width: null, height: null }),
  upload("f2", "family-card", { size: 2000 }),
  upload("f3", "self-photo"),
  upload("f4", "dtks", { contentType: "application/pdf", width: null, height: null }),
  upload("f5", "marketing-broadcast-proof"),
];

const v3 = (over: Partial<ProfileSource> = {}) => profileSections({ ...application({ formData: formV3 }), formVersion: 3, files, canOpenFiles: true, ...over });

describe("version 3: the files of an applicant, by slot", () => {
  test("the sections are 'Berkas' and 'Bukti Marketing' (no 'Tautan berkas'), and a row per slot in the order of the slot table", () => {
    const sections = v3();
    expect(sections.map((entry) => entry.title)).toEqual(["Identitas", "Pendidikan", "Keluarga & Ekonomi", "Tempat Tinggal", "Organisasi", "Berkas", "Bukti Marketing", "Interview Tertulis", "Pengajuan"]);
    expect(labels(sections, "berkas")).toEqual(["Terdaftar DTKS", ...slotsOfStep("documents").map((id) => slotLabel(id))]);
    expect(labels(sections, "marketing")).toEqual(["Instagram", ...slotsOfStep("marketing").map((id) => slotLabel(id))]);
  });

  test("a slot with files is a `files` value (the application, the files, who may open them); a slot with none is a dash", () => {
    const rows = section(v3(), "berkas")!.rows;
    const byLabel = (label: string) => rows.find((row) => row.label === label)!;
    expect(byLabel(slotLabel("family-card"))).toMatchObject({ stack: true, value: { type: "files", applicationId: "app-1", canOpen: true } });
    expect((byLabel(slotLabel("family-card")).value as { files: ApplicationFile[] }).files.map((file) => file.id)).toEqual(["f1", "f2"]);
    expect((byLabel(slotLabel("self-photo")).value as { files: ApplicationFile[] }).files.map((file) => file.id)).toEqual(["f3"]);
    expect(byLabel(slotLabel("father-income")).value).toEqual({ type: "missing" });
    expect(byLabel(slotLabel("electricity-bill")).value).toEqual({ type: "missing" });
    expect(byLabel("Terdaftar DTKS").value).toEqual({ type: "text", text: "Ya" });
    const marketing = section(v3(), "marketing")!.rows;
    expect(marketing[0]!.value).toEqual({ type: "instagram", username: "siti.contoh" });
    expect(marketing.find((row) => row.label === slotLabel("marketing-broadcast-proof"))!.value).toMatchObject({ type: "files" });
    expect(marketing.find((row) => row.label === slotLabel("marketing-story-proof"))!.value).toEqual({ type: "missing" });
  });

  test("nobody who may not open them is offered to: `canOpen` is false for a viewer and when the flag is absent", () => {
    for (const over of [{ canOpenFiles: false }, { canOpenFiles: undefined }]) {
      const rows = section(v3(over), "berkas")!.rows.filter((row) => row.value.type === "files");
      expect(rows.length).toBeGreaterThan(0);
      for (const entry of rows) expect((entry.value as { canOpen: boolean }).canOpen, JSON.stringify(over)).toBe(false);
    }
  });

  test("the SKTM slot is a row only for a family registered in DTKS", () => {
    expect(labels(v3(), "berkas")).toContain(slotLabel("dtks"));
    const not = profileSections({ ...application({ formData: { ...formV3, documents: { dtksRegistered: false } } }), formVersion: 3, files, canOpenFiles: true });
    expect(labels(not, "berkas")).not.toContain(slotLabel("dtks"));
    expect(section(not, "berkas")!.rows[0]!.value).toEqual({ type: "text", text: "Tidak" });
  });

  test("version 3 is known from the Worker's formVersion, or from the answers when it says nothing; version 2 keeps its links", () => {
    const fromAnswers = profileSections({ ...application({ formData: formV3 }), files });
    expect(section(fromAnswers, "berkas")!.title).toBe("Berkas");
    expect(section(profileSections(application({ formData: formV2 })), "berkas")!.title).toBe("Tautan berkas");
    // The Worker's word wins: version 2 answers with a stray file list still show links, not files.
    const stray = profileSections({ ...application({ formData: formV2 }), formVersion: 2, files, canOpenFiles: true });
    expect(section(stray, "berkas")!.title).toBe("Tautan berkas");
    expect(JSON.stringify(stray)).not.toContain('"type":"files"');
  });

  test("an application with no files at all, and one whose answers lack a documents bucket, still show every slot as a dash", () => {
    const empty = profileSections({ ...application({ formData: formV3 }), formVersion: 3, files: [], canOpenFiles: true });
    expect(section(empty, "berkas")!.rows.slice(1).every((row) => row.value.type === "missing")).toBe(true);
    const bare = profileSections({ ...application({ formData: { formVersion: 3, identity: formV3.identity } }), formVersion: 3, files: [], canOpenFiles: false });
    expect(section(bare, "berkas")!.rows.slice(1)).toHaveLength(slotsOfStep("documents").length - 1); // no `dtks` row: not registered
    expect(section(bare, "marketing")!.rows[0]!.value).toEqual({ type: "instagram", username: "" });
  });

  test("a file the applicant uploaded is never a link by itself: no `link` value anywhere in a version 3 page", () => {
    expect(JSON.stringify(v3())).not.toContain('"type":"link"');
  });
});

describe("how a file is described", () => {
  test("sizes in decimal units with the Indonesian comma", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1 kB");
    expect(formatBytes(45_500)).toBe("45,5 kB");
    expect(formatBytes(1_000_000)).toBe("1 MB");
    expect(formatBytes(1_840_000)).toBe("1,8 MB");
    expect(formatBytes(10_000_000)).toBe("10 MB");
  });

  test("the four stored types by their names", () => {
    expect(["image/png", "image/jpeg", "image/webp", "application/pdf"].map(fileTypeLabel)).toEqual(["PNG", "JPEG", "WebP", "PDF"]);
  });
});
