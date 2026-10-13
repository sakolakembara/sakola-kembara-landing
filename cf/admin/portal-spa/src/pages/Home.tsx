import { CalendarClock, CheckCircle2, Clock, FileText, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { LoadFailure, LoadingBlock } from "~/components/LoadState";
import { VerifyEmailBanner } from "~/components/VerifyEmailBanner";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { ENDPOINTS } from "~/lib/paths";
import { daysLeft, type HistoryItem, type OpenBatch, type Overview, parseOverview } from "~/lib/overview";
import { siteLink, usePublicConfig } from "~/lib/public-config";
import { useApiData } from "~/lib/use-api-data";

const LINK = "text-primary-blue font-semibold hover:underline";

/**
 * `/` — the portal's front page (the legacy `/portal`): a welcome, the card of the batch that is open (or the lack of
 * one), and the history of what the student has sent. One call, `GET /portal/api/overview`.
 */
export function HomePage() {
  usePageTitle("Beranda");
  const me = useMe();
  const { state, reload } = useApiData(ENDPOINTS.overview, parseOverview);

  return (
    <>
      <HeroBand firstName={state.status === "ready" ? state.data.student.firstName : null} />
      <Container className="relative z-10 -mt-10 space-y-6 px-4 pb-16 md:-mt-14 md:space-y-8 md:px-6 md:pb-24">
        {!me.emailVerified && <VerifyEmailBanner email={me.email} />}
        {state.status === "loading" && <LoadingBlock label="Memuat beranda…" />}
        {state.status === "error" && <LoadFailure onRetry={reload} />}
        {state.status === "ready" && (
          <>
            <CurrentBatchCard overview={state.data} />
            <HistoryCard history={state.data.history} />
          </>
        )}
      </Container>
    </>
  );
}

/** The navy band: a page header, the greeting in it. The name arrives with the overview. */
function HeroBand({ firstName }: { firstName: string | null }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary-blue to-accent-navy pb-16 pt-14 text-white md:pb-24 md:pt-20">
      {/* Soft decorative orbs, the same treatment as the public site's sections. */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-secondary-yellow/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

      <Container className="relative px-4 md:px-6">
        <Eyebrow tone="dark" className="mb-4">
          Portal Siswa
        </Eyebrow>
        <Heading level="page" className="mb-3">
          {firstName ? `Selamat datang, ${firstName}` : "Selamat datang"}
        </Heading>
        <p className="max-w-[600px] text-base leading-relaxed text-white/85 md:text-lg">
          Dari sini kamu bisa mendaftar sebagai calon siswa Sakola Kembara dan mengecek status pendaftaran ketika hasilnya diumumkan.
        </p>
      </Container>
    </section>
  );
}

function CurrentBatchCard({ overview }: { overview: Overview }) {
  const { openBatch, current, now } = overview;
  if (!openBatch) return <NoBatchCard />;
  if (current.state === "submitted") return <SubmittedCard batch={openBatch} />;
  return <OpenBatchCard batch={openBatch} now={now} draft={current.state === "draft"} />;
}

/** No batch is open: the legacy sentence, and the way to the program page on the public site. */
function NoBatchCard() {
  const { siteUrl } = usePublicConfig();
  return (
    <section aria-labelledby="batch-title" className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:p-10">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gray-100">
          <Clock size={22} className="text-gray-500" aria-hidden />
        </div>
        <div>
          <Eyebrow>Pendaftaran</Eyebrow>
          <h2 id="batch-title" className="mt-1 font-[family-name:var(--font-display)] text-xl text-gray-900 md:text-2xl">
            Belum ada batch yang dibuka
          </h2>
          <p className="mt-2 max-w-[600px] leading-relaxed text-gray-600">
            Pendaftaran Sakola Kembara dibuka sekali dalam setahun. Panitia akan memberi tahu di halaman ini begitu batch berikutnya mulai. Sementara itu, kamu
            bisa cek program di halaman{" "}
            {/* The public site is another Worker: a plain link, not the router's. */}
            <a href={siteLink(siteUrl, "/gabung-siswa")} className={LINK}>
              Gabung Siswa
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

/** The student has sent the application for the open batch: nothing more to do but wait. */
function SubmittedCard({ batch }: { batch: OpenBatch }) {
  return (
    <section aria-labelledby="batch-title" className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:p-10">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-secondary-green/10">
          <CheckCircle2 size={22} className="text-secondary-green" aria-hidden />
        </div>
        <div className="flex-1">
          <Eyebrow>Batch {batch.year}</Eyebrow>
          <h2 id="batch-title" className="mt-1 font-[family-name:var(--font-display)] text-xl text-gray-900 md:text-2xl">
            Pendaftaran kamu untuk {batch.name} sudah kami terima
          </h2>
          <p className="mt-2 max-w-[600px] leading-relaxed text-gray-600">
            Kami akan mengabari hasilnya di halaman{" "}
            <Link to="/status" className={LINK}>
              Status Pendaftaran
            </Link>{" "}
            setelah panitia selesai memutuskan seluruh pendaftar batch ini. Kamu tidak perlu mengirim ulang berkas.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * A batch is open and the student has not sent theirs: the star card. A white surface with a yellow rail on its left
 * so it contrasts with the navy band above instead of merging into it. With a draft saved on the server the button
 * says so ("Lanjutkan pendaftaran"); it goes to the wizard either way.
 */
function OpenBatchCard({ batch, now, draft }: { batch: OpenBatch; now: string; draft: boolean }) {
  const left = daysLeft(batch.closesAt, now);
  return (
    <section aria-labelledby="batch-title" className="relative overflow-hidden rounded-3xl border border-gray-100 bg-white p-8 shadow-lg md:p-12">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-secondary-yellow" />
      <div className="relative">
        <Eyebrow className="mb-3">Batch {batch.year} · Pendaftaran Dibuka</Eyebrow>
        <Heading id="batch-title" className="mb-3 text-gray-900">
          {batch.name}
        </Heading>
        <p className="mb-6 max-w-[600px] text-base leading-relaxed text-gray-600 md:text-lg">
          Isi formulir pendaftaran untuk mengajukan diri sebagai calon siswa. Progres kamu tersimpan otomatis, jadi bisa dilanjutkan kapan saja.
        </p>

        <dl className="mb-8 grid max-w-[600px] grid-cols-2 gap-3 sm:grid-cols-3">
          <MetaChip
            label="Tutup pendaftaran"
            value={new Date(batch.closesAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
            icon={<CalendarClock size={14} aria-hidden />}
          />
          <MetaChip label="Sisa waktu" value={left > 0 ? `${left} hari lagi` : "Ditutup hari ini"} icon={<Clock size={14} aria-hidden />} />
          <MetaChip label="Kuota" value="Terbatas" icon={<Sparkles size={14} aria-hidden />} />
        </dl>

        <Button href="/daftar" size="lg" className="transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-blue/30">
          {draft ? "Lanjutkan pendaftaran" : "Mulai daftar"}
        </Button>

        {batch.description && <p className="mt-6 max-w-[600px] whitespace-pre-wrap text-sm text-gray-500">{batch.description}</p>}
      </div>
    </section>
  );
}

function MetaChip({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <dt className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </dt>
      <dd className="text-sm font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

/**
 * The registration history. Deliberately verdict-free: the accepted / rejected decision only ever renders on the
 * status page, so this card at most says "the result is out, go look" (the API sends no verdict here either).
 */
function HistoryCard({ history }: { history: HistoryItem[] }) {
  const published = history.some((item) => item.published);
  return (
    <section aria-labelledby="history-title" className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:p-10">
      <div className="flex items-start gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${published ? "bg-secondary-yellow/20 text-primary-blue" : "bg-gray-100 text-gray-500"}`}
        >
          {published ? <Sparkles size={22} aria-hidden /> : <FileText size={22} aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <Eyebrow>Riwayat</Eyebrow>
          <h2 id="history-title" className="mt-1 font-[family-name:var(--font-display)] text-xl text-gray-900 md:text-2xl">
            {history.length === 0 ? "Riwayat pendaftaran" : published ? "Hasil pendaftaran kamu sudah keluar" : "Hasil belum diumumkan"}
          </h2>

          {history.length === 0 ? (
            <p className="mt-2 max-w-[600px] leading-relaxed text-gray-600">
              Kamu belum pernah mengirim pendaftaran. Setelah kirim, setiap pendaftaran yang kamu kirim akan tercatat di sini.
            </p>
          ) : (
            <>
              <p className="mt-2 max-w-[600px] leading-relaxed text-gray-600">
                {published
                  ? "Panitia sudah mengumumkan keputusan batch kamu. Silakan buka halaman Status Pendaftaran untuk melihat hasilnya."
                  : "Panitia masih menilai seluruh pendaftar batch ini. Hasilnya akan muncul di halaman Status Pendaftaran begitu diumumkan."}
              </p>

              <ul className="mt-5 divide-y divide-gray-100 border-y border-gray-100">
                {history.map((item) => (
                  <li key={item.id} className="py-3">
                    <div className="truncate font-semibold text-gray-900">
                      {item.batch.year} · {item.batch.name}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      Dikirim {new Date(item.submittedAt).toLocaleString("id-ID", { dateStyle: "medium" })}
                    </div>
                  </li>
                ))}
              </ul>

              {published ? (
                <Button href="/status" className="mt-6">
                  Lihat hasil
                </Button>
              ) : (
                <Link to="/status" className="mt-6 inline-block text-sm font-semibold text-primary-blue hover:underline">
                  Buka Status Pendaftaran
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
