import type { Editor } from "@tiptap/core";
import { act, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { resetUploadsBase, setUploader, type UploadRequest } from "~/lib/crud/upload-client";
import { API_PATH } from "~/pages/blog/form";
import { tidyHref } from "~/pages/blog/editor/links";
import { articleMarkdown } from "~/pages/blog/editor/serialize";
import { filterSlashItems, SLASH_ITEMS } from "~/pages/blog/editor/slashItems";
import { deferred, meBody, renderApp, respond, stubApi } from "./helpers";

// The article editor (SAKEM-116): what a person does in the page. Markdown shortcuts, the "/" menu, the toolbar over a
// selection, the address of a link, the alt text of a picture, a picture pasted or dropped, and the title's Enter.
// Through the blog form, as a writer sees it. What the editor does to the Markdown is in blog-editor-roundtrip.test.ts;
// the form around it is in blog.test.tsx.

const WRITER: Parameters<typeof meBody> = ["editor", ["konten"]];
const LIST = API_PATH;
const PATH = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-siswa.png";

async function open(routes: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi({ "GET /api/me": respond(meBody(...WRITER)), ...routes });
  renderApp("/blog/new");
  await screen.findByRole("form");
  const editor = ((await screen.findByLabelText("Isi Artikel")) as HTMLElement & { editor: Editor }).editor;
  return { api, editor, dom: editor.view.dom };
}

/** Types as a person does: each character goes first to the editor's input rules (`## `, `- `), then into the text. */
function typeInto(editor: Editor, text: string) {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (handle) => handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)))) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

const run = (action: () => void) => act(async () => void action());

/**
 * Presses Enter in a box and says whether the page took it (prevented the browser's own answer). In a browser, Enter in a text
 * box of a form submits the form through the button tied to it (the save button is in the top bar, tied by `form`), which
 * would save the article; user-event does not model a button outside the form, so this asks the question directly.
 */
const enterIsTaken = (box: Element) => {
  const event = createEvent.keyDown(box, { key: "Enter", bubbles: true, cancelable: true });
  fireEvent(box, event);
  return event.defaultPrevented;
};

afterEach(() => {
  setUploader(null);
  resetUploadsBase();
});

describe("the page is written like a page", () => {
  test("an empty page says what can be done, and the first thing typed is a paragraph", async () => {
    const { editor, dom } = await open();
    expect(dom.querySelector("p.is-editor-empty")?.getAttribute("data-placeholder")).toBe("Ketik / untuk perintah, atau mulai menulis…");
    expect(dom.getAttribute("role")).toBe("textbox");
    expect(dom.getAttribute("aria-multiline")).toBe("true");
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "Halo dunia");
    });
    expect(articleMarkdown(editor)).toBe("Halo dunia");
  });

  test("the Markdown shortcuts work as the words are typed: ## a heading, - a list, > a quote, **bold** a mark", async () => {
    const { editor } = await open();
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "## Judul bagian");
      editor.commands.insertContent({ type: "paragraph" });
      typeInto(editor, "- satu");
      editor.commands.insertContent({ type: "paragraph" });
    });
    const markdown = articleMarkdown(editor);
    expect(markdown).toContain("## Judul bagian");
    expect(markdown).toContain("- satu");
    await run(() => {
      editor.commands.setContent("", { contentType: "markdown" });
      editor.commands.focus("end");
      typeInto(editor, "> kutipan");
    });
    expect(articleMarkdown(editor)).toBe("> kutipan");
    await run(() => {
      editor.commands.setContent("", { contentType: "markdown" });
      editor.commands.focus("end");
      typeInto(editor, "ini **tebal** ya");
    });
    expect(articleMarkdown(editor)).toBe("ini **tebal** ya");
  });

  test("an underline (from Word, say) is words: Markdown has none, and the tag the editor could keep it in would be dropped by the Worker", async () => {
    const { editor, dom } = await open();
    await run(() => void editor.commands.setContent("<p>a <u>b</u> c</p>", { contentType: "html" }));
    expect(articleMarkdown(editor)).toBe("a b c");
    expect(dom.querySelector("u")).toBeNull(); // and the page never shows what a save would lose
  });

  test("an empty line is a line and not text: Enter twice leaves no gap in what is saved, and nothing is added at the end", async () => {
    const { editor } = await open();
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "Satu");
      editor.commands.insertContent([{ type: "paragraph" }, { type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "Dua" }] }, { type: "paragraph" }]);
    });
    expect(articleMarkdown(editor)).toBe("Satu\n\nDua"); // not "&nbsp;", which the site would draw as a gap
    await run(() => void editor.commands.setContent("| A | B |\n| --- | --- |\n| 1 | 2 |", { contentType: "markdown" })); // the editor keeps an empty line under a table
    expect(articleMarkdown(editor)).toBe("| A   | B   |\n| --- | --- |\n| 1   | 2   |"); // and no blank line before or after it
  });

  test("what is typed reaches the form: leaving asks first, and saving sends the Markdown", async () => {
    const user = userEvent.setup();
    const { api, editor } = await open({ [`POST ${LIST}`]: respond({ item: { id: "new-id", updatedAt: "2026-10-31T00:00:00.000Z" } }, 201) });
    await user.type(screen.getByLabelText("Judul"), "Cara Belajar");
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "## Mulai dari jadwal");
      editor.commands.insertContent({ type: "paragraph" });
      typeInto(editor, "Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    });
    await user.click(screen.getByRole("tab", { name: "Publikasi" })); // the Excerpt is on Publikasi
    await user.type(screen.getByLabelText(/^Excerpt/), "Ringkasan tentang cara belajar yang efektif.");
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ contentMarkdown: "## Mulai dari jadwal\n\nIsi artikel yang cukup panjang untuk lolos batas lima puluh karakter." });
  });
});

