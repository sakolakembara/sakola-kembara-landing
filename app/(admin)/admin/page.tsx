import type { Metadata } from "next";
import Link from "next/link";
import { count, desc, eq, isNull } from "drizzle-orm";
import {
  AlertCircle,
  CircleDot,
  Edit3,
  FilePlus2,
  FileText,
  Inbox,
  Megaphone,
  Newspaper,
  PenSquare,
  UserPlus,
  Users,
} from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  announcements,
  auditLog,
  contactMessages,
  reports,
  studentApplications,
  teamMembers,
  users,
} from "@/lib/db/schema";
import { getAllArticles } from "@/lib/blog";
import {
  CONTACT_SUBJECT_LABEL,
  CONTACT_SUBJECT_TONE,
} from "@/lib/messages";
import { AUDIT_LABEL, auditHref } from "@/lib/audit-labels";
import { AdminPageHeader } from "./_page-header";
import { Tag } from "@/components/ui/tag";
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from "@/lib/application-status";
import type { ApplicationStatus } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Dashboard",
};

async function getStats() {
  const [
    pendingApps,
    unreadMessages,
    activeAnnouncements,
    totalReports,
    totalTeam,
    blogArticles,
    recentApps,
    recentMessages,
    recentAudit,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(studentApplications)
      .where(eq(studentApplications.status, "pending"))
      .then((r) => r[0]?.value ?? 0),
    db
      .select({ value: count() })
      .from(contactMessages)
      .where(isNull(contactMessages.readAt))
      .then((r) => r[0]?.value ?? 0),
    db
      .select({ value: count() })
      .from(announcements)
      .where(eq(announcements.active, true))
      .then((r) => r[0]?.value ?? 0),
    db
      .select({ value: count() })
      .from(reports)
      .then((r) => r[0]?.value ?? 0),
    db
      .select({ value: count() })
      .from(teamMembers)
      .then((r) => r[0]?.value ?? 0),
    getAllArticles(),
    db
      .select({
        id: studentApplications.id,
        fullName: studentApplications.fullName,
        schoolName: studentApplications.schoolName,
        status: studentApplications.status,
        submittedAt: studentApplications.submittedAt,
      })
      .from(studentApplications)
      .orderBy(desc(studentApplications.submittedAt))
      .limit(5),
    db
      .select({
        id: contactMessages.id,
        fullName: contactMessages.fullName,
        subject: contactMessages.subject,
        message: contactMessages.message,
        readAt: contactMessages.readAt,
        createdAt: contactMessages.createdAt,
      })
      .from(contactMessages)
      .orderBy(desc(contactMessages.createdAt))
      .limit(5),
    db
      .select({
        id: auditLog.id,
        actorEmail: auditLog.actorEmail,
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(8),
  ]);

  return {
    pendingApps,
    unreadMessages,
    activeAnnouncements,
    totalReports,
    totalTeam,
    totalBlog: blogArticles.length,
    recentApps,
    recentMessages,
    recentAudit,
  };
}

export default async function AdminHomePage() {
  const [session, stats] = await Promise.all([auth(), getStats()]);
  const email = session?.user?.email?.toLowerCase() ?? "";
  const actor = email
    ? await db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { name: true },
      })
    : null;
  const greeting = actor?.name ?? email.split("@")[0] ?? "Admin";

  return (
    <div className="p-6 md:p-10">
      <AdminPageHeader
        title={<>Halo, {greeting}</>}
        className="mb-8"
      >
        <p className="text-gray-600">
          Ringkasan aktivitas Sakola Kembara hari ini.
        </p>
      </AdminPageHeader>

      <section
        aria-label="Ringkasan"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8"
      >
        <StatCard
          href="/admin/applications"
          label="Pendaftar pending"
          value={stats.pendingApps}
          tone={stats.pendingApps > 0 ? "attention" : "neutral"}
          icon={UserPlus}
        />
        <StatCard
          href="/admin/messages"
          label="Pesan belum dibaca"
          value={stats.unreadMessages}
          tone={stats.unreadMessages > 0 ? "attention" : "neutral"}
          icon={Inbox}
        />
        <StatCard
          href="/admin/announcements"
          label="Pengumuman aktif"
          value={stats.activeAnnouncements}
          icon={Megaphone}
        />
        <StatCard
          href="/admin/blog"
          label="Artikel blog"
          value={stats.totalBlog}
          icon={Newspaper}
        />
        <StatCard
          href="/admin/reports"
          label="Laporan"
          value={stats.totalReports}
          icon={FileText}
        />
        <StatCard
          href="/admin/team"
          label="Anggota tim"
          value={stats.totalTeam}
          icon={Users}
        />
      </section>

      <section aria-label="Tindakan Cepat" className="mb-8">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Tindakan Cepat
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction
            href="/admin/blog/new"
            label="Tulis artikel"
            icon={PenSquare}
          />
          <QuickAction
            href="/admin/announcements/new"
            label="Buat pengumuman"
            icon={Megaphone}
          />
          <QuickAction
            href="/admin/reports/new"
            label="Unggah laporan"
            icon={FilePlus2}
          />
          <QuickAction
            href="/admin/team/new"
            label="Tambah anggota tim"
            icon={UserPlus}
          />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Pendaftar terbaru</h2>
            <Link
              href="/admin/applications"
              className="text-xs font-medium text-primary-blue hover:underline"
            >
              Semua
            </Link>
          </header>
          {stats.recentApps.length === 0 ? (
            <p className="px-6 py-10 text-sm text-gray-500 text-center">
              Belum ada pendaftar.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {stats.recentApps.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/applications/${a.id}`}
                    className="flex items-start justify-between gap-3 px-6 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {a.fullName}
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {a.schoolName}
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <Tag tone={APPLICATION_STATUS_TONE[a.status as ApplicationStatus] ?? "amber"} size="sm">
                        {APPLICATION_STATUS_LABEL[a.status as ApplicationStatus] ?? a.status}
                      </Tag>
                      <time
                        className="text-[11px] text-gray-400 mt-1"
                        dateTime={a.submittedAt.toISOString()}
                      >
                        {a.submittedAt.toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}
                      </time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Pesan terbaru</h2>
            <Link
              href="/admin/messages"
              className="text-xs font-medium text-primary-blue hover:underline"
            >
              Semua
            </Link>
          </header>
          {stats.recentMessages.length === 0 ? (
            <p className="px-6 py-10 text-sm text-gray-500 text-center">
              Belum ada pesan masuk.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {stats.recentMessages.map((m) => {
                const unread = m.readAt === null;
                const subjectLabel =
                  CONTACT_SUBJECT_LABEL[
                    m.subject as keyof typeof CONTACT_SUBJECT_LABEL
                  ] ?? m.subject;
                const subjectTone =
                  CONTACT_SUBJECT_TONE[
                    m.subject as keyof typeof CONTACT_SUBJECT_TONE
                  ] ?? CONTACT_SUBJECT_TONE.other;
                return (
                  <li key={m.id}>
                    <Link
                      href={`/admin/messages/${m.id}`}
                      className="flex items-start gap-3 px-6 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <CircleDot
                        size={10}
                        className={`mt-1.5 shrink-0 ${unread ? "text-primary-blue fill-primary-blue" : "text-transparent"}`}
                        aria-label={unread ? "Belum dibaca" : ""}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span
                            className={`text-sm truncate ${unread ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}
                          >
                            {m.fullName}
                          </span>
                          <Tag tone={subjectTone} size="sm">
                            {subjectLabel}
                          </Tag>
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">
                          {m.message}
                        </div>
                      </div>
                      <time
                        className="text-[11px] text-gray-400 shrink-0"
                        dateTime={m.createdAt.toISOString()}
                      >
                        {m.createdAt.toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}
                      </time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <header className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Aktivitas terakhir</h2>
        </header>
        {stats.recentAudit.length === 0 ? (
          <p className="px-6 py-10 text-sm text-gray-500 text-center">
            Belum ada aktivitas. Setiap aksi admin akan muncul di sini.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {stats.recentAudit.map((row) => {
              const label = AUDIT_LABEL[row.action] ?? row.action;
              const href = auditHref(
                row.action,
                row.resourceType,
                row.resourceId,
              );
              const body = (
                <div className="flex items-start justify-between gap-3 px-6 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900">{label}</div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {row.actorEmail}
                    </div>
                  </div>
                  <time
                    className="text-xs text-gray-400 shrink-0"
                    dateTime={row.createdAt.toISOString()}
                  >
                    {row.createdAt.toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
              );
              return (
                <li key={row.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="block hover:bg-gray-50 transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  href,
  label,
  value,
  tone = "neutral",
  icon: Icon,
}: {
  href: string;
  label: string;
  value: number;
  tone?: "neutral" | "attention";
  icon: typeof Inbox;
}) {
  const attention = tone === "attention";
  return (
    <Link
      href={href}
      className={`group block rounded-xl p-4 border transition-colors ${
        attention
          ? "bg-amber-50 border-amber-200 hover:border-amber-300"
          : "bg-white border-gray-100 hover:border-primary-blue/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon
          size={16}
          className={attention ? "text-amber-700" : "text-gray-400"}
        />
        {attention && (
          <AlertCircle
            size={14}
            className="text-amber-600"
            aria-label="Perlu tindakan"
          />
        )}
      </div>
      <div
        className={`text-2xl font-extrabold leading-none ${
          attention ? "text-amber-900" : "text-primary-blue"
        }`}
      >
        {value}
      </div>
      <div
        className={`text-xs mt-1 ${attention ? "text-amber-800" : "text-gray-500"}`}
      >
        {label}
      </div>
    </Link>
  );
}

function QuickAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Edit3;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-primary-blue hover:shadow-sm transition-all"
    >
      <span className="shrink-0 w-9 h-9 rounded-lg bg-primary-blue/10 text-primary-blue flex items-center justify-center group-hover:bg-primary-blue group-hover:text-white transition-colors">
        <Icon size={18} />
      </span>
      <span className="text-sm font-medium text-gray-900">{label}</span>
    </Link>
  );
}
