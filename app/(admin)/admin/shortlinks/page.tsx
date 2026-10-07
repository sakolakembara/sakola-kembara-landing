import type { Metadata } from "next";
import Link from "next/link";
import { Edit, ExternalLink, Plus } from "lucide-react";
import { getAllShortlinks } from "@/lib/shortlinks";
import { SITE_URL } from "@/lib/seo";
import { TableHint } from "../_table-hint";
import { DeleteButton } from "./_delete-button";
import { CopyButton } from "./_copy-button";

export const metadata: Metadata = {
  title: "Shortlink",
};

interface PageProps {
  searchParams: Promise<{ deleted?: string; error?: string }>;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default async function ShortlinksAdminPage({ searchParams }: PageProps) {
  const { deleted, error } = await searchParams;
  const all = await getAllShortlinks();
  const activeCount = all.filter((s) => s.active).length;

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-gray-900 mb-1">
            Shortlink
          </h1>
          <p className="text-gray-600">
            {all.length} shortlink, {activeCount} aktif. Alamat pendek di{" "}
            <span className="font-mono text-sm">{SITE_URL}/slug</span> yang
            mengarahkan pengunjung ke tujuan mana pun.
          </p>
        </div>
        <Link
          href="/admin/shortlinks/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors whitespace-nowrap"
        >
          <Plus size={16} /> Shortlink Baru
        </Link>
      </header>

      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Shortlink berhasil dihapus.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {all.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada shortlink. Klik &ldquo;Shortlink Baru&rdquo; untuk membuat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHint />
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Alamat pendek</Th>
                  <Th>Tujuan</Th>
                  <Th>Klik</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {all.map((row) => {
                  const fullUrl = `${SITE_URL}/${row.slug}`;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/shortlinks/${row.id}/edit`}
                          className="font-medium text-gray-900 hover:text-primary-blue font-mono"
                        >
                          /{row.slug}
                        </Link>
                        <div className="mt-1">
                          <CopyButton url={fullUrl} />
                        </div>
                        {row.note && (
                          <p className="text-xs text-gray-500 mt-1 max-w-[240px] line-clamp-2">
                            {row.note}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top max-w-[320px]">
                        <a
                          href={row.targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1 text-gray-600 hover:text-primary-blue break-all"
                        >
                          <span className="line-clamp-2">{row.targetUrl}</span>
                          <ExternalLink
                            size={12}
                            className="shrink-0 mt-1"
                            aria-hidden
                          />
                        </a>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="font-medium text-gray-900">
                          {row.clickCount}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {row.clickCount > 0
                            ? formatDate(row.lastClickedAt)
                            : "Belum diklik"}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 whitespace-nowrap">
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                            Aktif
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">Nonaktif</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <Link
                          href={`/admin/shortlinks/${row.id}/edit`}
                          className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                        >
                          <Edit size={14} /> Edit
                        </Link>
                        <DeleteButton id={row.id} slug={row.slug} />
                      </td>
                    </tr>
                  );
                })}
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
