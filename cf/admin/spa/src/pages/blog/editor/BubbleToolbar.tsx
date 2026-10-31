import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Heading2, Heading3, Italic, Link2, List, Quote } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { tidyHref } from "./links";

// What shows over the words a person has selected (Medium's way): the few things a selection can become, and nothing
// else. The toolbar is dark and small, and a press does not take the focus from the text (`onMouseDown` is stopped),
// so the selection stays. Every one of them also has its keyboard way in the text itself (Ctrl+B, Ctrl+I, Ctrl+K,
// "## " and "- " typed at the start of a line), which is how it is reached without a pointer.

const BUTTON = "inline-flex size-8 items-center justify-center rounded-md text-sm font-bold text-white transition-colors hover:bg-white/15 aria-pressed:bg-white/25 [&_svg]:size-4";

function Tool({ label, pressed, onPress, children }: { label: string; pressed: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onMouseDown={(event) => event.preventDefault()} onClick={onPress} className={BUTTON}>
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-white/25" />;

/**
 * `linkRequests` counts the times Ctrl+K (⌘K) was pressed over a selection (the editor counts, this answers): each one opens
 * the box for the link's address, as pressing "Tautan" does.
 */
export function BubbleToolbar({ editor, linkRequests }: { editor: Editor; linkRequests: number }) {
  const now = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      link: current.isActive("link"),
      quote: current.isActive("blockquote"),
      list: current.isActive("bulletList"),
      code: current.isActive("code"),
      href: (current.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState("");
  const [refused, setRefused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linking) input.current?.focus();
  }, [linking]);

  function openLink() {
    setAddress(now.href);
    setRefused(false);
    setLinking(true);
  }

  useEffect(() => {
    if (linkRequests > 0) openLink();
  }, [linkRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  function closeLink() {
    setLinking(false);
    editor.commands.focus();
  }

  function applyLink() {
    const href = tidyHref(address);
    if (href === null) {
      setRefused(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinking(false);
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinking(false);
  }

  // Not a <form>: the toolbar sits inside the page's own form, and a form inside a form is not allowed. Enter is taken
  // here, so it does not reach the page's form and save the article.
  function onLinkKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeLink();
    } else if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    }
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textBubble"
      updateDelay={100}
      options={{ placement: "top", offset: 8 }}
      // A selection of words, not of a picture or of code; and the menu stays while its own address box has the focus.
      shouldShow={({ editor: current, from, to }) => from !== to && !current.isActive("image") && !current.isActive("codeBlock")}
    >
      {linking ? (
        <div role="group" aria-label="Tautan" onKeyDown={onLinkKeyDown} className="flex items-center gap-1 rounded-xl bg-gray-900 p-1.5 shadow-lg">
          <input
            ref={input}
            type="text"
            inputMode="url"
            aria-label="Alamat tautan"
            aria-invalid={refused ? true : undefined}
            placeholder="https://..."
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setRefused(false);
            }}
            className={cn("h-8 w-56 rounded-md border bg-white px-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-white/60", refused ? "border-red-400" : "border-transparent")}
          />
          <button type="button" onClick={applyLink} className="h-8 rounded-md bg-white px-3 text-sm font-semibold text-gray-900 hover:bg-gray-100">
            Terapkan
          </button>
          {now.link && (
            <button type="button" onClick={removeLink} className="h-8 rounded-md px-2 text-sm font-medium text-white hover:bg-white/15">
              Hapus
            </button>
          )}
          {refused && (
            <span role="alert" className="px-1 text-xs text-red-200">
              Alamat tidak sah
            </span>
          )}
        </div>
      ) : (
        <div role="toolbar" aria-label="Format teks terpilih" className="flex items-center gap-0.5 rounded-xl bg-gray-900 p-1 shadow-lg">
          <Tool label="Judul besar" pressed={now.h2} onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 aria-hidden="true" />
          </Tool>
          <Tool label="Judul kecil" pressed={now.h3} onPress={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 aria-hidden="true" />
          </Tool>
          <Divider />
          <Tool label="Tebal" pressed={now.bold} onPress={() => editor.chain().focus().toggleBold().run()}>
            <Bold aria-hidden="true" />
          </Tool>
          <Tool label="Miring" pressed={now.italic} onPress={() => editor.chain().focus().toggleItalic().run()}>
            <Italic aria-hidden="true" />
          </Tool>
          <Tool label="Tautan" pressed={now.link} onPress={openLink}>
            <Link2 aria-hidden="true" />
          </Tool>
          <Divider />
          <Tool label="Kutipan" pressed={now.quote} onPress={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote aria-hidden="true" />
          </Tool>
          <Tool label="Daftar" pressed={now.list} onPress={() => editor.chain().focus().toggleBulletList().run()}>
            <List aria-hidden="true" />
          </Tool>
          <Tool label="Kode" pressed={now.code} onPress={() => editor.chain().focus().toggleCode().run()}>
            <Code aria-hidden="true" />
          </Tool>
        </div>
      )}
    </BubbleMenu>
  );
}

/**
 * Changes the alt text of the selected picture and keeps the picture selected: replacing a node's attributes would leave the
 * selection on the text next to it, and the box (which is shown for a selected picture) would go away after one letter.
 */
function setAlt(editor: Editor, alt: string) {
  editor
    .chain()
    .command(({ tr, state }) => {
      const { selection } = state;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return false;
      tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, alt });
      tr.setSelection(NodeSelection.create(tr.doc, selection.from));
      return true;
    })
    .run();
}

/** Over a picture that is selected: its alt text, which a screen reader and a search engine read in its place. */
export function ImageBubble({ editor }: { editor: Editor }) {
  const alt = useEditorState({ editor, selector: ({ editor: current }) => (current.getAttributes("image").alt as string | null | undefined) ?? "" });
  return (
    <BubbleMenu editor={editor} pluginKey="imageBubble" updateDelay={100} options={{ placement: "top", offset: 8 }} shouldShow={({ editor: current }) => current.isActive("image")}>
      <label className="flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 shadow-lg">
        <span className="text-xs font-medium text-white">Teks alternatif</span>
        <input
          type="text"
          value={alt}
          placeholder="Jelaskan gambar ini"
          onChange={(event) => setAlt(editor, event.target.value)}
          onKeyDown={(event) => {
            // Enter would save the whole form: it only ends this box.
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              editor.commands.focus();
            }
          }}
          className="h-8 w-64 rounded-md border border-transparent bg-white px-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-white/60"
        />
      </label>
    </BubbleMenu>
  );
}
