import { FileText, Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, Input, Select, Textarea } from "~/components/ui/field";
import { FormSection, FormShell } from "~/components/crud/FormShell";
import { StatusTag } from "~/components/crud/StatusTag";
import { UploadField } from "~/components/crud/UploadField";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { useConfig } from "~/lib/config";
import { describeFailure } from "~/lib/crud/errors";
import { ifMatch } from "~/lib/crud/etag";
import { type FlashControl, flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { BodyEditor, type BodyMode } from "./BodyEditor";
import { MetaDescriptionField } from "./MetaDescriptionField";
import { SeoTitleField } from "./SeoTitleField";
import { API_PATH, type BlogItem, type BlogValues, CATEGORY_OPTIONS, type EditorTab, FIELD_LABELS, FIELD_TAB, ROUTE, STATUS, toBody, toValues } from "./model";
import { LIMITS } from "./rules";

// Create and edit an article, built with the form blocks of docs/cloudflare/admin-crud.md. The legacy editor's
// layout: a "Detail" tab (basic information, classification and publication, the hero image) and a "Konten" tab
// (the markdown, with a preview). What the new storage adds is the status: an article is saved as a draft, and
// "Terbitkan" and "Kembalikan ke Draf" change whether it is on the public site.
//
// What happens after a save is the legacy admin's: a new article opens its edit page with "Artikel berhasil
// dibuat."; saving an existing one stays on the page with "Artikel berhasil disimpan.".

type Action = "save" | "publish" | "unpublish";

const TAB_BUTTON = "relative -mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors";

export function BlogFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "konten") === "write";
  const item = useItem<BlogItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version, and a notice raised by a save
  // (or one that arrived with the navigation) has to survive that.
  const notice = useFlash();
  usePageTitle(id ? "Edit Artikel" : "Tulis Artikel");

  if (id && (item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat artikel...
        </p>
      </div>
    );
  }
  if (id && item.status === "error") {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat artikel."}</Alert>
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
  return <BlogForm key={item.item?.updatedAt ?? "new"} item={item.item} email={me.email} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: BlogItem | null;
  email: string;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: BlogItem) => void;
  onReload: () => void;
}

const FLASH: Record<Action, string> = {
  save: "Artikel berhasil disimpan.",
  publish: "Artikel berhasil diterbitkan.",
  unpublish: "Artikel dikembalikan menjadi draf.",
};

