import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, LogIn } from "lucide-react";
import { requireStudent } from "@/lib/auth-helpers";
import { getCurrentOpenBatch } from "@/lib/admission-batches";
import { getUserApplicationForBatch } from "@/lib/student-applications";
import { Wizard } from "./_wizard";

export const metadata: Metadata = {
  title: "Formulir Pendaftaran",
  description:
    "Formulir pendaftaran resmi Sakola Kembara. Isi seluruh bagian untuk mengajukan diri sebagai calon siswa.",
  robots: { index: false, follow: false },
};

export default async function StudentFormPage() {
  // Route is gated in middleware too (as part of the public site it's not
  // in the /portal matcher — so we auth here manually).
  const student = await requireStudent("/gabung-siswa/form");
  const openBatch = await getCurrentOpenBatch();

  if (!openBatch) {
    return (
      <PortalGate icon={<CalendarClock size={28} className="text-amber-600" />}>
        <h1 className="font-[var(--font-display)] text-2xl text-gray-900">
          Belum ada batch pendaftaran yang dibuka
        </h1>
        <p className="text-sm text-gray-600 mt-2">
          Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Silakan
          kembali lagi setelah kami mengumumkan batch berikutnya di halaman
          <Link href="/gabung-siswa" className="text-primary-blue font-medium hover:underline">
            {" "}Gabung Siswa
          </Link>
          .
        </p>
      </PortalGate>
    );
  }

  const existing = await getUserApplicationForBatch(student.userId, openBatch.id);
  if (existing) {
    return (
      <PortalGate icon={<CheckCircle2 size={28} className="text-emerald-600" />}>
        <h1 className="font-[var(--font-display)] text-2xl text-gray-900">
          Pendaftaran kamu untuk {openBatch.name} sudah masuk
        </h1>
        <p className="text-sm text-gray-600 mt-2">
          Dikirim pada{" "}
          {existing.submittedAt.toLocaleString("id-ID", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          . Untuk mengecek status, buka halaman{" "}
          <Link href="/portal/status" className="text-primary-blue font-medium hover:underline">
            Status Pendaftaran
          </Link>
          .
        </p>
      </PortalGate>
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
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-100 p-8 md:p-10 text-center">
        <div className="flex justify-center mb-4">{icon}</div>
        {children}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/portal"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
          >
            <LogIn size={14} /> Ke Portal Siswa
          </Link>
          <Link
            href="/"
            className="text-gray-600 hover:text-gray-900"
          >
            Kembali ke beranda
          </Link>
        </div>
      </div>
    </main>
  );
}

