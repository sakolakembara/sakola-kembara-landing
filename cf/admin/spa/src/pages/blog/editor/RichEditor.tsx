import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acceptFor, storedFilePath, storedFileUrl } from "~/lib/crud/upload-kinds";
import { useConfig } from "~/lib/config";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { BubbleToolbar, ImageBubble } from "./BubbleToolbar";
import { blogExtensions } from "./extensions";
import { picturesIn, uploadPicture } from "./images";
import { articleMarkdown } from "./serialize";
import { SlashCommand } from "./SlashCommand";

// The article, written the way Medium and Notion are written (SAKEM-116): the words on the page, a toolbar over a
// selection, "/" for what can be put on a line, and a picture that is pasted or dragged in. TipTap holds the document;
// Markdown is what goes in and what comes out (`@tiptap/markdown`), and it is still the text the Worker renders and
// stores, so nothing about saving, previewing or the API changed. The form is the owner of the text: this reads
// `initialMarkdown` once and reports every change, and a new version of the article mounts it again (the form is
// keyed by the version).
//
// It is loaded when the editor is first shown (BodyEditor lazy-loads this file), so the rest of the admin does not
// carry TipTap.

export interface RichEditorProps {
  /** The editable element's id: the field name, so the error summary can put the cursor in it. */
  id: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** No write access: the text is shown formatted and cannot be changed. */
  readOnly: boolean;
  invalid: boolean;
  describedBy: string;
}

const PLACEHOLDER = "Ketik / untuk perintah, atau mulai menulis…";

/** Runs `run` now, or when TipTap says the editor is created (it is not, yet, when the first effect runs). */
function whenReady(editor: Editor, run: () => void): (() => void) | undefined {
  if (editor.isInitialized) {
    run();
    return undefined;
  }
  editor.on("create", run);
  return () => void editor.off("create", run);
}

export default function RichEditor({ id, initialMarkdown, onChange, readOnly, invalid, describedBy }: RichEditorProps) {
  const base = useUploadsBase();
  // Read when a picture is drawn, so the files domain, which arrives with /api/config, is used as soon as it is known.
  const baseRef = useRef(base);
  baseRef.current = base;
  // The same for the public site, which the pictures of the migrated articles ("/blog/images/...") are drawn from.
  const { siteUrl } = useConfig();
  const siteRef = useRef(siteUrl);
  siteRef.current = siteUrl;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const picker = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [linkRequests, setLinkRequests] = useState(0);


  /** Uploads the pictures one after the other and writes each where the cursor is (or at `at`, where it was dropped). */
  const insertPictures = useCallback(async (files: File[], at?: number) => {
    setProblem(null);
    let position = at;
    for (const file of files) {
      setBusy(file.name);
      const outcome = await uploadPicture(file);
      const editor = editorRef.current;
      if (!outcome.ok) {
        setProblem(outcome.message);
        break;
      }
      if (!editor || editor.isDestroyed) break;
      const picture = { type: "paragraph", content: [{ type: "image", attrs: { src: outcome.path, alt: outcome.alt } }] };
      if (position === undefined) editor.chain().focus().insertContent(picture).run();
      else editor.chain().focus().insertContentAt(position, picture).run();
      position = undefined; // the next one follows the cursor
    }
    setBusy(null);
  }, []);

  const extensions = useMemo(
    () => [
      ...blogExtensions({
        placeholder: PLACEHOLDER,
        displaySrc: (src) => storedFileUrl(src, baseRef.current, siteRef.current),
        storedSrc: (src) => storedFilePath(src, baseRef.current, siteRef.current),
      }),
      SlashCommand.configure({ onPickImage: () => picker.current?.click() }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: initialMarkdown,
    contentType: "markdown",
    editable: !readOnly,
    editorProps: {
      attributes: { id, role: "textbox", "aria-multiline": "true", "aria-label": "Isi Artikel", class: "blog-content article-editor-text" },
      handleKeyDown: (view, event) => {
        // Ctrl+K (⌘K) over some words asks for the link's address, in the toolbar: the way to a link without a pointer.
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k" && !view.state.selection.empty) {
          event.preventDefault();
          setLinkRequests((count) => count + 1);
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        const files = Array.from(data?.files ?? []);
        // Words that come with a picture (a copy from a web page or from Word has both) are the text's business: only a
        // clipboard of files alone is a picture to upload.
        if (files.length === 0 || data?.getData("text/plain") || data?.getData("text/html")) return false;
        event.preventDefault();
        void insertPictures(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        // Moving something inside the text is the editor's own business.
        const files = moved ? [] : Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        // Any file, not only a picture: a picture is uploaded and anything else is refused with a sentence. Left to the
        // browser, a file dropped on the page would be opened in its place and the page, with the unsaved text, left.
        event.preventDefault();
        void insertPictures(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(articleMarkdown(current)),
  });
  editorRef.current = editor;

  // What a screen reader needs to know about the field, set on the editable element (TipTap draws it).
  useEffect(() => {
    if (!editor) return;
    return whenReady(editor, () => {
      const dom = editor.view.dom;
      const flag = (name: string, on: boolean, value = "true") => (on ? dom.setAttribute(name, value) : dom.removeAttribute(name));
      flag("aria-invalid", invalid);
      flag("aria-readonly", readOnly);
      flag("aria-describedby", describedBy !== "", describedBy);
    });
  }, [editor, invalid, readOnly, describedBy]);

  // The files domain and the site's address can arrive after the pictures were drawn: point the ones already on the page at them.
  useEffect(() => {
    if (!editor) return;
    return whenReady(editor, () => {
      for (const image of editor.view.dom.querySelectorAll<HTMLImageElement>('img[src^="/"]')) image.setAttribute("src", storedFileUrl(image.getAttribute("src") ?? "", base, siteUrl));
    });
  }, [editor, base, siteUrl]);

  return (
    <div className="article-editor relative">
      {problem && (
        <div role="alert" className="mb-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {problem}
        </div>
      )}
      <EditorContent editor={editor} />
      {editor && !readOnly && (
        <>
          <BubbleToolbar editor={editor} linkRequests={linkRequests} />
          <ImageBubble editor={editor} />
        </>
      )}
      {!readOnly && (
        <input
          ref={picker}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept={acceptFor("blog-image")}
          disabled={busy !== null}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = ""; // the same file can be picked again
            // A file the kind does not take is still given to the check, which says so in the Worker's own words.
            const pictures = picturesIn(chosen);
            const given = pictures.length > 0 ? pictures : chosen;
            if (given.length > 0) void insertPictures(given);
          }}
          className="sr-only"
        />
      )}
      {busy !== null && (
        <p role="status" className="mt-2 text-[13px] text-muted-foreground">
          Mengunggah {busy}...
        </p>
      )}
    </div>
  );
}
