import type { Metadata } from "next";
import Link from "next/link";
import { Download, Edit, Plus } from "lucide-react";
import { getAllReports, REPORT_CATEGORY_LABEL, REPORT_CATEGORY_PILL, formatBytes } from "@/lib/reports";
import { DeleteButton } from "./_delete-button";

export const metadata: Metadata = {
  title: "Laporan",
};

interface PageProps {
  searchParams: Promise<{
    created?: string;
    deleted?: string;
    error?: string;
  }>;
}

export default async function ReportsAdminPage({ searchParams }: PageProps) {
  const { created, deleted, error } = await searchParams;
  const all = await getAllReports();

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            Laporan
          </h1>
          <p className="text-gray-600">
            {all.length} total laporan. Tampil di publik di{" "}
            <Link
              href="/impact-reports"
              target="_blank"
              className="text-primary-blue hover:underline"
            >
              /impact-reports
            </Link>
            .
          </p>
        </div>
        <Link
          href="/admin/reports/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
        >
          <Plus size={16} /> Upload Laporan
        </Link>
      </header>

      {created && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Laporan berhasil diupload.
        </div>
      )}
      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Laporan berhasil dihapus.
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
            Belum ada laporan. Klik "Upload Laporan" untuk menambah.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Judul</Th>
                  <Th>Kategori</Th>
                  <Th>Tahun</Th>
                  <Th>Ukuran</Th>
                  <Th>Diupload</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {all.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top max-w-[400px]">
                      <Link
                        href={`/admin/reports/${row.id}/edit`}
                        className="font-medium text-gray-900 hover:text-primary-blue"
                      >
                        {row.title}
                      </Link>
                      <p className="text-xs text-gray-500 mt-1 font-mono truncate">
                        {row.filePath}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${REPORT_CATEGORY_PILL[row.category]}`}
                      >
                        {REPORT_CATEGORY_LABEL[row.category]}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-gray-700 font-medium">
                      {row.year}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-500 text-xs">
                      {formatBytes(row.fileSize)}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-500 text-xs whitespace-nowrap">
                      {row.uploadedAt.toLocaleDateString("id-ID", {
                        dateStyle: "medium",
                      })}
                    </td>
                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                      <a
                        href={row.filePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-gray-600 text-sm font-medium hover:text-gray-900 hover:underline mr-3"
                      >
                        <Download size={14} /> Lihat
                      </a>
                      <Link
                        href={`/admin/reports/${row.id}/edit`}
                        className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                      >
                        <Edit size={14} /> Edit
                      </Link>
                      <DeleteButton id={row.id} title={row.title} />
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
