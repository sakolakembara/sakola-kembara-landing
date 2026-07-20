import type { Metadata } from "next";
import { Wizard } from "./_wizard";

export const metadata: Metadata = {
  title: "Formulir Pendaftaran",
  description:
    "Formulir pendaftaran resmi Sakola Kembara Gen 6. Isi seluruh bagian untuk mengajukan diri sebagai calon siswa.",
};

export default function StudentFormPage() {
  return <Wizard />;
}
