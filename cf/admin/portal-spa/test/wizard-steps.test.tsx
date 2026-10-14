import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setFileUploader } from "~/lib/files/client";
import { choose, localCopy, next, openAt, REQUIRED_DOCUMENTS, REQUIRED_PROOFS, resetWizardMocks, setText, slotGroup, summaryLines, upload, uploadEverything, wizardServer } from "./wizard-helpers";

// Each screen of the wizard: what it asks, the legacy words of what it refuses, and what it hides until it is needed. The
// rules are the shared module's (pinned message by message in the Worker suite); these tests are about the SCREEN: that the
// message of a field appears under it and in the summary, and that nothing is sent while a screen does not pass.

// A whole run through the wizard is many screens: allow for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => void wizardServer());
afterEach(resetWizardMocks);

const user = () => userEvent.setup({ applyAccept: false, delay: null });
const heading = (name: string) => screen.findByRole("heading", { name });
/** What is shown under a field (the kit's `<name>-error`), by the field's label. */
const errorOf = (label: string | RegExp) => {
  const control = screen.getByRole("textbox", { name: label });
  return document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
};

describe("Identitas Pribadi", () => {
  test("nothing is filled in but the name from the account: every other field is refused in the legacy words, and nothing is sent", async () => {
    const u = user();
    const api = wizardServer();
    openAt("identity");
    await heading("Identitas Pribadi");
    expect((screen.getByRole("textbox", { name: "Nama Lengkap" }) as HTMLInputElement).value).toBe("Sari Dewi");

    await next(u);
    expect(summaryLines()).toEqual([
      "Nama Panggilan: Wajib diisi",
      "Jenis Kelamin: Pilih jenis kelamin",
      "Agama: Pilih agama",
      "Asal Sekolah: Wajib diisi",
      "Cabang Sakola Kembara: Pilih cabang",
      "Alamat Rumah: Wajib diisi",
      "Tahun Angkatan Kelulusan: Pilih tahun angkatan",
      "Nomor WhatsApp Pribadi: Gunakan format 62 diikuti 8–14 digit. Contoh: 6281392254544",
    ]);
    expect(errorOf("Nama Panggilan")).toBe("Wajib diisi");
    expect(api.writes()).toEqual([]);
  });

  test("the name that is all capitals, too short or too long is refused with the legacy sentence", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    setText("Nama Lengkap", "SARI DEWI");
    await next(u);
    expect(errorOf("Nama Lengkap")).toBe("Jangan menggunakan huruf kapital semua. Contoh: Dadi Dinan Haris");
    setText("Nama Lengkap", "Sa");
    await next(u);
    expect(errorOf("Nama Lengkap")).toBe("Nama minimal 3 karakter");
    setText("Nama Lengkap", `Sari ${"a".repeat(130)}`);
    await next(u);
    expect(errorOf("Nama Lengkap")).toBe("Maksimal 120 karakter");
  });

  test("the WhatsApp number loses its spaces as it is typed, and a number that is not 62 and 8 to 14 digits is refused", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    setText("Nomor WhatsApp Pribadi", "62 812 0000 0001");
    expect((screen.getByRole("textbox", { name: "Nomor WhatsApp Pribadi" }) as HTMLInputElement).value).toBe("6281200000001");
    setText("Nomor WhatsApp Pribadi", "081200000001");
    await next(u);
    expect(errorOf("Nomor WhatsApp Pribadi")).toBe("Gunakan format 62 diikuti 8–14 digit. Contoh: 6281392254544");
  });

  test("a field's message goes when the student changes that field, the others stay until the next try", async () => {
    const u = user();
    openAt("identity");
    await heading("Identitas Pribadi");
    await next(u);
    expect(errorOf("Nama Panggilan")).toBe("Wajib diisi");
    setText("Nama Panggilan", "Sari");
    expect(screen.getByRole("textbox", { name: "Nama Panggilan" }).getAttribute("aria-invalid")).toBeNull();
    expect(errorOf("Asal Sekolah")).toBe("Wajib diisi");
    // The summary still lists what is left to do, and no longer the field that was fixed.
    expect(summaryLines().some((line) => line.startsWith("Nama Panggilan"))).toBe(false);
  });

  test("the radio groups are named by their question, and the options are radios (the keyboard is the browser's)", async () => {
    openAt("identity");
    await heading("Identitas Pribadi");
    const gender = screen.getByRole("group", { name: /Jenis Kelamin/ });
    expect(within(gender).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["laki-laki", "perempuan"]);
    const religion = screen.getByRole("group", { name: /Agama/ });
    expect(within(religion).getAllByRole("radio")).toHaveLength(6);
    expect(within(screen.getByRole("group", { name: /Cabang Sakola Kembara/ })).getAllByRole("radio")).toHaveLength(8);
    expect(within(screen.getByRole("group", { name: /Tahun Angkatan Kelulusan/ })).getAllByRole("radio")).toHaveLength(2);
    // Every option of a group shares one name, which is what makes the arrow keys move between them.
    const names = new Set(within(gender).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).name));
    expect(names.size).toBe(1);
  });
});

