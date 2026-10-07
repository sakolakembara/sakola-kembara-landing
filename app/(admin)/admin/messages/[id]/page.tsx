import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail, Reply } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactMessages } from "@/lib/db/schema";
import {
  CONTACT_SUBJECT_LABEL,
  CONTACT_SUBJECT_TONE,
} from "@/lib/messages";
import { toggleMessageRead } from "../actions";
import { MarkAsRead } from "./_mark-read";
import { DeleteButton } from "../_delete-button";
import { AdminPageHeader } from "../../_page-header";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";

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

  // First open marks it as read (client-side, see MarkAsRead); the page still
  // renders it as unread this time so the admin sees it was new.
  const wasUnread = !message.readAt;
  const mailto = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(SUBJECT_LINE[message.subject] ?? "Re: Pesan")}`;

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      {wasUnread && <MarkAsRead id={message.id} />}
      <AdminPageHeader
        back={{ href: "/admin/messages", label: "Kembali ke daftar" }}
        title={message.fullName}
        overline="Detail pesan"
        className="md:items-start"
        actions={
          <Tag tone={CONTACT_SUBJECT_TONE[message.subject]} size="lg">
            {CONTACT_SUBJECT_LABEL[message.subject]}
          </Tag>
        }
      >
        <p className="text-gray-600 text-sm">{message.email}</p>
      </AdminPageHeader>

      <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap text-sm">
          <div className="text-gray-500">
            Dikirim{" "}
            {message.createdAt.toLocaleString("id-ID", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button href={mailto} size="sm">
              <Reply size={14} /> Balas via Email
            </Button>
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