function BlogForm({ item, email, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<BlogValues>(toValues(item, email));
  const navigate = useNavigate();
  const [tab, setTab] = useState<EditorTab>("detail");
  const [bodyMode, setBodyMode] = useState<BodyMode>("edit");
  const published = item?.status === "published";
  const { siteUrl } = useConfig();

  // One mutation for the three things the bar can do, so one summary of errors, one lock against a double click and
  // one stale alert serve all of them. "Terbitkan" and "Kembalikan ke Draf" save what was typed first (the Worker
  // changes the status of the SAVED article, so what the person sees is what goes public), then change the status
  // with the version that save answered.
  const save = useMutation<{ values: BlogValues; action: Action }, ItemPayload<BlogItem>>(async ({ values, action }) => {
    if (!item) return api<ItemPayload<BlogItem>>(API_PATH, { method: "POST", json: toBody(values) });
    let current = item;
    if (action === "save" || form.dirty) {
      const saved = await api<ItemPayload<BlogItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toBody(values), ifMatch: ifMatch(item.updatedAt) });
      if (!saved.ok || action === "save") return saved;
      current = saved.data.item;
    }
    return api<ItemPayload<BlogItem>>(`${API_PATH}/${encodeURIComponent(item.id)}/${action}`, { method: "POST", ifMatch: ifMatch(current.updatedAt) });
  });

  async function submit(action: Action = "save") {
    notice.dismiss();
    const result = await save.submit({ values: form.values, action });
    if (!result?.ok) return;
    if (item) {
      onSaved(result.data.item);
      notice.show({ tone: "success", text: FLASH[action] });
    } else {
      navigate(`${ROUTE}/${encodeURIComponent(result.data.item.id)}/edit`, { state: flashState({ tone: "success", text: "Artikel berhasil dibuat." }) });
    }
  }

  const { fields } = save;
  const errorTabs = new Set(Object.keys(fields).map((name) => FIELD_TAB[name]).filter(Boolean));

  // The legacy editor opened the tab that held the first error.
  useEffect(() => {
    const first = Object.keys(save.fields)[0];
    const wanted = first ? FIELD_TAB[first] : undefined;
    if (!wanted) return;
    setTab(wanted);
    if (first === "contentMarkdown") setBodyMode("edit");
  }, [save.failures]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link of the error summary points at a field that may be on the other tab (or under the preview): show it
  // before the summary tries to put the cursor there (a hidden control cannot take focus).
  useEffect(() => {
    const reveal = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
      const name = link?.getAttribute("href")?.slice(1);
      const wanted = name ? FIELD_TAB[name] : undefined;
      if (!name || !wanted) return;
      flushSync(() => {
        setTab(wanted);
        if (name === "contentMarkdown") setBodyMode("edit");
      });
    };
    document.addEventListener("click", reveal, true);
    return () => document.removeEventListener("click", reveal, true);
  }, []);

  const title = item ? "Edit Artikel" : "Tulis Artikel";
  const slugLocked = published;
  // Someone who cannot write has nothing to switch between, and a disabled fieldset would disable the tab buttons
  // (they sit inside it): they get both parts on one page.
  const tabbed = canWrite;
  const showDetail = !tabbed || tab === "detail";
  const showKonten = !tabbed || tab === "konten";

  const meta: ReactNode = item && (
    <>
      <StatusTag map={STATUS} value={item.status} />
      <code className="max-w-[260px] truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800" title={`/blog/${item.slug}`}>
        /blog/{item.slug}
      </code>
      {/* Only a published article is on the site, and only when the site's address is configured (SITE_URL). */}
      {published && siteUrl !== "" && (
        <a href={`${siteUrl}/blog/${item.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-blue hover:underline">
          Lihat di publik
        </a>
      )}
      {canWrite && (
        <Button variant="neutral" size="sm" disabled={save.pending} onClick={() => void submit(published ? "unpublish" : "publish")}>
          {published ? "Kembalikan ke Draf" : "Terbitkan"}
        </Button>
      )}
    </>
  );

  return (
    <FormShell
      title={title}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit("save")}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Artikel"}
      fieldLabels={FIELD_LABELS}
      meta={meta}
      flash={notice}
    >
      {tabbed && (
      <div className="-mx-6 -mt-6 border-b border-gray-200 px-2 md:-mx-8 md:-mt-8" role="tablist" aria-label="Bagian editor">
        <button type="button" role="tab" id="tab-detail" aria-selected={tab === "detail"} aria-controls="panel-detail" onClick={() => setTab("detail")} className={`${TAB_BUTTON} ${tab === "detail" ? "border-primary-blue text-primary-blue" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
          <Settings2 size={14} aria-hidden="true" /> Detail
          {errorTabs.has("detail") && <span className="absolute right-1 top-2 size-2 rounded-full bg-red-500" role="img" aria-label="Ada kesalahan" />}
        </button>
        <button type="button" role="tab" id="tab-konten" aria-selected={tab === "konten"} aria-controls="panel-konten" onClick={() => setTab("konten")} className={`${TAB_BUTTON} ${tab === "konten" ? "border-primary-blue text-primary-blue" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
          <FileText size={14} aria-hidden="true" /> Konten
          {errorTabs.has("konten") && <span className="absolute right-1 top-2 size-2 rounded-full bg-red-500" role="img" aria-label="Ada kesalahan" />}
        </button>
      </div>
      )}

      <div role="tabpanel" id="panel-detail" aria-labelledby={tabbed ? "tab-detail" : undefined} aria-label={tabbed ? undefined : "Detail"} hidden={!showDetail} className="space-y-6">
        <FormSection title="Informasi Dasar" description="Judul dan ringkasan yang muncul di list, hasil pencarian, dan SEO.">
          <Field label="Judul" id="title" required error={fields.title}>
            <Input type="text" required {...form.field("title")} placeholder="Contoh: Cerita Lulusan Sakola Kembara di ITB" />
          </Field>
          <Field
            label="Slug"
            id="slug"
            error={fields.slug}
            hint={slugLocked ? "Slug tidak bisa diubah setelah artikel terbit." : item ? "Alamat artikel: /blog/slug. Bisa diubah selama artikel masih draf." : "Kosongkan agar dibuat otomatis dari judul."}
          >
            <Input type="text" {...form.field("slug")} disabled={slugLocked} placeholder="cerita-lulusan-sakola-kembara-di-itb" />
          </Field>
          <Field label="Excerpt" id="excerpt" required error={fields.excerpt} hint={`${LIMITS.excerptMin}-${LIMITS.excerptMax} karakter. Muncul di list artikel dan SEO description.`}>
            <Textarea required rows={3} {...form.field("excerpt")} placeholder="Ringkasan singkat artikel..." />
          </Field>
          <SeoTitleField field={form.field("seoTitle")} error={fields.seoTitle} />
          <MetaDescriptionField field={form.field("metaDescription")} error={fields.metaDescription} stored={item?.metaDescription ?? ""} />
        </FormSection>

        <FormSection title="Klasifikasi & Publikasi" description="Bagaimana artikel ini dikelompokkan dan ditampilkan.">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Kategori" id="category" required error={fields.category}>
              <Select required {...form.field("category")}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tanggal Publikasi" id="date" required={published} error={fields.date} hint={published ? undefined : "Kosongkan agar terisi otomatis saat diterbitkan."}>
              <Input type="date" required={published} {...form.field("date")} />
            </Field>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Penulis" id="author" required error={fields.author}>
              <Input type="text" required {...form.field("author")} />
            </Field>
            <div>
              <span className="mb-2 block text-sm font-medium text-gray-700">Featured</span>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 transition-colors hover:border-gray-300">
                <input type="checkbox" {...form.checkbox("featured")} className="h-4 w-4 accent-primary-blue" />
                <span className="text-sm text-gray-700">Tampilkan sebagai artikel unggulan di blog index</span>
              </label>
            </div>
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium text-gray-700">Mesin pencari</span>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 transition-colors hover:border-gray-300">
              <input type="checkbox" {...form.checkbox("noindex")} className="mt-0.5 h-4 w-4 accent-primary-blue" />
              <span className="text-sm text-gray-700">
                Sembunyikan dari Google
                <span className="mt-0.5 block text-xs text-gray-500">Artikel tetap bisa dibuka lewat tautannya, tetapi tidak dimasukkan ke hasil pencarian dan sitemap.</span>
              </span>
            </label>
            {fields.noindex && <p className="mt-1.5 text-xs text-danger-fg">{fields.noindex}</p>}
          </div>
        </FormSection>

        <FormSection title="Gambar Hero" description="Gambar utama yang tampil di atas artikel dan sebagai thumbnail di list.">
          <UploadField
            id="image"
            label="Gambar Hero"
            kind="blog-image"
            value={form.values.image === "" ? null : form.values.image}
            onChange={(path) => form.set("image", path ?? "")}
            error={fields.image}
            disabled={!canWrite}
            hint="Pilih file (≤ 5 MB): PNG, JPEG, WebP, atau GIF."
          />
        </FormSection>
      </div>

      <div role="tabpanel" id="panel-konten" aria-labelledby={tabbed ? "tab-konten" : undefined} aria-label={tabbed ? undefined : "Konten"} hidden={!showKonten} className={tabbed ? undefined : "mt-6"}>
        <FormSection title="Isi Artikel" description="Tulis dalam Markdown (GFM: tabel, checklist, kode). Gunakan tombol Sisipkan Gambar untuk menambah gambar.">
          <BodyEditor id="contentMarkdown" value={form.values.contentMarkdown} onChange={(next) => form.set("contentMarkdown", next)} mode={bodyMode} onModeChange={setBodyMode} error={fields.contentMarkdown} readOnly={!canWrite} />
        </FormSection>
      </div>
    </FormShell>
  );
}
