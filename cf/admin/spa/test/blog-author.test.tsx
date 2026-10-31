import type { Editor } from "@tiptap/core";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { API_PATH, AUTHORS_PATH } from "~/pages/blog/form";
import { meBody, renderApp, respond, stubApi } from "./helpers";

// "Penulis" of the blog form (SAKEM-116): a box to choose from the accounts that can write, not a free text. The article
// keeps the name. The Worker's own rule is proved in test/blog.test.ts; what the screen does with it is here.

const WRITER: Parameters<typeof meBody> = ["editor", ["konten"]];
const AUTHORS = ["Ana Super", "Budi Konten", "Tester"];
const LIST = API_PATH;

const article = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  slug: "tulisan-lama",
  title: "Tulisan Lama",
  excerpt: "Ringkasan tentang tulisan lama yang cukup panjang.",
  metaDescription: null,
  seoTitle: null,
  noindex: false,
  contentMarkdown: "## Mulai\n\nIsi tulisan lama yang cukup panjang untuk lolos batas lima puluh karakter.",
  category: "Tips",
  author: "Tim Sakola Kembara",
  featured: false,
  status: "draft",
  date: null,
  image: null,
  imageWidth: null,
  imageHeight: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

async function open(path: string, routes: Parameters<typeof stubApi>[0] = {}, who = WRITER) {
  const api = stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${AUTHORS_PATH}`]: respond({ authors: AUTHORS }), ...routes });
  renderApp(path);
  await screen.findByRole("form");
  await screen.findByLabelText("Isi Artikel");
  return { api, user: userEvent.setup() };
}

const publikasi = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("tab", { name: "Publikasi" }));
const author = () => screen.getByRole("combobox", { name: /^Penulis/ }) as HTMLInputElement;

describe("the author of an article is chosen from the accounts that can write", () => {
  test("a new article starts under the signed-in person's name, and the box offers the accounts", async () => {
    const { api, user } = await open("/blog/new");
    await publikasi(user);
    await waitFor(() => expect(api.count(`GET ${AUTHORS_PATH}`)).toBe(1));
    expect(author().value).toBe("Tester");
    expect(screen.getByText("Pilih dari akun yang terdaftar di admin.")).toBeTruthy();
    await user.click(author());
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent)).toEqual(AUTHORS);
  });

  test("choosing another account is what the save sends", async () => {
    const { api, user } = await open("/blog/new", { [`POST ${LIST}`]: respond({ item: article({ id: "new-id", author: "Budi Konten" }) }, 201), [`GET ${LIST}/new-id`]: respond({ item: article({ id: "new-id", author: "Budi Konten" }) }) });
    await user.type(screen.getByLabelText("Judul"), "Cara Belajar");
    const editor = ((await screen.findByLabelText("Isi Artikel")) as HTMLElement & { editor: Editor }).editor;
    await act(async () => void editor.chain().focus("end").insertContent("Isi artikel yang cukup panjang untuk lolos batas lima puluh karakter.").run());
    await publikasi(user);
    await user.type(screen.getByLabelText(/^Excerpt/), "Ringkasan tentang cara belajar yang efektif.");
    await user.click(author());
    await user.click(await screen.findByRole("option", { name: "Budi Konten" }));
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    await waitFor(() => expect(api.count(`POST ${LIST}`)).toBe(1));
    expect(api.last(`POST ${LIST}`)?.body).toMatchObject({ author: "Budi Konten" });
  });

  test("a name that is not an account cannot be made the value: leaving the box puts the old one back", async () => {
    const { user } = await open("/blog/new");
    await publikasi(user);
    await user.click(author());
    await user.clear(author());
    await user.type(author(), "Orang Asing");
    await user.tab();
    expect(author().value).toBe("Tester");
  });

  test("an article whose author has no account keeps it, offered as an old name; saved unchanged it sends the same name", async () => {
    const { api, user } = await open("/blog/b1/edit", {
      [`GET ${LIST}/b1`]: respond({ item: article() }),
      [`PUT ${LIST}/b1`]: respond({ item: article({ title: "Judul baru", updatedAt: "2026-10-02T00:00:00.000Z" }) }),
    });
    await user.clear(screen.getByLabelText("Judul"));
    await user.type(screen.getByLabelText("Judul"), "Judul baru");
    await publikasi(user);
    expect(author().value).toBe("Tim Sakola Kembara");
    await user.click(author());
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: /Tim Sakola Kembara/ }).textContent).toContain("nama lama");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(api.count(`PUT ${LIST}/b1`)).toBe(1));
    expect(api.last(`PUT ${LIST}/b1`)?.body).toMatchObject({ author: "Tim Sakola Kembara" });
  });

  test("the Worker's refusal is a sentence under the box, the summary links to it and opens its tab, and the box takes the focus", async () => {
    const { user } = await open("/blog/b1/edit", {
      [`GET ${LIST}/b1`]: respond({ item: article() }),
      [`PUT ${LIST}/b1`]: respond({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { author: "Penulis harus akun yang terdaftar di admin" } }, 400),
    });
    await user.type(screen.getByLabelText("Judul"), " ubah");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(document.getElementById("panel-publikasi")!.hasAttribute("hidden")).toBe(false)); // the tab with the first error
    expect(author().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Penulis harus akun yang terdaftar di admin", { selector: "p" })).toBeTruthy();
    await user.click(within(summary).getByRole("link", { name: "Penulis: Penulis harus akun yang terdaftar di admin" }));
    expect(document.activeElement).toBe(author());
  });

  test("if the list cannot be loaded the name can be typed, and the Worker is the one that checks", async () => {
    const { api, user } = await open("/blog/new", { [`GET ${AUTHORS_PATH}`]: respond({ error: "internal" }, 500) });
    await publikasi(user);
    await waitFor(() => expect(api.count(`GET ${AUTHORS_PATH}`)).toBe(1));
    expect(await screen.findByText(/Daftar penulis belum bisa dimuat/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /^Penulis/ })).toBeNull();
    const box = screen.getByLabelText(/^Penulis/) as HTMLInputElement;
    expect(box.tagName).toBe("INPUT");
    await user.clear(box);
    await user.type(box, "Budi Konten");
    expect(box.value).toBe("Budi Konten");
  });

  test("someone who cannot write sees the name and asks for no list", async () => {
    const { api } = await open("/blog/b1/edit", { [`GET ${LIST}/b1`]: respond({ item: article({ author: "Ana Super" }) }) }, ["viewer", []]);
    const box = screen.getByLabelText(/^Penulis/) as HTMLInputElement;
    expect(box.value).toBe("Ana Super");
    expect(box.disabled).toBe(true);
    expect(api.count(`GET ${AUTHORS_PATH}`)).toBe(0);
  });
});
