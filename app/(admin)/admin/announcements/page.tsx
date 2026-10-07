import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Plus } from "lucide-react";
import { getAllAnnouncements } from "@/lib/announcements";
import type { AnnouncementSeverity } from "@/lib/db/schema";
import { DeleteButton } from "./_delete-button";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "../_page-header";
import { Tag, type TagTone } from "@/components/ui/tag";

export const metadata: Metadata = {
  title: "Pengumuman",
};

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  info: "Info",
  warning: "Peringatan",
  urgent: "Mendesak",
};

const SEVERITY_TONE: Record<AnnouncementSeverity, TagTone> = {
  info: "blue",
  warning: "amber",
  urgent: "red",
};

interface PageProps {
  searchParams: Promise<{ deleted?: string; error?: string }>;
}

function formatWindow(starts: Date | null, ends: Date | null): string {
  if (!starts && !ends) return "Tanpa batas";
  const fmt = (d: Date) =>
    d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
  if (starts) return `Mulai ${fmt(starts)}`;
  return `Berakhir ${fmt(ends!)}`;
}

function isCurrentlyShown(
  active: boolean,
  starts: Date | null,
  ends: Date | null,
): boolean {
  if (!active) return false;
  const now = Date.now();
  if (starts && starts.getTime() > now) return false;
  if (ends && ends.getTime() < now) return false;
  return true;
}

export default async function AnnouncementsAdminPage({ searchParams }: PageProps) {
  const { deleted, error } = await searchParams;
  const all = await getAllAnnouncements();

  return (
    <div className="p-6 md:p-10">
      <AdminPageHeader
        title="Pengumuman"
        actions={
          <Button href="/admin/announcements/new">
            <Plus size={16} /> Pengumuman Baru
          </Button>
        }
      >
        <p className="text-gray-600">
          {all.length} total pengumuman. Strip pengumuman tampil di seluruh
          halaman publik saat ada satu yang aktif dan dalam jendela jadwal.
        </p>
      </AdminPageHeader>

      {deleted && (
        <Alert tone="success" className="mb-4">
          Pengumuman berhasil dihapus.
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
            Belum ada pengumuman. Klik &ldquo;Pengumuman Baru&rdquo; untuk membuat.
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Pesan</Th>
                <Th>Severity</Th>
                <Th>Jadwal</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {all.map((row) => {
                const showing = isCurrentlyShown(
                  row.active,
                  row.startsAt,
                  row.endsAt,
                );
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <Td className="align-top max-w-[400px]">
                      <Link
                        href={`/admin/announcements/${row.id}/edit`}
                        className="font-medium text-gray-900 hover:text-primary-blue"
                      >
                        {row.title}
                      </Link>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                        {row.body}
                      </p>
                    </Td>
                    <Td className="align-top">
                      <Tag tone={SEVERITY_TONE[row.severity]} size="sm">
                        {SEVERITY_LABEL[row.severity]}
                      </Tag>
                    </Td>
                    <Td className="align-top text-gray-500 text-xs">
                      {formatWindow(row.startsAt, row.endsAt)}
                    </Td>
                    <Td className="align-top">
                      {showing ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
                          <span className="w-2 h-2 bg-green-500 rounded-full" />
                          Tampil
                        </span>
                      ) : row.active ? (
                        <span className="text-xs text-amber-700">
                          Aktif, di luar jadwal
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">
                          Tidak aktif
                        </span>
                      )}
                    </Td>
                    <Td className="align-top text-right whitespace-nowrap">
                      <Link
                        href={`/admin/announcements/${row.id}/edit`}
                        className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                      >
                        <Edit size={14} /> Edit
                      </Link>
                      <DeleteButton id={row.id} title={row.title} />
                    </Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        
        )}
      </TableCard>
    </div>
  );
}

