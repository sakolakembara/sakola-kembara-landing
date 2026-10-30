import { FileText, Link as LinkIcon, Type } from "lucide-react";
import type { ComponentType } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, Input, Select, Textarea } from "~/components/ui/field";
import { FormSection, FormShell } from "~/components/crud/FormShell";
import { UploadField } from "~/components/crud/UploadField";
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
import { API_PATH, CATEGORIES, CATEGORY_LABEL, CONTENT_TYPES, CONTENT_TYPE_HELP, FIELD_LABELS, ROUTE, type ResourceContentType, type ResourceItem, type ResourceValues, toBody, toValues } from "./model";

// Create and edit a document of the Pusat Dokumen, built with the form blocks of docs/cloudflare/admin-crud.md.
// A port of app/(admin)/admin/resources/_editor-form.tsx: the same sections, fields, hints and messages, with the
// file field of the kit (`UploadField`: the file goes to R2 as soon as it is picked, the form saves its path).
//
//  - A row is exactly one of three shapes. Switching the type keeps what was typed for the others until the save;
//    the Worker stores only the chosen one (and removes the file of a row that stops being a file).
//  - A file is a PDF or an image (PNG, JPEG, WebP), at most 25 MB: Dzul's decision for the Pusat Dokumen, enforced
//    by the Worker from the bytes. Word and Excel files are linked from elsewhere (type "Link Eksternal") or saved
//    as PDF.
//
// After a save: a new document opens the list with "Berkas berhasil dibuat."; saving an existing one stays on the
// form with "Perubahan tersimpan." (the legacy messages).

const TYPE_ICON: Record<ResourceContentType, ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  file: FileText,
  url: LinkIcon,
  text: Type,
};

export function ResourceFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "pendaftaran") === "write";
  const item = useItem<ResourceItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version.
  const notice = useFlash();
  usePageTitle(id ? "Edit Berkas" : "Berkas Baru");

  if (id && (item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat berkas...
        </p>
      </div>
    );
  }
  if (id && item.status === "error") {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat berkas."}</Alert>
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

  return <ResourceForm key={item.item?.updatedAt ?? "new"} item={item.item} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: ResourceItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: ResourceItem) => void;
  onReload: () => void;
}

function ResourceForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<ResourceValues>(toValues(item));
  const navigate = useNavigate();
  const save = useMutation<ResourceValues, ItemPayload<ResourceItem>>((values) =>
    item
      ? api<ItemPayload<ResourceItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toBody(values), ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<ResourceItem>>(API_PATH, { method: "POST", json: toBody(values) }),
  );

  async function submit() {
    notice.dismiss();
    const result = await save.submit(form.values);
    if (!result?.ok) return;
    if (item) {
      onSaved(result.data.item);
      notice.show({ tone: "success", text: "Perubahan tersimpan." });
    } else {
      navigate(ROUTE, { state: flashState({ tone: "success", text: "Berkas berhasil dibuat." }) });
    }
  }

  const { fields } = save;
  const { contentType } = form.values;

  return (
    <FormShell
      title={item ? "Edit Berkas" : "Berkas Baru"}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Berkas"}
      fieldLabels={FIELD_LABELS}
      flash={notice}
    >
      <FormSection title="Metadata">
        <Field label="Judul" id="title" required error={fields.title}>
          <Input type="text" required {...form.field("title")} placeholder="Contoh: Panduan Pendaftaran Sakola Kembara Gen 6" />
        </Field>

        <Field label="Deskripsi" id="description" error={fields.description} hint="Muncul di bawah judul di /gabung-siswa/docs. Boleh dikosongkan.">
          <Textarea rows={3} {...form.field("description")} placeholder="Ringkas isi atau instruksi penggunaan berkas ini." className="min-h-[80px] resize-y" />
        </Field>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Kategori" id="category" required error={fields.category} hint="Menentukan section di halaman /gabung-siswa/docs.">
            <Select required {...form.field("category")}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Urutan Tampil" id="displayOrder" required error={fields.displayOrder} hint="Lebih kecil = lebih dulu di dalam kategori.">
            <Input type="number" required min={0} max={9999} {...form.field("displayOrder")} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Tipe Konten" description="Setiap berkas hanya salah satu tipe: file, link, atau teks.">
        <Field group label="Tipe konten" error={fields.contentType}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {CONTENT_TYPES.map((type) => {
              const help = CONTENT_TYPE_HELP[type];
              const active = contentType === type;
              const Icon = TYPE_ICON[type];
              return (
                <label
                  key={type}
                  className={`flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-blue ${
                    active ? "border-primary-blue bg-primary-blue/5" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input type="radio" name="contentType" id={type === "file" ? "contentType" : undefined} value={type} checked={active} onChange={() => form.set("contentType", type)} className="sr-only" />
                  <span className="flex items-center gap-2">
                    <Icon size={16} className={active ? "text-primary-blue" : "text-gray-500"} aria-hidden="true" />
                    <span className={`text-sm font-semibold ${active ? "text-primary-blue" : "text-gray-800"}`}>{help.label}</span>
                  </span>
                  <span className="text-xs leading-relaxed text-gray-600">{help.description}</span>
                </label>
              );
            })}
          </div>
        </Field>
      </FormSection>

      {contentType === "file" && (
        <FormSection title="File">
          <UploadField
            id="filePath"
            label="File"
            kind="resource"
            required
            disabled={!canWrite}
            value={form.values.filePath || null}
            onChange={(path, result) => {
              form.set("filePath", path ?? "");
              form.set("fileSize", result ? String(result.size) : "");
            }}
            error={fields.filePath ?? fields.fileSize}
            hint="PDF, PNG, JPEG, atau WebP. Maksimal 25 MB."
          />
        </FormSection>
      )}

      {contentType === "url" && (
        <FormSection title="Link Eksternal">
          <Field label="URL" id="externalUrl" required error={fields.externalUrl} hint="Contoh: https://drive.google.com/…, https://youtube.com/…">
            <Input type="url" {...form.field("externalUrl")} placeholder="https://…" />
          </Field>
        </FormSection>
      )}

      {contentType === "text" && (
        <FormSection title="Teks Isi" description="Muncul di /gabung-siswa/docs dalam blok kode dengan tombol Salin.">
          <Field label="Teks" id="bodyText" required error={fields.bodyText} hint="Contoh: caption Instagram, template pesan broadcast.">
            <Textarea rows={10} {...form.field("bodyText")} placeholder="Tulis teks yang ingin bisa disalin calon siswa…" className="min-h-[200px] resize-y font-mono text-xs" />
          </Field>
        </FormSection>
      )}

      <FormSection title="Catatan Internal" description="Tidak ditampilkan ke publik. Untuk keperluan tim admin saja.">
        <Field label="Catatan" id="notes" error={fields.notes}>
          <Input type="text" {...form.field("notes")} placeholder="Sumber asli, kredit desain, dsb." />
        </Field>
      </FormSection>
    </FormShell>
  );
}
