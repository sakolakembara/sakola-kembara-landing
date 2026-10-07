import type { Metadata } from "next";
import Link from "next/link";
import {
  Edit,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Plus,
  Type,
} from "lucide-react";
import { getAllResources } from "@/lib/site-resources";
import {
  RESOURCE_CATEGORY_LABEL,
  RESOURCE_CATEGORY_PILL,
} from "@/lib/site-resources-config";
import { formatBytes } from "@/lib/report-types";
import { DeleteButton } from "./_delete-button";

export const metadata: Metadata = {
  title: "Berkas Pendaftaran",
};

interface PageProps {
  searchParams: Promise<{
    created?: string;
    deleted?: string;
    error?: string;
  }>;
}

export default async function ResourcesAdminPage({ searchParams }: PageProps) {
  const { created, deleted, error } = await searchParams;
  const all = await getAllResources();

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-gray-900 mb-1">
            Berkas Pendaftaran
          </h1>
          <p className="text-gray-600 max-w-[720px]">
            Kelola file, link, dan teks yang muncul di{" "}
            <Link
              href="/gabung-siswa/docs"
              target="_blank"
              className="text-primary-blue hover:underline"
            >
              /gabung-siswa/docs
            </Link>
            . Formulir pendaftaran menautkan ke kategori di halaman ini secara
            otomatis.
          </p>
        </div>
        <Link
          href="/admin/resources/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors whitespace-nowrap"
        >
          <Plus size={16} /> Tambah Berkas
        </Link>
      </header>

      {created && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Berkas berhasil dibuat.
        </div>
      )}
      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Berkas berhasil dihapus.
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
            Belum ada berkas. Klik &quot;Tambah Berkas&quot; untuk membuat
            entry pertama.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Judul</Th>
                  <Th>Kategori</Th>
                  <Th>Tipe</Th>
                  <Th>Urutan</Th>
                  <Th>Diubah</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {all.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top max-w-[420px]">
                      <Link
                        href={`/admin/resources/${row.id}/edit`}
                        className="font-medium text-gray-900 hover:text-primary-blue"
                      >
                        {row.title}
                      </Link>
                      {row.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {row.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${RESOURCE_CATEGORY_PILL[row.category]}`}
                      >
                        {RESOURCE_CATEGORY_LABEL[row.category]}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                        {row.contentType === "file" && (
                          <>
                            <FileText size={12} />
                            <span>
                              File
                              {row.fileSize
                                ? ` · ${formatBytes(row.fileSize)}`
                                : ""}
                            </span>
                          </>
                        )}
                        {row.contentType === "url" && (
                          <>
                            <LinkIcon size={12} />
                            <span>Link</span>
                          </>
                        )}
                        {row.contentType === "text" && (
                          <>
                            <Type size={12} />
                            <span>Teks</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-gray-500 text-xs font-mono">
                      {row.displayOrder}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-500 text-xs whitespace-nowrap">
                      {row.updatedAt.toLocaleDateString("id-ID", {
                        dateStyle: "medium",
                      })}
                    </td>
                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                      {(row.contentType === "file" && row.filePath) ||
                      (row.contentType === "url" && row.externalUrl) ? (
                        <a
                          href={
                            (row.contentType === "file"
                              ? row.filePath
                              : row.externalUrl) ?? "#"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-gray-600 text-sm font-medium hover:text-gray-900 hover:underline mr-3"
                        >
                          <ExternalLink size={12} /> Lihat
                        </a>
                      ) : null}
                      <Link
                        href={`/admin/resources/${row.id}/edit`}
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
