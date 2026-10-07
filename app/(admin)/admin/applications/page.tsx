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
import { TableHint } from "../_table-hint";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { AdminPageHeader } from "../_page-header";
import { Tag } from "@/components/ui/tag";
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from "@/lib/application-status";

export const metadata: Metadata = {
  title: "Pendaftar",
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
      <AdminPageHeader
        title="Pendaftar"
      >
        <p className="text-gray-600">
          {currentBatch ? (
            <>
              Batch <b>{currentBatch.name}</b>. {total} pendaftar.
            </>
          ) : (
            <>Daftar pendaftar siswa Sakola Kembara. {total} pendaftar (filter aktif).</>
          )}
        </p>
      </AdminPageHeader>

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
            label={`${APPLICATION_STATUS_LABEL[s]} (${countByStatus[s] ?? 0})`}
            active={statusFilter === s}
          />
        ))}
      </nav>

      <TableCard>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada pendaftar untuk filter ini.
          </div>
        ) : (
          <Table>
            <TableHint />
            <THead>
              <tr>
                <Th>Nama</Th>
                <Th>Batch</Th>
                <Th>Asal Sekolah</Th>
                <Th>Cabang</Th>
                <Th>Status</Th>
                <Th>Dikirim</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <Td className="align-top">
                    <div className="font-medium text-gray-900">{row.fullName}</div>
                    <div className="text-xs text-gray-500">
                      {row.email ?? row.whatsapp}
                    </div>
                  </Td>
                  <Td className="align-top text-gray-600 text-xs">
                    {row.batchName ? (
                      <>
                        {row.batchYear} · {row.batchName}
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </Td>
                  <Td className="align-top">{row.schoolName}</Td>
                  <Td className="align-top text-gray-600">
                    {row.branchPreference || "—"}
                  </Td>
                  <Td className="align-top">
                    <Tag tone={APPLICATION_STATUS_TONE[row.status]} size="sm">
                      {APPLICATION_STATUS_LABEL[row.status]}
                    </Tag>
                  </Td>
                  <Td className="align-top text-gray-500 text-xs">
                    {row.submittedAt.toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </Td>
                  <Td className="align-top">
                    <Link
                      href={`/admin/applications/${row.id}`}
                      className="inline-flex items-center gap-1 text-primary-blue font-medium hover:underline"
                    >
                      Lihat <ArrowRight size={14} />
                    </Link>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        
        )}
      </TableCard>

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