describe("the title", () => {
  test("Enter in the title goes to the text, and does not save the form (it would in any other text box of a form)", async () => {
    const user = userEvent.setup();
    const { api, dom } = await open();
    await user.type(screen.getByLabelText("Judul"), "Cara Belajar");
    expect(enterIsTaken(screen.getByLabelText("Judul"))).toBe(true);
    expect(document.activeElement).toBe(dom);
    expect(api.count(`POST ${LIST}`)).toBe(0);
    expect((screen.getByLabelText("Judul") as HTMLInputElement).value).toBe("Cara Belajar");
  });
});

describe("the '/' menu", () => {
  test("typing '/' opens a list of what can be put on the line; letters narrow it; the editor is its combobox", async () => {
    const { editor, dom } = await open();
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "/");
    });
    const list = await screen.findByRole("listbox", { name: "Sisipkan blok" });
    expect(within(list).getAllByRole("option")).toHaveLength(SLASH_ITEMS.length);
    expect(dom.getAttribute("aria-expanded")).toBe("true");
    expect(dom.getAttribute("aria-controls")).toBe(list.id);
    expect(dom.getAttribute("aria-activedescendant")).toBe(within(list).getAllByRole("option")[0]!.id);

    await run(() => typeInto(editor, "tab"));
    await waitFor(() => expect(within(screen.getByRole("listbox", { name: "Sisipkan blok" })).getAllByRole("option")).toHaveLength(1));
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: /Tabel/ })).toBeTruthy();
  });

  test("the arrow keys choose, Enter inserts it in place of the '/word', and the list closes", async () => {
    const { editor, dom } = await open();
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "/judul");
    });
    await screen.findByRole("listbox", { name: "Sisipkan blok" });
    await run(() => void fireEvent.keyDown(dom, { key: "ArrowDown" }));
    expect(dom.getAttribute("aria-activedescendant")).toBe("slash-option-judul-kecil");
    await run(() => void fireEvent.keyDown(dom, { key: "Enter" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(articleMarkdown(editor)).not.toContain("/judul");
    expect(dom.getAttribute("aria-expanded")).toBe("false");
  });

  test("a mouse press on an item inserts it too, and the word '/tabel' makes a table with a header row", async () => {
    const { editor, dom } = await open();
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "/tabel");
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("option", { name: /Tabel/ }));
    expect(articleMarkdown(editor)).toMatch(/\| --- \| --- \| --- \|/);
    expect(dom.querySelector("table th")).toBeTruthy();
  });

  test("Escape closes it and leaves what was typed; a word nothing matches says so; an address is not a command", async () => {
    const { editor, dom } = await open();
    await run(() => {
      editor.commands.focus("end");
      typeInto(editor, "/judul");
    });
    await screen.findByRole("listbox", { name: "Sisipkan blok" });
    await run(() => void fireEvent.keyDown(dom, { key: "Escape" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(articleMarkdown(editor)).toContain("/judul");

    await run(() => {
      editor.commands.setContent("", { contentType: "markdown" });
      editor.commands.focus("end");
      typeInto(editor, "/zzzz");
    });
    expect(await screen.findByText(/Tidak ada perintah yang cocok/)).toBeTruthy();

    await run(() => {
      editor.commands.setContent("", { contentType: "markdown" });
      editor.commands.focus("end");
      typeInto(editor, "lihat https://sakolakembara.org/blog");
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  test("inside a block of code a '/' is a '/': no list opens", async () => {
    const { editor } = await open();
    await run(() => {
      editor.commands.setContent("```\nx\n```", { contentType: "markdown" });
      editor.chain().focus().setTextSelection(2).run();
      typeInto(editor, " /");
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(articleMarkdown(editor)).toContain("x /");
  });

  test("the items are found by their title and by the words a writer would try", () => {
    const titles = (query: string) => filterSlashItems(query).map((item) => item.title);
    expect(titles("")).toHaveLength(SLASH_ITEMS.length);
    expect(titles("gambar")).toEqual(["Gambar"]);
    expect(titles("foto")).toEqual(["Gambar"]);
    expect(titles("jud")).toEqual(["Judul besar", "Judul kecil"]);
    expect(titles("daftar")).toEqual(["Daftar", "Daftar angka", "Daftar centang"]);
    expect(titles("GAMBAR")).toEqual(["Gambar"]);
    expect(titles("qqq")).toEqual([]);
  });
});

describe("the toolbar over a selection", () => {
  async function select(editor: Editor, text: string, from = 1) {
    await run(() => {
      editor.commands.setContent(text, { contentType: "markdown" });
      editor.chain().focus().setTextSelection({ from, to: from + text.length }).run();
    });
    return screen.findByRole("toolbar", { name: "Format teks terpilih" });
  }

  test("selecting words shows it; a press makes them bold or a heading and shows the state; a plain click shows nothing", async () => {
    const user = userEvent.setup();
    const { editor } = await open();
    const bar = await select(editor, "Belajar efektif");
    const bold = within(bar).getByRole("button", { name: "Tebal" });
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    await user.click(bold);
    expect(articleMarkdown(editor)).toBe("**Belajar efektif**");
    expect(within(bar).getByRole("button", { name: "Tebal" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(bar).getByRole("button", { name: "Judul besar" }));
    expect(articleMarkdown(editor)).toMatch(/^## /);
    await user.click(within(bar).getByRole("button", { name: "Daftar" }));
    expect(articleMarkdown(editor)).toMatch(/^- /);
  });

  test("a link: the address is asked for in the bar, written as given or with https://, and refused if it could run code", async () => {
    const user = userEvent.setup();
    const { api, editor } = await open();
    const bar = await select(editor, "situs kami");
    await user.click(within(bar).getByRole("button", { name: "Tautan" }));
    const address = screen.getByRole("textbox", { name: "Alamat tautan" });
    await user.type(address, "javascript:alert(1)");
    expect(enterIsTaken(address)).toBe(true);
    expect(await screen.findByText("Alamat tidak sah")).toBeTruthy();
    expect(address.getAttribute("aria-invalid")).toBe("true");
    expect(articleMarkdown(editor)).toBe("situs kami");

    await user.clear(address);
    await user.type(address, "sakolakembara.org");
    expect(enterIsTaken(address)).toBe(true); // Enter in the box applies the link; it does not save the article
    expect(articleMarkdown(editor)).toBe("[situs kami](https://sakolakembara.org)");
    expect(api.count(`POST ${LIST}`)).toBe(0);
  });

  test("Ctrl+K over some words asks for the address as well, without a pointer; over no words it does nothing", async () => {
    const user = userEvent.setup();
    const { editor, dom } = await open();
    await select(editor, "situs kami");
    await run(() => void fireEvent.keyDown(dom, { key: "k", ctrlKey: true }));
    const address = await screen.findByRole("textbox", { name: "Alamat tautan" });
    expect(document.activeElement).toBe(address);
    await user.type(address, "sakolakembara.org");
    expect(enterIsTaken(address)).toBe(true);
    expect(articleMarkdown(editor)).toBe("[situs kami](https://sakolakembara.org)");

    await run(() => void editor.chain().focus().setTextSelection(3).run()); // a cursor, no words
    const none = createEvent.keyDown(dom, { key: "k", metaKey: true, cancelable: true });
    await run(() => void fireEvent(dom, none));
    expect(none.defaultPrevented).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Alamat tautan" })).toBeNull();
  });

  test("a link can be changed or removed from the same bar, and Escape leaves without changing it", async () => {
    const user = userEvent.setup();
    const { editor } = await open();
    await select(editor, "[situs kami](https://lama.example) ", 1);
    await run(() => void editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run());
    const bar = await screen.findByRole("toolbar", { name: "Format teks terpilih" });
    expect(within(bar).getByRole("button", { name: "Tautan" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(bar).getByRole("button", { name: "Tautan" }));
    const address = screen.getByRole("textbox", { name: "Alamat tautan" });
    expect((address as HTMLInputElement).value).toBe("https://lama.example");
    await user.type(address, "{Escape}");
    expect(screen.queryByRole("textbox", { name: "Alamat tautan" })).toBeNull();
    expect(articleMarkdown(editor)).toContain("(https://lama.example)");

    await user.click(within(await screen.findByRole("toolbar", { name: "Format teks terpilih" })).getByRole("button", { name: "Tautan" }));
    await user.click(screen.getByRole("button", { name: "Hapus" }));
    expect(articleMarkdown(editor)).not.toContain("lama.example");
  });

  test("tidyHref: a site gets https://, a page of ours and a place in the page stay, anything that could run code is refused", () => {
    expect(tidyHref("sakolakembara.org")).toBe("https://sakolakembara.org");
    expect(tidyHref("  https://sakolakembara.org/blog  ")).toBe("https://sakolakembara.org/blog");
    expect(tidyHref("http://contoh.test")).toBe("http://contoh.test");
    expect(tidyHref("/program/pembinaan")).toBe("/program/pembinaan");
    expect(tidyHref("#bagian")).toBe("#bagian");
    expect(tidyHref("mailto:halo@sakolakembara.org")).toBe("mailto:halo@sakolakembara.org");
    expect(tidyHref("tel:+6281234")).toBe("tel:+6281234");
    for (const bad of ["", "   ", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.example", "vbscript:x", "file:///etc/passwd", "ftp://x.test"]) expect(tidyHref(bad), bad).toBeNull();
  });
});

describe("pictures", () => {
  const png = (name = "foto-siswa.png") => new File([new Uint8Array(2000)], name, { type: "image/png" });
  const uploader = () => {
    const requests: UploadRequest[] = [];
    setUploader(async (request) => {
      requests.push(request);
      return { ok: true as const, result: { id: "u1", path: PATH, contentType: "image/png", size: request.file.size, width: 800, height: 450 } };
    });
    return requests;
  };
  const pictureIn = (editor: Editor) => {
    let found: { alt: string; src: string } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") found = { alt: node.attrs.alt, src: node.attrs.src };
    });
    return found as { alt: string; src: string } | null;
  };

  test("a picture pasted from the clipboard is uploaded as a blog image and written in, with alt text made from its name", async () => {
    const requests = uploader();
    const { editor, dom } = await open();
    await run(() => void fireEvent.paste(dom, { clipboardData: { files: [png()], types: ["Files"], getData: () => "" } }));
    await waitFor(() => expect(pictureIn(editor)).toEqual({ alt: "foto siswa", src: PATH }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind).toBe("blog-image");
    expect(articleMarkdown(editor)).toBe(`![foto siswa](${PATH})`);
  });

  test("a clipboard that has words as well as a picture (a copy from a web page or Word) is the text's: nothing is uploaded", async () => {
    const requests = uploader();
    const { dom } = await open();
    await run(() => void fireEvent.paste(dom, { clipboardData: { files: [png()], types: ["Files", "text/html"], getData: (type: string) => (type === "text/html" ? "<p>texto</p>" : "") } }));
    expect(requests).toHaveLength(0);
  });

  test("text pasted is the editor's own business: nothing is uploaded", async () => {
    const requests = uploader();
    const { dom } = await open();
    await run(() => void fireEvent.paste(dom, { clipboardData: { files: [], types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? "sekadar teks" : "") } }));
    expect(requests).toHaveLength(0);
  });

  test("a picture dropped on the page is uploaded the same way, and a file that is not a picture is left to the browser", async () => {
    const requests = uploader();
    const { editor, dom } = await open();
    await run(() => {
      editor.commands.setContent("Satu.\n\nDua.", { contentType: "markdown" });
      editor.commands.focus("end"); // the cursor is at the end...
    });
    // ...and jsdom has no layout, so it cannot say what is under the pointer: say it is the start of the page.
    editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
    // A file that is not a picture is refused with a sentence (left to the browser it would be opened in place of the page, and the unsaved text lost).
    const pdf = createEvent.drop(dom, { dataTransfer: { files: [new File(["x"], "dokumen.pdf", { type: "application/pdf" })], types: ["Files"], getData: () => "" }, clientX: 1, clientY: 1 });
    await run(() => void fireEvent(dom, pdf));
    expect(pdf.defaultPrevented).toBe(true);
    expect((await screen.findByRole("alert")).textContent).toBe("Tipe file tidak didukung. Gunakan: PNG, JPEG, WebP, GIF.");
    expect(requests).toHaveLength(0);
    await run(() => void fireEvent.drop(dom, { dataTransfer: { files: [png("sampul-depan.png")], types: ["Files"], getData: () => "" }, clientX: 1, clientY: 1 }));
    await waitFor(() => expect(pictureIn(editor)).toEqual({ alt: "sampul depan", src: PATH }));
    expect(requests).toHaveLength(1);
    const text = articleMarkdown(editor);
    expect(text.indexOf("![sampul depan]")).toBeLessThan(text.indexOf("Satu.")); // where it was dropped, not where the cursor was
  });

  test("a refused picture is a sentence over the page, and the page is as it was", async () => {
    setUploader(async () => ({ ok: false, status: 413, message: "Ukuran file maksimal 5 MB." }));
    const { editor, dom } = await open();
    await run(() => void fireEvent.paste(dom, { clipboardData: { files: [png()], types: ["Files"], getData: () => "" } }));
    expect((await screen.findByRole("alert")).textContent).toBe("Ukuran file maksimal 5 MB.");
    expect(articleMarkdown(editor)).toBe("");
  });

  test("a selected picture shows its alt text in a box over it, and what is typed there is what the article keeps", async () => {
    const user = userEvent.setup();
    const { api, editor } = await open();
    await run(() => {
      editor.commands.setContent(`![lama](${PATH})`, { contentType: "markdown" });
      let at = -1;
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "image") at = position;
      });
      editor.chain().focus().setNodeSelection(at).run();
    });
    const box = await screen.findByRole("textbox", { name: "Teks alternatif" });
    expect((box as HTMLInputElement).value).toBe("lama");
    expect(screen.queryByRole("toolbar", { name: "Format teks terpilih" })).toBeNull(); // bold and headings are for words
    await user.clear(box);
    await user.type(box, "Siswa belajar di ruang baca");
    expect(articleMarkdown(editor)).toBe(`![Siswa belajar di ruang baca](${PATH})`);
    expect(enterIsTaken(box)).toBe(true); // Enter ends the box: it does not save the whole form
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.count(`POST ${LIST}`)).toBe(0);
  });

  test("a picture drawn before the files domain is known is pointed at it when it arrives", async () => {
    const config = deferred<Response>();
    const { editor, dom } = await open({ "GET /api/config": () => config.promise });
    await run(() => void editor.commands.setContent(`![x](${PATH})`, { contentType: "markdown" }));
    expect(dom.querySelector('img[alt="x"]')?.getAttribute("src")).toBe(PATH);
    await act(async () => config.resolve(respond({ google: false, uploadsBaseUrl: "https://files.example.org", siteUrl: "" })));
    await waitFor(() => expect(dom.querySelector('img[alt="x"]')?.getAttribute("src")).toBe(`https://files.example.org${PATH}`));
    expect(articleMarkdown(editor)).toBe(`![x](${PATH})`); // the text is not touched by it
  });

  test("a picture of the migrated articles (a path of the public site) is drawn from the public site, not from this host, and the text keeps the path", async () => {
    const LEGACY = "/blog/images/2026/02/foto-lama.jpg";
    const { api, editor, dom } = await open({ "GET /api/config": respond({ google: false, uploadsBaseUrl: "https://files.example.org", siteUrl: "https://sakolakembara.org" }) });
    await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
    await run(async () => void (await new Promise((resolve) => setTimeout(resolve, 30)))); // the answer is in
    await run(() => void editor.commands.setContent(`![lama](${LEGACY})`, { contentType: "markdown" }));
    await waitFor(() => expect(dom.querySelector('img[alt="lama"]')?.getAttribute("src")).toBe(`https://sakolakembara.org${LEGACY}`));
    expect(articleMarkdown(editor)).toBe(`![lama](${LEGACY})`); // what is saved is the path, not the address it is drawn from
    await run(() => void editor.commands.setContent(`<p><img src="https://sakolakembara.org${LEGACY}" alt="salin"></p>`, { contentType: "html" }));
    expect(articleMarkdown(editor)).toBe(`![salin](${LEGACY})`); // one copied out of the page comes back as the path
  });

  test("a picture drawn before the public site's address is known is pointed at it when it arrives", async () => {
    const LEGACY = "/blog/images/2026/02/foto-lama.jpg";
    const config = deferred<Response>();
    const { editor, dom } = await open({ "GET /api/config": () => config.promise });
    await run(() => void editor.commands.setContent(`![lama](${LEGACY})`, { contentType: "markdown" }));
    expect(dom.querySelector('img[alt="lama"]')?.getAttribute("src")).toBe(LEGACY);
    await act(async () => config.resolve(respond({ google: false, uploadsBaseUrl: "", siteUrl: "https://sakolakembara.org" })));
    await waitFor(() => expect(dom.querySelector('img[alt="lama"]')?.getAttribute("src")).toBe(`https://sakolakembara.org${LEGACY}`));
    expect(articleMarkdown(editor)).toBe(`![lama](${LEGACY})`);
  });

  test("a picture is drawn from the files domain and written down with its path; one copied out of the page comes back as the path", async () => {
    const { api, editor, dom } = await open({ "GET /api/config": respond({ google: false, uploadsBaseUrl: "https://files.example.org", siteUrl: "" }) });
    await waitFor(() => expect(api.count("GET /api/config")).toBe(1));
    await run(async () => void (await new Promise((resolve) => setTimeout(resolve, 30)))); // the answer is in, so the domain is known
    await run(() => void editor.commands.setContent(`![x](${PATH})`, { contentType: "markdown" }));
    await waitFor(() => expect(dom.querySelector('img[alt="x"]')?.getAttribute("src")).toBe(`https://files.example.org${PATH}`));
    expect(articleMarkdown(editor)).toBe(`![x](${PATH})`);
    await run(() => void editor.commands.setContent(`<p><img src="https://files.example.org${PATH}" alt="y"></p>`, { contentType: "html" }));
    expect(articleMarkdown(editor)).toBe(`![y](${PATH})`);
  });
});
