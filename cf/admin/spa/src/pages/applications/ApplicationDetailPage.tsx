import { Briefcase, Calendar, ExternalLink, FileText, GraduationCap, Home, Instagram, MessageCircle, User, Users } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DetailShell } from "~/components/crud/DetailShell";
import { StatusTag } from "~/components/crud/StatusTag";
import { accessTo } from "~/lib/access";
import { describeFailure } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { useItem } from "~/lib/crud/useItem";
import { useMe } from "~/lib/session";
import { instagramUrl, type ProfileRow, type ProfileSection, profileSections, type RowValue, safeWebUrl, whatsappUrl } from "./answers";
import { FilesValue, PurgeFiles } from "./FilesSection";
import { API_PATH, APPLICATION_STATUS, type ApplicationWithFiles, ROUTE } from "./model";
import { ReviewPanel } from "./ReviewPanel";

// The page of one applicant: every answer, the documents they linked, the notes, and the review. A port of
// app/(admin)/admin/applications/[id]/page.tsx, on the detail frame (DetailShell): the name and the status in the top
// bar, one line under it (email, batch, when it was sent), the answers in a card on the left, and on the right the two
// decisions this page has, "Ubah Status" and, for who may, "Hapus semua berkas". It has no actions in the bar: nothing
// here is done by a bar button. The sections are built by `profileSections` (answers.ts), which has the rules of what
// is shown when; this file draws them.
//
// What the applicant gave is shown as text. A version 2 application has links the applicant pasted (the legacy wizard
// asked for a link to their own Drive folder); a link is clickable only when it is an http or https address. A version
// 3 application has FILES the applicant uploaded to the private bucket (FilesSection.tsx): they are listed by slot, and
// opened one at a time, in a new tab, only by who may (`canOpenFiles`: Pendaftaran write), each open audited.

type Icon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;

const ICONS: Record<string, Icon> = {
  identitas: User,
  pendidikan: GraduationCap,
  keluarga: Users,
  "tempat-tinggal": Home,
  organisasi: Briefcase,
  berkas: FileText,
  marketing: Instagram,
  interview: User,
  "cerita-lama": User,
  pengajuan: Calendar,
};

const EXTERNAL = "inline-flex items-center gap-1 text-primary-blue hover:underline";

function Value({ value }: { value: RowValue }) {
  switch (value.type) {
    case "text":
      return <>{value.text}</>;
    case "long":
      return <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{value.text}</p>;
    case "missing":
      return <span className="text-gray-400">—</span>;
    case "muted":
      return <span className="text-gray-400">{value.text}</span>;
    case "link": {
      const url = safeWebUrl(value.url);
      // Not an http(s) address: shown as the text it is, never made clickable.
      return url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={`${EXTERNAL} break-all`}>
          <ExternalLink size={12} aria-hidden="true" />
          {value.url}
        </a>
      ) : (
        <span className="break-all text-gray-700">{value.url}</span>
      );
    }
    case "whatsapp": {
      const url = whatsappUrl(value.number);
      return url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={EXTERNAL}>
          <MessageCircle size={12} aria-hidden="true" />
          {value.number}
        </a>
      ) : (
        <>{value.number}</>
      );
    }
    case "instagram": {
      const profile = instagramUrl(value.username);
      return profile ? (
        <a href={profile.url} target="_blank" rel="noopener noreferrer" className={EXTERNAL}>
          <Instagram size={12} aria-hidden="true" />@{profile.handle}
        </a>
      ) : (
        <span className="text-gray-400">—</span>
      );
    }
    case "files":
      return <FilesValue applicationId={value.applicationId} files={value.files} canOpen={value.canOpen} />;
    case "debt":
      return (
        <div className="leading-relaxed text-gray-700">
          <div>
            <b>{value.kind}</b> — {value.amount}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {value.months} bulan · {value.description}
          </div>
        </div>
      );
  }
}

function Row({ row }: { row: ProfileRow }) {
  return (
    <div className={row.stack ? "space-y-1.5" : "grid gap-2 text-sm md:grid-cols-[180px_1fr]"}>
      <div className="text-xs text-gray-500 md:text-sm">{row.label}</div>
      <div className="text-sm text-gray-900">
        <Value value={row.value} />
      </div>
    </div>
  );
}

