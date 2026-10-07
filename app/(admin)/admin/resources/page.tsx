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
  RESOURCE_CATEGORY_TONE,
} from "@/lib/site-resources-config";
import { formatBytes } from "@/lib/report-types";
import { DeleteButton } from "./_delete-button";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { AdminPageHeader } from "../_page-header";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";

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
      <AdminPageHeader
        title="Berkas Pendaftaran"
        className="md:items-start"
        actions={
          <Button href="/admin/resources/new" className="whitespace-nowrap">
            <Plus size={16} /> Tambah Berkas
          </Button>
        }
      >
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
      </AdminPageHeader>

      {created && (
        <Alert tone="success" className="mb-4">
          Berkas berhasil dibuat.
        </Alert>
      )}
      {deleted && (
        <Alert tone="success" className="mb-4">
          Berkas berhasil dihapus.
        </Alert>
      )}
      {error && (
        <Alert className="mb-4">
          {error}
        </Alert>
      )}

      <TableCard>
        {all.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada berkas. Klik &quot;Tambah Berkas&quot; untuk membuat
            entry pertama.
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Judul</Th>
                <Th>Kategori</Th>
                <Th>Tipe</Th>
                <Th>Urutan</Th>
                <Th>Diubah</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {all.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <Td className="align-top max-w-[420px]">
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
                  </Td>
                  <Td className="align-top">
                    <Tag tone={RESOURCE_CATEGORY_TONE[row.category]} size="sm">
                      {RESOURCE_CATEGORY_LABEL[row.category]}
                    </Tag>
                  </Td>
                  <Td className="align-top">
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
                  </Td>
                  <Td className="align-top text-gray-500 text-xs font-mono">
                    {row.displayOrder}
                  </Td>
                  <Td className="align-top text-gray-500 text-xs whitespace-nowrap">
                    {row.updatedAt.toLocaleDateString("id-ID", {
                      dateStyle: "medium",
                    })}
                  </Td>
                  <Td className="align-top text-right whitespace-nowrap">
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

