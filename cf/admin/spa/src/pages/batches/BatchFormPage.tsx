import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, Input, Textarea } from "~/components/ui/field";
import { FormShell } from "~/components/crud/FormShell";
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
import { API_PATH, type BatchItem, type BatchValues, FIELD_LABELS, ROUTE, toBody, toValues } from "./model";

// Create and edit a batch, built with the form blocks of docs/cloudflare/admin-crud.md. A port of
// app/(admin)/admin/batches/_editor-form.tsx: the same fields, hints and messages.
//
// What happens after a save is the legacy admin's: a new batch opens its detail page with "Batch berhasil dibuat.";
// saving an existing one stays on the form with "Perubahan berhasil disimpan.". "Kembali" goes to the batch (to the
// list for a new one).

export function BatchFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "pendaftaran") === "write";
  const item = useItem<BatchItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version.
  const notice = useFlash();
  usePageTitle(id ? "Edit Batch" : "Batch Baru");

  if (id && (item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat batch...
        </p>
      </div>
    );
  }
  if (id && item.status === "error") {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat batch."}</Alert>
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
  return <BatchForm key={item.item?.updatedAt ?? "new"} item={item.item} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: BatchItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: BatchItem) => void;
  onReload: () => void;
}

function BatchForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<BatchValues>(toValues(item));
  const navigate = useNavigate();
  const save = useMutation<BatchValues, ItemPayload<BatchItem>>((values) =>
    item
      ? api<ItemPayload<BatchItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toBody(values), ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<BatchItem>>(API_PATH, { method: "POST", json: toBody(values) }),
  );

  async function submit() {
    notice.dismiss();
    const result = await save.submit(form.values);
    if (!result?.ok) return;
    if (item) {
      onSaved(result.data.item);
      notice.show({ tone: "success", text: "Perubahan berhasil disimpan." });
    } else {
      navigate(`${ROUTE}/${encodeURIComponent(result.data.item.id)}`, { state: flashState({ tone: "success", text: "Batch berhasil dibuat." }) });
    }
  }

  const { fields } = save;

  return (
    <FormShell
      title={item ? "Edit Batch" : "Batch Baru"}
      back={{ href: item ? `${ROUTE}/${encodeURIComponent(item.id)}` : ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Batch"}
      fieldLabels={FIELD_LABELS}
      flash={notice}
    >
      <Field label="Tahun angkatan" id="year" required error={fields.year} hint="Contoh: 2026 untuk periode 2026/2027.">
        <Input type="number" required min={2024} max={2100} {...form.field("year")} />
      </Field>

      <Field label="Nama batch" id="name" required error={fields.name} hint="Muncul di halaman siswa dan admin. Contoh: “Gen 7 — 2026/2027”.">
        <Input type="text" required {...form.field("name")} placeholder="Contoh: Gen 7 — 2026/2027" />
      </Field>

      <Field label="Deskripsi (opsional)" id="description" error={fields.description}>
        <Textarea rows={3} {...form.field("description")} />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Buka pendaftaran" id="opensAt" required error={fields.opensAt}>
          <Input type="datetime-local" required {...form.field("opensAt")} />
        </Field>
        <Field label="Tutup pendaftaran" id="closesAt" required error={fields.closesAt}>
          <Input type="datetime-local" required {...form.field("closesAt")} />
        </Field>
      </div>
    </FormShell>
  );
}

