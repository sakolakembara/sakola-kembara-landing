import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, Input, Select } from "~/components/ui/field";
import { Tag } from "~/components/ui/tag";
import { renderAt } from "./helpers";

// The admin's copy of the UI kit (cf/admin/DESIGN.md section 4): the same props as the public kit, the look of the polish.

describe("Button", () => {
  test("a button is type=button unless it says otherwise, and primary at the default size", () => {
    render(<Button>Simpan</Button>);
    const button = screen.getByRole("button", { name: "Simpan" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("md:min-h-10");
  });

  test("a phone gets 44 px targets and a desktop 40 px (or 34 px for the small size)", () => {
    render(
      <>
        <Button>Biasa</Button>
        <Button size="sm">Kecil</Button>
        <Button size="lg">Besar</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Biasa" }).className).toMatch(/min-h-11.*md:min-h-10/);
    expect(screen.getByRole("button", { name: "Kecil" }).className).toMatch(/min-h-10.*md:min-h-\[34px\]/);
    expect(screen.getByRole("button", { name: "Besar" }).className).toContain("min-h-11");
  });

  test("the variants are the kit's: neutral is the outline, danger the red one", () => {
    render(
      <>
        <Button variant="neutral">Batal</Button>
        <Button variant="danger">Hapus</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Batal" }).className).toContain("border-input");
    expect(screen.getByRole("button", { name: "Hapus" }).className).toContain("bg-destructive");
  });

  test("an app route is a router link, an outside address opens in a new tab, a file is a plain link", () => {
    renderAt(
      <>
        <Button href="/blog">Blog</Button>
        <Button href="https://sakolakembara.org">Situs</Button>
        <Button href="/laporan/2025.pdf">Laporan</Button>
      </>,
    );
    expect(screen.getByRole("link", { name: "Blog" }).getAttribute("href")).toBe("/blog");
    const outside = screen.getByRole("link", { name: "Situs" });
    expect(outside.getAttribute("target")).toBe("_blank");
    expect(outside.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Laporan" }).getAttribute("target")).toBeNull();
  });
});

describe("Alert", () => {
  test("every tone has an icon next to its words, so the color is not the only signal", () => {
    const { container } = render(
      <>
        <Alert tone="danger">Gagal.</Alert>
        <Alert tone="success">Tersimpan.</Alert>
        <Alert tone="warning">Hati-hati.</Alert>
        <Alert tone="info">Catatan.</Alert>
      </>,
    );
    const icons = container.querySelectorAll("svg[aria-hidden=true]");
    expect(icons).toHaveLength(4);
  });

  test("an error is announced at once, the other tones politely", () => {
    render(
      <>
        <Alert>Gagal.</Alert>
        <Alert tone="info">Catatan.</Alert>
      </>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Gagal.");
    expect(screen.getByRole("status").textContent).toBe("Catatan.");
  });
});

describe("Tag", () => {
  test("a status can carry a dot, which screen readers skip", () => {
    const { container } = render(
      <Tag tone="green" dot>
        Terbit
      </Tag>,
    );
    expect(screen.getByText("Terbit").className).toContain("bg-success-bg");
    expect(container.querySelector("i[aria-hidden=true]")).not.toBeNull();
  });

  test("without dot there is none", () => {
    const { container } = render(<Tag tone="gray">News</Tag>);
    expect(container.querySelector("i")).toBeNull();
  });
});

describe("Field controls", () => {
  test("a select keeps its own arrow and the same height as an input", () => {
    render(
      <Field label="Kategori" id="kategori">
        <Select defaultValue="a">
          <option value="a">A</option>
        </Select>
      </Field>,
    );
    const select = screen.getByLabelText("Kategori") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.style.backgroundImage).toContain("data:image/svg+xml");
    expect(select.className).toContain("appearance-none");
    expect(select.className).toContain("md:h-10");
  });

  test("an error turns the border red and describes the control", () => {
    render(
      <Field label="Judul" id="judul" error="Judul wajib diisi">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Judul");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("aria-invalid:border-danger-fg");
    expect(input.getAttribute("aria-describedby")).toBe("judul-error");
  });

  test("a phone gets 16 px text (no zoom on focus) and a desktop 14 px", () => {
    render(<Input aria-label="Cari" />);
    const input = screen.getByLabelText("Cari");
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("md:text-sm");
  });
});
