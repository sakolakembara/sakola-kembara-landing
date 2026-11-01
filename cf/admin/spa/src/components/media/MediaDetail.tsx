import { Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { CopyButton } from "~/components/crud/CopyButton";
import { Button } from "~/components/ui/button";
import { Field, Input, Textarea } from "~/components/ui/field";
import { useConfig } from "~/lib/config";
import { describeFailure } from "~/lib/crud/errors";
import { ALT_TEXT_MAX, formatSize, isImage, MEDIA_PATH, type MediaItem, saveAltText, typeLabel, useMediaUsage } from "~/lib/crud/media";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { storedFileUrl } from "~/lib/crud/upload-kinds";
import { useDeleteAction } from "~/lib/crud/useDeleteAction";
import { formatDate } from "~/lib/format";
import { NAV_ITEMS } from "~/lib/nav";
import { MediaThumb } from "./MediaTile";

/** "WebP · 1920 × 1080 · 240 KB", or "PDF · 2,4 MB" for a file with no picture size. */
export function describeFile(item: Pick<MediaItem, "contentType" | "width" | "height" | "size">): string {
  const dimensions = item.width && item.height ? ` · ${item.width} × ${item.height}` : "";
  return `${typeLabel(item.contentType)}${dimensions} · ${formatSize(item.size)}`;
}

/** The text alternative of a picture: what a screen reader says for it and what shows when it cannot be drawn. Controlled: the page saves it with a button, a picker with the choice. */
export function AltTextField({
  id,
  value,
  onChange,
  error,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange(next: string): void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <Field label="Teks alternatif" id={id} error={error} hint={disabled ? undefined : `Jelaskan isi gambar dalam satu atau dua kalimat. ${value.length}/${ALT_TEXT_MAX}`}>
      <Textarea
        rows={3}
        value={value}
        maxLength={ALT_TEXT_MAX}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Untuk gambar: jelaskan isinya"
        className="resize-y"
      />
    </Field>
  );
}

export interface MediaDetailProps {
  item: MediaItem;
  /** Write access to the file's area: the text alternative can be changed and the file deleted. */
  canWrite: boolean;
  /** The text alternative was saved: the file as it is now. */
  onChanged(item: MediaItem): void;
  /** The file is gone. */
  onDeleted(item: MediaItem): void;
  /** The file changed underneath (the delete said so): load the list again. */
  onReload(): void;
}

/** "Dipakai di": the menus that use the file, each a link to its list when the menu is one of the sidebar's. */
function UsedBy({ usedBy, failed }: { usedBy: string[] | null; failed: boolean }) {
  if (failed) return <p className="text-sm text-gray-600">Tidak bisa memeriksa pemakaian file ini.</p>;
  if (usedBy === null) return <p className="text-sm text-gray-500">Memeriksa...</p>;
  if (usedBy.length === 0) return <p className="text-sm text-gray-600">Belum dipakai di mana pun.</p>;
  return (
    <ul className="space-y-0.5 text-sm">
      {usedBy.map((label) => {
        const target = NAV_ITEMS.find((entry) => entry.label === label);
        return (
          <li key={label}>
            {target ? (
              <Link to={target.path} className="text-primary-blue hover:underline">
                {label}
              </Link>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Everything about one file, for the Media page's side panel (and the same in a window on a phone): the picture, the
 * name and what it is, the address to copy, the text alternative, where it is used, and Hapus. A file still in use cannot be
 * deleted: the Worker says 409 and names the menus, and the dialog shows that sentence with only "Tutup".
 */
export function MediaDetail({ item, canWrite, onChanged, onDeleted, onReload }: MediaDetailProps) {
  const base = useUploadsBase();
  const { siteUrl } = useConfig();
  const url = storedFileUrl(item.path, base, siteUrl);
  const image = isImage(item);
  const altId = useId();
  const linkId = useId();

  const [alt, setAlt] = useState(item.altText ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Another file starts from its own text, with nothing said about the one before.
  useEffect(() => {
    setAlt(item.altText ?? "");
    setProblem(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a different file resets the field
  }, [item.id]);
  // What the server has changed under the same file (this save, an edit elsewhere): the field follows, and "Tersimpan." stays.
  useEffect(() => setAlt(item.altText ?? ""), [item.altText]);

  const [usageVersion, setUsageVersion] = useState(0);
  const usage = useMediaUsage(item.id, usageVersion);

  const remove = useDeleteAction<MediaItem>({
    basePath: MEDIA_PATH,
    noun: "berkas",
    nameOf: (file) => file.name,
    note: "Gambar atau PDF-nya juga dihapus dari penyimpanan.",
    onDeleted,
    // A refused delete (409 in_use) says which menus use it; asking again after one of them let go needs the list as it is now.
    onReload: () => {
      setUsageVersion((count) => count + 1);
      onReload();
    },
  });

  async function save() {
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const result = await saveAltText(item.id, alt.trim());
    setSaving(false);
    if (!result.ok) {
      setProblem(describeFailure(result).fields.altText ?? describeFailure(result).message);
      return;
    }
    setSaved(true);
    onChanged(result.data.item);
  }

  const changed = alt.trim() !== (item.altText ?? "");

  return (
    <div className="space-y-4">
      <MediaThumb item={item} alt={image ? (item.altText ?? "") : ""} className="aspect-[4/3]" />
      <div>
        <h3 className="break-all text-[15px] font-semibold leading-snug text-gray-900">{item.name}</h3>
        <p className="mt-0.5 text-[13px] text-gray-600">
          {describeFile(item)} · diunggah {formatDate(item.createdAt)}
          {item.uploadedByName ? ` oleh ${item.uploadedByName}` : ""}
        </p>
      </div>

      <Field label="Tautan" id={linkId}>
        <div className="flex items-center gap-3">
          <Input readOnly size="sm" value={url} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 text-[13px]" />
          <CopyButton url={url} />
        </div>
      </Field>

      {image && (
        <div className="space-y-2">
          <AltTextField
            id={altId}
            value={alt}
            onChange={(next) => {
              setAlt(next);
              setSaved(false);
            }}
            error={problem ?? undefined}
            disabled={!canWrite}
          />
          {canWrite && (
            <div className="flex items-center gap-3">
              <Button size="sm" variant="neutral" disabled={saving || !changed} onClick={() => void save()}>
                {saving ? "Menyimpan..." : "Simpan teks alt"}
              </Button>
              <span role="status" className="text-[13px] text-success-fg">
                {saved && !changed ? "Tersimpan." : ""}
              </span>
            </div>
          )}
        </div>
      )}

      <section aria-label="Dipakai di">
        <h4 className="mb-1 text-sm font-medium text-gray-700">Dipakai di</h4>
        <UsedBy usedBy={usage.usedBy} failed={usage.status === "error"} />
      </section>

      {canWrite && (
        <div>
          <Button variant="neutral" fullWidth onClick={() => remove.ask(item)} aria-haspopup="dialog" className="text-red-700 hover:bg-danger-bg hover:text-red-800">
            <Trash2 aria-hidden="true" />
            Hapus
          </Button>
          <p className="mt-2 text-[13px] text-gray-600">Media yang masih dipakai tidak bisa dihapus.</p>
        </div>
      )}
      <ConfirmDialog {...remove.dialogProps} />
    </div>
  );
}
