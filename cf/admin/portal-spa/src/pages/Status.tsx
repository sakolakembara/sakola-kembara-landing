import { CheckCircle2, Clock, HeartHandshake, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { LoadFailure, LoadingBlock } from "~/components/LoadState";
import { usePageTitle } from "~/lib/hooks";
import { ENDPOINTS } from "~/lib/paths";
import { announcedAt, parseStatusItems, type StatusItem, statusView, type Tone } from "~/lib/status";
import { useApiData } from "~/lib/use-api-data";

/**
 * Tone styling for the outcome card. `accepted` is deliberately a solid, high-contrast surface: this card is the
 * reason the student opened the page, so it has to outweigh the band above it rather than fade into the page
 * background. The other tones stay calm white surfaces. (All of this is the legacy page's.)
 */
const TONE_CARD: Record<Tone, string> = {
  accepted: "bg-secondary-green border-secondary-green text-white shadow-xl shadow-secondary-green/25",
  rejected: "bg-white border-gray-200 shadow-sm",
  pending: "bg-white border-amber-200 shadow-sm",
};
const TONE_ICON: Record<Tone, string> = {
  accepted: "bg-white/20 text-white",
  rejected: "bg-gray-100 text-gray-500",
  pending: "bg-amber-50 text-amber-600",
};
const TONE_EYEBROW: Record<Tone, string> = { accepted: "text-white", rejected: "text-gray-500", pending: "text-amber-700" };
const TONE_BATCH: Record<Tone, string> = { accepted: "text-white/70", rejected: "text-gray-500", pending: "text-gray-500" };
const TONE_HEADLINE: Record<Tone, string> = {
  accepted: "text-white text-3xl md:text-5xl",
  rejected: "text-gray-900 text-2xl md:text-4xl",
  pending: "text-gray-900 text-2xl md:text-3xl",
};
const TONE_BODY: Record<Tone, string> = {
  accepted: "text-white/90 text-lg md:text-xl",
  rejected: "text-gray-700 text-base md:text-lg",
  pending: "text-gray-700 text-base md:text-lg",
};
const TONE_FOOTER: Record<Tone, string> = {
  accepted: "border-white/25 text-white/75",
  rejected: "border-gray-100 text-gray-500",
  pending: "border-gray-100 text-gray-500",
};
const TONE_FOOTER_VALUE: Record<Tone, string> = { accepted: "text-white", rejected: "text-gray-700", pending: "text-gray-700" };

function iconFor(item: StatusItem): ReactNode {
  const result = item.result;
  if (result.state === "decided") return result.decision === "accepted" ? <CheckCircle2 size={26} aria-hidden /> : <HeartHandshake size={26} aria-hidden />;
  return <Clock size={26} aria-hidden />;
}

/**
 * `/status` — the status of every application the student has sent (the legacy `/portal/status`). The promise to
 * students: the decision is shown only when the whole batch is announced. The API already withholds it before then
 * (`result.state` is `processing`); lib/status.ts reads nothing but `result` and reads anything it does not know as
 * "processing", so this page cannot show an early verdict even if the API sent one by mistake.
 */
export function StatusPage() {
  usePageTitle("Status Pendaftaran");
  const { state, reload } = useApiData(ENDPOINTS.applications, parseStatusItems);

  return (
    <>
      {/* The band is a page header, not the headline: the outcome card below is what the student came for. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-blue to-accent-navy pb-14 pt-10 text-white md:pb-20 md:pt-14">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-secondary-yellow/20 blur-3xl" />
        <Container size="focused" className="relative px-4 md:px-6">
          <Eyebrow tone="dark" className="mb-3">
            Status Pendaftaran
          </Eyebrow>
          <Heading level="subsection" as="h1" className="mb-2">
            Rekap perjalanan pendaftaranmu
          </Heading>
          <p className="max-w-[600px] text-sm leading-relaxed text-white/80 md:text-base">Hasil hanya muncul setelah panitia mengumumkan keputusan seluruh batch.</p>
        </Container>
      </section>

      <Container size="focused" className="relative z-10 -mt-8 space-y-6 px-4 pb-16 md:-mt-12 md:px-6 md:pb-24">
        {state.status === "loading" && <LoadingBlock label="Memuat status pendaftaran…" />}
        {state.status === "error" && <LoadFailure onRetry={reload} />}
        {state.status === "ready" && (state.data.length === 0 ? <NoApplications /> : <Applications items={state.data} />)}
      </Container>
    </>
  );
}

function NoApplications() {
  return (
    <div className="mx-auto max-w-[760px] rounded-3xl border border-gray-100 bg-white p-10 text-center shadow-sm md:p-14">
      <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Inbox size={26} className="text-gray-500" aria-hidden />
      </div>
      <h2 className="mb-2 font-[family-name:var(--font-display)] text-xl text-gray-900 md:text-2xl">Belum ada pendaftaran</h2>
      <p className="mx-auto mb-6 max-w-[420px] text-sm leading-relaxed text-gray-600">
        Kamu belum pernah mengirim pendaftaran ke Sakola Kembara. Kembali ke portal untuk melihat batch yang sedang dibuka.
      </p>
      <Button href="/">Ke beranda portal</Button>
    </div>
  );
}

function Applications({ items }: { items: StatusItem[] }) {
  return (
    <ul className="space-y-6">
      {items.map((item) => {
        const view = statusView(item.result);
        const announced = announcedAt(item.result);
        return (
          <li key={item.id} className={`overflow-hidden rounded-3xl border ${TONE_CARD[view.tone]}`}>
            <article aria-labelledby={`status-${item.id}`} className="p-7 md:p-12">
              <header className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl md:h-14 md:w-14 ${TONE_ICON[view.tone]}`}>{iconFor(item)}</div>
                <div className="min-w-0 flex-1">
                  <div className={`inline-flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider ${TONE_EYEBROW[view.tone]}`}>
                    <span aria-hidden className="h-2 w-2 rounded-full bg-secondary-yellow" />
                    {view.eyebrow}
                    <span className={`font-medium normal-case tracking-normal ${TONE_BATCH[view.tone]}`}>
                      <span aria-hidden className="hidden sm:inline">
                        ·{" "}
                      </span>
                      Batch {item.batch.year} · {item.batch.name}
                    </span>
                  </div>
                  <h2 id={`status-${item.id}`} className={`mt-2 font-[family-name:var(--font-display)] leading-tight ${TONE_HEADLINE[view.tone]}`}>
                    {view.headline}
                  </h2>
                </div>
              </header>

              <p className={`whitespace-pre-wrap leading-relaxed ${TONE_BODY[view.tone]}`}>{view.body}</p>

              <footer className={`mt-7 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-4 text-xs ${TONE_FOOTER[view.tone]}`}>
                <span>
                  Dikirim <b className={`font-semibold ${TONE_FOOTER_VALUE[view.tone]}`}>{new Date(item.submittedAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}</b>
                </span>
                {announced && (
                  <span>
                    Diumumkan <b className={`font-semibold ${TONE_FOOTER_VALUE[view.tone]}`}>{new Date(announced).toLocaleString("id-ID", { dateStyle: "long" })}</b>
                  </span>
                )}
              </footer>

              {view.tone === "rejected" && (
                <Link to="/" className="mt-5 inline-block text-sm font-semibold text-primary-blue hover:underline">
                  Lihat batch pendaftaran berikutnya
                </Link>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
