import { CalendarClock, CheckCircle2 } from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { siteLink } from "~/lib/public-config";

// The screens in place of the wizard (legacy: PortalGate in daftar/page.tsx): no batch is open, or the application for it
// is already sent. They come from the `gate` of `GET applications/current`, and from the 409 a save or a submit can get
// when the batch closes, or the application is sent from another tab, while the student is filling the form in.

const LINK = "font-semibold text-primary-blue hover:underline";

function Gate({ eyebrow, headline, icon, children, notice }: { eyebrow: string; headline: string; icon: ReactNode; children: ReactNode; notice?: string }) {
  return (
    <Container size="reading" className="px-4 py-12 md:px-6 md:py-16">
      <Link to="/" className="mb-6 inline-flex min-h-11 w-fit items-center text-sm text-gray-500 transition-colors hover:text-gray-900">
        Kembali ke portal
      </Link>
      <div className="rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm md:p-12">
        <div className="mb-5 inline-flex size-16 items-center justify-center rounded-full bg-gray-50">{icon}</div>
        <Eyebrow className="mb-3">{eyebrow}</Eyebrow>
        <Heading level="subsection" as="h1" tabIndex={-1} data-gate-heading className="mb-3 text-gray-900 focus:outline-none">
          {headline}
        </Heading>
        {notice && <Alert className="mb-4 text-left">{notice}</Alert>}
        <p className="leading-relaxed text-gray-600">{children}</p>
      </div>
    </Container>
  );
}

/** No batch is open. `notice` is what the Worker said when a save or a submit found the batch closed. */
export function NoBatchGate({ siteUrl, notice }: { siteUrl: string; notice?: string }) {
  return (
    <Gate eyebrow="Pendaftaran" headline="Belum ada batch pendaftaran yang dibuka" icon={<CalendarClock size={32} className="text-primary-blue" aria-hidden />} notice={notice}>
      Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Silakan kembali lagi setelah panitia mengumumkan batch berikutnya di halaman{" "}
      <a href={siteLink(siteUrl, "/gabung-siswa")} className={LINK}>
        Gabung Siswa
      </a>
      .
    </Gate>
  );
}

/** The application for the open batch is already sent. */
export function SubmittedGate({ batch, submittedAt }: { batch: { year: number; name: string }; submittedAt: string }) {
  return (
    <Gate eyebrow={`Batch ${batch.year}`} headline={`Pendaftaran kamu untuk ${batch.name} sudah kami terima`} icon={<CheckCircle2 size={32} className="text-secondary-green" aria-hidden />}>
      Dikirim pada <b>{new Date(submittedAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}</b>. Untuk mengecek status, buka halaman{" "}
      <Link to="/status" className={LINK}>
        Status Pendaftaran
      </Link>
      .
    </Gate>
  );
}
