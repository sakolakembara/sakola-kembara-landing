import { Save, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, Select, Textarea } from "~/components/ui/field";
import { SwitchField } from "~/components/ui/switch";
import { CopyButton } from "~/components/crud/CopyButton";
import { FormShell } from "~/components/crud/FormShell";
import { PageTabs } from "~/components/crud/PageTabs";
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

// Create and edit an article, built with the form blocks of docs/cloudflare/admin-crud.md in the editor layout of
// cf/admin/DESIGN.md ("Forms: one bar", SAKEM-116): the breadcrumb, the status and the actions in the shell's top bar, three
// tabs under it, and cards. "Konten" is the text (a textarea and its preview, for now) with the article's address and
// summary beside it; "Publikasi" the status, category, date, author, Featured and the hero image; "SEO" what a search
// result and a shared link show. The status is part of the article: it is saved as a draft, and "Terbitkan" and
// "Kembalikan ke Draf" change whether it is on the public site.
//
// What happens after a save is the legacy admin's: a new article opens its edit page with "Artikel berhasil
// dibuat."; saving an existing one stays on the page with "Artikel berhasil disimpan.".

type Action = "save" | "publish" | "unpublish";

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
  const [tab, setTab] = useState<EditorTab>("konten");
  const [bodyMode, setBodyMode] = useState<BodyMode>("edit");
  const [running, setRunning] = useState<Action | null>(null);
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
    setRunning(action);
    const result = await save.submit({ values: form.values, action });
    setRunning(null);
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

  // The editor opens the tab that holds the first error.
  useEffect(() => {
    const first = Object.keys(save.fields)[0];
    const wanted = first ? FIELD_TAB[first] : undefined;
    if (!wanted) return;
    setTab(wanted);
    if (first === "contentMarkdown") setBodyMode("edit");
  }, [save.failures]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link of the error summary points at a field that may be on another tab (or under the preview): show it
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

  const slugLocked = published;
  // Someone who cannot write has nothing to switch between, and a disabled fieldset would disable the tab buttons
  // (they sit inside it): they get all three parts on one page.
  const tabbed = canWrite;
  const showKonten = !tabbed || tab === "konten";
  const showPublikasi = !tabbed || tab === "publikasi";
  const showSeo = !tabbed || tab === "seo";

  return (
    <FormShell
      title={item ? "Edit Artikel" : "Tulis Artikel"}
      back={{ href: ROUTE, label: "Kembali ke daftar artikel" }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit("save")}
      onReload={onReload}
      readOnly={!canWrite}
      fieldLabels={FIELD_LABELS}
      flash={notice}
      page={{
        crumb: item ? item.title : "Artikel baru",
        status: item && <StatusTag map={STATUS} value={item.status} />,
        tabs: tabbed ? (
          <PageTabs
            label="Bagian editor"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "konten", label: "Konten", invalid: errorTabs.has("konten") },
              { id: "publikasi", label: "Publikasi", invalid: errorTabs.has("publikasi") },
              { id: "seo", label: "SEO", invalid: errorTabs.has("seo") },
            ]}
          />
        ) : undefined,
        // A draft has two ways to save: keep it a draft, or put it on the site. Everything else has one.
        actions: (formId) => (
          <>
            <Button variant="ghost" href={ROUTE}>
              {canWrite ? "Batal" : "Tutup"}
            </Button>
            {canWrite && item && !published && (
              <>
                <Button variant="neutral" type="submit" form={formId} disabled={save.pending}>
                  {running === "save" ? "Menyimpan..." : "Simpan"}
                </Button>
                <Button disabled={save.pending} onClick={() => void submit("publish")}>
                  <Send aria-hidden="true" />
                  Terbitkan
                </Button>
              </>
            )}
            {canWrite && (!item || published) && (
              <Button type="submit" form={formId} disabled={save.pending}>
                <Save aria-hidden="true" />
                {running === "save" ? "Menyimpan..." : item ? "Simpan Perubahan" : "Buat Artikel"}
              </Button>
            )}
          </>
        ),
      }}
    >
      <div className={tabbed ? undefined : "space-y-8"}>
        <div role="tabpanel" id="panel-konten" aria-labelledby={tabbed ? "tab-konten" : undefined} aria-label={tabbed ? undefined : "Konten"} hidden={!showKonten} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0">
            <h2 className="text-base font-semibold leading-snug tracking-tight text-foreground">
              Isi Artikel
            </h2>
            <p className="mb-3 mt-1 text-[13px] leading-relaxed text-muted-foreground">Tulis dalam Markdown (GFM: tabel, checklist, kode). Gunakan tombol Sisipkan Gambar untuk menambah gambar.</p>
            <BodyEditor id="contentMarkdown" value={form.values.contentMarkdown} onChange={(next) => form.set("contentMarkdown", next)} mode={bodyMode} onModeChange={setBodyMode} error={fields.contentMarkdown} readOnly={!canWrite} />
          </section>

          <Card className="lg:sticky lg:top-[68px]">
            <CardHeader>
              <CardTitle>Informasi Dasar</CardTitle>
              <CardDescription>Judul dan ringkasan yang muncul di list, hasil pencarian, dan SEO.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Judul" id="title" required error={fields.title}>
                <Input type="text" required {...form.field("title")} placeholder="Contoh: Cerita Lulusan Sakola Kembara di ITB" />
              </Field>
              <div>
                <Field
                  label="Slug"
                  id="slug"
                  error={fields.slug}
                  hint={slugLocked ? "Slug tidak bisa diubah setelah artikel terbit." : item ? "Alamat artikel: /blog/slug. Bisa diubah selama artikel masih draf." : "Kosongkan agar dibuat otomatis dari judul."}
                >
                  <Input type="text" {...form.field("slug")} disabled={slugLocked} placeholder="cerita-lulusan-sakola-kembara-di-itb" />
                </Field>
                {item && <ArticleLink slug={item.slug} siteUrl={siteUrl} published={published} />}
              </div>
              <Field label="Excerpt" id="excerpt" required error={fields.excerpt} hint={`${LIMITS.excerptMin}-${LIMITS.excerptMax} karakter. Muncul di list artikel dan SEO description.`}>
                <Textarea required rows={4} {...form.field("excerpt")} placeholder="Ringkasan singkat artikel..." />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div role="tabpanel" id="panel-publikasi" aria-labelledby={tabbed ? "tab-publikasi" : undefined} aria-label={tabbed ? undefined : "Publikasi"} hidden={!showPublikasi} className="grid items-start gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Publikasi</CardTitle>
              <CardDescription>Bagaimana artikel ini dikelompokkan dan ditampilkan.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="block text-sm font-medium text-foreground">Status</span>
                  <span className="text-[13px] text-muted-foreground">{published ? "Sudah tayang di situs." : item ? "Belum tayang di situs." : "Belum disimpan."}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item && <StatusTag map={STATUS} value={item.status} />}
                  {canWrite && published && (
                    <Button variant="neutral" size="sm" disabled={save.pending} onClick={() => void submit("unpublish")}>
                      Kembalikan ke Draf
                    </Button>
                  )}
                </div>
              </div>
              <hr className="border-border" />
              <div className="grid gap-5 sm:grid-cols-2">
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
              <Field label="Penulis" id="author" required error={fields.author}>
                <Input type="text" required {...form.field("author")} />
              </Field>
              <SwitchField label="Featured" description="Tampilkan sebagai artikel unggulan di blog index." error={fields.featured} {...form.checkbox("featured")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gambar Hero</CardTitle>
              <CardDescription>Gambar utama yang tampil di atas artikel dan sebagai thumbnail di list.</CardDescription>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        <div role="tabpanel" id="panel-seo" aria-labelledby={tabbed ? "tab-seo" : undefined} aria-label={tabbed ? undefined : "SEO"} hidden={!showSeo} className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Mesin Pencari</CardTitle>
              <CardDescription>Semua opsional. Kosong berarti situs memakai Judul dan Excerpt.</CardDescription>
            </CardHeader>
            <CardContent>
              <SeoTitleField field={form.field("seoTitle")} error={fields.seoTitle} />
              <MetaDescriptionField field={form.field("metaDescription")} error={fields.metaDescription} stored={item?.metaDescription ?? ""} />
              <SwitchField label="Sembunyikan dari Google" description="Artikel tetap bisa dibuka lewat tautannya, tetapi tidak dimasukkan ke hasil pencarian dan sitemap." error={fields.noindex} {...form.checkbox("noindex")} />
            </CardContent>
          </Card>
        </div>
      </div>
    </FormShell>
  );
}

/**
 * Under the slug: the address of a saved article with "Salin", and the link to it. Only a published article is on the
 * site, and only when the site's address is configured (SITE_URL); until then the link says it is waiting for that.
 */
function ArticleLink({ slug, siteUrl, published }: { slug: string; siteUrl: string; published: boolean }) {
  const path = `/blog/${slug}`;
  const address = siteUrl === "" ? path : `${siteUrl}${path}`;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
      <span>Tautan:</span>
      <code className="min-w-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">{address}</code>
      <CopyButton url={address} />
      {published ? (
        siteUrl !== "" && (
          <a href={address} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Lihat di publik
          </a>
        )
      ) : (
        <span className="text-gray-400">Lihat di publik (setelah terbit)</span>
      )}
    </div>
  );
}
