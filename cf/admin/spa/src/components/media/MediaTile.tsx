import { FileText, ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useConfig } from "~/lib/config";
import { isImage, type MediaItem } from "~/lib/crud/media";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { storedFileUrl } from "~/lib/crud/upload-kinds";

/**
 * The picture of a media file, or the icon of its type: a PDF has no picture, and neither has an image whose file
 * cannot be read (the files domain is not set, the object is gone). A broken picture is an icon, never a hole.
 * Decorative unless `alt` says otherwise: the name beside it is its name.
 */
export function MediaThumb({ item, alt = "", className }: { item: Pick<MediaItem, "path" | "contentType">; alt?: string; className?: string }) {
  const base = useUploadsBase();
  const { siteUrl } = useConfig();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [item.path]);
  const image = isImage(item);
  return (
    <span className={cn("flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-gray-400", className)}>
      {image && !broken ? (
        <img src={storedFileUrl(item.path, base, siteUrl)} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : image ? (
        <ImageIcon size={30} aria-hidden="true" />
      ) : (
        <FileText size={30} aria-hidden="true" />
      )}
    </span>
  );
}

export interface MediaTileProps {
  item: MediaItem;
  /** The file whose panel is open (the page) or that will be used (a picker). */
  active: boolean;
  /** With a checkbox for choosing several (the page); without, none. */
  ticked?: boolean;
  onOpen(): void;
  onTick?(): void;
}

/** One cell of the grid: the picture and the name, pressed to open or choose it; a checkbox in the corner to tick it with others. */
export function MediaTile({ item, active, ticked, onOpen, onTick }: MediaTileProps) {
  return (
    <li className="relative min-w-0">
      <button type="button" onClick={onOpen} aria-pressed={active} className="group block w-full rounded-lg text-left">
        <MediaThumb item={item} className={cn("transition-shadow group-hover:border-gray-300", active && "border-primary-blue ring-2 ring-primary-blue")} />
        <span className="mt-1.5 block truncate text-[13px] text-gray-700">{item.name}</span>
      </button>
      {onTick && (
        <input
          type="checkbox"
          checked={ticked === true}
          onChange={onTick}
          aria-label={`Pilih ${item.name}`}
          className="absolute left-2 top-2 size-5 cursor-pointer rounded border-gray-300 bg-white accent-primary-blue shadow-sm"
        />
      )}
    </li>
  );
}
