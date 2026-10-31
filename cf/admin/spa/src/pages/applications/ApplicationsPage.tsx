import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { DescriptionSkeleton, PageHeader } from "~/components/PageHeader";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { ColumnsMenu } from "~/components/crud/ColumnsMenu";
import { FilterBar, type FilterSpec } from "~/components/crud/FilterBar";
import { Pagination } from "~/components/crud/Pagination";
import { StatusTag } from "~/components/crud/StatusTag";
import { api } from "~/lib/api";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { isFiltered, pageSizeChoices } from "~/lib/crud/query";
import { cachedRead, keepRead, readCacheVersion } from "~/lib/crud/readCache";
import type { ListPayload } from "~/lib/crud/types";
import { useColumnChoice } from "~/lib/crud/useColumnChoice";
import { useList } from "~/lib/crud/useList";
import type { BatchItem } from "../batches/model";
import { PendaftarTabs } from "./DraftFilesPage";
import { ALL_BATCHES, API_PATH, APPLICATION_STATUS, type ApplicationListed, LIST_SPEC, needsDefaultBatch, newestBatch, ROUTE, STATUS_OPTIONS } from "./model";

// The list of applicants (Pendaftar). A port of app/(admin)/admin/applications/page.tsx with the decisions of
// docs/cloudflare/admin-ia.md (question 8): it OPENS ON THE NEWEST BATCH, not on every batch, and the legacy
// pills became the filter bar of the kit (batch, status, search). Pages replace the legacy "50 newest".
//
// The address says what is shown, so a link can be shared:
//   /applications                       redirects to ?batch=<newest batch>
//   /applications?batch=<id>            one batch
//   /applications?batch=all             every batch
//   /applications?status=pending        a status in every batch (what the dashboard's tiles count)
//   &q=siti                             the applicants whose name or email STARTS with it
//
// The search is a prefix match on purpose (the table grows; the Worker answers from an index), and the box says so.

interface BatchOptions {
  status: "loading" | "ready" | "error";
  batches: BatchItem[];
  retry: () => void;
  message: string;
}

/** The batches' request: a few rows a year, newest first. */
const BATCHES_PATH = "/api/admin/batches?pageSize=100&sort=-year";

/**
 * The batches, newest year first: for the batch select and to know which one is the newest. A few rows a year. The
 * last answer is kept in memory like a list's (lib/crud/readCache.ts): coming back to Pendaftar shows the page at once
 * and asks again, instead of waiting for the batches before the applicants can even be asked for.
 */
function useBatches(): BatchOptions {
  const [state, setState] = useState<{ status: BatchOptions["status"]; batches: BatchItem[]; message: string }>(() => {
    const kept = cachedRead<ListPayload<BatchItem>>(BATCHES_PATH);
    return kept ? { status: "ready", batches: kept.items, message: "" } : { status: "loading", batches: [], message: "" };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const version = readCacheVersion();
    setState((previous) => (previous.batches.length > 0 ? previous : { ...previous, status: "loading" }));
    void api<ListPayload<BatchItem>>(BATCHES_PATH, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) keepRead(BATCHES_PATH, result.data, version);
      setState(result.ok ? { status: "ready", batches: result.data.items, message: "" } : { status: "error", batches: [], message: describeFailure(result).message });
    });
    return () => controller.abort();
  }, [attempt]);
  return { ...state, retry: () => setAttempt((count) => count + 1) };
}

/**
 * Pendaftar while the batches are on their way (and while the address is being given the newest one): the page's own
 * parts in their places, so what arrives fills them in. The filter bar is drawn, switched off, because its height is
 * what everything under it waits on; there is nothing to choose before the batches are known.
 */
function PendaftarLoading() {
  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Pendaftar">
        <DescriptionSkeleton />
      </PageHeader>
      <PendaftarTabs current="applicants" />
      <fieldset disabled className="contents">
        <FilterBar
          list={{ query: { page: 1, pageSize: 20, q: "", sort: "", filters: {} }, apply: () => undefined, reset: () => undefined }}
          search={{ label: "Cari", placeholder: "Awal nama atau email" }}
          filters={[
            { name: "batch", label: "Batch", allLabel: "Semua batch", options: [] },
            { name: "status", label: "Status", allLabel: "Semua status", options: STATUS_OPTIONS },
          ]}
        />
      </fieldset>
      <DataTable<ApplicationListed> caption="Daftar pendaftar" columns={COLUMNS("")} rows={[]} rowKey={(row) => row.id} state="loading" emptyText="" />
    </div>
  );
}

export function ApplicationsPage() {
  const batches = useBatches();
  const [params] = useSearchParams();

  if (batches.status === "loading") return <PendaftarLoading />;

  if (batches.status !== "ready") {
    return (
      <div className="p-6 md:p-10">
        <PageHeader title="Pendaftar" />
        <div className="space-y-4">
          <p role="alert" className="text-gray-700">
            {batches.message || MESSAGES.loadFailed}
          </p>
          <Button variant="neutral" onClick={batches.retry}>
            Coba lagi
          </Button>
        </div>
      </div>
    );
  }

  // Nothing says which batch: the newest one (when there is one at all). The page stays as it was while the address
  // changes: a `<Navigate>` on its own draws nothing for the commit it takes to land, and the page went blank.
  const newest = newestBatch(batches.batches);
  if (needsDefaultBatch(params) && newest) {
    const next = new URLSearchParams(params);
    next.set("batch", newest.id);
    return (
      <>
        <PendaftarLoading />
        <Navigate to={`?${next.toString()}`} replace />
      </>
    );
  }

  return <ApplicantList batches={batches.batches} />;
}

