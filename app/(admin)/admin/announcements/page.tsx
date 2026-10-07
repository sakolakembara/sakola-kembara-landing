import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Plus } from "lucide-react";
import { getAllAnnouncements } from "@/lib/announcements";
import type { AnnouncementSeverity } from "@/lib/db/schema";
import { DeleteButton } from "./_delete-button";

export const metadata: Metadata = {
  title: "Pengumuman",
};

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  info: "Info",
  warning: "Peringatan",
  urgent: "Mendesak",
};

const SEVERITY_PILL: Record<AnnouncementSeverity, string> = {
  info: "bg-blue-50 text-blue-700 border-blue-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
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
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-gray-900 mb-1">
            Pengumuman
          </h1>
          <p className="text-gray-600">
            {all.length} total pengumuman. Strip pengumuman tampil di seluruh
            halaman publik saat ada satu yang aktif dan dalam jendela jadwal.
          </p>
        </div>
        <Link
          href="/admin/announcements/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
        >
          <Plus size={16} /> Pengumuman Baru
        </Link>
      </header>

      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Pengumuman berhasil dihapus.
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
            Belum ada pengumuman. Klik "Pengumuman Baru" untuk membuat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Pesan</Th>
                  <Th>Severity</Th>
                  <Th>Jadwal</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {all.map((row) => {
                  const showing = isCurrentlyShown(
                    row.active,
                    row.startsAt,
                    row.endsAt,
                  );
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 align-top max-w-[400px]">
                        <Link
                          href={`/admin/announcements/${row.id}/edit`}
                          className="font-medium text-gray-900 hover:text-primary-blue"
                        >
                          {row.title}
                        </Link>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                          {row.body}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${SEVERITY_PILL[row.severity]}`}
                        >
                          {SEVERITY_LABEL[row.severity]}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-500 text-xs">
                        {formatWindow(row.startsAt, row.endsAt)}
                      </td>
                      <td className="px-4 py-3 align-top">
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
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <Link
                          href={`/admin/announcements/${row.id}/edit`}
                          className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                        >
                          <Edit size={14} /> Edit
                        </Link>
                        <DeleteButton id={row.id} title={row.title} />
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
