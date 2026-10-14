import { BRANCHES, GRADUATION_BATCHES, RELIGIONS } from "@shared/application-form/steps";
import { AreaField, ChoiceField, StepHeader, TextField } from "../form";

/** Step 2 of 8, "Identitas Pribadi": the legacy fields, words and hints (app/(portal)/portal/daftar/_steps/identity.tsx). */
export function IdentityStep() {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Identitas Pribadi"
        subtitle="Bagian ini berisi informasi dasar tentang dirimu. Kami gunakan data ini untuk mengenalmu lebih jauh dan mempermudah komunikasi selama program berlangsung."
      />

      <TextField
        bucket="identity"
        name="fullName"
        label="Nama Lengkap"
        autoComplete="name"
        placeholder="Contoh: Dadi Dinan Haris"
        hint={
          <>
            Isi sesuai KTP/KK/Akta dan gunakan huruf kapital di awal setiap kata.
            <br />
            Contoh benar: <b>Dadi Dinan Haris</b>. Hindari <s>DADI DINAN</s> atau <s>dadi din</s>.
          </>
        }
      />

      <TextField bucket="identity" name="nickname" label="Nama Panggilan" autoComplete="nickname" hint="Isi bebas sesuai nama sehari-hari kamu. Contoh: Dadi, Joy." />

      <ChoiceField
        bucket="identity"
        name="gender"
        label="Jenis Kelamin"
        options={[
          { value: "laki-laki", label: "Laki-laki" },
          { value: "perempuan", label: "Perempuan" },
        ]}
      />

      <ChoiceField bucket="identity" name="religion" label="Agama" columns={3} options={RELIGIONS.map((religion) => ({ value: religion, label: religion }))} />

      <TextField
        bucket="identity"
        name="schoolName"
        label="Asal Sekolah"
        placeholder="Contoh: SMAN 1 Cililin"
        hint={
          <>
            Tulis lengkap, jangan disingkat.
            <br />
            Benar: <b>SMAN 1 Cililin</b>. Kurang tepat: <s>SMA Negeri 1 Cililin</s>.
          </>
        }
      />

      <ChoiceField bucket="identity" name="branch" label="Cabang Sakola Kembara" columns={3} options={BRANCHES.map((branch) => ({ value: branch, label: branch }))} />

      <AreaField
        bucket="identity"
        name="homeAddress"
        label="Alamat Rumah (sesuai KTP/KK)"
        autoComplete="street-address"
        placeholder="Alamat lengkap: jalan, RT/RW, kelurahan, kecamatan, kota/kabupaten, provinsi"
      />

      <ChoiceField
        bucket="identity"
        name="graduationBatch"
        label="Tahun Angkatan Kelulusan"
        hint="Isi sesuai tahun kelulusan SMA. Kalau kamu sekarang kelas 12, pilih 2027."
        options={GRADUATION_BATCHES.map((batch) => ({ value: batch, label: batch }))}
      />

      <TextField
        bucket="identity"
        name="whatsapp"
        label="Nomor WhatsApp Pribadi"
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        placeholder="6281392254544"
        clean={(typed) => typed.replace(/\s+/g, "")}
        hint={
          <>
            Tulis dengan format <b>62</b> di depan (tanpa spasi, tanpa +).
            <br />
            Contoh: <b>6281392254544</b>.
          </>
        }
      />
    </div>
  );
}
