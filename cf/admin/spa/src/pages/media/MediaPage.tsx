import { LayoutGrid, List, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { cn } from "@/lib/cn";
import { BulkBar } from "~/components/crud/BulkBar";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { Flash } from "~/components/crud/Flash";
import { Modal, ModalBody } from "~/components/crud/Modal";
import { Pagination } from "~/components/crud/Pagination";
import { MediaDetail } from "~/components/media/MediaDetail";
import { MediaDropzone } from "~/components/media/MediaDropzone";
import { MediaFilters } from "~/components/media/MediaFilters";
import { MediaThumb, MediaTile } from "~/components/media/MediaTile";
import { PageHeader } from "~/components/PageHeader";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { accessTo } from "~/lib/access";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { formatSize, kindForFile, MEDIA_PATH, type MediaItem, typeLabel, useMediaList } from "~/lib/crud/media";
import { useSelection } from "~/lib/crud/useSelection";
import { useRowOperations } from "~/lib/crud/useRowOperations";
import { formatDate } from "~/lib/format";
import { useMe } from "~/lib/session";
import { ACCEPT, isFiltered, mediaSearchParams, PAGE_SIZE, parseMediaParams, type MediaPageQuery, type MediaView } from "./model";

// The Media library (SAKEM-117, wireframe "Media" on the canvas of the ticket): every file the person may read, as a grid of
// pictures or a list, to search, filter by type and by when it was uploaded, tick several, drop new files onto, and open one for its panel
// (the address to copy, the text alternative, where it is used, delete). The state is in the address bar like every list's, so a
// reload and a link keep the page, the search and the view. A person who can only read sees it all and none of the buttons that change it.
//
// The page is the whole width. The detail of a file is a window (`Modal`) opened by a click on it, at every width; a drop of new files
// never opens one, since several go up one after the other.

const idOf = (item: MediaItem) => item.id;

const VIEWS: { view: MediaView; label: string; icon: typeof LayoutGrid }[] = [
  { view: "grid", label: "Tampilan grid", icon: LayoutGrid },
  { view: "list", label: "Tampilan daftar", icon: List },
];

const COLUMNS = (open: (item: MediaItem) => void, active: MediaItem | null): readonly Column<MediaItem>[] => [
  {
    key: "name",
    header: "Nama",
    cell: (item) => (
      <button type="button" onClick={() => open(item)} aria-pressed={active?.id === item.id} className="flex min-w-0 items-center gap-3 text-left">
        <MediaThumb item={item} className="aspect-square w-12 shrink-0" />
        <span className="min-w-0 break-all font-medium text-gray-900 hover:text-primary-blue">{item.name}</span>
      </button>
    ),
  },
  { key: "type", header: "Jenis", className: "whitespace-nowrap text-sm text-gray-600", cell: (item) => typeLabel(item.contentType) },
  { key: "size", header: "Ukuran", className: "whitespace-nowrap text-sm text-gray-600", cell: (item) => formatSize(item.size) },
  {
    key: "uploaded",
    header: "Diunggah",
    className: "whitespace-nowrap text-sm text-gray-600",
    cell: (item) => (
      <>
        {formatDate(item.createdAt)}
        {item.uploadedByName && <div className="text-xs text-gray-500">oleh {item.uploadedByName}</div>}
      </>
    ),
  },
];

export function MediaPage() {
  const me = useMe();
  const canWrite = accessTo(me, "konten") === "write";
  const notice = useFlash();
  const chooser = useRef<HTMLInputElement>(null);

  const [params, setParams] = useSearchParams();
  const paramsText = params.toString();
  const query = parseMediaParams(new URLSearchParams(paramsText));
  const go = useCallback((next: MediaPageQuery, replace = true) => setParams(mediaSearchParams(next), { replace }), [setParams]);
  const searchFor = (page: number) => {
    const text = mediaSearchParams({ ...query, page }).toString();
    return text ? `?${text}` : "?";
  };

  const list = useMediaList({ kind: null, q: query.q, type: query.type, range: query.range, page: query.page, pageSize: PAGE_SIZE });
  const filtered = isFiltered(query);

  // The file whose window is open. It follows the list's fresh copy of itself (a text alternative saved, an upload that just landed).
  const [active, setActive] = useState<MediaItem | null>(null);
  useEffect(() => {
    setActive((current) => (current ? (list.items.find((item) => item.id === current.id) ?? current) : current));
  }, [list.items]);

  const selection = useSelection(list.items, idOf, searchFor(query.page));
  const rows = useRowOperations<MediaItem>({
    apiPath: MEDIA_PATH,
    noun: "berkas",
    nameOf: (item) => item.name,
    deleteNote: "Gambar atau PDF-nya juga dihapus dari penyimpanan. Berkas yang masih dipakai tidak ikut dihapus.",
    notify: notice.show,
    onChanged: (done) => {
      const gone = new Set(done.map(idOf));
      selection.drop([...gone]);
      setActive((current) => (current && gone.has(current.id) ? null : current));
      list.refetch();
    },
  });

  // A page past the end (the last file of the last page was deleted): go to the last page that exists.
  useEffect(() => {
    if (list.status === "ready" && list.items.length === 0 && list.total > 0 && query.page > 1) go({ ...query, page: list.totalPages });
  }, [list.status, list.items.length, list.total, list.totalPages, query, go]);

  function removed(item: MediaItem) {
    selection.drop([item.id]);
    setActive(null);
    notice.show({ tone: "success", text: `Berkas “${item.name}” berhasil dihapus.` });
    list.refetch();
    document.getElementById("main")?.focus();
  }

  const detail = active && (
    <MediaDetail
      key={active.id}
      item={active}
      canWrite={canWrite}
      onChanged={(item) => {
        setActive(item);
        list.refetch();
      }}
      onDeleted={removed}
      onReload={list.refetch}
    />
  );

  const empty = list.status === "ready" && list.items.length === 0;
  const errorText = list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed;
  const emptyText = filtered
    ? "Tidak ada media yang cocok dengan filter."
    : canWrite
      ? "Belum ada media. Tarik file ke area di atas, atau klik “Unggah”."
      : "Belum ada media.";
  const resetButton = filtered && (
    <Button variant="neutral" size="sm" onClick={() => go({ ...query, q: "", type: "", range: "", page: 1 })}>
      Tampilkan semua
    </Button>
  );

  return (
    <div className="p-6 md:p-10">
      <PageHeader
        title="Media"
        actions={
          canWrite ? (
            <Button onClick={() => chooser.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Unggah
            </Button>
          ) : undefined
        }
      />
      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MediaFilters idPrefix="media" query={query} withType onChange={(patch) => go({ ...query, ...patch, page: 1 })} />
          <div role="group" aria-label="Tampilan" className="flex rounded-lg border border-input bg-card p-0.5">
            {VIEWS.map(({ view, label, icon: Icon }) => (
              <Button
                key={view}
                size="sm"
                variant={query.view === view ? "subtle" : "ghost"}
                aria-label={label}
                aria-pressed={query.view === view}
                onClick={() => go({ ...query, view })}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>

        {canWrite && (
          <MediaDropzone
            accept={ACCEPT}
            multiple
            chooserRef={chooser}
            kindFor={kindForFile}
            // Not opened: several files go up one after the other, and a window over them would be in the way.
            onUploaded={() => list.refetch()}
          >
            Gambar diperkecil otomatis (maks 1920 px). Hingga 5 MB per gambar, 20 MB per PDF.
          </MediaDropzone>
        )}

        {query.view === "list" ? (
          <DataTable<MediaItem>
            caption="Daftar media"
            columns={COLUMNS(setActive, active)}
            rows={list.items}
            rowKey={idOf}
            state={list.status}
            errorMessage={errorText}
            onRetry={list.refetch}
            emptyText={emptyText}
            emptyFiltered={filtered}
            emptyAction={resetButton}
            refreshing={list.refreshing}
            selection={canWrite ? { selected: selection.ids, toggle: selection.toggle, toggleAll: selection.toggleAll, label: (item) => item.name } : undefined}
          />
        ) : list.status === "error" ? (
          <Alert tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{errorText}</span>
              <Button size="sm" variant="neutral" onClick={list.refetch}>
                Coba lagi
              </Button>
            </div>
          </Alert>
        ) : list.status === "loading" ? (
          <div role="status" aria-label="Memuat media">
            <div aria-hidden="true" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className="aspect-[4/3] w-full rounded-lg" />
              ))}
            </div>
          </div>
        ) : empty ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-600">
            <p>{emptyText}</p>
            {resetButton && <div className="mt-3">{resetButton}</div>}
          </div>
        ) : (
          <ul
            aria-label="Daftar media"
            aria-busy={list.refreshing}
            className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5", list.refreshing && "opacity-60")}
          >
            {list.items.map((item) => (
              <MediaTile
                key={item.id}
                item={item}
                active={active?.id === item.id}
                ticked={canWrite ? selection.ids.has(item.id) : undefined}
                onOpen={() => setActive(item)}
                onTick={canWrite ? () => selection.toggle(item.id) : undefined}
              />
            ))}
          </ul>
        )}

        <Pagination page={query.page} pageSize={PAGE_SIZE} total={list.total} searchFor={searchFor} selected={selection.rows.length} />

        {canWrite && (
          <BulkBar count={selection.rows.length} noun="berkas" onClear={selection.clear}>
            <Button
              variant="neutral"
              size="sm"
              disabled={rows.busy}
              onClick={() => rows.askDelete(selection.rows)}
              aria-haspopup="dialog"
              className="text-red-700 hover:bg-danger-bg hover:text-red-800"
            >
              <Trash2 aria-hidden="true" />
              Hapus
            </Button>
          </BulkBar>
        )}
      </div>

      <Modal open={active !== null} title="Detail media" onClose={() => setActive(null)}>
        <ModalBody className="p-5 md:p-6">{detail}</ModalBody>
      </Modal>
      <ConfirmDialog {...rows.dialogProps} />
    </div>
  );
}
