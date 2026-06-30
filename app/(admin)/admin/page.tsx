import type { Metadata } from "next";
import { count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  announcements,
  auditLog,
  contactMessages,
  reports,
  studentApplications,
} from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Dashboard",
};

async function getStats() {
  const now = new Date();
  const [
    pendingApps,
    unreadMessages,
    activeAnnouncements,
    totalReports,
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
  ]);

  const recent = await db
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
    .limit(10);

  return {
    pendingApps,
    unreadMessages,
    activeAnnouncements,
    totalReports,
    recent,
    now,
  };
}

const STAT_CARDS = [
  { key: "pendingApps", label: "Pendaftar pending" },
  { key: "unreadMessages", label: "Pesan belum dibaca" },
  { key: "activeAnnouncements", label: "Pengumuman aktif" },
  { key: "totalReports", label: "Total laporan" },
] as const;

export default async function AdminHomePage() {
  const stats = await getStats();

  return (
    <div className="p-6 md:p-10">
      <header className="mb-8">
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
          Dashboard
        </h1>
        <p className="text-gray-600">
          Ringkasan aktivitas admin Sakola Kembara.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {STAT_CARDS.map((card) => (
          <div
            key={card.key}
            className="bg-white rounded-xl p-6 border border-gray-100"
          >
            <div className="text-sm text-gray-500 mb-1">{card.label}</div>
            <div className="text-3xl font-extrabold text-primary-blue leading-none">
              {stats[card.key]}
            </div>
          </div>
        ))}
      </div>

      <section className="bg-white rounded-xl p-6 border border-gray-100">
        <h2 className="font-semibold text-gray-900 mb-4">Aktivitas terakhir</h2>
        {stats.recent.length === 0 ? (
          <p className="text-sm text-gray-500">
            Belum ada aktivitas. Setiap aksi admin akan muncul di sini.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {stats.recent.map((row) => (
              <li
                key={row.id}
                className="py-3 flex items-center justify-between text-sm"
              >
                <div>
                  <span className="font-medium text-gray-900">{row.action}</span>{" "}
                  {row.resourceType && (
                    <span className="text-gray-500">
                      · {row.resourceType}
                      {row.resourceId ? `/${row.resourceId}` : ""}
                    </span>
                  )}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {row.actorEmail}
                  </div>
                </div>
                <time
                  className="text-xs text-gray-400 shrink-0 ml-4"
                  dateTime={row.createdAt.toISOString()}
                >
                  {row.createdAt.toLocaleString("id-ID")}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
