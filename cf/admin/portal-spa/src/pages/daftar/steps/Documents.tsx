import { AlertCircle, Instagram } from "lucide-react";
import { type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { FileSlotField } from "~/components/FileSlotField";
import { typesHint } from "~/lib/files/accept";
import { fileErrorKey } from "~/lib/wizard/fields";
import { SLOTS, type SlotId } from "@shared/application-form/slots";
import { ChoiceField, StepHeader, useForm } from "../form";

// Step 7 of 8, "Pengumpulan Berkas": the documents and, under them, the marketing proofs (the legacy drew both on one screen,
// _steps/documents.tsx and marketing.tsx). Every document is a FILE now, not a pasted link: `FileSlotField` (P4) takes it,
// resizes a photo, sends it, and tells this screen what changed. The sentences about Google Drive, the file-name formats and
// "link harus bisa diakses siapa saja" are gone; the rest of the legacy notes stay, with "unggah" where they said "tempel link".

/** The link to a heading of the document center on the public site (another Worker: a plain link, in a new tab). */
function DocsLink({ siteUrl, hash, children }: { siteUrl: string; hash: string; children: ReactNode }) {
  return (
    <a href={`${siteUrl}/gabung-siswa/docs#${hash}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-blue underline hover:text-primary-blue-dark">
      {children}
    </a>
  );
}

/** What a slot's field says under its label: what it takes (the same line the field itself shows), then the step's own note. */
function slotHint(slot: SlotId, note?: ReactNode): ReactNode {
  const { maxFiles } = SLOTS[slot];
  return (
    <div className="space-y-1">
      <div>
        {typesHint(slot)}. Maksimal 10 MB per berkas.{maxFiles > 1 ? ` Sampai ${maxFiles} berkas.` : ""}
      </div>
      {note && <div>{note}</div>}
    </div>
  );
}

/** One document or proof: the file field, wired to the wizard's list of files and to the screen's errors. */
function Slot({ slot, note, required = SLOTS[slot].required === true }: { slot: SlotId; note?: ReactNode; required?: boolean }) {
  const { errors, filesOf, applyFileChange, setSlotBusy, expire } = useForm();
  return (
    <div data-field={fileErrorKey(slot)}>
      <FileSlotField
        slot={slot}
        files={filesOf(slot)}
        onChange={applyFileChange}
        onUnauthorized={expire}
        onBusyChange={(busy) => setSlotBusy(slot, busy)}
        error={errors[fileErrorKey(slot)]}
        required={required}
        hint={slotHint(slot, note)}
      />
    </div>
  );
}

export function DocumentsStep({ siteUrl }: { siteUrl: string }) {
  const { values, filesOf } = useForm();
  const dtks = values.documents.dtksRegistered;
  const pusat = (hash: string, text: string) => (
    <DocsLink siteUrl={siteUrl} hash={hash}>
      {text}
    </DocsLink>
  );
  const templates = <>Template surat bisa diunduh di {pusat("berkas-pendaftaran", "Pusat Dokumen")}.</>;
  const marketing = (text: string) => <>{pusat("berkas-marketing", text)}</>;

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <StepHeader
          title="Berkas Pendaftaran"
          subtitle="Unggah setiap berkas langsung dari HP atau komputermu di kolom yang sesuai. Setelah bagian ini, kamu akan mengumpulkan berkas marketing di bagian bawah."
        />

        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="text-sm leading-relaxed text-amber-900">
            <p className="mb-1 font-semibold">Sebelum lanjut:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Berkas boleh berupa foto atau PDF, maksimal 10 MB per berkas. Foto akan diperkecil otomatis sebelum dikirim.</li>
              <li>
                Template surat izin, surat penghasilan, dan SKTM bisa{" "}
                <a href={`${siteUrl}/gabung-siswa/docs#berkas-pendaftaran`} target="_blank" rel="noopener noreferrer" className="font-semibold underline hover:text-amber-700">
                  diunduh di sini
                </a>
                .
              </li>
              <li>Dilarang memalsukan atau memanipulasi isi berkas — dapat menjadi alasan diskualifikasi.</li>
            </ul>
          </div>
        </div>

        <div className="space-y-5">
          <Slot slot="father-income" note={<>Kosongkan jika tidak ada. {templates}</>} />
          <Slot slot="mother-income" note={<>Kosongkan jika tidak ada. {templates}</>} />
          <Slot slot="other-earner-1-income" note="Isi jika ada anggota keluarga lain (selain Ayah/Ibu) yang bekerja." />
          <Slot slot="other-earner-2-income" note="Isi jika ada anggota keluarga lain kedua yang bekerja." />
          <Slot slot="debt-proof" note="Wajib memuat total hutang dan lama cicilan. Bukan struk cicilan bulanan. Kosongkan jika tidak memiliki hutang." />
          <Slot slot="electricity-bill" note={<>Boleh beberapa berkas, atau jadikan 1 file PDF. Cara melihat pembelian token di PLN Mobile ada di {pusat("tutorial", "tutorial ini")}.</>} />
          <Slot slot="family-card" />
          <Slot slot="parent-permission" note={templates} />
          <Slot slot="self-photo" note="Wajah wajib terlihat jelas." />
          <Slot slot="house-photos" note="Foto depan, ruang tamu, dan kamar mandi. Boleh beberapa foto." />
          <Slot
            slot="vehicle-photos"
            note="Kalau lebih dari satu kendaraan, unggah semuanya. Kalau tidak memiliki kendaraan sama sekali, tetap unggah surat pernyataan tidak memiliki kendaraan."
          />
        </div>

        <ChoiceField
          bucket="documents"
          name="dtksRegistered"
          label="Apakah kamu terdaftar dalam DTKS?"
          hint="DTKS = Data Terpadu Kesejahteraan Sosial. Jika Ya, wajib unggah SKTM DTKS di kolom di bawah."
          options={[
            { value: "ya", label: "Ya, terdaftar" },
            { value: "tidak", label: "Tidak terdaftar" },
          ]}
        />

        {dtks === "ya" && <Slot slot="dtks" required note="SKTM tanpa keterangan DTKS tidak dianggap sah." />}

        {/* Saying "tidak" removes the SKTM the student already sent, when the step is saved (the Worker does it): say so before. */}
        {dtks === "tidak" && filesOf("dtks").length > 0 && <Alert tone="warning">Berkas SKTM DTKS yang sudah kamu unggah akan dihapus saat bagian ini disimpan.</Alert>}
      </div>

      <div className="space-y-6 border-t border-gray-100 pt-8">
        <StepHeader title="Berkas Marketing" subtitle="Bantu kami menjangkau lebih banyak teman yang butuh bimbel gratis ini. Bagian ini juga jadi bentuk kontribusi kecil kamu untuk Sakola Kembara." />
        <InstagramField />
        <div className="space-y-5">
          <Slot
            slot="marketing-follow-proof"
            note={
              <>
                Screenshot bukti follow akun{" "}
                <a href="https://instagram.com/sakolakembara" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-blue underline hover:text-primary-blue-dark">
                  @sakolakembara
                </a>
                .
              </>
            }
          />
          <Slot slot="marketing-broadcast-proof" note={<>Unggah semua screenshot-nya. Poster + template broadcast bisa diambil dari {marketing("Pusat Dokumen")}.</>} />
          <Slot
            slot="marketing-twibbon-proof"
            note={
              <>
                Wajib tag <b>@sakolakembara</b>. Twibbon + caption bisa diambil dari {marketing("Pusat Dokumen")}.
              </>
            }
          />
          <Slot
            slot="marketing-story-proof"
            note={
              <>
                Wajib tag <b>@sakolakembara</b>. Poster story bisa diambil dari {marketing("Pusat Dokumen")}.
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

function InstagramField() {
  const { values, errors, update } = useForm();
  return (
    <Field
      label="Username Instagram (akun utama, tidak boleh diprivat)"
      id="instagramUsername"
      required
      hint="Tulis tanpa @ di depan. Kami akan verifikasi bukti follow, twibbon, dan story yang kamu upload di akun ini."
      error={errors.instagramUsername}
    >
      <div className="relative">
        <Instagram size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
        <Input
          id="instagramUsername"
          data-field="instagramUsername"
          type="text"
          value={values.marketing.instagramUsername}
          onChange={(event) => update("marketing", { instagramUsername: event.target.value })}
          className="pl-9"
          placeholder="username_kamu"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
    </Field>
  );
}
