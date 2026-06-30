"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Edit3, Eye, Save } from "lucide-react";
import {
  BLOG_CATEGORIES,
  type BlogArticle,
} from "@/lib/blog-types";
import {
  createBlogPost,
  updateBlogPost,
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

  const todayIso = new Date().toISOString().slice(0, 10);

  const inputClass =
    "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none";

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
        hint="Path relatif terhadap /public, contoh: /blog/images/2026/01/cover.jpg. Opsional. Upload manual via filesystem untuk sekarang."
      >
        <input
          type="text"
          id="image"
          name="image"
          defaultValue={article?.image ?? ""}
          placeholder="/blog/images/2026/01/cover.jpg"
          className={inputClass}
        />
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
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Isi Artikel <span className="text-red-500 ml-0.5">*</span>
          </label>
          <div className="flex gap-1" role="tablist">
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
        {tab === "edit" ? (
          <textarea
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
