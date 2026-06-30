"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import {
  ArrowLeft,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  ImagePlus,
  Save,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { BLOG_CATEGORIES, type BlogArticle } from "@/lib/blog-types";
import {
  createBlogPost,
  updateBlogPost,
  uploadBlogImage,
  type BlogFormState,
} from "./actions";

const initialState: BlogFormState = { status: "idle" };

interface EditorFormProps {
  mode: "create" | "edit";
  article?: BlogArticle;
  defaultAuthor: string;
  successMessage?: string;
}

type TopTab = "detail" | "konten";

// Fields that live on the Detail tab — used to flag the tab when errors land
// inside it, so users don't lose validation feedback when on the wrong tab.
const DETAIL_FIELDS = ["title", "excerpt", "category", "date", "author", "image"] as const;
const KONTEN_FIELDS = ["body"] as const;

const TEXT_INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <Save size={16} />
      {pending ? "Menyimpan..." : label}
    </button>
  );
}

export function EditorForm({
  mode,
  article,
  defaultAuthor,
  successMessage,
}: EditorFormProps) {
  const action = mode === "create" ? createBlogPost : updateBlogPost;
  const [state, formAction] = useActionState(action, initialState);

  const [tab, setTab] = useState<TopTab>("detail");
  const [bodyTab, setBodyTab] = useState<"edit" | "preview">("edit");

  const [body, setBody] = useState(article?.contentMarkdown ?? "");
  const [heroImage, setHeroImage] = useState(article?.image ?? "");
  const [heroUploading, setHeroUploading] = useState(false);
  const [bodyUploading, setBodyUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const heroInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  const detailHasError = useMemo(
    () =>
      DETAIL_FIELDS.some(
        (f) => (state.fieldErrors as Record<string, string[]> | undefined)?.[f]?.length,
      ),
    [state.fieldErrors],
  );
  const kontenHasError = useMemo(
    () =>
      KONTEN_FIELDS.some(
        (f) => (state.fieldErrors as Record<string, string[]> | undefined)?.[f]?.length,
      ),
    [state.fieldErrors],
  );

  // Auto-jump to the tab that has the first validation error, on submit error.
  useMemo(() => {
    if (state.status === "error") {
      if (detailHasError) setTab("detail");
      else if (kontenHasError) setTab("konten");
    }
  }, [state.status, detailHasError, kontenHasError]);

  async function uploadAndApply(
    file: File,
    setBusy: (b: boolean) => void,
    apply: (path: string) => void,
  ) {
    setUploadError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadBlogImage(fd);
      if (!result.ok) {
        setUploadError(result.error);
        return;
      }
      apply(result.path);
    } catch {
      setUploadError("Upload gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  function insertAtCursor(text: string) {
    const ta = bodyTextareaRef.current;
    if (!ta) {
      setBody((b) => (b.endsWith("\n") || b === "" ? b + text : `${b}\n${text}`));
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setBody(body.slice(0, start) + text + body.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + text.length;
      ta.selectionStart = ta.selectionEnd = cursor;
    });
  }

  return (
    <form action={formAction}>
      {article && <input type="hidden" name="id" value={article.id} />}

      {/* Sticky page header. Now that <main> in the admin layout has no
          padding (each page handles its own), this pins honestly to top: 0
          and spans the full width of <main>. Holds navigation, mode/url
          context, and the primary save action so the admin never has to
          scroll to apply changes. */}
      <header className="sticky top-0 z-20 px-6 md:px-10 py-3 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <Link
              href="/admin/blog"
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} /> Kembali
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {mode === "create" ? "Tulis Artikel" : "Edit Artikel"}
            </span>
            {mode === "edit" && article && (
              <>
                <span className="text-gray-300 select-none">·</span>
                <code
                  className="px-2 py-1 bg-gray-100 rounded text-gray-800 font-mono text-xs truncate max-w-[260px]"
                  title={`/blog/${article.id}`}
                >
                  /blog/{article.id}
                </code>
                <Link
                  href={`/blog/${article.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-xs text-primary-blue hover:underline whitespace-nowrap"
                >
                  Lihat di publik <ExternalLink size={12} />
                </Link>
              </>
            )}
          </div>
          <SubmitButton
            label={mode === "create" ? "Buat Artikel" : "Simpan Perubahan"}
          />
        </div>
      </header>

      <div className="max-w-6xl px-6 md:px-10 pt-6 pb-12">
        {/* Form-level banners — sit at the top of the content area so a
            scroll-to-top after an error always reveals them. */}
        {(state.status === "error" && state.message) ||
        (state.status === "success" && state.message) ||
        (successMessage && state.status !== "error" && state.status !== "success") ? (
          <div className="mb-5">
            {state.status === "error" && state.message && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {state.message}
              </div>
            )}
            {state.status === "success" && state.message && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
                {state.message}
              </div>
            )}
            {successMessage &&
              state.status !== "error" &&
              state.status !== "success" && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}
          </div>
        ) : null}

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Top tabs */}
        <nav
          className="flex border-b border-gray-200 px-2"
          role="tablist"
          aria-label="Bagian editor"
        >
          <TopTabButton
            active={tab === "detail"}
            onClick={() => setTab("detail")}
            icon={<Settings2 size={14} />}
            label="Detail"
            hasError={detailHasError}
          />
          <TopTabButton
            active={tab === "konten"}
            onClick={() => setTab("konten")}
            icon={<FileText size={14} />}
            label="Konten"
            hasError={kontenHasError}
          />
        </nav>

        {/* ============ Tab: Detail ============ */}
        <div
          role="tabpanel"
          className={tab === "detail" ? "p-6 md:p-8" : "hidden"}
        >
          <Section
            title="Informasi Dasar"
            description="Judul dan ringkasan yang muncul di list, hasil pencarian, dan SEO."
          >
            <Field
              label="Judul"
              name="title"
              required
              errors={state.fieldErrors?.title}
            >
              <input
                type="text"
                id="title"
                name="title"
                required
                defaultValue={article?.title ?? ""}
                placeholder="Contoh: Cerita Lulusan Sakola Kembara di ITB"
                className={TEXT_INPUT}
              />
            </Field>

            <Field
              label="Excerpt"
              name="excerpt"
              required
              errors={state.fieldErrors?.excerpt}
              hint="20-500 karakter. Muncul di list artikel dan SEO description."
            >
              <textarea
                id="excerpt"
                name="excerpt"
                required
                rows={3}
                defaultValue={article?.excerpt ?? ""}
                placeholder="Ringkasan singkat artikel..."
                className={`${TEXT_INPUT} resize-none`}
              />
            </Field>
          </Section>

          <Section
            title="Klasifikasi & Publikasi"
            description="Bagaimana artikel ini dikelompokkan dan ditampilkan."
          >
            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Kategori"
                name="category"
                required
                errors={state.fieldErrors?.category}
              >
                <select
                  id="category"
                  name="category"
                  required
                  defaultValue={article?.category ?? "Cerita"}
                  className={`${TEXT_INPUT} bg-white`}
                >
                  {BLOG_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Tanggal Publikasi"
                name="date"
                required
                errors={state.fieldErrors?.date}
              >
                <input
                  type="date"
                  id="date"
                  name="date"
                  required
                  defaultValue={article?.dateISO ?? todayIso}
                  className={TEXT_INPUT}
                />
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <Field
                label="Penulis"
                name="author"
                required
                errors={state.fieldErrors?.author}
              >
                <input
                  type="text"
                  id="author"
                  name="author"
                  required
                  defaultValue={article?.author ?? defaultAuthor}
                  className={TEXT_INPUT}
                />
              </Field>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Featured
                </label>
                <label className="flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
                  <input
                    type="checkbox"
                    name="featured"
                    defaultChecked={article?.featured ?? false}
                    className="w-4 h-4 accent-primary-blue"
                  />
                  <span className="text-sm text-gray-700">
                    Tampilkan sebagai artikel unggulan di blog index
                  </span>
                </label>
              </div>
            </div>
          </Section>

          <Section
            title="Gambar Hero"
            description="Gambar utama yang tampil di atas artikel dan sebagai thumbnail di list."
            isLast
          >
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                id="image"
                name="image"
                value={heroImage}
                onChange={(e) => setHeroImage(e.target.value)}
                placeholder="/blog/images/2026/01/cover.jpg"
                className={`${TEXT_INPUT} flex-1 min-w-[260px]`}
              />
              <input
                ref={heroInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAndApply(f, setHeroUploading, setHeroImage);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => heroInputRef.current?.click()}
                disabled={heroUploading}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <Upload size={14} />
                {heroUploading ? "Mengupload..." : "Upload"}
              </button>
              {heroImage && (
                <button
                  type="button"
                  onClick={() => setHeroImage("")}
                  className="shrink-0 inline-flex items-center justify-center w-10 h-10 text-gray-500 hover:text-red-600 border-2 border-gray-200 hover:border-red-200 rounded-lg transition-colors"
                  title="Hapus gambar"
                  aria-label="Hapus gambar hero"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Pilih file (≤ 5 MB) atau tempel path yang sudah ada (
              <span className="font-mono">/blog/images/...</span>).
            </p>
            {heroImage && (
              <div className="mt-4 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={heroImage}
                  alt="Preview"
                  className="max-h-56 rounded-lg border border-gray-200 object-cover bg-gray-50"
                />
              </div>
            )}
            {state.fieldErrors?.image?.[0] && (
              <p className="text-xs text-red-600 mt-1">
                {state.fieldErrors.image[0]}
              </p>
            )}
          </Section>
        </div>

        {/* ============ Tab: Konten ============ */}
        <div
          role="tabpanel"
          className={tab === "konten" ? "p-6 md:p-8" : "hidden"}
        >
          <Section
            title="Isi Artikel"
            description="Tulis dalam Markdown (GFM: tabel, checklist, kode). Gunakan toolbar untuk menyisipkan gambar."
            isLast
          >
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
                <div className="flex gap-1" role="tablist" aria-label="Mode editor">
                  <button
                    type="button"
                    onClick={() => setBodyTab("edit")}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors ${
                      bodyTab === "edit"
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                    }`}
                  >
                    <Edit3 size={12} /> Tulis
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyTab("preview")}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors ${
                      bodyTab === "preview"
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                    }`}
                  >
                    <Eye size={12} /> Preview
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={bodyInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        uploadAndApply(f, setBodyUploading, (p) => {
                          const alt = f.name
                            .replace(/\.[^.]+$/, "")
                            .replace(/[-_]/g, " ");
                          insertAtCursor(`\n![${alt}](${p})\n`);
                        });
                        setBodyTab("edit");
                      }
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => bodyInputRef.current?.click()}
                    disabled={bodyUploading}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-white text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-60 transition-colors"
                  >
                    <ImagePlus size={12} />
                    {bodyUploading ? "Mengupload..." : "Sisipkan Gambar"}
                  </button>
                </div>
              </div>

              {uploadError && (
                <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-700">
                  {uploadError}
                </div>
              )}

              {bodyTab === "edit" ? (
                <textarea
                  ref={bodyTextareaRef}
                  name="body"
                  required
                  rows={24}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="# Judul Sub Bagian&#10;&#10;Tulis paragraf di sini..."
                  className="w-full px-4 py-3 font-mono text-sm focus:outline-none resize-y min-h-[400px]"
                />
              ) : (
                <>
                  <div className="px-5 py-4 bg-white blog-content overflow-auto min-h-[400px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {body || "_Belum ada isi._"}
                    </ReactMarkdown>
                  </div>
                  {/* Keep value submittable while previewing */}
                  <input type="hidden" name="body" value={body} />
                </>
              )}
            </div>

            <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
              <span>{body.length.toLocaleString("id-ID")} karakter</span>
              {state.fieldErrors?.body?.[0] && (
                <span className="text-red-600">
                  {state.fieldErrors.body[0]}
                </span>
              )}
            </div>
          </Section>
        </div>
        </div>
      </div>
    </form>
  );
}

function TopTabButton({
  active,
  onClick,
  icon,
  label,
  hasError,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hasError: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
        active
          ? "border-primary-blue text-primary-blue"
          : "border-transparent text-gray-600 hover:text-gray-900"
      }`}
    >
      {icon}
      {label}
      {hasError && (
        <span
          className="absolute top-2 right-1 w-2 h-2 rounded-full bg-red-500"
          aria-label="Ada kesalahan"
        />
      )}
    </button>
  );
}

function Section({
  title,
  description,
  children,
  isLast,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <section
      className={`pb-6 ${isLast ? "" : "mb-6 border-b border-gray-100"}`}
    >
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          {title}
        </h2>
        {description && (
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        )}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  hint,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-gray-700 mb-2"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !errors?.length && (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
      {errors?.[0] && <p className="text-xs text-red-600 mt-1">{errors[0]}</p>}
    </div>
  );
}
