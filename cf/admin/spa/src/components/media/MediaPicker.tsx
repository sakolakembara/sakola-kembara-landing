import { useMemo, useState } from "react";
import { Modal, ModalBody, ModalFooter } from "~/components/crud/Modal";
import { PageTabs } from "~/components/crud/PageTabs";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { EMPTY_QUERY, isImage, type MediaItem, mediaItemFromUpload, type MediaQuery, saveAltText, useMediaList } from "~/lib/crud/media";
import { acceptFor, FILE_TYPES, UPLOAD_KINDS, type UploadKindName } from "~/lib/crud/upload-kinds";
import { useMe } from "~/lib/session";
import { AltTextField, describeFile } from "./MediaDetail";
import { MediaDropzone } from "./MediaDropzone";
import { MediaFilters } from "./MediaFilters";
import { MediaThumb, MediaTile } from "./MediaTile";

/**
 * Choosing a file from the library (SAKEM-117): the dialog the article's hero image, the editor's "/ Gambar" menu and the
 * file fields of Tim, Laporan and Pusat Dokumen open. Two tabs: "Pustaka media" (the files of this field's kind, to search and
 * pick one) and "Unggah" (a new file, which is then the one picked). A field takes only its own kind of file (the Worker refuses another), so the
 * library lists that kind, which is why a picker for a PDF field shows PDFs and one for a blog image shows images.
 *
 * Choosing is not saving: the file's path goes to `onPick` and the form saves it with the rest. The text alternative
 * is the one thing written here: it belongs to the file, so it is saved when the file is chosen and every place that
 * uses the picture then has it.
 */
export interface MediaPickerProps {
  open: boolean;
  kind: UploadKindName;
  /** "Pilih gambar hero". */
  title: string;
  description?: string;
  onPick(item: MediaItem): void;
  onClose(): void;
}

const PAGE_SIZE = 20;