function Section({ section, last }: { section: ProfileSection; last: boolean }): ReactNode {
  const IconComponent = ICONS[section.id] ?? User;
  return (
    <section aria-labelledby={`section-${section.id}`} className={last ? "" : "border-b border-gray-100"}>
      <header className="flex items-center gap-2 px-5 pb-3 pt-5 md:px-6">
        <span className="text-gray-500">
          <IconComponent size={14} aria-hidden="true" />
        </span>
        <h2 id={`section-${section.id}`} className="text-base font-semibold tracking-tight text-gray-900">
          {section.title}
        </h2>
      </header>
      <div className="space-y-3 px-5 pb-5 md:px-6">
        {section.rows.map((row, index) => (
          <Row key={`${row.label}-${index}`} row={row} />
        ))}
      </div>
    </section>
  );
}

/** "Kembali ke daftar" goes back to the list as the person had it (batch, status, page), when they came from it. */
function backTarget(state: unknown): string {
  const back = typeof state === "object" && state !== null ? (state as { back?: unknown }).back : undefined;
  return typeof back === "string" && (back === ROUTE || back.startsWith(`${ROUTE}?`)) ? back : ROUTE;
}

export function ApplicationDetailPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "pendaftaran") === "write";
  const location = useLocation();
  const item = useItem<ApplicationWithFiles>(`${API_PATH}/${encodeURIComponent(id)}`);
  const notice = useFlash();

  if ((item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat pendaftar...
        </p>
      </div>
    );
  }
  if (item.status === "error" || !item.item) {
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat pendaftar."}</Alert>
        {item.failure?.status === 404 ? (
          <Button variant="neutral" href={backTarget(location.state)}>
            Kembali ke daftar
          </Button>
        ) : (
          <Button variant="neutral" onClick={item.refetch}>
            Coba lagi
          </Button>
        )}
      </div>
    );
  }

  const application = item.item;
  const sections = profileSections(application);
  const backHref = backTarget(location.state);

  return (
    <DetailShell
      title={application.fullName}
      back={{ href: backHref, label: "Kembali ke daftar" }}
      crumbHref={backHref}
      status={<StatusTag map={APPLICATION_STATUS} value={application.status} />}
      meta={
        <>
          <span>{application.email}</span>
          <span>
            Batch:{" "}
            <Link to={`/batches/${encodeURIComponent(application.batch.id)}`} className="font-medium text-primary-blue hover:underline">
              {application.batch.year} · {application.batch.name}
            </Link>
          </span>
          <span>Dikirim {new Date(application.submittedAt).toLocaleDateString("id-ID", { dateStyle: "medium" })}</span>
        </>
      }
      flash={notice}
      aside={
        <>
          <Card>
            <CardHeader>
              <CardTitle>Ubah Status</CardTitle>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                // Keyed by the version: after a save or "Muat ulang" the form starts again from the fresh values.
                <ReviewPanel
                  key={application.updatedAt}
                  application={application}
                  onSaved={(next) => {
                    // The answer of a review has no files, no `canOpenFiles` and no version: what the page had stays.
                    item.replace({ ...application, ...next });
                    notice.show({ tone: "success", text: "Status pendaftar berhasil diubah." });
                  }}
                  onReload={() => {
                    notice.dismiss();
                    item.refetch();
                  }}
                />
              ) : (
                <Alert tone="info">Kamu hanya bisa melihat data ini. Perubahan tidak bisa disimpan dengan peranmu.</Alert>
              )}
            </CardContent>
          </Card>
          {application.canOpenFiles && application.files.length > 0 && (
            <PurgeFiles
              applicationId={application.id}
              fullName={application.fullName}
              files={application.files}
              onPurged={({ pending }) => {
                item.refetch();
                notice.show(
                  pending > 0
                    ? { tone: "danger", text: "Berkas sudah dihapus dari daftar, tetapi sebagian belum terhapus dari penyimpanan. Sistem akan mencoba lagi otomatis." }
                    : { tone: "success", text: "Semua berkas pendaftar sudah dihapus." },
                );
              }}
            />
          )}
        </>
      }
    >
      {/* The applicant's profile: one card, a section per kind of answer. */}
      <Card className="gap-0 overflow-hidden py-0 md:py-0">
        {sections.map((section, index) => (
          <Section key={section.id} section={section} last={index === sections.length - 1} />
        ))}
      </Card>
    </DetailShell>
  );
}
