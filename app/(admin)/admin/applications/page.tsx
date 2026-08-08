import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  admissionBatches,
  applicationStatus,
  studentApplications,
  type ApplicationStatus,
} from "@/lib/db/schema";
import { getAllBatches } from "@/lib/admission-batches";

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
  searchParams: Promise<{ status?: string; batch?: string }>;
}

function isStatus(s: string | undefined): s is ApplicationStatus {
  return Boolean(s && applicationStatus.includes(s as ApplicationStatus));
}

export default async function ApplicationsPage({ searchParams }: PageProps) {
  const { status, batch } = await searchParams;
  const statusFilter = isStatus(status) ? status : null;
  const batches = await getAllBatches();
  const batchFilter =
    batch && batches.some((b) => b.id === batch) ? batch : null;
  const currentBatch = batchFilter
    ? batches.find((b) => b.id === batchFilter)!
    : null;

  const whereClauses: SQL[] = [];
  if (statusFilter) whereClauses.push(eq(studentApplications.status, statusFilter));
  if (batchFilter) whereClauses.push(eq(studentApplications.batchId, batchFilter));
  const whereExpr =
    whereClauses.length > 0
      ? whereClauses.length === 1
        ? whereClauses[0]
        : and(...whereClauses)
      : undefined;

  const counts = await db
    .select({
      status: studentApplications.status,
      value: count(),
    })
    .from(studentApplications)
    .where(batchFilter ? eq(studentApplications.batchId, batchFilter) : sql`true`)
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
      whatsapp: studentApplications.whatsapp,
      schoolName: studentApplications.schoolName,
      graduationYear: studentApplications.graduationYear,
      branchPreference: studentApplications.branchPreference,
      status: studentApplications.status,
      submittedAt: studentApplications.submittedAt,
      batchName: admissionBatches.name,
      batchYear: admissionBatches.year,
    })
    .from(studentApplications)
    .leftJoin(admissionBatches, eq(studentApplications.batchId, admissionBatches.id))
    .where(whereExpr ?? sql`true`)
    .orderBy(desc(studentApplications.submittedAt))
    .limit(50);

  function link(overrides: { status?: string | null; batch?: string | null }) {
    const params = new URLSearchParams();
    const nextStatus = "status" in overrides ? overrides.status : statusFilter;
    const nextBatch = "batch" in overrides ? overrides.batch : batchFilter;
    if (nextStatus) params.set("status", nextStatus);
    if (nextBatch) params.set("batch", nextBatch);
    const qs = params.toString();
    return qs ? `/admin/applications?${qs}` : "/admin/applications";
  }

  return (
    <div className="p-6 md:p-10">
      <header className="mb-6">
        <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
          Pendaftar
        </h1>
        <p className="text-gray-600">
          {currentBatch ? (
            <>
              Batch <b>{currentBatch.name}</b>. {total} pendaftar.
            </>
          ) : (
            <>Daftar pendaftar siswa Sakola Kembara. {total} pendaftar (filter aktif).</>
          )}
        </p>
      </header>

      {batches.length > 0 && (
        <nav className="flex flex-wrap gap-2 mb-3">
          <FilterPill
            href={link({ batch: null })}
            label="Semua batch"
            active={!batchFilter}
          />
          {batches.map((b) => (
            <FilterPill
              key={b.id}
              href={link({ batch: b.id })}
              label={`${b.year} · ${b.name}`}
              active={batchFilter === b.id}
            />
          ))}
        </nav>
      )}

      <nav className="flex flex-wrap gap-2 mb-6">
        <FilterPill
          href={link({ status: null })}
          label={`Semua (${total})`}
          active={!statusFilter}
        />
        {applicationStatus.map((s) => (
          <FilterPill
            key={s}
            href={link({ status: s })}
            label={`${STATUS_LABEL[s]} (${countByStatus[s] ?? 0})`}
            active={statusFilter === s}
          />
        ))}
      </nav>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada pendaftar untuk filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Nama</Th>
                  <Th>Batch</Th>
                  <Th>Asal Sekolah</Th>
                  <Th>Cabang</Th>
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
                      <div className="text-xs text-gray-500">
                        {row.email ?? row.whatsapp}
                      </div>
                    </Td>
                    <Td className="text-gray-600 text-xs">
                      {row.batchName ? (
                        <>
                          {row.batchYear} · {row.batchName}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </Td>
                    <Td>{row.schoolName}</Td>
                    <Td className="text-gray-600">
                      {row.branchPreference || "—"}
                    </Td>
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