function PickerBody({
  kind,
  onPick,
  onClose,
  saving,
  setSaving,
}: Pick<MediaPickerProps, "kind" | "onPick" | "onClose"> & { saving: boolean; setSaving: (saving: boolean) => void }) {
  const me = useMe();
  const rule = UPLOAD_KINDS[kind];
  // Only a kind that takes both pictures and PDFs (Pusat Dokumen) needs the choice between them.
  const kinds = new Set(rule.types.map((type) => (type === "pdf" ? "pdf" : "image")));
  const withType = kinds.size > 1;
  const noun = kinds.has("image") ? "gambar" : "file";

  const [tab, setTab] = useState<"pustaka" | "unggah">("pustaka");
  const [query, setQuery] = useState<Pick<MediaQuery, "q" | "type" | "range" | "page">>(EMPTY_QUERY);
  const list = useMediaList({ ...query, kind, pageSize: PAGE_SIZE });
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [alt, setAlt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const accept = useMemo(() => acceptFor(kind), [kind]);

  function choose(item: MediaItem) {
    setSelected(item);
    setAlt(item.altText ?? "");
    setProblem(null);
  }

  async function confirm() {
    if (!selected) return;
    if (!isImage(selected) || alt.trim() === (selected.altText ?? "")) {
      onPick(selected);
      return;
    }
    setSaving(true);
    setProblem(null);
    const result = await saveAltText(selected.id, alt.trim());
    setSaving(false);
    if (!result.ok) {
      setProblem(describeFailure(result).fields.altText ?? describeFailure(result).message);
      return;
    }
    onPick(result.data.item);
  }

  const filtered = query.q !== "" || query.type !== "";
  const empty = list.status === "ready" && list.items.length === 0;

  return (
    <>
      <ModalBody>
        <PageTabs
          label="Sumber file"
          tabs={[
            { id: "pustaka", label: "Pustaka media" },
            { id: "unggah", label: "Unggah" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "unggah" ? (
          <div role="tabpanel" id="panel-unggah" aria-labelledby="tab-unggah" className="p-5 md:p-6">
            <MediaDropzone
              accept={accept}
              multiple={false}
              kindFor={() => kind}
              onUploaded={(result) => {
                choose(mediaItemFromUpload(result, kind, me.name));
                list.refetch();
                setTab("pustaka");
              }}
            >
              {rule.types.map((type) => FILE_TYPES[type].label).join(", ")}. Maksimal {rule.maxBytes / 1_000_000} MB.
              {kinds.has("image") && " Gambar diperkecil otomatis."}
            </MediaDropzone>
          </div>
        ) : (
          <div role="tabpanel" id="panel-pustaka" aria-labelledby="tab-pustaka" className="grid gap-5 p-5 md:p-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="min-w-0 space-y-4">
              <MediaFilters
                idPrefix="picker"
                query={query}
                withType={withType}
                withRange={false}
                onChange={(patch) => setQuery((current) => ({ ...current, ...patch, page: 1 }))}
              />
              {list.status === "error" ? (
                <Alert tone="danger">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}</span>
                    <Button size="sm" variant="neutral" onClick={list.refetch}>
                      Coba lagi
                    </Button>
                  </div>
                </Alert>
              ) : list.status === "loading" ? (
                <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="aspect-[4/3] w-full rounded-lg" />
                  ))}
                </div>
              ) : empty ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-600">
                  {filtered ? `Tidak ada ${noun} yang cocok.` : `Belum ada ${noun} di pustaka. Buka tab Unggah untuk menambah.`}
                </p>
              ) : (
                <ul aria-busy={list.refreshing} aria-label={`Daftar ${noun}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {list.items.map((item) => (
                    <MediaTile key={item.id} item={item} active={selected?.id === item.id} onOpen={() => choose(item)} />
                  ))}
                </ul>
              )}
              {list.totalPages > 1 && (
                <nav aria-label="Halaman" className="flex items-center justify-between gap-3 text-[13px] text-gray-600">
                  <Button
                    size="sm"
                    variant="neutral"
                    disabled={query.page <= 1}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: current.page - 1,
                      }))
                    }
                  >
                    Sebelumnya
                  </Button>
                  <span>
                    Halaman {query.page} dari {list.totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="neutral"
                    disabled={query.page >= list.totalPages}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: current.page + 1,
                      }))
                    }
                  >
                    Berikutnya
                  </Button>
                </nav>
              )}
            </div>

            <aside aria-label="Berkas yang dipilih" className="space-y-3 border-gray-200 max-lg:border-t max-lg:pt-4 lg:border-l lg:pl-5">
              {selected ? (
                <>
                  <MediaThumb item={selected} alt={selected.altText ?? ""} />
                  <div>
                    <p className="break-all text-sm font-semibold text-gray-900">{selected.name}</p>
                    <p className="text-xs text-gray-600">{describeFile(selected)}</p>
                  </div>
                  {isImage(selected) && <AltTextField id="picker-alt" value={alt} onChange={setAlt} error={problem ?? undefined} />}
                  {!isImage(selected) && problem && <Alert tone="danger">{problem}</Alert>}
                </>
              ) : (
                <p className="text-sm text-gray-600">Pilih satu {noun} untuk melihat rinciannya.</p>
              )}
            </aside>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="text-[13px] text-gray-600">{selected ? "1 dipilih" : `Belum ada ${noun} yang dipilih`}</span>
        <span className="flex gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button disabled={!selected || saving} onClick={() => void confirm()}>
            {saving ? "Menyimpan..." : `Pakai ${noun} ini`}
          </Button>
        </span>
      </ModalFooter>
    </>
  );
}

export function MediaPicker({ open, kind, title, description, onPick, onClose }: MediaPickerProps) {
  // The text alternative is being saved: the window cannot be closed under it (Escape, the backdrop and the cross wait), or the
  // file would be used after the person had walked away from the choice.
  const [saving, setSaving] = useState(false);
  return (
    <Modal open={open} title={title} description={description} onClose={onClose} locked={saving} wide>
      <PickerBody kind={kind} onPick={onPick} onClose={onClose} saving={saving} setSaving={setSaving} />
    </Modal>
  );
}
