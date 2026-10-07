import type { Metadata } from "next";
import Link from "next/link";
import { Download, Edit, Plus } from "lucide-react";
import { getAllReports, REPORT_CATEGORY_LABEL, REPORT_CATEGORY_TONE, formatBytes } from "@/lib/reports";
import { DeleteButton } from "./_delete-button";
import { TableHint } from "../_table-hint";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "../_page-header";
import { Tag } from "@/components/ui/tag";

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
      <AdminPageHeader
        title="Laporan"
        actions={
          <Button href="/admin/reports/new">
            <Plus size={16} /> Upload Laporan
          </Button>
        }
      >
        <p className="text-gray-600">
          {all.length} total laporan. Tampil di publik di{" "}
          <Link
            href="/laporan"
            target="_blank"
            className="text-primary-blue hover:underline"
          >
            /laporan
          </Link>
          .
        </p>
      </AdminPageHeader>

      {created && (
        <Alert tone="success" className="mb-4">
          Laporan berhasil diupload.
        </Alert>
      )}
      {deleted && (
        <Alert tone="success" className="mb-4">
          Laporan berhasil dihapus.
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
            Belum ada laporan. Klik &ldquo;Upload Laporan&rdquo; untuk menambah.
          </div>
        ) : (
          <Table>
            <TableHint />
            <THead>
              <tr>
                <Th>Judul</Th>
                <Th>Kategori</Th>
                <Th>Tahun</Th>
                <Th>Ukuran</Th>
                <Th>Diupload</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {all.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <Td className="align-top max-w-[400px]">
                    <Link
                      href={`/admin/reports/${row.id}/edit`}
                      className="font-medium text-gray-900 hover:text-primary-blue"
                    >
                      {row.title}
                    </Link>
                    {row.description && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                        {row.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1 font-mono truncate">
                      {row.filePath}
                    </p>
                  </Td>
                  <Td className="align-top">
                    <Tag tone={REPORT_CATEGORY_TONE[row.category]} size="sm">
                      {REPORT_CATEGORY_LABEL[row.category]}
                    </Tag>
                  </Td>
                  <Td className="align-top text-gray-700 font-medium whitespace-nowrap">
                    {row.year}
                    <div className="text-xs text-gray-400 font-normal">
                      {row.year.includes("/") ? "Tahun Ajaran" : "Tahun"}
                    </div>
                  </Td>
                  <Td className="align-top text-gray-500 text-xs">
                    {formatBytes(row.fileSize)}
                  </Td>
                  <Td className="align-top text-gray-500 text-xs whitespace-nowrap">
                    {row.uploadedAt.toLocaleDateString("id-ID", {
                      dateStyle: "medium",
                    })}
                  </Td>
                  <Td className="align-top text-right whitespace-nowrap">
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

