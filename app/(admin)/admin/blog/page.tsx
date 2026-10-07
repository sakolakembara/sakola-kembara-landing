import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Plus } from "lucide-react";
import { getBlogArticlesSorted } from "@/lib/blog";
import { BLOG_CATEGORIES, cleanExcerpt } from "@/lib/blog-types";
import { DeleteButton } from "./_delete-button";
import { TableHint } from "../_table-hint";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "../_page-header";
import { Input, Select } from "@/components/ui/field";

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
      <AdminPageHeader
        title="Blog"
        actions={
          <Button href="/admin/blog/new">
            <Plus size={16} /> Tulis Artikel Baru
          </Button>
        }
      >
        <p className="text-gray-600">
          {all.length} total artikel · {filtered.length} ditampilkan
        </p>
      </AdminPageHeader>

      {deleted && (
        <Alert tone="success" className="mb-4">
          Artikel berhasil dihapus.
        </Alert>
      )}
      {error && (
        <Alert className="mb-4">
          {error}
        </Alert>
      )}

      <form
        className="flex flex-wrap gap-3 mb-4"
        action="/admin/blog"
        method="get"
      >
        <Input
          size="sm"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cari judul atau excerpt..."
          aria-label="Cari artikel"
          className="flex-1 min-w-[200px] w-auto"
        />
        <Select
          size="sm"
          name="category"
          defaultValue={category ?? ""}
          aria-label="Kategori"
          className="w-auto"
        >
          <option value="">Semua kategori</option>
          {BLOG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="neutral">
          Filter
        </Button>
        {(needle || validCategory) && (
          <Link
            href="/admin/blog"
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Reset
          </Link>
        )}
      </form>

      <TableCard>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Tidak ada artikel yang cocok.
          </div>
        ) : (
          <Table>
            <TableHint />
            <THead>
              <tr>
                <Th>Judul</Th>
                <Th>Kategori</Th>
                <Th>Tanggal</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {filtered.map((article) => (
                <tr
                  key={article.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <Td className="align-top max-w-[400px]">
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
                  </Td>
                  <Td className="align-top text-gray-600">
                    {article.category}
                  </Td>
                  <Td className="align-top text-gray-500 text-xs whitespace-nowrap">
                    {article.date}
                  </Td>
                  <Td className="align-top text-right whitespace-nowrap">
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
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        
        )}
      </TableCard>
    </div>
  );
}

