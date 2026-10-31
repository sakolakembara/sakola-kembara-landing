import type { Editor, JSONContent } from "@tiptap/core";

/**
 * The Markdown of the page, as the article keeps it. An empty paragraph at the top of the page (the editor keeps one after
 * a table or a picture so that a cursor can go below it, and Enter twice makes another) is not text, and Markdown can only
 * write it as `&nbsp;`, which the site draws as a gap: they are left out, so what is saved is words and blocks.
 */
export function articleMarkdown(editor: Editor): string {
  const doc = editor.getJSON();
  const content = (doc.content ?? []).filter((node: JSONContent) => !(node.type === "paragraph" && (node.content ?? []).length === 0));
  // A table is written with a line break on each side, which at the top or the end of the page is a blank line the text does not need.
  return (editor.markdown?.serialize({ ...doc, content }) ?? editor.getMarkdown()).replace(/^\n+|\n+$/g, "");
}
