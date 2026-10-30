import { CalendarDays, CheckCircle, Undo2, Users } from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Table, TBody, Td, Th, THead } from "~/components/ui/table";
import { Tag } from "~/components/ui/tag";
import { Flash } from "~/components/crud/Flash";
import { StatusTag } from "~/components/crud/StatusTag";
import { PageHeader } from "~/components/PageHeader";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { useMe } from "~/lib/session";
import { APPLICATION_STATUS } from "../applications/model";
import { API_PATH, applicantsLink, type BatchDetail, PHASE_STATUS, ROUTE, STATUS_KEYS } from "./model";

// The page of one batch: its facts, how its applicants are decided, the newest five, and the publication of the
// results. A port of app/(admin)/admin/batches/[id]/page.tsx with what docs/cloudflare/admin-ia.md decided
// (section 3.4): the tiles lead to the Pendaftar list filtered to this batch and status, the table of up to 100
// applicants became the newest five with "Lihat semua", and the form to change the batch is its own page
// (`/batches/:id/edit`), reached from here.
//
// "Publikasikan Hasil" and "Batalkan Publikasi" are for someone who can write; the Worker checks the rule of
// publishing again (docs/cloudflare/admin-pendaftaran.md), so the button following `canPublish` is only courtesy.

const LONG: Intl.DateTimeFormatOptions = { dateStyle: "long", timeStyle: "short" };
const SHORT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

