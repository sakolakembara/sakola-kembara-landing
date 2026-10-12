import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Table, TableCard, TBody, Td, Th, THead } from "@/components/ui/table";
import { Tag, type TagTone } from "@/components/ui/tag";
import { PageHeader } from "~/components/PageHeader";
import { accessTo } from "~/lib/access";
import { type Announcement, api, type Severity } from "~/lib/api";
import { useSubmitLock } from "~/lib/hooks";
import { useMe } from "~/lib/session";

// Labels, tones and window text come from app/(admin)/admin/announcements/page.tsx.
const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", warning: "Peringatan", urgent: "Mendesak" };
const SEVERITY_TONE: Record<Severity, TagTone> = { info: "blue", warning: "amber", urgent: "red" };

function formatWindow(starts: string | null, ends: string | null): string {
  const fmt = (value: string) => new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  if (!starts && !ends) return "Tanpa batas";
  if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
  return starts ? `Mulai ${fmt(starts)}` : `Berakhir ${fmt(ends!)}`;
}

function isCurrentlyShown(row: Announcement): boolean {
  const now = Date.now();
  return row.active && (!row.startsAt || new Date(row.startsAt).getTime() <= now) && (!row.endsAt || new Date(row.endsAt).getTime() >= now);
}

export function AnnouncementsPage() {
  const me = useMe();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api<{ announcements: Announcement[] }>("/api/announcements");
    if (list.ok) setRows(list.data.announcements);
    else setError("Gagal memuat pengumuman.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The form is only offered to someone who may change Komunikasi (a viewer, or
  // an editor without that area, reads only). The API refuses their writes anyway.
  const canWrite = accessTo(me, "komunikasi") === "write";

  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Pengumuman">
        <p className="text-gray-600">
          {rows.length} total pengumuman. Strip pengumuman tampil di seluruh halaman publik saat ada satu yang aktif dan dalam jendela jadwal.
        </p>
      </PageHeader>

      {error && <Alert className="mb-4">{error}</Alert>}

      {canWrite && (
        <CreateForm
          onCreated={async () => {
            setError(null);
            await load();
          }}
        />
      )}

      <TableCard>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">Belum ada pengumuman.</div>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Pesan</Th>
                <Th>Severity</Th>
                <Th>Jadwal</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <Td className="align-top max-w-[400px]">
                    <span className="font-medium text-gray-900">{row.title}</span>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-1">{row.body}</p>
                  </Td>
                  <Td className="align-top">
                    <Tag tone={SEVERITY_TONE[row.severity]} size="sm">
                      {SEVERITY_LABEL[row.severity]}
                    </Tag>
                  </Td>
                  <Td className="align-top text-gray-500 text-xs">{formatWindow(row.startsAt, row.endsAt)}</Td>
                  <Td className="align-top">
                    {isCurrentlyShown(row) ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Tampil
                      </span>
                    ) : row.active ? (
                      <span className="text-xs text-amber-700">Aktif, di luar jadwal</span>
                    ) : (
                      <span className="text-xs text-gray-500">Tidak aktif</span>
                    )}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { pending, run } = useSubmitLock();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const date = (name: string) => {
      const value = String(data.get(name) ?? "");
      return value ? new Date(value).toISOString() : null; // datetime-local is local time
    };
    void run(async () => {
      setMessage(null);
      const result = await api("/api/announcements", {
        method: "POST",
        json: {
          title: data.get("title"),
          body: data.get("body"),
          severity: data.get("severity"),
          ctaLabel: data.get("ctaLabel"),
          ctaUrl: data.get("ctaUrl"),
          active: data.get("active") === "on",
          startsAt: date("startsAt"),
          endsAt: date("endsAt"),
        },
      });
      if (result.ok) {
        form.reset();
        setFieldErrors({});
        setMessage({ tone: "success", text: "Pengumuman berhasil disimpan." });
        await onCreated();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setMessage({ tone: "danger", text: "Periksa kembali isian formulir." });
      }
    });
  }

  return (
    <form onSubmit={submit} className="mb-6 bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-5 max-w-4xl">
      <h2 className="text-lg font-semibold text-gray-900">Pengumuman Baru</h2>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Field label="Judul" id="title" required error={fieldErrors.title?.[0]}>
        <Input type="text" id="title" name="title" required placeholder="Contoh: Pendaftaran Angkatan 2026 Dibuka" />
      </Field>
      <Field label="Isi" id="body" required error={fieldErrors.body?.[0]} hint="Pesan singkat (5-500 karakter).">
        <Textarea id="body" name="body" required rows={3} placeholder="Penjelasan singkat..." />
      </Field>
      <Field label="Severity" id="severity" required>
        <select id="severity" name="severity" defaultValue="info" className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 leading-6 focus:border-primary-blue focus:outline-none h-12">
          <option value="info">Info</option>
          <option value="warning">Peringatan</option>
          <option value="urgent">Mendesak</option>
        </select>
      </Field>
      <div className="grid md:grid-cols-2 gap-5">
        <Field label="Label CTA" id="ctaLabel" error={fieldErrors.ctaLabel?.[0]} hint="Kosongkan jika tidak ada tombol.">
          <Input type="text" id="ctaLabel" name="ctaLabel" placeholder="Contoh: Daftar Sekarang" />
        </Field>
        <Field label="URL CTA" id="ctaUrl" error={fieldErrors.ctaUrl?.[0]} hint="/gabung-siswa atau URL lengkap (https://...).">
          <Input type="text" id="ctaUrl" name="ctaUrl" placeholder="/gabung-siswa" />
        </Field>
      </div>
      <label className="flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 transition-colors">
        <input type="checkbox" name="active" className="w-4 h-4 accent-primary-blue" />
        <span className="text-sm text-gray-700">
          <span className="font-medium text-gray-900">Aktifkan.</span> Pengumuman akan tampil di seluruh halaman publik selama jendela jadwal di bawah.
        </span>
      </label>
      <div className="grid md:grid-cols-2 gap-5">
        <Field label="Mulai (opsional)" id="startsAt" error={fieldErrors.startsAt?.[0]} hint="Kosongkan untuk segera tampil saat aktif.">
          <Input type="datetime-local" id="startsAt" name="startsAt" />
        </Field>
        <Field label="Berakhir (opsional)" id="endsAt" error={fieldErrors.endsAt?.[0]} hint="Kosongkan untuk tampil tanpa batas waktu.">
          <Input type="datetime-local" id="endsAt" name="endsAt" />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan..." : "Buat Pengumuman"}
      </Button>
    </form>
  );
}
