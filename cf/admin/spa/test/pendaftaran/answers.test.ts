import { describe, expect, test } from "vitest";
import { formatRupiah, instagramUrl, type ProfileSection, profileSections, safeWebUrl, whatsappUrl } from "~/pages/applications/answers";
import type { ApplicationDetail } from "~/pages/applications/model";

// The rules of the applicant detail page (a port of app/(admin)/admin/applications/[id]/page.tsx), as data:
// which rows exist when, what kind of value each is, and that what the applicant wrote is never made into a
// link that could run something.

function application(over: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: "a1",
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

const form = {
  formVersion: 2,
  identity: { nickname: "Siti", gender: "perempuan", religion: "Islam", homeAddress: "Jl. Contoh 1\nKota Contoh" },
  household: {
    livingWith: ["Ayah", "Ibu"],
    father: { name: "Bapak", occupation: "Petani", income: 1_200_000 },
    mother: { name: "Ibu", occupation: "IRT", income: 0 },
    otherEarners: [{ relation: "Kakak", income: 800_000 }, { relation: "Paman", income: 500_000 }],
    familySize: 5,
  },
  housing: { residenceStatus: "Milik sendiri", buildingArea: 36, motorcycles: 1, cars: 0, debt: { type: "Bank", amount: 5_000_000, installmentMonths: 24, description: "Modal usaha" } },
  organizations: [{ name: "OSIS", position: "Anggota" }],
  documents: {
    fatherIncomeUrl: "https://drive.contoh.test/a",
    motherIncomeUrl: null,
    otherEarner1IncomeUrl: null,
    otherEarner2IncomeUrl: null,
    debtProofUrl: null,
    electricityBillUrl: "https://drive.contoh.test/listrik",
    familyCardUrl: "https://drive.contoh.test/kk",
    parentPermissionUrl: "https://drive.contoh.test/izin",
    selfPhotoUrl: "https://drive.contoh.test/foto",
    dtksRegistered: true,
    dtksUrl: "https://drive.contoh.test/dtks",
    houseImagesUrl: "https://drive.contoh.test/rumah",
    vehicleImagesUrl: "https://drive.contoh.test/kendaraan",
  },
  marketing: { instagramUsername: "@siti.contoh", instagramFollowProofUrl: "https://drive.contoh.test/f", broadcastProofUrl: "https://drive.contoh.test/b", twibbonUploadUrl: "https://drive.contoh.test/t", storyUploadUrl: "https://drive.contoh.test/s" },
  interview: { motivationHigherEducation: "Ingin kuliah", motivationSakem: "Ingin belajar", consistencyPlan: "Tiap malam", attendanceCommitment: "Penuh", parentResponse: "Mendukung", ifParentChangesMind: "Berdiskusi", agreedToSignedStatement: true },
};

const section = (sections: ProfileSection[], id: string) => sections.find((candidate) => candidate.id === id);
const labels = (sections: ProfileSection[], id: string) => section(sections, id)?.rows.map((row) => row.label);

describe("the sections of a full application, in the legacy order", () => {
  const sections = profileSections(application({ formData: form }));

  test("every section, with the titles of the legacy page (the two about files were renamed: docs/cloudflare/admin-ia.md 3.4)", () => {
    expect(sections.map((entry) => entry.title)).toEqual([
      "Identitas",
      "Pendidikan",
      "Keluarga & Ekonomi",
      "Tempat Tinggal",
      "Organisasi",
      "Tautan berkas",
      "Bukti Marketing",
      "Interview Tertulis",
      "Pengajuan",
    ]);
  });

  test("identity: the legacy rows, the phone number as a WhatsApp link, the address as a paragraph", () => {
    expect(labels(sections, "identitas")).toEqual(["Nama Lengkap", "Panggilan", "Jenis Kelamin", "Agama", "Email", "WhatsApp", "Alamat Rumah"]);
    const rows = section(sections, "identitas")!.rows;
    expect(rows.find((row) => row.label === "Jenis Kelamin")?.value).toEqual({ type: "text", text: "Perempuan" });
    expect(rows.find((row) => row.label === "WhatsApp")?.value).toEqual({ type: "whatsapp", number: "0812-3456-7890" });
    expect(rows.find((row) => row.label === "Alamat Rumah")).toMatchObject({ stack: true, value: { type: "long", text: "Jl. Contoh 1\nKota Contoh" } });
  });

  test("education, with a dash for a missing branch", () => {
    expect(section(sections, "pendidikan")!.rows.map((row) => [row.label, (row.value as { text: string }).text])).toEqual([
      ["Asal Sekolah", "SMAN 1 Contoh"],
      ["Tahun Angkatan", "2026"],
      ["Cabang", "Bandung"],
    ]);
    const without = profileSections(application({ branchPreference: null }));
    expect(section(without, "pendidikan")!.rows[2]!.value).toEqual({ type: "text", text: "—" });
  });

  test("family: names and jobs, money as rupiah, every other earner, the size", () => {
    const rows = section(sections, "keluarga")!.rows;
    expect(rows.map((row) => [row.label, (row.value as { text: string }).text])).toEqual([
      ["Tinggal Bersama", "Ayah, Ibu"],
      ["Ayah", "Bapak · Petani"],
      ["Penghasilan Ayah", formatRupiah(1_200_000)],
      ["Ibu", "Ibu · IRT"],
      ["Penghasilan Ibu", formatRupiah(0)],
      ["Anggota Lain 1", `Kakak · ${formatRupiah(800_000)}`],
      ["Anggota Lain 2", `Paman · ${formatRupiah(500_000)}`],
      ["Jumlah Anggota Keluarga", "5 orang"],
    ]);
    expect(formatRupiah(1_200_000)).toBe("Rp 1.200.000");
  });

  test("housing: the area, the vehicles and a debt with its details, or 'Tidak ada'", () => {
    const rows = section(sections, "tempat-tinggal")!.rows;
    expect(rows.map((row) => row.label)).toEqual(["Status Tempat Tinggal", "Luas Bangunan", "Kendaraan", "Hutang"]);
    expect(rows[1]!.value).toEqual({ type: "text", text: "36 m²" });
    expect(rows[2]!.value).toEqual({ type: "text", text: "1 motor · 0 mobil" });
    expect(rows[3]!.value).toEqual({ type: "debt", kind: "Bank", amount: formatRupiah(5_000_000), months: 24, description: "Modal usaha" });
    const free = profileSections(application({ formData: { ...form, housing: { ...form.housing, debt: null } } }));
    expect(section(free, "tempat-tinggal")!.rows[3]!.value).toEqual({ type: "text", text: "Tidak ada" });
  });

  test("organisations: each one, or 'Belum pernah'", () => {
    expect(section(sections, "organisasi")!.rows).toEqual([{ label: "Organisasi 1", value: { type: "text", text: "OSIS — Anggota" } }]);
    const none = profileSections(application({ formData: { ...form, organizations: [] } }));
    expect(section(none, "organisasi")!.rows).toEqual([{ label: "Pengalaman", value: { type: "text", text: "Belum pernah" } }]);
  });

  test("documents: a link where the applicant gave one, a dash where not; the DTKS letter only for a registered family", () => {
    const rows = section(sections, "berkas")!.rows;
    expect(rows.map((row) => row.label)).toEqual([
      "Surat Penghasilan Ayah", "Surat Penghasilan Ibu", "Surat Penghasilan Anggota Lain 1", "Surat Penghasilan Anggota Lain 2", "Bukti Hutang", "Tagihan/Token Listrik",
      "Kartu Keluarga", "Surat Izin Orang Tua", "Foto Diri", "Foto Rumah", "Foto Kendaraan", "Terdaftar DTKS", "SKTM DTKS",
    ]);
    expect(rows[0]).toMatchObject({ stack: true, value: { type: "link", url: "https://drive.contoh.test/a" } });
    expect(rows[1]!.value).toEqual({ type: "missing" });
    expect(rows[11]!.value).toEqual({ type: "text", text: "Ya" });
    const notRegistered = profileSections(application({ formData: { ...form, documents: { ...form.documents, dtksRegistered: false, dtksUrl: "https://x.test" } } }));
    expect(labels(notRegistered, "berkas")).not.toContain("SKTM DTKS");
    expect(section(notRegistered, "berkas")!.rows.find((row) => row.label === "Terdaftar DTKS")?.value).toEqual({ type: "text", text: "Tidak" });
  });

  test("marketing and the written interview", () => {
    expect(labels(sections, "marketing")).toEqual(["Instagram", "Bukti Follow @sakolakembara", "Bukti Share Broadcast WA", "Bukti Upload Twibbon", "Bukti Share Story Instagram"]);
    expect(section(sections, "marketing")!.rows[0]!.value).toEqual({ type: "instagram", username: "@siti.contoh" });
    expect(labels(sections, "interview")).toEqual([
      "Motivasi Pendidikan Tinggi", "Motivasi Sakola Kembara", "Rencana Konsistensi", "Komitmen Kehadiran", "Tanggapan Orang Tua", "Jika Orang Tua Berubah Pikiran", "Siap Materai",
    ]);
    expect(section(sections, "interview")!.rows[6]!.value).toEqual({ type: "text", text: "Ya" });
  });

  test("the submission: when it was sent and 'Belum ditinjau', then the last note once there is one", () => {
    const first = section(sections, "pengajuan")!.rows;
    expect(first.map((row) => row.label)).toEqual(["Dikirim", "Ditinjau Terakhir"]);
    expect(first[1]!.value).toEqual({ type: "muted", text: "Belum ditinjau" });
    const reviewed = profileSections(application({ formData: form, reviewedAt: "2026-10-02T03:00:00.000Z", reviewNotes: "Berkas lengkap." }));
    const rows = section(reviewed, "pengajuan")!.rows;
    expect(rows.map((row) => row.label)).toEqual(["Dikirim", "Ditinjau Terakhir", "Catatan Review Terakhir"]);
    expect(rows[1]!.value.type).toBe("text");
    expect(rows[2]).toMatchObject({ stack: true, value: { type: "long", text: "Berkas lengkap." } });
  });
});

describe("an application with less than a full form never breaks the page", () => {
  test("no wizard answers: only identity, education and the submission, and the old story when there is one", () => {
    const plain = profileSections(application({ formData: null }));
    expect(plain.map((entry) => entry.id)).toEqual(["identitas", "pendidikan", "pengajuan"]);
    const old = profileSections(application({ formData: null, motivation: "Cerita lama", economicBackground: "Latar lama" }));
    expect(old.map((entry) => entry.id)).toEqual(["identitas", "pendidikan", "cerita-lama", "pengajuan"]);
    expect(section(old, "cerita-lama")!.rows.map((row) => row.label)).toEqual(["Motivasi", "Latar Belakang Ekonomi"]);
    // The old story is for applications that have no answers: with answers it is not shown.
    expect(profileSections(application({ formData: form, motivation: "Cerita lama" })).map((entry) => entry.id)).not.toContain("cerita-lama");
  });

  test("a part that is missing leaves its section out; a part of another shape is read as empty, not as a crash", () => {
    const partial = profileSections(application({ formData: { identity: { nickname: "Siti" } } }));
    expect(partial.map((entry) => entry.id)).toEqual(["identitas", "pendidikan", "pengajuan"]);
    expect(labels(partial, "identitas")).toEqual(["Nama Lengkap", "Panggilan", "Email", "WhatsApp"]);

    for (const weird of ["teks", 42, [], [1, 2], { household: "bukan objek", housing: 7, documents: [], marketing: null, interview: "x", organizations: "x" }, { household: { father: "x", mother: null, otherEarners: "x", livingWith: "x" } }]) {
      expect(() => profileSections(application({ formData: weird })), JSON.stringify(weird)).not.toThrow();
    }
    const odd = profileSections(application({ formData: { household: { father: "x", otherEarners: "x", livingWith: "x", familySize: "banyak" } } }));
    expect(section(odd, "keluarga")!.rows.find((row) => row.label === "Tinggal Bersama")?.value).toEqual({ type: "text", text: "—" });
    expect(section(odd, "keluarga")!.rows.find((row) => row.label === "Jumlah Anggota Keluarga")?.value).toEqual({ type: "text", text: "0 orang" });
  });
});

describe("what the applicant typed is text, and a link is clickable only when it is a web address", () => {
  test("http and https only", () => {
    expect(safeWebUrl("https://drive.google.com/file/d/abc/view")).toBe("https://drive.google.com/file/d/abc/view");
    expect(safeWebUrl("http://contoh.test/x")).toBe("http://contoh.test/x");
    for (const bad of ["javascript:alert(document.cookie)", "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "ftp://contoh.test/x", "//contoh.test/x", "/halaman", "drive.google.com/x", "", "   "]) {
      expect(safeWebUrl(bad), bad).toBeNull();
    }
  });

  test("a phone number becomes its digits at wa.me, or no link when it has none", () => {
    expect(whatsappUrl("0812-3456-7890")).toBe("https://wa.me/081234567890");
    expect(whatsappUrl("+62 812 3456 7890")).toBe("https://wa.me/6281234567890");
    expect(whatsappUrl("tidak ada")).toBeNull();
    expect(whatsappUrl("")).toBeNull();
  });

  test("an Instagram name loses its @, is encoded, and an empty one is no link", () => {
    expect(instagramUrl("@siti.contoh")).toEqual({ handle: "siti.contoh", url: "https://instagram.com/siti.contoh" });
    expect(instagramUrl("siti")).toEqual({ handle: "siti", url: "https://instagram.com/siti" });
    expect(instagramUrl("a/b?c=d#e")?.url).toBe("https://instagram.com/a%2Fb%3Fc%3Dd%23e");
    expect(instagramUrl("@")).toBeNull();
    expect(instagramUrl("")).toBeNull();
  });
});
