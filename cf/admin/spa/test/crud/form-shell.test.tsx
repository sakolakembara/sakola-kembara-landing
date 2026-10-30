import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { Field, Input } from "~/components/ui/field";
import { FormSection, FormShell } from "~/components/crud/FormShell";
import type { ApiResult } from "~/lib/api";
import { useFlash } from "~/lib/crud/flash";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useMutation } from "~/lib/crud/useMutation";
import { deferred, renderAt } from "../helpers";

type Save = (values: { title: string }) => Promise<ApiResult<{ item: { id: string } }>>;

function Form({ onSave, readOnly, onReload, initial = "" }: { onSave: Save; readOnly?: boolean; onReload?: () => void; initial?: string }) {
  const form = useFormValues<{ title: string }>({ title: initial });
  const save = useMutation(onSave);
  const flash = useFlash();
  return (
    <div>
      <FormShell
        title="Pengumuman Baru"
        back={{ href: "/daftar" }}
        save={save}
        dirty={form.dirty}
        onSubmit={() => void save.submit(form.values)}
        onReload={onReload}
        readOnly={readOnly}
        fieldLabels={{ title: "Judul" }}
        flash={flash}
      >
        <FormSection title="Konten" description="Pesan yang muncul di strip pengumuman.">
          <Field label="Judul" id="title" required error={save.fields.title}>
            <Input {...form.field("title")} />
          </Field>
        </FormSection>
      </FormShell>
      <nav>
        <Link to="/lain">ke halaman lain</Link>
      </nav>
    </div>
  );
}

const ok: Save = async () => ({ ok: true, data: { item: { id: "1" } } });
const location = () => screen.getByTestId("location").textContent;
const type = (value: string) => fireEvent.change(screen.getByLabelText(/Judul/), { target: { value } });

