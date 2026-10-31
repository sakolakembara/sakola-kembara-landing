import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FormCard, FormColumns } from "~/components/crud/FormShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { SwitchField } from "~/components/ui/switch";
import { API_PATH } from "~/pages/blog/form";
import { meBody, renderApp, respond, stubApi } from "./helpers";

// The frame of an editor page (SAKEM-116, cf/admin/DESIGN.md "Forms: one bar"), through the blog form: one bar (the
// shell's own top bar holds the breadcrumb with the title, the status and the actions), tabs under it that work from the
// keyboard, and, on a phone, a thin bar with the title and the actions at the bottom edge. And the two kit pieces it
// brought: Card and Switch. What the blog form does with them is in test/blog.test.tsx.

const WRITER: Parameters<typeof meBody> = ["editor", ["konten"]];
const item = {
  id: "b1",
  slug: "cara-belajar-efektif",
  title: "Cara Belajar Efektif",
  excerpt: "Ringkasan tentang cara belajar yang efektif untuk siswa.",
  metaDescription: null,
  seoTitle: null,
  noindex: false,
  contentMarkdown: "## Mulai dari jadwal\n\nBuat jadwal belajar harian dan patuhi dengan disiplin. Istirahat itu penting.",
  category: "Tips",
  author: "Dzul",
  featured: false,
  status: "draft",
  date: null,
  image: null,
  imageWidth: null,
  imageHeight: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

async function openEditor(who = WRITER) {
  stubApi({ "GET /api/me": respond(meBody(...who)), [`GET ${API_PATH}/b1`]: respond({ item }), [`GET ${API_PATH}`]: respond({ items: [], page: 1, pageSize: 20, total: 0 }) });
  renderApp("/blog/b1/edit");
  await screen.findByRole("form");
  await waitFor(() => expect((screen.getByLabelText(/^Judul(?! SEO)/) as HTMLInputElement).value).toBe(item.title));
}

const topBar = () => screen.getByRole("navigation", { name: "Breadcrumb" }).closest("header")!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the editor's bar is the shell's top bar", () => {
  test("the breadcrumb ends with the title, the status sits beside it, the actions are on the right, and 'Lihat situs' makes room", async () => {
    await openEditor();
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((crumb) => crumb.textContent)).toEqual(["Konten Situs", "Blog", "Cara Belajar Efektif"]);
    expect(crumbs.getByRole("link", { name: "Blog" }).getAttribute("href")).toBe("/blog"); // the way back
    expect(crumbs.getByText("Cara Belajar Efektif").getAttribute("aria-current")).toBe("page");

    const bar = within(topBar());
    expect(bar.getByText("Draf")).toBeTruthy();
    for (const name of ["Simpan", "Terbitkan"]) expect(bar.getByRole("button", { name })).toBeTruthy();
    expect(bar.getByRole("link", { name: "Batal" }).getAttribute("href")).toBe("/blog");
    expect(bar.queryByRole("link", { name: /Lihat situs/ })).toBeNull();
  });

  test("the page has no bar of its own: its buttons are in the top bar, and the title is a heading only a screen reader gets", async () => {
    await openEditor();
    const page = within(screen.getByRole("main"));
    expect(page.queryByRole("button", { name: "Simpan" })).toBeNull();
    expect(page.queryByRole("button", { name: "Terbitkan" })).toBeNull();
    expect(page.queryByRole("link", { name: "Batal" })).toBeNull();
    expect(page.getByRole("heading", { level: 1, name: "Edit Artikel" }).className).toContain("sr-only");
  });

  test("a save button in the top bar belongs to the form: it submits it, and the fields' own checks run first", async () => {
    const user = userEvent.setup();
    await openEditor();
    const save = within(topBar()).getByRole("button", { name: "Simpan" }) as HTMLButtonElement;
    expect(save.getAttribute("type")).toBe("submit");
    expect(save.form).toBe(screen.getByRole("form"));
    // The title is required: with it emptied the browser refuses before the form is asked to save.
    await user.clear(screen.getByLabelText(/^Judul(?! SEO)/));
    await user.click(save);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("leaving the page takes its crumb and its buttons away, and the link to the site comes back", async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(within(topBar()).getByRole("link", { name: "Batal" }));
    await screen.findByRole("heading", { level: 1, name: "Blog" });
    const bar = within(topBar());
    expect(bar.queryByRole("button", { name: "Simpan" })).toBeNull();
    expect(bar.queryByText("Draf")).toBeNull();
    expect(bar.getByRole("link", { name: /Lihat situs/ })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).queryByText("Cara Belajar Efektif")).toBeNull();
  });
});

