import { Edit, ExternalLink, FileText, Link as LinkIcon, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Tag } from "~/components/ui/tag";
import { PageHeader } from "~/components/PageHeader";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { FilterBar } from "~/components/crud/FilterBar";
import { Flash } from "~/components/crud/Flash";
import { Pagination } from "~/components/crud/Pagination";
import { accessTo } from "~/lib/access";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { isFiltered } from "~/lib/crud/query";
import { useConfig } from "~/lib/config";
import { storedFileUrl } from "~/lib/crud/upload-kinds";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { useDeleteAction } from "~/lib/crud/useDeleteAction";
import { useList } from "~/lib/crud/useList";
import { useMe } from "~/lib/session";
import { formatDate } from "~/lib/format";
import { API_PATH, CATEGORIES, CATEGORY_LABEL, CATEGORY_TONE, CONTENT_TYPES, CONTENT_TYPE_LABEL, formatBytes, groupByCategory, LIST_SPEC, ROUTE, type ResourceItem } from "./model";

// The list of documents, grouped by the five categories of the public page /gabung-siswa/docs, each in the page's
// own order. A port of app/(admin)/admin/resources/page.tsx (the menu was "Berkas Pendaftaran"). The legacy list was
// one table in the alphabetical order of the category names; here a category is a section with its heading, which
// is also how a visitor meets it. Built from the pieces of the kit (docs/cloudflare/admin-crud.md#15-the-spa-kit)
// instead of `ListPage`, which has one table.
//
// Write affordances follow `accessTo(me, "pendaftaran")`: a viewer sees the list and "Lihat" links, nothing to change.

function TypeCell({ row }: { row: ResourceItem }) {
  const Icon = row.contentType === "file" ? FileText : row.contentType === "url" ? LinkIcon : Type;
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <Icon size={12} aria-hidden="true" />
      <span>{row.contentType === "file" ? `File${row.fileSize ? ` · ${formatBytes(row.fileSize)}` : ""}` : row.contentType === "url" ? "Link" : "Teks"}</span>
    </div>
  );
}

export function ResourcesPage() {
  const me = useMe();
  const canWrite = accessTo(me, "pendaftaran") === "write";
  const base = useUploadsBase();
  const { siteUrl } = useConfig();
  const list = useList<ResourceItem>(API_PATH, LIST_SPEC);
  const notice = useFlash();

  const refocus = useRef(false);
  const remove = useDeleteAction<ResourceItem>({
    basePath: API_PATH,
    noun: "berkas",
    nameOf: (row) => row.title,
    note: "File uploadnya juga akan dihapus.",
    onDeleted: () => {
      notice.show({ tone: "success", text: "Berkas berhasil dihapus." });
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

  const columns: readonly Column<ResourceItem>[] = [
    {
      key: "title", sort: "title",
      header: "Judul",
      className: "max-w-[420px] align-top",
      cell: (row) => (
        <>
          <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} className="font-medium text-gray-900 hover:text-primary-blue">
            {row.title}
          </Link>
          {row.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{row.description}</p>}
        </>
      ),
    },
    { key: "type", header: "Tipe", cell: (row) => <TypeCell row={row} /> },
    { key: "order", sort: "displayOrder", header: "Urutan", className: "align-top font-mono text-xs text-gray-500", cell: (row) => row.displayOrder },
    { key: "updated", sort: "updatedAt", sortFirst: "desc", header: "Diubah", className: "whitespace-nowrap align-top text-xs text-gray-500", cell: (row) => formatDate(row.updatedAt) },
  ];

  const actions = (row: ResourceItem) => {
    const target = row.contentType === "file" && row.filePath ? storedFileUrl(row.filePath, base, siteUrl) : row.contentType === "url" ? row.externalUrl : null;
    return (
      <>
        {target && (
          <a
            href={target}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Buka ${row.title}`}
            className="mr-3 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline"
          >
            <ExternalLink size={12} aria-hidden="true" /> Lihat
          </a>
        )}
        <Link
          to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`}
          aria-label={`${canWrite ? "Edit" : "Lihat"} ${row.title}`}
          className="mr-3 inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline"
        >
          {canWrite && <Edit size={14} aria-hidden="true" />} {canWrite ? "Edit" : "Detail"}
        </Link>
        {canWrite && (
          <button
            type="button"
            onClick={() => remove.ask(row)}
            aria-label={`Hapus ${row.title}`}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline"
          >
            <Trash2 size={14} aria-hidden="true" /> Hapus
          </button>
        )}
      </>
    );
  };

  const groups = groupByCategory(list.items);
  const filtered = isFiltered(list.query);
  const showGroups = list.status === "ready" && groups.length > 0;

  return (
    <div className="p-6 md:p-10">
      <PageHeader
        title="Pusat Dokumen"
        className="md:items-start"
        actions={
          canWrite ? (
            <Button href={`${ROUTE}/new`} className="whitespace-nowrap">
              <Plus size={16} aria-hidden="true" /> Tambah Berkas
            </Button>
          ) : undefined
        }
      >
        <p className="max-w-[720px] text-gray-600">
          Kelola file, link, dan teks yang muncul di{" "}
          <a href="/gabung-siswa/docs" target="_blank" rel="noopener noreferrer" className="text-primary-blue hover:underline">
            /gabung-siswa/docs
          </a>
          . Formulir pendaftaran menautkan ke kategori di halaman ini secara otomatis.
        </p>
      </PageHeader>

      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <FilterBar
        list={list}
        search={{ label: "Cari", placeholder: "Judul atau deskripsi" }}
        filters={[
          { name: "category", label: "Kategori", allLabel: "Semua kategori", options: CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] })) },
          { name: "contentType", label: "Tipe", allLabel: "Semua tipe", options: CONTENT_TYPES.map((value) => ({ value, label: CONTENT_TYPE_LABEL[value] })) },
        ]}
      />

      {showGroups ? (
        <div className={`space-y-8 ${list.refreshing ? "opacity-60 transition-opacity" : ""}`} aria-busy={list.refreshing}>
          {groups.map((group) => (
            <section key={group.category} aria-labelledby={`category-${group.category}`}>
              <header className="mb-3 flex flex-wrap items-center gap-3">
                <h2 id={`category-${group.category}`} className="m-0">
                  <Tag tone={CATEGORY_TONE[group.category]} size="md">
                    {CATEGORY_LABEL[group.category]}
                  </Tag>
                </h2>
                <span className="text-xs text-gray-500">{group.items.length} berkas</span>
              </header>
              <DataTable<ResourceItem> caption={`Daftar berkas: ${CATEGORY_LABEL[group.category]}`} columns={columns} rows={group.items} rowKey={(row) => row.id} state="ready" emptyText="" actions={actions} />
            </section>
          ))}
        </div>
      ) : (
        <DataTable<ResourceItem>
          caption="Daftar berkas"
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          state={list.status}
          errorMessage={list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
          onRetry={list.refetch}
          emptyText={filtered ? "Tidak ada berkas yang cocok dengan filter." : canWrite ? 'Belum ada berkas. Klik "Tambah Berkas" untuk membuat entry pertama.' : "Belum ada berkas."}
          actions={actions}
        />
      )}

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchFor={list.searchFor} />

      <ConfirmDialog {...remove.dialogProps} />
    </div>
  );
}
