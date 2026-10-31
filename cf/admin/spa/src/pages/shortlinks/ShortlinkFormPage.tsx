import { useNavigate, useParams } from "react-router";
import { Field, Input } from "~/components/ui/field";
import { FormCard, FormColumns, FormShell } from "~/components/crud/FormShell";
import { StatusTag } from "~/components/crud/StatusTag";
import { SwitchField } from "~/components/ui/switch";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { ifMatch } from "~/lib/crud/etag";
import { type FlashControl, flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { SITE_HOST, SITE_URL } from "~/lib/site";
import { ForbiddenPage } from "../Forbidden";
import { itemGate } from "../konten/itemGate";
import { API_PATH, FIELD_LABELS, ROUTE, type ShortlinkItem, type ShortlinkValues, SLUG_PLACEHOLDER, STATUS, toBody, toValues } from "./model";

// Create and edit a shortlink, built with the form blocks of docs/cloudflare/admin-crud.md. The same screen serves
// `/shortlinks/new` and `/shortlinks/:id/edit`. What the legacy admin did, kept: the slug is typed after a fixed
// prefix (the site's name) with a sentence that shows the address it will open at as it is typed; the target is a
// full URL or a path of this site; a note only the admin sees; and a switch. A new link opens its edit page with
// "Shortlink berhasil dibuat."; saving an existing one stays on the page with "Shortlink berhasil disimpan.", and
// says so when the slug changed: the old address stops working.

export function ShortlinkFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "konten") === "write";
  const item = useItem<ShortlinkItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version (see the announcements screen).
  const notice = useFlash();
  usePageTitle(id ? "Edit Shortlink" : "Shortlink Baru");

  const gate = itemGate(id, item, { noun: "shortlink", listHref: ROUTE });
  if (gate) return gate;
  if (!id && !canWrite) return <ForbiddenPage />;

  return <ShortlinkForm key={item.item?.updatedAt ?? "new"} item={item.item} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: ShortlinkItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: ShortlinkItem) => void;
  onReload: () => void;
}

function ShortlinkForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<ShortlinkValues>(toValues(item));
  const navigate = useNavigate();
  const save = useMutation<ShortlinkValues, ItemPayload<ShortlinkItem>>((values) =>
    item
      ? api<ItemPayload<ShortlinkItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toBody(values), ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<ShortlinkItem>>(API_PATH, { method: "POST", json: toBody(values) }),
  );

  async function submit() {
    notice.dismiss();
    const result = await save.submit(form.values);
    if (!result?.ok) return;
    if (item) {
      const renamed = item.slug !== result.data.item.slug;
      onSaved(result.data.item);
      notice.show({ tone: "success", text: renamed ? `Shortlink berhasil disimpan. Slug lama /${item.slug} tidak lagi aktif.` : "Shortlink berhasil disimpan." });
    } else {
      navigate(`${ROUTE}/${encodeURIComponent(result.data.item.id)}/edit`, { state: flashState({ tone: "success", text: "Shortlink berhasil dibuat." }) });
    }
  }

  const { fields } = save;
  // Cosmetic only: the Worker trims and lower-cases what is sent, and decides whether it is allowed.
  const previewSlug = form.values.slug.trim().toLowerCase() || SLUG_PLACEHOLDER;
  const slugField = form.field("slug");

  return (
    <FormShell
      title={item ? "Edit Shortlink" : "Shortlink Baru"}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Shortlink"}
      fieldLabels={FIELD_LABELS}
      flash={notice}
      page={{ crumb: item ? item.slug : "Shortlink baru", status: item && <StatusTag map={STATUS} value={item.active ? "active" : "inactive"} /> }}
    >
      <FormColumns
        aside={
          <FormCard title="Status">
            <SwitchField
              label="Aktifkan"
              description="Saat dinonaktifkan, alamat pendek menampilkan halaman 404, tapi slug tetap dipesan sehingga tidak bisa dipakai ulang."
              error={fields.active}
              {...form.checkbox("active")}
            />
          </FormCard>
        }
      >
        <FormCard title="Alamat pendek" description="Bagian setelah nama domain. Inilah yang dibagikan ke publik.">
          <Field label="Slug" id="slug" required error={fields.slug}>
            {/* The host is shown as a prefix that cannot be edited, so it is obvious the box holds only the path segment. */}
            <div
              className={`flex items-stretch overflow-hidden rounded-xl border-2 focus-within:border-primary-blue ${fields.slug ? "border-danger-fg focus-within:border-danger-fg" : "border-gray-200"}`}
            >
              <span aria-hidden="true" className="flex select-none items-center whitespace-nowrap border-r-2 border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
                {SITE_HOST}/
              </span>
              <input
                type="text"
                required
                {...slugField}
                placeholder="daftar-2026"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={fields.slug ? true : undefined}
                aria-describedby={fields.slug ? "slug-error" : "slug-help"}
                className="min-w-0 flex-1 px-3 py-3 focus:outline-none"
              />
            </div>
          </Field>
          <p id="slug-help" className="-mt-2 text-xs text-gray-500">
            Huruf kecil, angka, dan tanda hubung. Akan terbuka di <span className="break-all font-mono text-gray-700">{`${SITE_URL}/${previewSlug}`}</span>
          </p>
        </FormCard>

        <FormCard title="Tujuan" description="Ke mana pengunjung diarahkan saat membuka alamat di atas.">
          <Field label="URL tujuan" id="targetUrl" required error={fields.targetUrl} hint="URL lengkap (https://...) atau jalur di situs ini (/gabung-siswa).">
            <Input type="text" required {...form.field("targetUrl")} placeholder="https://forms.gle/..." autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
          <Field label="Catatan" id="note" error={fields.note} hint="Hanya terlihat di admin. Contoh: dipakai di bio Instagram.">
            <Input type="text" {...form.field("note")} placeholder="Dibagikan lewat broadcast WhatsApp angkatan 2026" />
          </Field>
        </FormCard>
      </FormColumns>
    </FormShell>
  );
}
