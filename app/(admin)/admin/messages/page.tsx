import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_SUBJECT_LABEL,
  CONTACT_SUBJECT_TONE,
  getAllMessages,
} from "@/lib/messages";
import { TableCard } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { AdminPageHeader } from "../_page-header";
import { Tag } from "@/components/ui/tag";

export const metadata: Metadata = {
  title: "Pesan",
};

interface PageProps {
  searchParams: Promise<{ filter?: string; deleted?: string; error?: string }>;
}

export default async function MessagesPage({ searchParams }: PageProps) {
  const { filter, deleted, error } = await searchParams;
  const all = await getAllMessages();

  const unreadCount = all.filter((m) => m.readAt === null).length;
  const filtered =
    filter === "unread"
      ? all.filter((m) => m.readAt === null)
      : filter === "read"
        ? all.filter((m) => m.readAt !== null)
        : all;

  return (
    <div className="p-6 md:p-10">
      <AdminPageHeader
        title="Pesan"
      >
        <p className="text-gray-600">
          {all.length} total · {unreadCount} belum dibaca.
        </p>
      </AdminPageHeader>

      {deleted && (
        <Alert tone="success" className="mb-4">
          Pesan berhasil dihapus.
        </Alert>
      )}
      {error && (
        <Alert className="mb-4">
          {error}
        </Alert>
      )}

      <nav className="flex flex-wrap gap-2 mb-6">
        <FilterPill href="/admin/messages" label={`Semua (${all.length})`} active={!filter} />
        <FilterPill
          href="/admin/messages?filter=unread"
          label={`Belum dibaca (${unreadCount})`}
          active={filter === "unread"}
        />
        <FilterPill
          href="/admin/messages?filter=read"
          label={`Sudah dibaca (${all.length - unreadCount})`}
          active={filter === "read"}
        />
      </nav>

      <TableCard>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            {filter === "unread"
              ? "Tidak ada pesan yang belum dibaca."
              : filter === "read"
                ? "Tidak ada pesan yang sudah dibaca."
                : "Belum ada pesan dari pengunjung."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((m) => {
              const unread = m.readAt === null;
              return (
                <li
                  key={m.id}
                  className={`hover:bg-gray-50 transition-colors ${unread ? "bg-blue-50/30" : ""}`}
                >
                  <Link
                    href={`/admin/messages/${m.id}`}
                    className="flex items-center gap-4 p-4"
                  >
                    <span
                      className={`shrink-0 w-2 h-2 rounded-full ${
                        unread ? "bg-primary-blue" : "bg-transparent"
                      }`}
                      aria-label={unread ? "Belum dibaca" : "Sudah dibaca"}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                          className={`text-sm ${unread ? "font-semibold text-gray-900" : "text-gray-700"}`}
                        >
                          {m.fullName}
                        </span>
                        <span className="text-xs text-gray-500">{m.email}</span>
                        <Tag tone={CONTACT_SUBJECT_TONE[m.subject]} size="sm">
                          {CONTACT_SUBJECT_LABEL[m.subject]}
                        </Tag>
                      </div>
                      <p
                        className={`text-sm mt-1 line-clamp-1 ${unread ? "text-gray-700" : "text-gray-500"}`}
                      >
                        {m.message}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-gray-500 whitespace-nowrap">
                        {m.createdAt.toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </TableCard>
    </div>
  );
}

function FilterPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-primary-blue text-white border-primary-blue"
          : "bg-white text-gray-700 border-gray-200 hover:border-primary-blue/40"
      }`}
    >
      {label}
    </Link>
  );
}
