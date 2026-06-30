import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applicationStatus,
  studentApplications,
  type ApplicationStatus,
} from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Pendaftar",
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  under_review: "Dalam Review",
  accepted: "Diterima",
  rejected: "Ditolak",
};

const STATUS_PILL: Record<ApplicationStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  under_review: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

function isStatus(s: string | undefined): s is ApplicationStatus {
  return Boolean(s && applicationStatus.includes(s as ApplicationStatus));
}

export default async function ApplicationsPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const filter = isStatus(status) ? status : null;

  // Counts per status — drives the filter pills.
  const counts = await db
    .select({
      status: studentApplications.status,
      value: count(),
    })
    .from(studentApplications)
    .groupBy(studentApplications.status);

  const countByStatus = Object.fromEntries(
    counts.map((c) => [c.status, Number(c.value)]),
  ) as Record<ApplicationStatus, number>;
  const total = Object.values(countByStatus).reduce((a, b) => a + b, 0);

  const rows = await db
    .select({
      id: studentApplications.id,
      fullName: studentApplications.fullName,
      email: studentApplications.email,
      schoolName: studentApplications.schoolName,
      graduationYear: studentApplications.graduationYear,
      branchPreference: studentApplications.branchPreference,
      status: studentApplications.status,
      submittedAt: studentApplications.submittedAt,
    })
    .from(studentApplications)
    .where(filter ? eq(studentApplications.status, filter) : sql`true`)
    .orderBy(desc(studentApplications.submittedAt))
    .limit(50);

  return (
    <div className="p-6 md:p-10">
      <header className="mb-6">
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
          Pendaftar
        </h1>
        <p className="text-gray-600">
          Daftar pendaftar siswa Sakola Kembara. {total} total pendaftar.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 mb-6">
        <FilterPill href="/admin/applications" label={`Semua (${total})`} active={!filter} />
        {applicationStatus.map((s) => (
          <FilterPill
            key={s}
            href={`/admin/applications?status=${s}`}
            label={`${STATUS_LABEL[s]} (${countByStatus[s] ?? 0})`}
            active={filter === s}
          />
        ))}
      </nav>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada pendaftar{filter ? ` dengan status "${STATUS_LABEL[filter]}"` : ""}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Nama</Th>
                  <Th>Asal Sekolah</Th>
                  <Th>Cabang</Th>
                  <Th>Tahun Lulus</Th>
                  <Th>Status</Th>
                  <Th>Dikirim</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <Td>
                      <div className="font-medium text-gray-900">{row.fullName}</div>
                      <div className="text-xs text-gray-500">{row.email}</div>
                    </Td>
                    <Td>{row.schoolName}</Td>
                    <Td className="text-gray-600">
                      {row.branchPreference || "—"}
                    </Td>
                    <Td className="text-gray-600">{row.graduationYear}</Td>
                    <Td>
                      <span
                        className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_PILL[row.status]}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </Td>
                    <Td className="text-gray-500 text-xs">
                      {row.submittedAt.toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/applications/${row.id}`}
                        className="inline-flex items-center gap-1 text-primary-blue font-medium hover:underline"
                      >
                        Lihat <ArrowRight size={14} />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rows.length === 50 && (
        <p className="text-xs text-gray-500 mt-3">
          Menampilkan 50 pendaftar terbaru. Paginasi akan ditambahkan setelah
          volume meningkat.
        </p>
      )}
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

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-3">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
