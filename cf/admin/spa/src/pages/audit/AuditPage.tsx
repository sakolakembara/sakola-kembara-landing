import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { PageHeader } from "~/components/PageHeader";
import { ACTION_OPTIONS, activityHref, activityLabel, RESOURCE_OPTIONS, resourceLabel } from "~/lib/audit";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { formatDateTime } from "~/lib/format";
import { type AuditItem, type AuditQuery, isFiltered, parseAuditQuery, toSearchParams } from "./model";
import { useAuditList } from "./useAuditList";

// Aktivitas (Sistem, super_admin only): the audit log, read-only. A port of app/(admin)/admin/audit/page.tsx:
// the same filters, columns and words (docs/cloudflare/admin-sistem.md). What changes is the pager: a cursor, so
// "Berikutnya" and the browser's Back button instead of page numbers, and no "Total N entri".

const COLUMNS: readonly Column<AuditItem>[] = [
  {
    key: "time",
    header: "Waktu",
    headerClassName: "w-[180px]",
    className: "whitespace-nowrap align-top text-xs text-gray-500",
    cell: (row) => <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>,
  },
  {
    key: "action",
    header: "Aksi",
    className: "align-top",
    cell: (row) => (
      <>
        <div className="font-medium text-gray-900">{activityLabel(row.action)}</div>
        <code className="font-mono text-[11px] text-gray-400">{row.action}</code>
      </>
    ),
  },
  {
    key: "actor",
    header: "Aktor",
    className: "break-all align-top text-gray-700",
    cell: (row) => (
      <>
        <div>{row.actorEmail}</div>
        {row.actorName && <div className="text-xs text-gray-500">{row.actorName}</div>}
      </>
    ),
  },
  {
    key: "resource",
    header: "Resource",
    className: "align-top text-gray-700",
    cell: (row) => {
      if (!row.resourceType) return <span className="text-gray-300">—</span>;
      const href = activityHref(row.action, row.resourceType, row.resourceId);
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-500">{resourceLabel(row.resourceType)}</span>
          {row.resourceId && <span className="max-w-[200px] truncate font-mono text-[11px] text-gray-700">{row.resourceId}</span>}
          {href && (
            <Link to={href} className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary-blue hover:underline">
              Buka
            </Link>
          )}
        </div>
      );
    },
  },
  {
    key: "details",
    header: "Detail",
    className: "max-w-[300px] align-top",
    cell: (row) =>
      row.details ? (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-900">Metadata</summary>
          <pre className="mt-2 overflow-x-auto rounded border border-gray-100 bg-gray-50 p-2 text-[11px] leading-relaxed">{JSON.stringify(row.details, null, 2)}</pre>
        </details>
      ) : (
        <span className="text-xs text-gray-300">—</span>
      ),
  },
];

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</span>
      {children}
    </label>
  );
}

const LINK =
  "inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-primary-blue hover:text-primary-blue";
const OFF = "inline-flex items-center gap-1 rounded-lg border border-gray-100 px-3 py-2 text-sm font-medium text-gray-300";

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const paramsText = params.toString();
  const query = useMemo(() => parseAuditQuery(new URLSearchParams(paramsText)), [paramsText]);
  const list = useAuditList(query);
  const filtered = isFiltered(query);

  // A new page replaces the table under the link that was pressed: put the focus back at the top of the page.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus();
  }, [query.cursor]);

  const searchFor = (cursor: string) => {
    const search = toSearchParams({ ...query, cursor }).toString();
    return search ? `?${search}` : "?";
  };

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    // Filters change what the list is, so the position in it (the cursor) goes.
    setParams(toSearchParams(parseAuditQuery(new URLSearchParams({ action: text("action"), resource: text("resource"), actor: text("actor"), from: text("from"), to: text("to") }))), { replace: true });
  }

  const emptyText = query.cursor ? "Tidak ada aktivitas yang lebih lama." : filtered ? "Tidak ada aktivitas yang cocok dengan filter." : "Belum ada aktivitas.";
  const formKey = JSON.stringify([query.action, query.resource, query.actor, query.from, query.to]);
  const showPager = list.status === "ready" && (query.cursor !== "" || list.nextCursor !== null || list.items.length > 0);

  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Aktivitas">
        <p className="text-gray-600">Catatan aksi admin dan kejadian sistem, seperti pendaftaran siswa, pesan masuk, verifikasi email, dan reset password. Yang terbaru di atas.</p>
      </PageHeader>

      <form
        key={formKey}
        onSubmit={apply}
        role="search"
        aria-label="Saring aktivitas"
        className="mb-5 grid grid-cols-1 items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 md:grid-cols-2 md:p-5 lg:grid-cols-6"
      >
        <Filter label="Aksi">
          <Select size="sm" name="action" defaultValue={query.action}>
            <option value="">Semua aksi</option>
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Filter>
        <Filter label="Tipe resource">
          <Select size="sm" name="resource" defaultValue={query.resource}>
            <option value="">Semua tipe</option>
            {RESOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Filter>
        <Filter label="Aktor (email lengkap)">
          <Input size="sm" type="text" name="actor" defaultValue={query.actor} placeholder="nama@contoh.com" maxLength={254} autoComplete="off" spellCheck={false} />
        </Filter>
        <Filter label="Dari">
          <Input size="sm" type="date" name="from" defaultValue={query.from} />
        </Filter>
        <Filter label="Sampai">
          <Input size="sm" type="date" name="to" defaultValue={query.to} />
        </Filter>
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="flex-1">
            Terapkan
          </Button>
          {filtered && (
            // A button, not a link: the address bar is rewritten, the page does not change.
            <button
              type="button"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
              title="Hapus filter"
              className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border-2 border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
            >
              <X size={14} aria-hidden="true" />
              <span className="sr-only">Hapus filter</span>
            </button>
          )}
        </div>
      </form>

      <DataTable<AuditItem>
        caption="Daftar aktivitas"
        columns={COLUMNS}
        rows={list.items}
        rowKey={(row) => row.id}
        state={list.status}
        errorMessage={list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
        onRetry={list.refetch}
        emptyText={emptyText}
        refreshing={list.refreshing}
      />

      {showPager && (
        <nav aria-label="Halaman" className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {query.cursor !== "" && (
            <Link to={{ search: searchFor("") }} className={LINK}>
              Kembali ke yang terbaru
            </Link>
          )}
          {list.items.length > 0 && <p className="text-xs text-gray-500">Menampilkan {list.items.length.toLocaleString("id-ID")} aktivitas</p>}
          {list.nextCursor ? (
            <Link to={{ search: searchFor(list.nextCursor) }} rel="next" className={LINK}>
              Berikutnya
            </Link>
          ) : (
            list.items.length > 0 && (
              <span aria-disabled="true" className={OFF}>
                Berikutnya
              </span>
            )
          )}
        </nav>
      )}
    </div>
  );
}
