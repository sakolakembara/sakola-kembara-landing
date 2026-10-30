import { FileText } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { Field, Input, Select, Textarea } from "~/components/ui/field";
import { FormSection, FormShell } from "~/components/crud/FormShell";
import { UploadField } from "~/components/crud/UploadField";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { ifMatch } from "~/lib/crud/etag";
import { type FlashControl, flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { uploadUrl } from "~/lib/crud/upload-kinds";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { formatDateTime } from "~/lib/format";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { ForbiddenPage } from "../Forbidden";
import { itemGate } from "../konten/itemGate";
import { API_PATH, CATEGORIES, CATEGORY_LABEL, defaultYear, FIELD_LABELS, formatBytes, type ReportItem, type ReportValues, ROUTE, toCreateBody, toUpdateBody, toValues } from "./model";

// Create and edit a report, built with the form blocks of docs/cloudflare/admin-crud.md. The same screen serves
// `/reports/new` and `/reports/:id/edit`. What the legacy admin did, kept:
//
//   - a new report is created WITH its PDF (required, at most 20 MB: the upload field refuses more before it is sent),
//     and then the person is back on the list with "Laporan berhasil diupload.";
//   - editing changes the metadata only: the file is shown, not replaceable ("Hapus laporan dan buat baru jika perlu
//     mengganti file."), and saving stays on the page with "Metadata laporan berhasil disimpan.".

export function ReportFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "konten") === "write";
  const item = useItem<ReportItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version (see the announcements screen).
  const notice = useFlash();
  usePageTitle(id ? "Edit Laporan" : "Upload Laporan");

  const gate = itemGate(id, item, { noun: "laporan", listHref: ROUTE });
  if (gate) return gate;
  // Nothing to look at on an empty form: a role that cannot create is not offered one.
  if (!id && !canWrite) return <ForbiddenPage />;

  return <ReportForm key={item.item?.updatedAt ?? "new"} item={item.item} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: ReportItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: ReportItem) => void;
  onReload: () => void;
}

function ReportForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<ReportValues>(toValues(item));
  const navigate = useNavigate();
  const base = useUploadsBase();
  const save = useMutation<ReportValues, ItemPayload<ReportItem>>((values) =>
    item
      ? api<ItemPayload<ReportItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toUpdateBody(values), ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<ReportItem>>(API_PATH, { method: "POST", json: toCreateBody(values) }),
  );

  async function submit() {
    notice.dismiss();
    const result = await save.submit(form.values);
    if (!result?.ok) return;
    if (item) {
      onSaved(result.data.item);
      notice.show({ tone: "success", text: "Metadata laporan berhasil disimpan." });
    } else {
      navigate(ROUTE, { state: flashState({ tone: "success", text: "Laporan berhasil diupload." }) });
    }
  }

  const { fields } = save;
  const currentYear = new Date().getUTCFullYear();

  return (
    <FormShell
      title={item ? "Edit Metadata" : "Upload Laporan"}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Upload Laporan"}
      fieldLabels={FIELD_LABELS}
      flash={notice}
    >
      <FormSection title="Metadata" description="Informasi yang muncul di list publik dan admin.">
        <Field label="Judul" id="title" required error={fields.title}>
          <Input type="text" required {...form.field("title")} placeholder="Contoh: Laporan Tahunan Sakola Kembara 2025/2026" />
        </Field>
        <Field label="Deskripsi" id="description" error={fields.description} hint="Ringkasan isi laporan. Muncul di kartu laporan publik.">
          <Textarea
            rows={3}
            {...form.field("description")}
            placeholder="Contoh: Ringkasan kegiatan, pencapaian, dan tantangan sepanjang tahun ajaran 2025/2026."
            className="min-h-[80px] resize-y"
          />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Kategori" id="category" required error={fields.category}>
            <Select required {...form.field("category")}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Tahun"
            id="year"
            required
            error={fields.year}
            hint={`Tahun laporan. Gunakan format tahun ajaran (${currentYear}/${currentYear + 1}) atau tahun tunggal (${currentYear}).`}
          >
            <Input type="text" required inputMode="numeric" pattern="\d{4}(/\d{4})?" {...form.field("year")} placeholder={defaultYear()} />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="File"
        description={item ? "File PDF tidak bisa diganti dari sini. Hapus laporan dan buat baru jika perlu mengganti file." : "PDF, maksimal 20 MB. Wajib diupload."}
      >
        {item ? (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <FileText size={20} aria-hidden="true" className="shrink-0 text-gray-500" />
            <div className="min-w-0 flex-1">
              <a href={uploadUrl(item.filePath, base)} target="_blank" rel="noopener noreferrer" title={item.filePath} className="block truncate text-sm font-medium text-primary-blue hover:underline">
                {item.filePath}
              </a>
              <div className="mt-0.5 text-xs text-gray-500">
                {formatBytes(item.fileSize)} · diupload {formatDateTime(item.uploadedAt)}
              </div>
            </div>
          </div>
        ) : (
          <UploadField
            id="filePath"
            label="File PDF"
            kind="report"
            required
            value={form.values.filePath || null}
            onChange={(path, result) => {
              form.set("filePath", path ?? "");
              form.set("fileSize", path && result ? String(result.size) : "");
            }}
            error={fields.filePath ?? fields.fileSize}
            disabled={!canWrite}
          />
        )}
      </FormSection>
    </FormShell>
  );
}
