import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  CONTACT_SUBJECT_LABEL,
  CONTACT_SUBJECT_PILL,
  getAllMessages,
} from "@/lib/messages";

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
      <header className="mb-6">
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
          Pesan
        </h1>
        <p className="text-gray-600">
          {all.length} total · {unreadCount} belum dibaca.
        </p>
      </header>

      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Pesan berhasil dihapus.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4 text-sm text-red-700">
          {error}
        </div>
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

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
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
                        <span
                          className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${CONTACT_SUBJECT_PILL[m.subject]}`}
                        >
                          {CONTACT_SUBJECT_LABEL[m.subject]}
                        </span>
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
                      <ArrowRight
                        size={14}
                        className="ml-auto mt-1 text-gray-300"
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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
