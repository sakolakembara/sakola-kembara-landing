import { Edit, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/PageHeader";
import { type Access, accessTo, type Section } from "~/lib/access";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { isFiltered, type ListSpec } from "~/lib/crud/query";
import type { Versioned } from "~/lib/crud/types";
import { useDeleteAction } from "~/lib/crud/useDeleteAction";
import { useList, type ListState } from "~/lib/crud/useList";
import { useMe } from "~/lib/session";
import { ConfirmDialog } from "./ConfirmDialog";
import { type Column, DataTable } from "./DataTable";
import { FilterBar, type FilterSpec } from "./FilterBar";
import { Flash } from "./Flash";
import { Pagination } from "./Pagination";

/**
 * A resource's list screen, composed from the pieces of this folder (docs/cloudflare/admin-crud.md#15-the-spa-kit):
 * header with the create button, the notice, the filter bar, the table, the pagination and the delete
 * confirmation. The list state is in the URL (`useList`).
 *
 * Write affordances follow `accessTo(me, area)`: someone who can write sees "Pengumuman Baru", "Edit" and "Hapus";
 * a read-only role sees the list and a "Lihat" link to the form (which opens read-only). The server refuses
 * writes anyway; this only keeps anyone from being offered a button that cannot work.
 *
 * A screen with more to show than this (stat tiles above the table, a column with a switch) uses the pieces
 * directly: `useList`, `FilterBar`, `DataTable`, `Pagination`, `useDeleteAction` and `ConfirmDialog`.
 */
export interface ListPageProps<T extends Versioned> {
  title: string;
  /** Under the title; a function sees the loaded list (for "12 total pengumuman"). */
  description?: ReactNode | ((list: ListState<T>) => ReactNode);
  /** The API collection: `/api/admin/announcements`. */
  apiPath: string;
  /** The SPA route of the menu: `/announcements`; `/new` and `/<id>/edit` live below it. */
  routePath: string;
  area: Section;
  spec: ListSpec;
  columns: readonly Column<T>[];
  /** Names the table for screen readers: "Daftar pengumuman". */
  caption: string;
  search?: { label?: string; placeholder?: string };
  filters?: readonly FilterSpec[];
  /** Lower case, in the delete question: "pengumuman". */
  noun: string;
  nameOf: (row: T) => string;
  /** The create button: "Pengumuman Baru". */
  createLabel: string;
  /** What an empty list says; a function knows whether the person can create ("Klik ... untuk membuat" is for them only). */
  emptyText: ReactNode | ((canWrite: boolean) => ReactNode);
  emptyFilteredText?: ReactNode;
  /** What else a delete takes with it ("File uploadnya juga akan dihapus."). */
  deleteNote?: string;
  /** Extra links before "Edit" in a row (a "Salin" button, a "Buka" link). */
  rowActions?: (row: T, access: Access) => ReactNode;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function ListPage<T extends Versioned>(props: ListPageProps<T>) {
  const { title, description, apiPath, routePath, area, spec, columns, caption, search, filters, noun, nameOf, createLabel, emptyText, emptyFilteredText, deleteNote, rowActions } = props;
  const me = useMe();
  const access = accessTo(me, area);
  const canWrite = access === "write";

  const list = useList<T>(apiPath, spec);
  const filtered = isFiltered(list.query);
  const notice = useFlash();

  const refocus = useRef(false);
  const remove = useDeleteAction<T>({
    basePath: apiPath,
    noun,
    nameOf,
    note: deleteNote,
    onDeleted: () => {
      notice.show({ tone: "success", text: `${capitalise(noun)} berhasil dihapus.` });
      refocus.current = true;
      list.refetch();
    },
    onReload: list.refetch,
  });

  // The row whose button was pressed is gone: put the focus back at the top of the page instead of nowhere.
  useEffect(() => {
    if (!refocus.current || list.status !== "ready") return;
    refocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) document.getElementById("main")?.focus();
  }, [list.items, list.status]);

  const actions = (row: T) => (
    <>
      {rowActions?.(row, access)}
      <Button
        href={`${routePath}/${encodeURIComponent(row.id)}/edit`}
        variant="ghost"
        size="sm"
        aria-label={`${canWrite ? "Edit" : "Lihat"} ${nameOf(row)}`}
        title={canWrite ? "Edit" : undefined}
        className={cn("text-primary-blue hover:text-primary-blue", canWrite && "md:max-xl:px-2.5")}
      >
        {canWrite && <Edit aria-hidden="true" />}
        {/* Between a phone and a wide desktop the table is tight: the icon stands for the word (still its name, and its tooltip). */}
        <span className={canWrite ? "md:max-xl:sr-only" : undefined}>{canWrite ? "Edit" : "Lihat"}</span>
      </Button>
      {canWrite && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => remove.ask(row)}
          aria-label={`Hapus ${nameOf(row)}`}
          aria-haspopup="dialog"
          title="Hapus"
          className="text-red-700 hover:bg-danger-bg hover:text-red-800 md:max-xl:px-2.5"
        >
          <Trash2 aria-hidden="true" />
          <span className="md:max-xl:sr-only">Hapus</span>
        </Button>
      )}
    </>
  );

  return (
    <div className="p-6 md:p-10">
      <PageHeader
        title={title}
        actions={
          canWrite ? (
            <Button href={`${routePath}/new`}>
              <Plus size={16} aria-hidden="true" /> {createLabel}
            </Button>
          ) : undefined
        }
      >
        {description && <div className="text-gray-600">{typeof description === "function" ? description(list) : description}</div>}
      </PageHeader>

      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <FilterBar list={list} search={search} filters={filters} />

      <DataTable<T>
        caption={caption}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        state={list.status}
        errorMessage={list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
        onRetry={list.refetch}
        emptyText={filtered ? (emptyFilteredText ?? "Tidak ada data yang cocok dengan filter.") : typeof emptyText === "function" ? emptyText(canWrite) : emptyText}
        emptyFiltered={filtered}
        emptyAction={
          filtered && (
            <Button variant="neutral" size="sm" onClick={list.reset}>
              Tampilkan semua
            </Button>
          )
        }
        actions={actions}
        refreshing={list.refreshing}
        sort={{ value: list.query.sort, onChange: list.setSort }}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchFor={list.searchFor} />

      <ConfirmDialog {...remove.dialogProps} />
    </div>
  );
}
