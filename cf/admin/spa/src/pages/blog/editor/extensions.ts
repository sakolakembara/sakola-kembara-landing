import type { Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

// What the article editor knows how to write: the Markdown the Worker renders (docs/cloudflare/admin-blog.md, "The
// render pipeline"), nothing more. Markdown stays the stored text; the editor only reads it into a document and writes
// it back, so a node or a mark that Markdown cannot say (underline, colour, a font) is not in the schema: the person
// cannot make something that would be lost on save.

export interface BlogExtensionsOptions {
  placeholder?: string;
  /** The address an image is DRAWN from (a path of an upload is shown from the files domain); the stored `src` stays the path. */
  displaySrc?: (src: string) => string;
  /** The way back: an image copied out of the page and pasted in has the drawn address; the text must keep the path. */
  storedSrc?: (src: string) => string;
}

export function blogExtensions({ placeholder, displaySrc, storedSrc }: BlogExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      // Every level a Markdown article can have is read; the menus offer the two writers use.
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // No underline: Markdown has none.
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          src: { default: null, parseHTML: (element: HTMLElement) => (storedSrc ? storedSrc(element.getAttribute("src") ?? "") : element.getAttribute("src")) },
        };
      },
      renderHTML({ HTMLAttributes }) {
        const src = typeof HTMLAttributes.src === "string" ? HTMLAttributes.src : "";
        return ["img", { ...HTMLAttributes, src: displaySrc ? displaySrc(src) : src }];
      },
    }).configure({ inline: true, allowBase64: false }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    Markdown,
  ];
}