export function BatchDetailPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "pendaftaran") === "write";
  const item = useItem<BatchDetail>(`${API_PATH}/${encodeURIComponent(id)}`);
  const notice = useFlash();

  const publish = useMutation<void, ItemPayload<BatchDetail>>(() => api<ItemPayload<BatchDetail>>(`${API_PATH}/${encodeURIComponent(id)}/publish`, { method: "POST" }));
  const unpublish = useMutation<void, ItemPayload<BatchDetail>>(() => api<ItemPayload<BatchDetail>>(`${API_PATH}/${encodeURIComponent(id)}/unpublish`, { method: "POST" }));

  async function run(action: typeof publish, success: string) {
    notice.dismiss();
    publish.clearErrors();
    unpublish.clearErrors();
    const result = await action.submit();
    if (!result) return;
    if (result.ok) {
      item.replace(result.data.item);
      notice.show({ tone: "success", text: success });
    } else {
      // The numbers on screen may be the reason it was refused: show the batch as it is now.
      item.refetch();
    }
  }

  if ((item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat batch...
        </p>
      </div>
    );
  }
  if (item.status === "error" || !item.item) {
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat batch."}</Alert>
        {item.failure?.status === 404 ? (
          <Button variant="neutral" href={ROUTE}>
            Kembali ke daftar batch
          </Button>
        ) : (
          <Button variant="neutral" onClick={item.refetch}>
            Coba lagi
          </Button>
        )}
      </div>
    );
  }

  const batch = item.item;
  const { counts } = batch;
  const undecided = counts.pending + counts.under_review;
  const refusal = publish.formError ?? unpublish.formError;

  return (
    <div className="max-w-6xl p-6 md:p-10">
      <PageHeader
        back={{ href: ROUTE, label: "Kembali ke daftar batch" }}
        title={batch.name}
        overline={<>Batch {batch.year}</>}
        className="md:items-start"
        actions={
          batch.resultsPublishedAt && (
            <Tag tone="soft" size="lg">
              <CheckCircle size={14} aria-hidden="true" />
              Hasil dipublikasikan {new Date(batch.resultsPublishedAt).toLocaleDateString("id-ID", { dateStyle: "medium" })}
            </Tag>
          )
        }
      >
        <p className="flex items-center gap-1.5 text-sm text-gray-600">
          <CalendarDays size={14} aria-hidden="true" />
          {new Date(batch.opensAt).toLocaleString("id-ID", LONG)}
          {" — "}
          {new Date(batch.closesAt).toLocaleString("id-ID", LONG)}
        </p>
        {/* A published batch already has its tag (with the date) at the right. */}
        {!batch.resultsPublishedAt && (
          <p className="mt-2">
            <StatusTag map={PHASE_STATUS} value={batch.phase} />
          </p>
        )}
      </PageHeader>

      <Flash flash={notice.flash} dismiss={notice.dismiss} />
      {refusal && <Alert className="mb-4">{refusal}</Alert>}

      <div className="grid items-start gap-6 lg:grid-cols-5">
        {/* min-w-0 lets the applicants table scroll inside its card on phones instead of widening the whole column. */}
        <div className="min-w-0 space-y-6 lg:col-span-3">
          <section aria-labelledby="batch-summary" className="rounded-2xl border border-gray-100 bg-white p-6">
            <h2 id="batch-summary" className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-900">
              <Users size={14} aria-hidden="true" /> Ringkasan Pendaftar
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {STATUS_KEYS.map((status) => (
                <Link
                  key={status}
                  to={applicantsLink(batch.id, status)}
                  aria-label={`${APPLICATION_STATUS[status].label}: ${counts[status]} pendaftar`}
                  className="block rounded-lg border border-gray-100 bg-gray-50 p-4 transition-colors hover:border-primary-blue/40"
                >
                  <div className="text-xs text-gray-500">{APPLICATION_STATUS[status].label}</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{counts[status]}</div>
                </Link>
              ))}
            </div>
          </section>

          <section aria-labelledby="batch-applicants" className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 id="batch-applicants" className="text-sm font-semibold uppercase tracking-wide text-gray-900">
                Pendaftar di batch ini
              </h2>
              <Link to={applicantsLink(batch.id)} className="text-xs font-medium text-primary-blue hover:underline">
                Lihat semua
              </Link>
            </header>
            {batch.recent.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Belum ada pendaftar untuk batch ini.</div>
            ) : (
              <Table>
                <caption className="sr-only">Lima pendaftar terbaru di batch ini</caption>
                <THead>
                  <tr>
                    <Th scope="col">Nama</Th>
                    <Th scope="col">Sekolah</Th>
                    <Th scope="col">Status</Th>
                    <Th scope="col">Dikirim</Th>
                  </tr>
                </THead>
                <TBody>
                  {batch.recent.map((applicant) => (
                    <tr key={applicant.id} className="hover:bg-gray-50">
                      <Td>
                        <Link to={`/applications/${encodeURIComponent(applicant.id)}`} className="font-medium text-gray-900 hover:text-primary-blue">
                          {applicant.fullName}
                        </Link>
                        <div className="text-xs text-gray-500">{applicant.email}</div>
                      </Td>
                      <Td className="text-gray-700">{applicant.schoolName}</Td>
                      <Td>
                        <StatusTag map={APPLICATION_STATUS} value={applicant.status} />
                      </Td>
                      <Td className="text-xs text-gray-500">{new Date(applicant.submittedAt).toLocaleString("id-ID", SHORT)}</Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          <section aria-labelledby="batch-data" className="rounded-2xl border border-gray-100 bg-white">
            <header className="border-b border-gray-100 px-6 py-4">
              <h2 id="batch-data" className="text-sm font-semibold uppercase tracking-wide text-gray-900">
                {canWrite ? "Ubah Data Batch" : "Data Batch"}
              </h2>
            </header>
            <div className="space-y-4 p-6">
              {batch.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{batch.description}</p> : <p className="text-sm text-gray-400">Tidak ada deskripsi.</p>}
              <Button variant="neutral" href={`${ROUTE}/${encodeURIComponent(batch.id)}/edit`}>
                {canWrite ? "Ubah Data" : "Lihat Data"}
              </Button>
            </div>
          </section>
        </div>

        <aside aria-labelledby="batch-publish" className="min-w-0 space-y-4 lg:sticky lg:top-10 lg:col-span-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-6">
            <h2 id="batch-publish" className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-900">
              Publikasi Hasil
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              Siswa hanya melihat hasil pendaftarannya setelah kamu klik publikasikan. Semua pendaftar di batch ini harus sudah diputuskan (diterima atau ditolak)
              sebelum publikasi.
            </p>
            {batch.resultsPublishedAt ? (
              <div className="space-y-3">
                <p className="rounded-lg border border-primary-blue/20 bg-primary-blue/5 px-3 py-2 text-sm text-gray-700">
                  Hasil sudah dipublikasikan pada {new Date(batch.resultsPublishedAt).toLocaleString("id-ID", LONG)}.
                </p>
                {canWrite && (
                  <Button variant="neutral" fullWidth disabled={unpublish.pending} onClick={() => void run(unpublish, "Publikasi hasil dibatalkan.")}>
                    <Undo2 size={16} aria-hidden="true" /> {unpublish.pending ? "Membatalkan..." : "Batalkan Publikasi"}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <ul className="mb-3 space-y-1 text-xs text-gray-600">
                  <li>
                    • Total pendaftar: <b>{counts.total}</b>
                  </li>
                  <li>
                    • Belum diputuskan: <b>{undecided}</b>
                  </li>
                  <li>
                    • Diterima: <b>{counts.accepted}</b>
                  </li>
                  <li>
                    • Ditolak: <b>{counts.rejected}</b>
                  </li>
                </ul>
                {canWrite && (
                  <>
                    <Button fullWidth disabled={!batch.canPublish || publish.pending} onClick={() => void run(publish, "Hasil batch berhasil dipublikasikan.")}>
                      <CheckCircle size={16} aria-hidden="true" /> {publish.pending ? "Mempublikasikan..." : "Publikasikan Hasil"}
                    </Button>
                    {!batch.canPublish && (
                      <p className="text-xs text-gray-500">{counts.total === 0 ? "Belum ada pendaftar." : "Selesaikan semua keputusan (Diterima / Ditolak) terlebih dahulu."}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
