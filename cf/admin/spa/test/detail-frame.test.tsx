import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import { Breadcrumb } from "~/components/Breadcrumb";
import { DetailShell } from "~/components/crud/DetailShell";
import { FormColumns } from "~/components/crud/FormShell";
import { PageBar } from "~/components/crud/PageBar";
import { ChromeSlot, PageChromeProvider } from "~/lib/page-chrome";

// The frame of a page that shows one thing (SAKEM-119, pattern 3; cf/admin/DESIGN.md "Detail pages"), without the shell:
// the bar then draws its phone version, which is what a phone gets. What the three pages put in it (the applicant, the
// batch, the message) is in their own tests; here is what the frame itself promises.

const inRouter = (node: ReactNode) => <MemoryRouter>{node}</MemoryRouter>;

describe("DetailShell", () => {
  test("a thin bar with the arrow back, the name and the status, the line under it, and the actions at the bottom edge", () => {
    render(
      inRouter(
        <DetailShell
          title="Siti Contoh"
          back={{ href: "/applications?batch=b1", label: "Kembali ke daftar" }}
          status={<span>Dalam Review</span>}
          actions={<button type="button">Balas lewat email</button>}
          meta={<span>siti@contoh.test</span>}
        >
          <p>isi</p>
        </DetailShell>,
      ),
    );
    const back = screen.getByRole("link", { name: "Kembali ke daftar" });
    expect(back.getAttribute("href")).toBe("/applications?batch=b1");
    const thin = within(back.parentElement!);
    expect(thin.getByText("Siti Contoh")).toBeTruthy();
    expect(thin.getByText("Dalam Review")).toBeTruthy();
    expect(screen.getByText("siti@contoh.test")).toBeTruthy();
    const edge = screen.getByRole("button", { name: "Balas lewat email" }).parentElement!;
    expect(edge.className).toContain("fixed");
    expect(edge.className).toContain("bottom-0");
  });

  test("the title is a heading only a screen reader gets, and the tab's title unless another is given", () => {
    render(
      inRouter(
        <DetailShell title="Ayu Contoh" documentTitle="Detail Pesan" back={{ href: "/messages" }}>
          <p>isi</p>
        </DetailShell>,
      ),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ayu Contoh" }).className).toContain("sr-only");
    expect(document.title).toBe("Detail Pesan | Admin Sakola Kembara");
  });

  test("a page with no actions draws no bar at the bottom and keeps no room for one", () => {
    const { container } = render(
      inRouter(
        <DetailShell title="Siti Contoh" back={{ href: "/applications" }}>
          <p>isi</p>
        </DetailShell>,
      ),
    );
    expect(container.querySelector(".fixed")).toBeNull();
    expect(screen.getByText("isi").closest("div[class*='px-4']")!.className).not.toContain("pb-28");
  });

  test("a page with actions keeps room under its content for the bar at the bottom", () => {
    render(
      inRouter(
        <DetailShell title="Gen 7" back={{ href: "/batches" }} actions={<button type="button">Ubah Data</button>}>
          <p>isi</p>
        </DetailShell>,
      ),
    );
    expect(screen.getByText("isi").closest("div[class*='px-4']")!.className).toContain("pb-28");
  });

  test("the column of decisions stays in view while the facts scroll, from the wide layout up", () => {
    render(
      inRouter(
        <DetailShell title="Gen 7" back={{ href: "/batches" }} aside={<p>keputusan</p>}>
          <p>fakta</p>
        </DetailShell>,
      ),
    );
    const side = screen.getByText("keputusan").parentElement!;
    expect(side.className).toContain("lg:sticky");
    expect(screen.getByText("fakta").parentElement!.className).not.toContain("sticky");
  });

  test("a form's side column is not sticky: only a detail page's decisions are", () => {
    render(
      <FormColumns aside={<p>status</p>}>
        <p>kartu</p>
      </FormColumns>,
    );
    expect(screen.getByText("status").parentElement!.className).not.toContain("sticky");
  });
});

// What a page tells the bar (its name, where the list's step leads) is only for as long as the page is open. The next page
// below the same list may not draw a bar of its own (a page that is not on the frame yet), and must not inherit it.
describe("what a page puts in the shell's bar", () => {
  function Harness({ open }: { open: boolean }) {
    return (
      <MemoryRouter initialEntries={["/applications/a1"]}>
        <PageChromeProvider>
          <Breadcrumb />
          <ChromeSlot slot="leading" />
          <ChromeSlot slot="actions" />
          {open && <PageBar title="Siti Contoh" back={{ href: "/applications?batch=b1" }} crumbHref="/applications?batch=b1" actions={<button type="button">Balas</button>} />}
        </PageChromeProvider>
      </MemoryRouter>
    );
  }

  test("the name and the list's address are gone when the page is", async () => {
    const { rerender } = render(<Harness open />);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(within(crumbs).getByRole("link", { name: "Pendaftar" }).getAttribute("href")).toBe("/applications?batch=b1"));
    expect(within(crumbs).getByText("Siti Contoh")).toBeTruthy();

    rerender(<Harness open={false} />);
    await waitFor(() => expect(within(crumbs).queryByText("Siti Contoh")).toBeNull());
    expect(within(crumbs).getByRole("link", { name: "Pendaftar" }).getAttribute("href")).toBe("/applications");
  });
});