describe("Keluarga & Ekonomi", () => {
  test("empty: who the student lives with, the parents, their income and the size of the family are asked for", async () => {
    const u = user();
    const api = wizardServer();
    openAt("household");
    await heading("Keluarga & Ekonomi");
    await next(u);
    expect(summaryLines()).toEqual([
      "Kamu tinggal bersama siapa?: Pilih minimal satu",
      "Nama Ayah: Wajib diisi",
      "Pekerjaan Ayah: Wajib diisi",
      "Penghasilan Ayah per Bulan: Wajib diisi",
      "Nama Ibu: Wajib diisi",
      "Pekerjaan Ibu: Wajib diisi",
      "Penghasilan Ibu per Bulan: Wajib diisi",
      "Jumlah Anggota Keluarga: Minimal 1 (termasuk kamu)",
    ]);
    expect(api.writes()).toEqual([]);
  });

  test("an income is refused for each of the legacy wrong forms, with its own sentence", async () => {
    const u = user();
    openAt("household");
    await heading("Keluarga & Ekonomi");
    const cases: [string, string][] = [
      ["Rp1.200.000", 'Hilangkan "Rp". Contoh benar: 1.200.000'],
      ["1.200.000,00", "Hilangkan koma. Contoh benar: 1.200.000"],
      ["1.000.000-2.000.000", "Isi satu angka pasti, bukan rentang."],
      ["sejuta", "Hanya angka. Contoh: 1.200.000"],
    ];
    for (const [typed, message] of cases) {
      setText("Penghasilan Ayah per Bulan", typed);
      await next(u);
      expect(errorOf("Penghasilan Ayah per Bulan"), typed).toBe(message);
    }
  });

  test("a family member who works: the fields appear when 'Ya' is chosen and the second member only under the first", async () => {
    const u = user();
    openAt("household");
    await heading("Keluarga & Ekonomi");
    expect(screen.queryByText("Anggota 1")).toBeNull();
    await choose(u, /Apakah ada anggota keluarga lain/, "Ya");
    expect(screen.getByText("Anggota 1")).toBeTruthy();
    expect(screen.queryByText("Anggota 2")).toBeNull();
    await choose(u, /Ada anggota keluarga kedua/, "Ya");
    expect(screen.getByText("Anggota 2")).toBeTruthy();

    await next(u);
    expect(summaryLines()).toEqual(expect.arrayContaining(["Anggota 1, Hubungan dengan Kamu: Wajib diisi", "Anggota 1, Penghasilan per Bulan: Wajib diisi", "Anggota 2, Hubungan dengan Kamu: Wajib diisi", "Anggota 2, Penghasilan per Bulan: Wajib diisi"]));
  });

  test("turning the first member off forgets the second too (the legacy form did, and the second needs the first)", async () => {
    const u = user();
    openAt("household", { household: { hasOtherEarner1: true, earner1Relation: "Kakak", earner1Income: "500.000", hasOtherEarner2: true, earner2Relation: "Paman/Bibi", earner2Income: "300.000" } });
    await heading("Keluarga & Ekonomi");
    expect(screen.getByText("Anggota 2")).toBeTruthy();
    await choose(u, /Apakah ada anggota keluarga lain/, "Tidak");
    expect(screen.queryByText("Anggota 1")).toBeNull();
    expect(screen.queryByText("Anggota 2")).toBeNull();
    await waitFor(() => expect(localCopy()?.values.household).toMatchObject({ hasOtherEarner1: false, hasOtherEarner2: false, earner1Relation: "", earner2Income: "" }));
  });

  test("'Lainnya': the box opens and takes focus when it is chosen, what is written is the answer, and an empty box is still 'Wajib diisi'", async () => {
    const u = user();
    openAt("household");
    await heading("Keluarga & Ekonomi");
    const father = screen.getByRole("group", { name: /Pekerjaan Ayah/ });
    expect(within(father).queryByRole("textbox")).toBeNull();
    await u.click(within(father).getByRole("radio", { name: "Lainnya" }));
    const box = within(father).getByRole("textbox", { name: "Lainnya" });
    expect(document.activeElement).toBe(box);
    await next(u);
    expect(summaryLines()).toContain("Pekerjaan Ayah: Wajib diisi");
    fireEvent.change(box, { target: { value: "Nelayan" } });
    expect((within(father).getByRole("radio", { name: "Lainnya" }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(localCopy()?.values.household?.fatherOccupation).toBe("Nelayan"));
  });

  test("a saved 'Lainnya' answer opens with its box showing it, and without stealing focus on the way in", async () => {
    openAt("household", { household: { fatherOccupation: "Nelayan" } });
    await heading("Keluarga & Ekonomi");
    const father = screen.getByRole("group", { name: /Pekerjaan Ayah/ });
    expect((within(father).getByRole("textbox", { name: "Lainnya" }) as HTMLInputElement).value).toBe("Nelayan");
    expect(document.activeElement).not.toBe(within(father).getByRole("textbox", { name: "Lainnya" }));
  });

  test("who the student lives with: Ayah and Ibu are checkboxes and anyone else is written in the box", async () => {
    const u = user();
    openAt("household");
    await heading("Keluarga & Ekonomi");
    await u.click(screen.getByRole("checkbox", { name: "Ayah" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Lainnya" }), { target: { value: "Nenek" } });
    await waitFor(() => expect(localCopy()?.values.household?.livingWith).toEqual(["Ayah", "Nenek"]));
    await u.click(screen.getByRole("checkbox", { name: "Ayah" }));
    await waitFor(() => expect(localCopy()?.values.household?.livingWith).toEqual(["Nenek"]));
    fireEvent.change(screen.getByRole("textbox", { name: "Lainnya" }), { target: { value: "  " } });
    await waitFor(() => expect(localCopy()?.values.household?.livingWith).toEqual([]));
  });

  test("the size of the family is a list of 1 to 20", async () => {
    openAt("household");
    await heading("Keluarga & Ekonomi");
    const options = within(screen.getByRole("combobox", { name: /Jumlah Anggota Keluarga/ })).getAllByRole("option");
    expect(options).toHaveLength(21);
    expect(options[0]?.textContent).toBe("— Pilih —");
    expect(options[20]?.textContent).toBe("20 orang");
  });
});

describe("Tempat Tinggal & Hutang", () => {
  test("a home, its size and the vehicles are asked for; the vehicles start at 0 as in the legacy form", async () => {
    const u = user();
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    expect((screen.getByRole("textbox", { name: "Jumlah Kepemilikan Motor" }) as HTMLInputElement).value).toBe("0");
    await next(u);
    expect(summaryLines()).toEqual(["Status Tempat Tinggal: Pilih status tempat tinggal", "Luas Bangunan Tempat Tinggal: Isi luas dalam meter persegi"]);
  });

  test("the counts are refused with their own sentences", async () => {
    const u = user();
    openAt("housing", { housing: { residenceStatus: "Rumah Pribadi" } });
    await heading("Tempat Tinggal & Hutang");
    const cases: [string, string, string][] = [
      ["Luas Bangunan Tempat Tinggal", "-5", "Tidak boleh negatif"],
      ["Luas Bangunan Tempat Tinggal", "10001", "Maksimal 10000"],
      ["Luas Bangunan Tempat Tinggal", "seratus", "Isi luas dalam meter persegi"],
      ["Jumlah Kepemilikan Motor", "51", "Maksimal 50"],
      ["Jumlah Kepemilikan Mobil", "", "Isi dengan angka"],
    ];
    for (const [label, typed, message] of cases) {
      setText(label, typed);
      await next(u);
      expect(errorOf(label), `${label}: ${typed}`).toBe(message);
      setText(label, label.startsWith("Luas") ? "60" : "0");
    }
  });

  test("debt: its four fields appear with 'Ya' and are asked for; the months have their own rules; 'Tidak' forgets them", async () => {
    const u = user();
    openAt("housing", { housing: { residenceStatus: "Rumah Pribadi", buildingArea: "60" } });
    await heading("Tempat Tinggal & Hutang");
    expect(screen.queryByRole("textbox", { name: "Jenis Hutang" })).toBeNull();
    await choose(u, "Apakah keluarga kamu memiliki hutang?", "Ya");
    await next(u);
    expect(summaryLines()).toEqual(["Jenis Hutang: Wajib diisi", "Jumlah Hutang: Wajib diisi", "Lama Waktu Cicilan: Minimal 1 bulan", "Keterangan Hutang: Wajib diisi"]);
    setText("Lama Waktu Cicilan", "0");
    await next(u);
    expect(errorOf("Lama Waktu Cicilan")).toBe("Minimal 1 bulan");
    setText("Lama Waktu Cicilan", "601");
    await next(u);
    expect(errorOf("Lama Waktu Cicilan")).toBe("Maksimal 600 bulan");
    setText("Jenis Hutang", "Pinjaman bank");
    await choose(u, "Apakah keluarga kamu memiliki hutang?", "Tidak");
    expect(screen.queryByRole("textbox", { name: "Jenis Hutang" })).toBeNull();
    await waitFor(() => expect(localCopy()?.values.housing).toMatchObject({ hasDebt: false, debtType: "", debtInstallmentMonths: "" }));
  });
});

describe("Organisasi", () => {
  test("'Tidak' (the start) says it is fine and asks for nothing; the step is saved as 'no organisations'", async () => {
    const u = user();
    const api = wizardServer();
    openAt("organizations");
    await heading("Organisasi");
    expect(screen.getByText("Tidak masalah! Kamu bisa langsung lanjut ke bagian berikutnya.")).toBeTruthy();
    await next(u);
    await heading("Interview Tertulis");
    expect(api.last("PUT /portal/api/applications/current/steps/organizations")?.body).toEqual({ hasOrganizations: false, entries: [] });
  });

  test("'Ya' with nothing filled in asks for at least one; a row with a name and no position asks for the position, on its own row", async () => {
    const u = user();
    openAt("organizations");
    await heading("Organisasi");
    await choose(u, "Pernah mengikuti organisasi atau kepanitiaan?", "Ya");
    await next(u);
    expect(summaryLines()).toEqual(["Organisasi: Tambahkan minimal satu organisasi"]);
    await u.click(screen.getByRole("button", { name: "Tambah Organisasi" }));
    const names = screen.getAllByRole("textbox", { name: "Nama Organisasi" });
    fireEvent.change(names[1] as HTMLElement, { target: { value: "OSIS SMAN 1 Contoh" } });
    await next(u);
    expect(summaryLines()).toEqual(["Organisasi 2, Jabatan / Posisi: Jabatan wajib diisi"]);
    const positions = screen.getAllByRole("textbox", { name: "Jabatan / Posisi" });
    expect(positions[0]?.getAttribute("aria-invalid")).toBeNull();
    expect(positions[1]?.getAttribute("aria-invalid")).toBe("true");
  });

  test("rows are added and removed; the last one cannot be removed, it is emptied", async () => {
    const u = user();
    openAt("organizations", { organizations: { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }, { name: "Pramuka", position: "Anggota" }] } });
    await heading("Organisasi");
    expect(screen.getAllByRole("textbox", { name: "Nama Organisasi" })).toHaveLength(2);
    await u.click(screen.getByRole("button", { name: "Hapus organisasi 1" }));
    expect(screen.getAllByRole("textbox", { name: "Nama Organisasi" })).toHaveLength(1);
    expect((screen.getByRole("textbox", { name: "Nama Organisasi" }) as HTMLInputElement).value).toBe("Pramuka");
    await u.click(screen.getByRole("button", { name: "Hapus organisasi 1" }));
    expect((screen.getByRole("textbox", { name: "Nama Organisasi" }) as HTMLInputElement).value).toBe("");
  });

  test("turning 'Ya' off puts the list back to one empty row", async () => {
    const u = user();
    openAt("organizations", { organizations: { hasOrganizations: true, entries: [{ name: "OSIS", position: "Ketua" }] } });
    await heading("Organisasi");
    await choose(u, "Pernah mengikuti organisasi atau kepanitiaan?", "Tidak");
    await choose(u, "Pernah mengikuti organisasi atau kepanitiaan?", "Ya");
    expect((screen.getByRole("textbox", { name: "Nama Organisasi" }) as HTMLInputElement).value).toBe("");
  });
});

describe("Interview Tertulis", () => {
  test("six answers of at least 20 characters and the statement are asked for", async () => {
    const u = user();
    openAt("interview");
    await heading("Interview Tertulis");
    await next(u);
    expect(summaryLines()).toEqual([
      "Motivasi Pendidikan Tinggi: Tulis minimal 20 karakter",
      "Motivasi Sakola Kembara: Tulis minimal 20 karakter",
      "Rencana Konsistensi: Tulis minimal 20 karakter",
      "Komitmen Kehadiran: Tulis minimal 20 karakter",
      "Tanggapan Orang Tua: Tulis minimal 20 karakter",
      "Jika Orang Tua Berubah Pikiran: Tulis minimal 20 karakter",
      "Siap Tanda Tangan Materai: Pilih Ya atau Tidak",
    ]);
  });

  test("a student who says 'Tidak' to the signed statement cannot go on, with the legacy sentence", async () => {
    const u = user();
    openAt("interview");
    await heading("Interview Tertulis");
    await choose(u, /Jika diterima, apakah kamu benar-benar siap/, "Tidak");
    await next(u);
    expect(summaryLines()).toContain("Siap Tanda Tangan Materai: Pendaftaran hanya dapat dilanjutkan jika kamu bersedia menandatangani surat pernyataan bermaterai.");
  });

  test("each box counts its characters and stops at 2000 (the legacy counter)", async () => {
    openAt("interview");
    await heading("Interview Tertulis");
    const box = screen.getByRole("textbox", { name: /Mengapa kamu tertarik menjadi bagian/ }) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(2000);
    fireEvent.change(box, { target: { value: "a".repeat(1850) } });
    expect(screen.getByText("1850 / 2000 karakter")).toBeTruthy();
    // The other boxes have their own counter.
    expect(screen.getAllByText("0 / 2000 karakter")).toHaveLength(5);
  });

  test("a shorter answer than 20 characters is refused once trimmed", async () => {
    const u = user();
    openAt("interview");
    await heading("Interview Tertulis");
    setText(/Mengapa kamu tertarik menjadi bagian/, `   ${"a".repeat(19)}   `);
    await next(u);
    expect(summaryLines()).toContain("Motivasi Sakola Kembara: Tulis minimal 20 karakter");
  });
});

describe("Pengumpulan Berkas: the documents, DTKS and the marketing proofs", () => {
  test("nothing yet: DTKS, the Instagram name and every required document and proof are asked for; nothing is sent", async () => {
    const u = user();
    const api = wizardServer();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    expect(screen.getByRole("heading", { name: "Berkas Marketing" })).toBeTruthy();
    await next(u);
    expect(summaryLines()).toEqual([
      "Terdaftar DTKS: Pilih Ya atau Tidak",
      "Username Instagram: Wajib diisi",
      ...[
        "Tagihan/Token Listrik 3 Bulan Terakhir",
        "Scan Kartu Keluarga",
        "Surat Izin Orang Tua (bermaterai)",
        "Foto Diri",
        "Foto Rumah: depan, ruang tamu, kamar mandi",
        "Foto Kendaraan yang ada di rumah",
        "Bukti Follow Instagram @sakolakembara",
        "Bukti Share Poster + Broadcast ke 3 Grup WhatsApp",
        "Bukti Upload Twibbon di Feed Instagram",
        "Bukti Share Poster di Story Instagram",
      ].map((label) => `${label}: Wajib diisi`),
    ]);
    expect(api.writes()).toEqual([]);
  });

  test("the optional documents are not asked for and carry no asterisk; the required ones do", async () => {
    openAt("documents");
    await heading("Berkas Pendaftaran");
    expect(slotGroup("Surat Keterangan Penghasilan Ayah").querySelector("legend span")).toBeNull();
    expect(slotGroup("Bukti Hutang").querySelector("legend span")).toBeNull();
    expect(slotGroup("Scan Kartu Keluarga").querySelector("legend span")?.textContent).toBe("*");
    expect(slotGroup("Foto Diri").querySelector("legend span")?.textContent).toBe("*");
  });

  test("DTKS 'Ya' brings the SKTM slot, and it is required with the legacy sentence; 'Tidak' takes it away", async () => {
    const u = user();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    expect(screen.queryByRole("group", { name: /Surat Keterangan Tidak Mampu/ })).toBeNull();
    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Ya, terdaftar");
    const sktm = screen.getByRole("group", { name: /Surat Keterangan Tidak Mampu \(SKTM\) terdaftar DTKS/ });
    expect(sktm.querySelector("legend span")?.textContent).toBe("*");
    expect(screen.getByText("SKTM tanpa keterangan DTKS tidak dianggap sah.")).toBeTruthy();
    await next(u);
    expect(summaryLines()).toContain("Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS: Wajib diisi karena kamu terdaftar DTKS. Unggah SKTM DTKS-mu.");
    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Tidak terdaftar");
    expect(screen.queryByRole("group", { name: /Surat Keterangan Tidak Mampu/ })).toBeNull();
    await next(u);
    expect(summaryLines().some((line) => line.includes("DTKS-mu"))).toBe(false);
  });

  test("a file sent is listed under its slot, and the slot is no longer 'Wajib diisi' (the message goes with the file)", async () => {
    const u = user();
    wizardServer();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    await next(u);
    expect(within(slotGroup("Scan Kartu Keluarga")).getByText("Wajib diisi")).toBeTruthy();
    await upload(u, "Scan Kartu Keluarga");
    expect(await within(slotGroup("Scan Kartu Keluarga")).findByText("Berkas 1")).toBeTruthy();
    expect(within(slotGroup("Scan Kartu Keluarga")).queryByText("Wajib diisi")).toBeNull();
  });

  test("a student who sent the SKTM and then says 'Tidak' is told it goes when the screen is saved, and it does: the Worker removes it and the screen forgets it", async () => {
    const u = user();
    const api = wizardServer();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    await uploadEverything(u);
    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Ya, terdaftar");
    await upload(u, "Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS");
    expect(await within(slotGroup("Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS")).findByText("Berkas 1")).toBeTruthy();
    expect(screen.queryByText("Berkas SKTM DTKS yang sudah kamu unggah akan dihapus saat bagian ini disimpan.")).toBeNull();

    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Tidak terdaftar");
    expect(screen.getByText("Berkas SKTM DTKS yang sudah kamu unggah akan dihapus saat bagian ini disimpan.")).toBeTruthy();
    await next(u);
    await heading("Tinjau & Kirim");
    expect(api.last("PUT /portal/api/applications/current/steps/documents")?.body).toEqual({ dtksRegistered: "tidak" });
    // The Worker took it away: it is not in the review, and the server no longer lists it.
    const current = await api.apps.handle("GET", "/portal/api/applications/current", {});
    const body = (await current?.json()) as { files: { slot: string }[] };
    expect(body.files.some((stored) => stored.slot === "dtks")).toBe(false);
    // ...and the screen forgot it too: asking for the SKTM again shows an empty slot, not the file that is gone.
    await u.click(within(screen.getByRole("navigation", { name: "Bagian formulir" })).getByRole("button", { name: "Pengumpulan Berkas" }));
    await heading("Berkas Pendaftaran");
    await choose(u, "Apakah kamu terdaftar dalam DTKS?", "Ya, terdaftar");
    expect(within(slotGroup("Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS")).queryByText("Berkas 1")).toBeNull();
    expect(within(slotGroup("Surat Keterangan Tidak Mampu (SKTM) terdaftar DTKS")).getByRole("button", { name: "Pilih berkas" })).toBeTruthy();
  });

  test("a file refused by the Worker says why under its slot, and a 401 on a file goes to the sign-in page", async () => {
    const u = user();
    wizardServer();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    setFileUploader(async () => ({ ok: false, status: 413, message: "Ukuran file maksimal 10 MB.", code: "too_large" }));
    await upload(u, "Scan Kartu Keluarga", "berkas.pdf", "application/pdf", { expectStored: false });
    expect((await within(slotGroup("Scan Kartu Keluarga")).findAllByText("Ukuran file maksimal 10 MB.")).length).toBeGreaterThan(0);
    setFileUploader(async () => ({ ok: false, status: 401, message: "Sesi kamu sudah berakhir. Silakan masuk lagi." }));
    await upload(u, "Foto Diri", "diri.jpg", "image/jpeg", { expectStored: false });
    expect(await screen.findByRole("heading", { name: "Selamat datang kembali" })).toBeTruthy();
  });

  test("the Instagram name loses its @ in the rules and is refused with the legacy sentences", async () => {
    const u = user();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    setText(/Username Instagram/, "sari contoh");
    await next(u);
    expect(errorOf(/Username Instagram/)).toBe("Hanya huruf, angka, titik, dan garis bawah.");
    setText(/Username Instagram/, "a".repeat(31));
    await next(u);
    expect(errorOf(/Username Instagram/)).toBe("Maksimal 30 karakter");
  });

  test("with every answer and every required file it goes on to the review, and the two buckets are saved: documents, then marketing", async () => {
    const u = user();
    const api = wizardServer();
    openAt("documents");
    await heading("Berkas Pendaftaran");
    await u.click(within(screen.getByRole("group", { name: /Apakah kamu terdaftar dalam DTKS/ })).getByRole("radio", { name: "Tidak terdaftar" }));
    setText(/Username Instagram/, "@sari_contoh");
    for (const label of REQUIRED_DOCUMENTS) await upload(u, label, label === "Foto Diri" || label.startsWith("Foto") ? "foto.jpg" : "berkas.pdf", label.startsWith("Foto") ? "image/jpeg" : "application/pdf");
    for (const label of REQUIRED_PROOFS) await upload(u, label, "bukti.png", "image/png");
    await next(u);
    await heading("Tinjau & Kirim");
    expect(api.writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /portal/api/applications/current/steps/documents",
      "PUT /portal/api/applications/current/steps/marketing",
    ]);
    // What is sent is what the rules store: the @ is gone.
    expect(api.last("PUT /portal/api/applications/current/steps/marketing")?.body).toEqual({ instagramUsername: "sari_contoh" });
    expect(api.last("PUT /portal/api/applications/current/steps/documents")?.body).toEqual({ dtksRegistered: "tidak" });
  });
});
