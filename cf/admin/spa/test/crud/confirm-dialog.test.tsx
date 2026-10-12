import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { ConfirmDialog, type ConfirmDialogProps } from "~/components/crud/ConfirmDialog";
import { pressEscapeIn } from "../dialog-shim";

// The native <dialog> is the browser's (top layer, inert page, focus trap: see test/dialog-shim.ts). What is
// proved here is what OUR code does around it: names and roles, where the focus starts and returns, and what
// Escape and the backdrop answer.

function Harness({ onConfirm, onCancel, ...rest }: Partial<ConfirmDialogProps> & { onConfirm?: () => void; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Hapus pengumuman Satu</button>
      <button>Tombol lain</button>
      <ConfirmDialog
        open={open}
        title="Hapus pengumuman?"
        description={<>Pengumuman &ldquo;Satu&rdquo; akan dihapus. Tindakan ini tidak bisa dibatalkan.</>}
        confirmLabel="Hapus"
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          onCancel?.();
          setOpen(false);
        }}
        {...rest}
      />
    </div>
  );
}

const dialog = () => document.querySelector("dialog")!;

describe("ConfirmDialog", () => {
  test("closed it is not in the accessibility tree; open it is an alert dialog named by its title and described by its text", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(dialog().hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Hapus pengumuman Satu"));
    const open = screen.getByRole("alertdialog", { name: "Hapus pengumuman?" });
    expect(open).toBe(dialog());
    expect(open.hasAttribute("open")).toBe(true);
    expect(open.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(open.getAttribute("aria-describedby")!)!.textContent).toBe("Pengumuman “Satu” akan dihapus. Tindakan ini tidak bisa dibatalkan.");
  });

  test("the focus starts on the safe button, not on the destructive one", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Hapus pengumuman Satu"));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Batal" }));
  });

  test("the keyboard reaches both buttons in order (Batal, then Hapus) and Enter on Hapus confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByText("Hapus pengumuman Satu"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Hapus" }));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test("Batal and the title of the page behind: cancel closes and returns the focus to the button that opened it", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const opener = screen.getByText("Hapus pengumuman Satu");
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Batal" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  test("Escape (the browser's `cancel` event) is answered with Batal, and the browser is told not to close it by itself", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const opener = screen.getByText("Hapus pengumuman Satu");
    await user.click(opener);

    let prevented = false;
    act(() => {
      prevented = pressEscapeIn(dialog());
    });
    expect(prevented).toBe(true); // otherwise the browser would close it and the state would still say "open"
    expect(onCancel).toHaveBeenCalledOnce();
    expect(dialog().hasAttribute("open")).toBe(false); // closed by the parent's state
    expect(document.activeElement).toBe(opener);
  });

  test("a click on the backdrop (the dialog element itself) cancels; a click inside does not", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await user.click(screen.getByText("Hapus pengumuman Satu"));

    await user.click(screen.getByText(/akan dihapus/));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(dialog()); // target is the dialog element: that is where a backdrop click lands
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test("while a request is in flight Escape and the backdrop do nothing and the buttons are disabled, with the pending label", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Hapus?" description="x" confirmLabel="Hapus" pending pendingLabel="Menghapus..." onConfirm={() => undefined} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "Menghapus..." })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Batal" })).toHaveProperty("disabled", true);
    expect(pressEscapeIn(dialog())).toBe(true);
    fireEvent.click(dialog());
    await user.click(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog().hasAttribute("open")).toBe(true);
  });

  test("an error from the server is an alert inside the dialog", () => {
    render(<ConfirmDialog open title="Hapus?" description="x" confirmLabel="Hapus" error="Masih dipakai di: Blog." onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toBe("Masih dipakai di: Blog.");
  });

  test("no confirm label leaves only a close button (a delete that cannot be retried)", () => {
    render(<ConfirmDialog open title="Hapus?" description="x" confirmLabel={null} onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("button", { name: "Tutup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hapus" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("destructive is the kit's red button; a plain question is the primary one", () => {
    const { rerender } = render(<ConfirmDialog open title="Hapus?" description="x" confirmLabel="Hapus" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("button", { name: "Hapus" }).className).toContain("bg-red-600");
    rerender(<ConfirmDialog open title="Pindah?" description="x" confirmLabel="Pindah" destructive={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("button", { name: "Pindah" }).className).toContain("bg-primary-blue");
  });

  test("when the button that opened it is gone (a deleted row), the focus goes to the main area instead of nowhere", async () => {
    const user = userEvent.setup();
    function Gone() {
      const [open, setOpen] = useState(false);
      const [row, setRow] = useState(true);
      return (
        <main id="main" tabIndex={-1}>
          {row && <button onClick={() => setOpen(true)}>Hapus baris</button>}
          <ConfirmDialog
            open={open}
            title="Hapus?"
            description="x"
            confirmLabel="Hapus"
            onConfirm={() => {
              setRow(false); // the row disappears together with the dialog
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </main>
      );
    }
    render(<Gone />);
    await user.click(screen.getByText("Hapus baris"));
    await user.click(screen.getByRole("button", { name: "Hapus" }));
    expect(screen.queryByText("Hapus baris")).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  test("unmounting while open closes it (a route change), without a warning", () => {
    const view = render(<ConfirmDialog open title="Hapus?" description="x" confirmLabel="Hapus" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(dialog().hasAttribute("open")).toBe(true);
    view.unmount();
    expect(document.querySelector("dialog")).toBeNull();
  });

  test("a browser without dialog methods still shows it (as a non-modal dialog)", () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: unknown; close?: unknown };
    const { showModal, close } = proto;
    delete proto.showModal;
    delete proto.close;
    try {
      const view = render(<ConfirmDialog open title="Hapus?" description="x" confirmLabel="Hapus" onConfirm={() => undefined} onCancel={() => undefined} />);
      expect(dialog().hasAttribute("open")).toBe(true);
      view.rerender(<ConfirmDialog open={false} title="Hapus?" description="x" confirmLabel="Hapus" onConfirm={() => undefined} onCancel={() => undefined} />);
      expect(dialog().hasAttribute("open")).toBe(false);
    } finally {
      proto.showModal = showModal;
      proto.close = close;
    }
  });
});