describe("on a phone", () => {
  function phone() {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
  }

  test("the shell's bar is left alone; the page draws a thin bar (back arrow, title, status) and its buttons at the bottom edge", async () => {
    phone();
    await openEditor();
    const page = within(screen.getByRole("main"));
    const back = page.getByRole("link", { name: "Kembali ke daftar artikel" });
    expect(back.getAttribute("href")).toBe("/blog");
    const thin = within(back.parentElement!);
    expect(thin.getByText("Cara Belajar Efektif")).toBeTruthy();
    expect(thin.getByText("Draf")).toBeTruthy();
    for (const name of ["Simpan", "Terbitkan"]) expect(page.getByRole("button", { name })).toBeTruthy();
    expect(within(topBar()).queryByRole("button", { name: "Simpan" })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).queryByText("Cara Belajar Efektif")).toBeNull();
  });
});

describe("the tabs", () => {
  const tab = (name: string) => screen.getByRole("tab", { name });

  test("only the selected tab is in the tab order, and each names the panel it controls", async () => {
    await openEditor();
    const tabs = within(screen.getByRole("tablist", { name: "Bagian editor" })).getAllByRole("tab");
    expect(tabs.map((each) => [each.textContent, each.getAttribute("aria-selected"), each.tabIndex])).toEqual([
      ["Konten", "true", 0],
      ["Publikasi", "false", -1],
      ["SEO", "false", -1],
    ]);
    for (const each of tabs) expect(document.getElementById(each.getAttribute("aria-controls")!)?.getAttribute("aria-labelledby")).toBe(each.id);
  });

  test("the arrow keys, Home and End move between them, wrapping, and the focus goes with the selection", async () => {
    const user = userEvent.setup();
    await openEditor();
    tab("Konten").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("Publikasi"));
    expect(tab("Publikasi").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("panel-publikasi")!.hasAttribute("hidden")).toBe(false);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tab("SEO"));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("Konten")); // wraps
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tab("SEO")); // and back
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tab("Konten"));
    expect(document.getElementById("panel-seo")!.hasAttribute("hidden")).toBe(true);
  });
});

describe("Card", () => {
  test("a titled box: the title is an h2 unless it says h3, and the description and the content follow", () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Informasi Dasar</CardTitle>
            <CardDescription>Judul dan ringkasan.</CardDescription>
          </CardHeader>
          <CardContent>isi</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h3">Bagian kecil</CardTitle>
          </CardHeader>
        </Card>
      </>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Informasi Dasar" }).closest("[data-slot='card']")?.textContent).toContain("Judul dan ringkasan.isi");
    expect(screen.getByRole("heading", { level: 3, name: "Bagian kecil" })).toBeTruthy();
  });
});

describe("FormCard and FormColumns (the one-page forms, SAKEM-119)", () => {
  test("FormCard is a Card: the title is an h2, the description is there only when it was given, and the fields follow", () => {
    const { rerender } = render(
      <FormCard title="Alamat pendek" description="Bagian setelah nama domain.">
        <input aria-label="Slug" />
      </FormCard>,
    );
    const card = screen.getByRole("heading", { level: 2, name: "Alamat pendek" }).closest("[data-slot='card']")!;
    expect(card.textContent).toContain("Bagian setelah nama domain.");
    expect(card.contains(screen.getByLabelText("Slug"))).toBe(true);
    rerender(
      <FormCard title="Status">
        <input aria-label="Aktif" />
      </FormCard>,
    );
    expect(document.querySelector("[data-slot='card-description']")).toBeNull();
  });

  test("with a side column the cards of the form come first and the side column is the second, 340 px wide from lg; without one there is a single column", () => {
    const { container, rerender } = render(
      <FormColumns aside={<p>samping</p>}>
        <p>utama</p>
      </FormColumns>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(Array.from(grid.children).map((column) => column.textContent)).toEqual(["utama", "samping"]);
    expect(grid.className).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
    expect(grid.className).not.toMatch(/max-w-/); // as wide as the window: a cap left a wide window empty at the right

    rerender(
      <FormColumns>
        <p>utama</p>
      </FormColumns>,
    );
    const single = container.firstElementChild as HTMLElement;
    expect(single.children).toHaveLength(1);
    expect(single.className).not.toContain("lg:grid-cols");
  });
});

describe("SwitchField", () => {
  test("a row with a switch: the label and its description name it, pressing the row flips it, and the value is a boolean", async () => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    render(<SwitchField id="featured" name="featured" label="Featured" description="Tampilkan sebagai artikel unggulan." checked={false} onChange={(event) => seen.push(event.target.checked)} />);
    const control = screen.getByRole("switch", { name: /Featured/ });
    expect(control.getAttribute("id")).toBe("featured");
    expect(control.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toBe("Tampilkan sebagai artikel unggulan.");
    await user.click(screen.getByText("Tampilkan sebagai artikel unggulan.")); // the whole row is pressable
    expect(seen).toEqual([true]);
  });

  test("a refusal is read with the control in place of the description, and the control is marked invalid", () => {
    render(<SwitchField id="noindex" label="Sembunyikan dari Google" description="Tidak masuk hasil pencarian." error="Nilai tidak sah" checked onChange={() => {}} />);
    const control = screen.getByRole("switch", { name: /Sembunyikan dari Google/ });
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toBe("Nilai tidak sah");
  });

  test("a disabled one cannot be pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchField id="featured" label="Featured" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByText("Featured"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