const COLUMNS = (back: string): readonly Column<ApplicationListed>[] => [
  {
    key: "name", sort: "fullName",
    header: "Nama",
    cell: (row) => (
      <>
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}`} state={{ back }} className="font-medium text-gray-900 hover:text-primary-blue">
          {row.fullName}
        </Link>
        <div className="text-xs text-gray-500">{row.email}</div>
      </>
    ),
  },
  { key: "batch", header: "Batch", className: "align-top text-xs text-gray-600", cell: (row) => `${row.batch.year} · ${row.batch.name}` },
  { key: "school", header: "Asal Sekolah", cell: (row) => row.schoolName },
  { key: "branch", header: "Cabang", className: "align-top text-gray-600", cell: (row) => row.branchPreference || "—" },
  { key: "status", header: "Status", cell: (row) => <StatusTag map={APPLICATION_STATUS} value={row.status} /> },
  {
    key: "submitted", sort: "submittedAt", sortFirst: "desc",
    header: "Dikirim",
    className: "align-top text-xs text-gray-500",
    cell: (row) => new Date(row.submittedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }),
  },
];

function ApplicantList({ batches }: { batches: BatchItem[] }) {
  const list = useList<ApplicationListed>(API_PATH, LIST_SPEC);
  const location = useLocation();
  const back = `${location.pathname}${location.search}`;
  const columns = useMemo(() => COLUMNS(back), [back]);
  const columnChoice = useColumnChoice(API_PATH, columns);

  const batchValue = list.query.filters.batch;
  const chosen = batchValue && batchValue !== ALL_BATCHES ? batches.find((batch) => batch.id === batchValue) : undefined;

  // The filter bar has one "no filter" option per select (the empty value, which it leaves out of the address).
  // For the batch that would mean "choose nothing, so open the newest": here it means every batch, which the
  // address spells `batch=all`. These three lines translate between the two.
  const filters: FilterSpec[] = [
    { name: "batch", label: "Batch", allLabel: "Semua batch", options: batches.map((batch) => ({ value: batch.id, label: `${batch.year} · ${batch.name}` })) },
    { name: "status", label: "Status", allLabel: "Semua status", options: STATUS_OPTIONS },
  ];
  const { batch: _batch, ...otherFilters } = list.query.filters;
  const bar = {
    // "Every batch" is no value in the bar: its "Semua batch" option is the empty one.
    query: { ...list.query, filters: batchValue === ALL_BATCHES || !batchValue ? otherFilters : { ...otherFilters, batch: batchValue } },
    apply: (next: { q?: string; filters?: Record<string, string> }) => list.apply({ q: next.q, filters: { ...next.filters, batch: next.filters?.batch || ALL_BATCHES } }),
    // "Hapus filter": back to where the page opens (the newest batch).
    reset: () => list.apply({ q: "", filters: {} }),
  };

  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Pendaftar">
        {list.status === "loading" ? (
          // The count is not known until the list is there: a "0 pendaftar" that changes a moment later would be false.
          <DescriptionSkeleton />
        ) : (
          <p className="text-gray-600">
            {chosen ? (
              <>
                Batch <b>{chosen.name}</b>. {list.total.toLocaleString("id-ID")} pendaftar.
              </>
            ) : (
              <>
                Daftar pendaftar siswa Sakola Kembara. {list.total.toLocaleString("id-ID")} pendaftar{isFiltered({ ...list.query, filters: otherFilters }) ? " (filter aktif)" : ""}.
              </>
            )}
          </p>
        )}
      </PageHeader>

      {/* For who may purge: the drafts that hold files (SAKEM-093). A viewer sees no tabs. */}
      <PendaftarTabs current="applicants" />

      <FilterBar list={bar} search={{ label: "Cari", placeholder: "Awal nama atau email" }} filters={filters} trailing={<ColumnsMenu choice={columnChoice} />} />

      <DataTable<ApplicationListed>
        caption="Daftar pendaftar"
        columns={columnChoice.shown}
        rows={list.items}
        rowKey={(row) => row.id}
        state={list.status}
        errorMessage={list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
        onRetry={list.refetch}
        emptyText={isFiltered(list.query) ? "Belum ada pendaftar untuk filter ini." : "Belum ada pendaftar."}
        emptyFiltered={isFiltered(list.query)}
        emptyAction={
          isFiltered(list.query) && (
            <Button variant="neutral" size="sm" onClick={list.reset}>
              Tampilkan semua
            </Button>
          )
        }
        sort={{ value: list.query.sort, onChange: list.setSort }}
        actions={(row) => (
          <Link to={`${ROUTE}/${encodeURIComponent(row.id)}`} state={{ back }} aria-label={`Lihat ${row.fullName}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline">
            Lihat
          </Link>
        )}
        refreshing={list.refreshing}
      />

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        searchFor={list.searchFor}
        perPage={{ value: list.query.pageSize, choices: pageSizeChoices(LIST_SPEC), onChange: list.setPageSize }}
      />
    </div>
  );
}