describe("FormShell", () => {
  test("a form with a name, one h1, the sections, and the buttons of the bar", () => {
    renderAt(<Form onSave={ok} />, "/baru");
    expect(screen.getByRole("form", { name: "Pengumuman Baru" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Pengumuman Baru" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Konten" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali" }).getAttribute("href")).toBe("/daftar");
    expect(screen.getByRole("link", { name: "Batal" }).getAttribute("href")).toBe("/daftar");
    expect(screen.getByRole("button", { name: "Simpan" })).toBeTruthy();
    expect(document.title).toBe("Pengumuman Baru | Admin Sakola Kembara");
  });

  // jsdom draws no CSS; these check what the CSS works from.
  test("the bar sticks to the top from md only, and on a phone the buttons are a bar at the bottom of the screen", () => {
    renderAt(<Form onSave={ok} />, "/baru");
    const bar = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(bar.className).toContain("md:sticky");
    // A bar that sticks on a phone would take a third of the screen; a blur on it would trap the fixed buttons inside it.
    expect(bar.className.split(" ")).not.toContain("sticky");
    expect(bar.className.split(" ")).not.toContain("backdrop-blur");
    const buttons = screen.getByRole("button", { name: "Simpan" }).parentElement!;
    expect(buttons.className).toContain("max-md:fixed");
    expect(buttons.className).toContain("max-md:bottom-0");
    expect(within(buttons).getByRole("link", { name: "Batal" })).toBeTruthy();
  });

  test("the form leaves room under it for the bottom bar on a phone", () => {
    renderAt(<Form onSave={ok} />, "/baru");
    expect(screen.getByRole("form").querySelector("fieldset")!.parentElement!.className).toContain("pb-28");
  });

  test("Simpan submits, once, however many times it is pressed; the label says it is working", async () => {
    const gate = deferred<ApiResult<{ item: { id: string } }>>();
    const onSave = vi.fn<Save>(() => gate.promise);
    renderAt(<Form onSave={onSave} />, "/baru");
    type("Judul baru");
    const button = screen.getByRole("button", { name: "Simpan" });
    act(() => {
      button.click();
      button.click();
    });
    fireEvent.submit(button.closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ title: "Judul baru" });
    expect(screen.getByRole("button", { name: "Menyimpan..." })).toHaveProperty("disabled", true);
    await act(async () => gate.resolve({ ok: true, data: { item: { id: "1" } } }));
    expect(screen.getByRole("button", { name: "Simpan" })).toHaveProperty("disabled", false);
  });
});

describe("FormShell: what a failed save shows", () => {
  const invalid: Save = async () => ({ ok: false, status: 400, code: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" } });

  test("the field says it, with the red border's `aria-invalid`, and a summary above the form links to it", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={invalid} />, "/baru");
    type("ab");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    const input = await screen.findByLabelText(/Judul/);
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById(input.getAttribute("aria-describedby")!)!.textContent).toBe("Judul minimal 3 karakter");

    const summary = screen.getByRole("alert");
    expect(within(summary).getByText("Periksa kembali isian formulir.")).toBeTruthy();
    const link = within(summary).getByRole("link", { name: "Judul: Judul minimal 3 karakter" });
    expect(link.getAttribute("href")).toBe("#title");
    // The summary takes the focus when it appears: it is read out, and its links are the way to the fields.
    expect(document.activeElement).toBe(summary);

    await user.click(link);
    expect(document.activeElement).toBe(input);
    expect(location()).toBe("/baru"); // no hash navigation
  });

  test("an error that is not about a field is one alert, and a stale save is a warning with 'Muat ulang'", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const { unmount } = renderAt(<Form onSave={async () => ({ ok: false, status: 403, code: "forbidden" })} />, "/baru");
    type("Judul");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Kamu tidak punya izin untuk melakukan ini.");
    unmount();

    renderAt(<Form onSave={async () => ({ ok: false, status: 409, code: "stale" })} onReload={reload} />, "/baru");
    type("Judul");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    const warning = await screen.findByRole("status");
    expect(warning.textContent).toContain("Data ini sudah diubah orang lain sejak kamu membukanya");
    expect(warning.textContent).toContain("Perubahan yang belum disimpan akan hilang");
    await user.click(within(warning).getByRole("button", { name: "Muat ulang" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  test("a failure that came back again moves the focus to the summary again", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={invalid} />, "/baru");
    type("ab");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    const summary = await screen.findByRole("alert");
    expect(document.activeElement).toBe(summary);
    screen.getByLabelText(/Judul/).focus();
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("alert")));
  });
});

describe("FormShell: the unsaved-changes guard", () => {
  test("nothing is asked while nothing was changed", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={ok} />, "/baru");
    await user.click(screen.getByRole("link", { name: "ke halaman lain" }));
    expect(location()).toBe("/lain");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("leaving by a link with unsaved changes asks first; 'Tetap di sini' stays and keeps what was typed", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={ok} />, "/baru");
    type("Belum disimpan");
    await user.click(screen.getByRole("link", { name: "ke halaman lain" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" });
    expect(dialog.textContent).toContain("Perubahan yang belum disimpan akan hilang.");
    expect(location()).toBe("/baru");

    await user.click(within(dialog).getByRole("button", { name: "Tetap di sini" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(location()).toBe("/baru");
    expect((screen.getByLabelText(/Judul/) as HTMLInputElement).value).toBe("Belum disimpan");
  });

  test("'Tinggalkan' lets the navigation through", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={ok} />, "/baru");
    type("Belum disimpan");
    await user.click(screen.getByRole("link", { name: "ke halaman lain" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Tinggalkan" }));
    await waitFor(() => expect(location()).toBe("/lain"));
  });

  test("'Batal' and 'Kembali' are navigations too: they ask", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={ok} />, "/baru");
    type("Belum disimpan");
    await user.click(screen.getByRole("link", { name: "Batal" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(location()).toBe("/baru");
  });

  test("the browser's back button (a history navigation) asks as well", async () => {
    const view = renderAt(<Form onSave={ok} />, "/mulai");
    await act(async () => {
      await view.router.navigate("/baru");
    });
    type("Belum disimpan");
    await act(async () => {
      await view.router.navigate(-1);
    });
    expect(await screen.findByRole("alertdialog", { name: "Tinggalkan halaman?" })).toBeTruthy();
    expect(location()).toBe("/baru");
  });

  test("typing the old value back is not a change: no question", async () => {
    const user = userEvent.setup();
    renderAt(<Form onSave={ok} initial="Awal" />, "/baru");
    type("Lain");
    type("Awal");
    await user.click(screen.getByRole("link", { name: "ke halaman lain" }));
    expect(location()).toBe("/lain");
  });

  test("a save that worked lets the navigation that follows it pass at once (the form has not re-rendered as clean yet)", async () => {
    const view = renderAt(<Form onSave={ok} />, "/baru");
    type("Judul baru");
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await act(async () => {
      // As a page does: submit, then navigate in the same breath when the save answers.
      await Promise.resolve();
      await view.router.navigate("/lain");
    });
    await waitFor(() => expect(location()).toBe("/lain"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("closing or reloading the tab: the browser's own question while unsaved, none otherwise", async () => {
    renderAt(<Form onSave={ok} />, "/baru");
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    type("Belum disimpan");
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(true);
  });

  test("the listener goes when the form does", () => {
    const view = renderAt(<Form onSave={ok} />, "/baru");
    type("Belum disimpan");
    view.unmount();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("FormShell: a role that cannot write", () => {
  test("no Simpan, the fields are disabled, 'Tutup' instead of 'Batal', and a line that says why", () => {
    renderAt(<Form onSave={ok} readOnly initial="Isi" />, "/baru");
    expect(screen.queryByRole("button", { name: "Simpan" })).toBeNull();
    // A control inside a disabled <fieldset> is disabled by the browser (the property of the control itself stays false).
    expect(screen.getByLabelText(/Judul/).matches(":disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Tutup" }).getAttribute("href")).toBe("/daftar");
    expect(screen.queryByRole("link", { name: "Batal" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Kamu hanya bisa melihat data ini");
  });

  test("submitting does nothing, and leaving never asks", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(ok);
    renderAt(<Form onSave={onSave} readOnly initial="Isi" />, "/baru");
    fireEvent.submit(screen.getByRole("form"));
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "ke halaman lain" }));
    expect(location()).toBe("/lain");
  });
});
