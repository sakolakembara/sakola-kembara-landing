"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Edit3, Eye, ImagePlus, Save, Upload, X } from "lucide-react";
import {
  BLOG_CATEGORIES,
  type BlogArticle,
} from "@/lib/blog-types";
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
  const [body, setBody] = useState(article?.contentMarkdown ?? "");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [heroImage, setHeroImage] = useState(article?.image ?? "");
  const [heroUploading, setHeroUploading] = useState(false);
  const [bodyUploading, setBodyUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  const inputClass =
    "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

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
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + text.length;
      ta.selectionStart = ta.selectionEnd = cursor;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      {article && <input type="hidden" name="id" value={article.id} />}

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
          className={inputClass}
        />
      </Field>

      {mode === "edit" && (
        <Field
          label="URL"
          name="slug-display"
          hint="Slug tidak bisa diubah agar URL existing tidak rusak."
        >
          <input
            type="text"
            id="slug-display"
            readOnly
            value={`/blog/${article!.id}`}
            className={`${inputClass} bg-gray-50 font-mono text-sm text-gray-600 cursor-not-allowed`}
          />
        </Field>
      )}

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
            className={`${inputClass} bg-white`}
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
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="Excerpt"
        name="excerpt"
        required
        errors={state.fieldErrors?.excerpt}
        hint="Ringkasan singkat (20-500 karakter). Muncul di list dan SEO description."
      >
        <textarea
          id="excerpt"
          name="excerpt"
          required
          rows={3}
          defaultValue={article?.excerpt ?? ""}
          placeholder="Ringkasan artikel..."
          className={`${inputClass} resize-none`}
        />
      </Field>

      <Field
        label="Gambar Hero"
        name="image"
        errors={state.fieldErrors?.image}
        hint="Pilih file (≤ 5 MB) atau tempel path /blog/images/... yang sudah ada."
      >
        <div className="flex gap-2">
          <input
            type="text"
            id="image"
            name="image"
            value={heroImage}
            onChange={(e) => setHeroImage(e.target.value)}
            placeholder="/blog/images/2026/01/cover.jpg"
            className={inputClass}
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
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Upload size={14} />
            {heroUploading ? "Mengupload..." : "Upload"}
          </button>
          {heroImage && (
            <button
              type="button"
              onClick={() => setHeroImage("")}
              className="shrink-0 inline-flex items-center justify-center w-10 h-10 text-gray-500 hover:text-red-600 border-2 border-gray-200 rounded-lg"
              title="Hapus gambar"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {heroImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt="Preview"
            className="mt-3 max-h-48 rounded-lg border border-gray-200 object-cover"
          />
        )}
      </Field>

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
            className={inputClass}
          />
        </Field>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Featured
          </label>
          <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-lg cursor-pointer w-full">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={article?.featured ?? false}
              className="w-4 h-4 accent-primary-blue"
            />
            <span className="text-sm">Tampilkan sebagai artikel unggulan</span>
          </label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <label className="block text-sm font-medium text-gray-700">
            Isi Artikel <span className="text-red-500 ml-0.5">*</span>
          </label>
          <div className="flex gap-2 items-center">
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
                  setTab("edit");
                }
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => bodyInputRef.current?.click()}
              disabled={bodyUploading}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60"
            >
              <ImagePlus size={12} />
              {bodyUploading ? "Mengupload..." : "Sisipkan Gambar"}
            </button>
            <div className="w-px h-5 bg-gray-200" />
            <button
              type="button"
              onClick={() => setTab("edit")}
              className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors ${
                tab === "edit"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Edit3 size={12} /> Tulis
            </button>
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors ${
                tab === "preview"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Eye size={12} /> Preview
            </button>
          </div>
        </div>
        {uploadError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2 text-xs text-red-700">
            {uploadError}
          </div>
        )}
        {tab === "edit" ? (
          <textarea
            ref={bodyTextareaRef}
            name="body"
            required
            rows={20}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Tulis isi artikel dalam markdown..."
            className={`${inputClass} font-mono text-sm`}
          />
        ) : (
          <>
            <div className="min-h-[500px] px-5 py-4 bg-white border-2 border-gray-200 rounded-lg blog-content overflow-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {body || "_Belum ada isi._"}
              </ReactMarkdown>
            </div>
            {/* Keep the value submittable when previewing */}
            <input type="hidden" name="body" value={body} />
          </>
        )}
        {state.fieldErrors?.body?.[0] && (
          <p className="text-xs text-red-600 mt-1">
            {state.fieldErrors.body[0]}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Markdown lengkap dengan GFM (tabel, checklist). Referensi gambar dari{" "}
          <span className="font-mono">/blog/images/...</span>
        </p>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <SubmitButton
          label={mode === "create" ? "Buat Artikel" : "Simpan Perubahan"}
        />
      </div>
    </form>
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
