import type { Editor } from "@tiptap/core";
import { Code, Heading2, Heading3, ImagePlus, List, ListChecks, ListOrdered, Minus, Quote, Table } from "lucide-react";
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/cn";
import type { SlashItem } from "./slashItems";

// The list under the "/" (SlashCommand.ts). An ARIA combobox: the editor is the combobox, this is its listbox, and the
// option under the arrows is `aria-activedescendant` of the editor, so a screen reader reads it while the focus stays
// where the person is typing. Pressing an option with the mouse does not take the focus from the text.

export const SLASH_MENU_ID = "slash-menu";
const optionId = (item: SlashItem) => `slash-option-${item.id}`;

const ICONS: Record<string, ReactNode> = {
  "judul-besar": <Heading2 aria-hidden="true" />,
  "judul-kecil": <Heading3 aria-hidden="true" />,
  daftar: <List aria-hidden="true" />,
  "daftar-angka": <ListOrdered aria-hidden="true" />,
  "daftar-centang": <ListChecks aria-hidden="true" />,
  kutipan: <Quote aria-hidden="true" />,
  gambar: <ImagePlus aria-hidden="true" />,
  tabel: <Table aria-hidden="true" />,
  kode: <Code aria-hidden="true" />,
  pemisah: <Minus aria-hidden="true" />,
};

export interface SlashMenuProps {
  editor: Editor;
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export interface SlashMenuHandle {
  /** Arrow keys and Enter; true when the key was used. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu({ editor, items, command }, ref) {
  const [active, setActive] = useState(0);
  // A new list (the person typed another letter) starts at its first item.
  useEffect(() => setActive(0), [items]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (items.length === 0) return false;
        if (event.key === "ArrowDown") setActive((now) => (now + 1) % items.length);
        else if (event.key === "ArrowUp") setActive((now) => (now - 1 + items.length) % items.length);
        else if (event.key === "Enter") command(items[active] ?? items[0]!);
        else return false;
        return true;
      },
    }),
    [items, active, command],
  );

  // The editor is the combobox while the list is open.
  const current = items[active];
  useEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-haspopup", "listbox");
    dom.setAttribute("aria-expanded", "true");
    dom.setAttribute("aria-controls", SLASH_MENU_ID);
    if (current) dom.setAttribute("aria-activedescendant", optionId(current));
    else dom.removeAttribute("aria-activedescendant");
    return () => {
      dom.setAttribute("aria-expanded", "false");
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [editor, current]);

  return (
    <div className="w-[340px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-1.5 shadow-lg">
      <div role="listbox" id={SLASH_MENU_ID} aria-label="Sisipkan blok" className="max-h-[320px] overflow-y-auto">
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            id={optionId(item)}
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onClick={() => command(item)}
            className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5", index === active && "bg-gray-100")}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-gray-700 [&_svg]:size-4">{ICONS[item.id]}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{item.title}</span>
              <span className="block text-xs text-muted-foreground">{item.hint}</span>
            </span>
          </div>
        ))}
      </div>
      {items.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Tidak ada perintah yang cocok. Hapus huruf terakhir, atau lanjut menulis.</p>}
      <p className="border-t border-border px-2.5 pb-1 pt-2 text-xs text-muted-foreground">Ketik untuk menyaring · ↑↓ pilih · Enter sisipkan · Esc tutup</p>
    </div>
  );
});
