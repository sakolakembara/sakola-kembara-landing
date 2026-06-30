import type { Metadata } from "next";
import Link from "next/link";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  type SQL,
} from "drizzle-orm";
import { ArrowRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import {
  AUDIT_LABEL,
  KNOWN_ACTIONS,
  KNOWN_RESOURCE_TYPES,
  RESOURCE_TYPE_LABEL,
  auditHref,
} from "@/lib/audit-labels";

export const metadata: Metadata = {
  title: "Aktivitas",
};

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{
    action?: string;
    actor?: string;
    resource?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

function parseDate(input: string | undefined, endOfDay = false): Date | null {
  if (!input) return null;
  const d = new Date(endOfDay ? `${input}T23:59:59.999` : `${input}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const action = params.action?.trim() || undefined;
  const actor = params.actor?.trim() || undefined;
  const resource = params.resource?.trim() || undefined;
  const fromDate = parseDate(params.from);
  const toDate = parseDate(params.to, true);

  const filters: SQL[] = [];
  if (action) filters.push(eq(auditLog.action, action));
  if (actor) filters.push(ilike(auditLog.actorEmail, `%${actor}%`));
  if (resource) filters.push(eq(auditLog.resourceType, resource));
  if (fromDate) filters.push(gte(auditLog.createdAt, fromDate));
  if (toDate) filters.push(lte(auditLog.createdAt, toDate));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(auditLog)
    .where(where);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.parseInt(params.page ?? "1", 10);
  const currentPage = Math.min(
    Math.max(1, Number.isNaN(requested) ? 1 : requested),
    totalPages,
  );

  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_SIZE)
    .offset((currentPage - 1) * PAGE_SIZE);

  const baseQuery = new URLSearchParams();
  if (action) baseQuery.set("action", action);
  if (actor) baseQuery.set("actor", actor);
  if (resource) baseQuery.set("resource", resource);
  if (params.from) baseQuery.set("from", params.from);
  if (params.to) baseQuery.set("to", params.to);
  const hasAnyFilter = baseQuery.toString().length > 0;

  function hrefForPage(page: number) {
    const q = new URLSearchParams(baseQuery);
    if (page > 1) q.set("page", String(page));
    const str = q.toString();
    return str ? `/admin/audit?${str}` : "/admin/audit";
  }

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            Aktivitas
          </h1>
          <p className="text-gray-600">
            Catatan semua aksi yang dilakukan admin. Total{" "}
            <strong>{total.toLocaleString("id-ID")}</strong> entri.
          </p>
        </div>
      </header>

      <form
        method="get"
        className="bg-white rounded-xl border border-gray-100 p-4 md:p-5 mb-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
      >
        <Filter label="Aksi">
          <select
            name="action"
            defaultValue={action ?? ""}
            className={SELECT_CLS}
          >
            <option value="">Semua aksi</option>
            {KNOWN_ACTIONS.map((k) => (
              <option key={k} value={k}>
                {AUDIT_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Tipe resource">
          <select
            name="resource"
            defaultValue={resource ?? ""}
            className={SELECT_CLS}
          >
            <option value="">Semua tipe</option>
            {KNOWN_RESOURCE_TYPES.map((r) => (
              <option key={r} value={r}>
                {RESOURCE_TYPE_LABEL[r] ?? r}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Aktor (email)">
          <input
            type="text"
            name="actor"
            defaultValue={actor ?? ""}
            placeholder="cari email…"
            className={INPUT_CLS}
          />
        </Filter>
        <Filter label="Dari">
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className={INPUT_CLS}
          />
        </Filter>
        <Filter label="Sampai">
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className={INPUT_CLS}
          />
        </Filter>
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors text-sm"
          >
            Terapkan
          </button>
          {hasAnyFilter && (
            <Link
              href="/admin/audit"
              className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border-2 border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
              title="Hapus filter"
            >
              <X size={14} />
            </Link>
          )}
        </div>
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            {hasAnyFilter
              ? "Tidak ada aktivitas yang cocok dengan filter."
              : "Belum ada aktivitas."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th className="w-[180px]">Waktu</Th>
                  <Th>Aksi</Th>
                  <Th>Aktor</Th>
                  <Th>Resource</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const label = AUDIT_LABEL[row.action] ?? row.action;
                  const href = auditHref(
                    row.action,
                    row.resourceType,
                    row.resourceId,
                  );
                  const resourceTypeLabel = row.resourceType
                    ? RESOURCE_TYPE_LABEL[row.resourceType] ?? row.resourceType
                    : null;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        <time dateTime={row.createdAt.toISOString()}>
                          {row.createdAt.toLocaleString("id-ID", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{label}</div>
                        <code className="text-[11px] text-gray-400 font-mono">
                          {row.action}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-gray-700 break-all">
                        {row.actorEmail}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {resourceTypeLabel ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-gray-500">
                              {resourceTypeLabel}
                            </span>
                            {row.resourceId && (
                              <span className="font-mono text-[11px] text-gray-700 truncate max-w-[200px]">
                                {row.resourceId}
                              </span>
                            )}
                            {href && (
                              <Link
                                href={href}
                                className="text-[11px] text-primary-blue font-medium hover:underline inline-flex items-center gap-1 mt-0.5"
                              >
                                Buka <ArrowRight size={10} />
                              </Link>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[300px]">
                        {row.metadata ? (
                          <details className="text-xs text-gray-600">
                            <summary className="cursor-pointer text-gray-500 hover:text-gray-900 select-none">
                              Metadata
                            </summary>
                            <pre className="mt-2 bg-gray-50 border border-gray-100 rounded p-2 overflow-x-auto text-[11px] leading-relaxed">
                              {JSON.stringify(row.metadata, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          hrefForPage={hrefForPage}
        />
      )}
    </div>
  );
}

const SELECT_CLS =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm bg-white";
const INPUT_CLS =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

function Filter({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left text-xs font-semibold uppercase tracking-wide px-4 py-3 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Pagination({
  currentPage,
  totalPages,
  hrefForPage,
}: {
  currentPage: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  const pages = pageNumbers(currentPage, totalPages);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-2 mt-5 flex-wrap"
    >
      {currentPage > 1 ? (
        <Link
          href={hrefForPage(currentPage - 1)}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 hover:text-primary-blue rounded-lg border border-gray-200 hover:border-primary-blue transition-colors"
        >
          <ChevronLeft size={16} /> Sebelumnya
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-300 rounded-lg border border-gray-100">
          <ChevronLeft size={16} /> Sebelumnya
        </span>
      )}
      <div className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`gap-${i}`}
              className="px-2 text-sm text-gray-400 select-none"
            >
              …
            </span>
          ) : p === currentPage ? (
            <span
              key={p}
              aria-current="page"
              className="min-w-[36px] px-2 py-2 text-sm font-semibold text-white bg-primary-blue rounded-lg text-center"
            >
              {p}
            </span>
          ) : (
            <Link
              key={p}
              href={hrefForPage(p)}
              className="min-w-[36px] px-2 py-2 text-sm font-medium text-gray-700 hover:text-primary-blue rounded-lg border border-gray-200 hover:border-primary-blue text-center transition-colors"
            >
              {p}
            </Link>
          ),
        )}
      </div>
      {currentPage < totalPages ? (
        <Link
          href={hrefForPage(currentPage + 1)}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 hover:text-primary-blue rounded-lg border border-gray-200 hover:border-primary-blue transition-colors"
        >
          Berikutnya <ChevronRight size={16} />
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-300 rounded-lg border border-gray-100">
          Berikutnya <ChevronRight size={16} />
        </span>
      )}
    </nav>
  );
}

function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
