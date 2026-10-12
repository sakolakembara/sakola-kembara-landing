import { useNavigate, useParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormSection, FormShell } from "~/components/crud/FormShell";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { ifMatch } from "~/lib/crud/etag";
import { type FlashControl, flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { API_PATH, type AnnouncementItem, type AnnouncementValues, FIELD_LABELS, ROUTE, SEVERITIES, SEVERITY_HINT, SEVERITY_LABEL, toBody, toValues } from "./model";

// Create and edit announcements, built with the form blocks of docs/cloudflare/admin-crud.md. The same screen
// serves `/announcements/new` and `/announcements/:id/edit`: it loads the item (edit), renders the form keyed
// by the item's version, and leaves the rest to `FormShell` (error summary, stale alert, unsaved guard).
//
// What happens after a save is the legacy admin's: a new announcement opens its edit page with "Pengumuman
// berhasil dibuat."; saving an existing one stays on the page with "Pengumuman berhasil disimpan.".

const RING: Record<(typeof SEVERITIES)[number], string> = {
  info: "ring-blue-500 bg-blue-50 border-blue-300",
  warning: "ring-amber-500 bg-amber-50 border-amber-300",
  urgent: "ring-red-500 bg-red-50 border-red-300",
};

export function AnnouncementFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "komunikasi") === "write";
  const item = useItem<AnnouncementItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version, and a notice raised by a save
  // (or one that arrived with the navigation) has to survive that.
  const notice = useFlash();
  usePageTitle(id ? "Edit Pengumuman" : "Pengumuman Baru");

  if (id && (item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat pengumuman...
        </p>
      </div>
    );
  }
  if (id && item.status === "error") {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat pengumuman."}</Alert>
        {missing ? (
          <Button variant="neutral" href={ROUTE}>
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

  // Keyed by the version: after "Muat ulang" or a save the form starts again from the fresh values.
  return <AnnouncementForm key={item.item?.updatedAt ?? "new"} item={item.item} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: AnnouncementItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: AnnouncementItem) => void;
  onReload: () => void;
}

function AnnouncementForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<AnnouncementValues>(toValues(item));
  const navigate = useNavigate();
  const save = useMutation<AnnouncementValues, ItemPayload<AnnouncementItem>>((values) =>
    item
      ? api<ItemPayload<AnnouncementItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toBody(values), ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<AnnouncementItem>>(API_PATH, { method: "POST", json: toBody(values) }),
  );

  async function submit() {
    notice.dismiss();
    const result = await save.submit(form.values);
    if (!result?.ok) return;
    if (item) {
      onSaved(result.data.item);
      notice.show({ tone: "success", text: "Pengumuman berhasil disimpan." });
    } else {
      navigate(`${ROUTE}/${encodeURIComponent(result.data.item.id)}/edit`, { state: flashState({ tone: "success", text: "Pengumuman berhasil dibuat." }) });
    }
  }

  const title = item ? "Edit Pengumuman" : "Pengumuman Baru";
  const { fields } = save;

  return (
    <FormShell
      title={title}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Pengumuman"}
      fieldLabels={FIELD_LABELS}
      flash={notice}
    >
      <FormSection title="Konten" description="Pesan yang muncul di strip pengumuman.">
        <Field label="Judul" id="title" required error={fields.title}>
          <Input type="text" required {...form.field("title")} placeholder="Contoh: Pendaftaran Angkatan 2026 Dibuka" />
        </Field>
        <Field label="Isi" id="body" required error={fields.body} hint="Pesan singkat (5-500 karakter).">
          <Textarea required rows={3} {...form.field("body")} placeholder="Penjelasan singkat..." />
        </Field>
      </FormSection>

      <FormSection title="Tampilan" description="Warna dan ikon strip menyesuaikan severity.">
        <Field group label="Severity" required error={fields.severity}>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITIES.map((severity) => (
              <label
                key={severity}
                className={`relative cursor-pointer rounded-xl border-2 px-4 py-3 transition-all focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-blue ${
                  form.values.severity === severity ? `ring-2 ${RING[severity]}` : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <input type="radio" name="severity" id={severity === "info" ? "severity" : undefined} value={severity} required checked={form.values.severity === severity} onChange={() => form.set("severity", severity)} className="sr-only" />
                <div className="text-sm font-semibold text-gray-900">{SEVERITY_LABEL[severity]}</div>
                <div className="mt-0.5 text-xs text-gray-500">{SEVERITY_HINT[severity]}</div>
              </label>
            ))}
          </div>
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Label CTA" id="ctaLabel" error={fields.ctaLabel} hint="Kosongkan jika tidak ada tombol.">
            <Input type="text" {...form.field("ctaLabel")} placeholder="Contoh: Daftar Sekarang" />
          </Field>
          <Field label="URL CTA" id="ctaUrl" error={fields.ctaUrl} hint="/gabung-siswa atau URL lengkap (https://...).">
            <Input type="text" {...form.field("ctaUrl")} placeholder="/gabung-siswa" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Jadwal" description="Kapan pengumuman aktif tampil di publik.">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 transition-colors hover:border-gray-300">
          <input type="checkbox" {...form.checkbox("active")} className="h-4 w-4 accent-primary-blue" />
          <span className="text-sm text-gray-700">
            <span className="font-medium text-gray-900">Aktifkan.</span> Pengumuman akan tampil di seluruh halaman publik selama jendela jadwal di bawah.
          </span>
        </label>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Mulai (opsional)" id="startsAt" error={fields.startsAt} hint="Kosongkan untuk segera tampil saat aktif.">
            <Input type="datetime-local" {...form.field("startsAt")} />
          </Field>
          <Field label="Berakhir (opsional)" id="endsAt" error={fields.endsAt} hint="Kosongkan untuk tampil tanpa batas waktu.">
            <Input type="datetime-local" {...form.field("endsAt")} />
          </Field>
        </div>
      </FormSection>
    </FormShell>
  );
}
