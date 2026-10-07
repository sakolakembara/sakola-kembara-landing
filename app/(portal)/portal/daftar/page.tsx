import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { requireStudent } from "@/lib/auth-helpers";
import { getCurrentOpenBatch } from "@/lib/admission-batches";
import { getUserApplicationForBatch } from "@/lib/student-applications";
import { Wizard } from "./_wizard";

export const metadata: Metadata = {
  title: "Daftar Sekarang",
  description:
    "Formulir pendaftaran resmi Sakola Kembara. Isi seluruh bagian untuk mengajukan diri sebagai calon siswa.",
  robots: { index: false, follow: false },
};

export default async function StudentFormPage() {
  const student = await requireStudent("/portal/daftar");
  const openBatch = await getCurrentOpenBatch();

  if (!openBatch) {
    return (
      <PortalGate
        eyebrow="Pendaftaran"
        headline="Belum ada batch pendaftaran yang dibuka"
        icon={<CalendarClock className="text-primary-blue" size={32} />}
        body={
          <>
            Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Silakan
            kembali lagi setelah panitia mengumumkan batch berikutnya di halaman{" "}
            <Link
              href="/gabung-siswa"
              className="text-primary-blue font-semibold hover:underline"
            >
              Gabung Siswa
            </Link>
            .
          </>
        }
      />
    );
  }

  const existing = await getUserApplicationForBatch(student.userId, openBatch.id);
  if (existing) {
    return (
      <PortalGate
        eyebrow={`Batch ${openBatch.year}`}
        headline={`Pendaftaran kamu untuk ${openBatch.name} sudah kami terima`}
        icon={<CheckCircle2 className="text-secondary-green" size={32} />}
        body={
          <>
            Dikirim pada{" "}
            <b>
              {existing.submittedAt.toLocaleString("id-ID", {
                dateStyle: "long",
                timeStyle: "short",
              })}
            </b>
            . Untuk mengecek status, buka halaman{" "}
            <Link
              href="/portal/status"
              className="text-primary-blue font-semibold hover:underline"
            >
              Status Pendaftaran
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <Wizard
      batch={{ id: openBatch.id, year: openBatch.year, name: openBatch.name }}
      user={{
        email: student.email,
        name: student.name,
      }}
    />
  );
}

function PortalGate({
  eyebrow,
  headline,
  icon,
  body,
}: {
  eyebrow: string;
  headline: string;
  icon: React.ReactNode;
  body: React.ReactNode;
}) {
  return (
    <Container size="reading" className="px-4 md:px-6 py-12 md:py-16">
      <Link
        href="/portal"
        className="block w-fit text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6"
      >
        Kembali ke portal
      </Link>
      <div className="bg-white rounded-3xl border border-gray-100 p-8 md:p-12 text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 mb-5">
          {icon}
        </div>
        <Eyebrow className="mb-3">{eyebrow}</Eyebrow>
        <Heading level="subsection" as="h1" className="text-gray-900 mb-3">
          {headline}
        </Heading>
        <p className="text-gray-600 leading-relaxed">{body}</p>
      </div>
    </Container>
  );
}
