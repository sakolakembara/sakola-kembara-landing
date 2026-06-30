import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Reply } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactMessages } from "@/lib/db/schema";
import {
  CONTACT_SUBJECT_LABEL,
  CONTACT_SUBJECT_PILL,
} from "@/lib/messages";
import {
  markMessageAsRead,
  toggleMessageRead,
} from "../actions";
import { DeleteButton } from "../_delete-button";

export const metadata: Metadata = {
  title: "Detail Pesan",
};

const SUBJECT_LINE: Record<string, string> = {
  partnership: "Re: Kerjasama dengan Sakola Kembara",
  donation: "Re: Pertanyaan donasi Sakola Kembara",
  other: "Re: Pesan dari sakolakembara.org",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MessageDetailPage({ params }: PageProps) {
  const { id } = await params;
  const message = await db.query.contactMessages.findFirst({
    where: eq(contactMessages.id, id),
  });
  if (!message) notFound();

  // Mark as read on first open. markMessageAsRead is idempotent; if already
  // read, this is a cheap no-op. Doing this server-side after the row read
  // means the admin layout shows the unread count decrementing on next render.
  if (!message.readAt) {
    await markMessageAsRead(message.id);
  }

  const wasUnread = !message.readAt;
  const mailto = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(SUBJECT_LINE[message.subject] ?? "Re: Pesan")}`;

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <Link
        href="/admin/messages"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
      >
        <ArrowLeft size={14} /> Kembali ke daftar
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Detail pesan
          </p>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            {message.fullName}
          </h1>
          <p className="text-gray-600 text-sm">{message.email}</p>
        </div>
        <span
          className={`inline-flex items-center text-sm font-medium px-3 py-1.5 rounded-full border ${CONTACT_SUBJECT_PILL[message.subject]}`}
        >
          {CONTACT_SUBJECT_LABEL[message.subject]}
        </span>
      </header>

      <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap text-sm">
          <div className="text-gray-500">
            Dikirim{" "}
            {message.createdAt.toLocaleString("id-ID", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </div>
          <div className="flex items-center gap-3">
            <a
              href={mailto}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-blue text-white text-sm font-medium rounded-lg hover:bg-primary-blue-dark transition-colors"
            >
              <Reply size={14} /> Balas via Email
            </a>
            <form action={toggleMessageRead}>
              <input type="hidden" name="id" value={message.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 hover:underline"
              >
                <Mail size={14} /> Tandai belum dibaca
              </button>
            </form>
            <DeleteButton id={message.id} fullName={message.fullName} />
          </div>
        </div>
        <div className="p-6">
          <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">
            {message.message}
          </p>
        </div>
        {wasUnread && (
          <div className="px-6 pb-4 text-xs text-gray-400">
            Pesan ini ditandai sebagai sudah dibaca saat kamu membukanya.
          </div>
        )}
      </section>
    </div>
  );
}
