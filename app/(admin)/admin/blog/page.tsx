import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Plus } from "lucide-react";
import { getBlogArticlesSorted } from "@/lib/blog";
import { BLOG_CATEGORIES, cleanExcerpt } from "@/lib/blog-types";
import { DeleteButton } from "./_delete-button";
import { TableHint } from "../_table-hint";

export const metadata: Metadata = {
  title: "Blog",
};

interface PageProps {
  searchParams: Promise<{
    category?: string;
    q?: string;
    deleted?: string;
    error?: string;
  }>;
}

export default async function BlogAdminPage({ searchParams }: PageProps) {
  const { category, q, deleted, error } = await searchParams;
  const all = await getBlogArticlesSorted();

  const validCategory =
    category && BLOG_CATEGORIES.includes(category as never) ? category : null;
  const needle = q?.trim().toLowerCase() ?? "";

  let filtered = all;
  if (validCategory) {
    filtered = filtered.filter((a) => a.category === validCategory);
  }
  if (needle) {
    filtered = filtered.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.excerpt.toLowerCase().includes(needle),
    );
  }

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-gray-900 mb-1">
            Blog
          </h1>
          <p className="text-gray-600">
            {all.length} total artikel · {filtered.length} ditampilkan
          </p>
        </div>
        <Link
          href="/admin/blog/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
        >
          <Plus size={16} /> Tulis Artikel Baru
        </Link>
      </header>

      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Artikel berhasil dihapus.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        className="flex flex-wrap gap-3 mb-4"
        action="/admin/blog"
        method="get"
      >
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cari judul atau excerpt..."
          className="flex-1 min-w-[200px] px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm"
        />
        <select
          name="category"
          defaultValue={category ?? ""}
          className="px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none bg-white text-sm"
        >
          <option value="">Semua kategori</option>
          {BLOG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800"
        >
          Filter
        </button>
        {(needle || validCategory) && (
          <Link
            href="/admin/blog"
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Reset
          </Link>
        )}
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Tidak ada artikel yang cocok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHint />
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Judul</Th>
                  <Th>Kategori</Th>
                  <Th>Tanggal</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((article) => (
                  <tr
                    key={article.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 align-top max-w-[400px]">
                      <Link
                        href={`/admin/blog/${article.id}/edit`}
                        className="font-medium text-gray-900 hover:text-primary-blue"
                      >
                        {article.title}
                      </Link>
                      {article.featured && (
                        <span className="ml-2 inline-block text-xs font-medium px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">
                          Featured
                        </span>
                      )}
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                        {cleanExcerpt(article.excerpt)}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top text-gray-600">
                      {article.category}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-500 text-xs whitespace-nowrap">
                      {article.date}
                    </td>
                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                      <Link
                        href={`/admin/blog/${article.id}/edit`}
                        className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                      >
                        <Edit size={14} /> Edit
                      </Link>
                      <DeleteButton
                        slug={article.id}
                        title={article.title}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-3">
      {children}
    </th>
  );
}
