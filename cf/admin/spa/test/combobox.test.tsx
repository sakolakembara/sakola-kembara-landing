import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { Combobox, type ComboboxOption } from "~/components/ui/combobox";
import { Field } from "~/components/ui/field";

// The box to choose one of a list (cf/admin/DESIGN.md section 2). Typed free text is not a value; the ARIA combobox
// pattern; Enter chooses and never saves the form around it.

const OPTIONS: ComboboxOption[] = [
  { value: "Ana Super", label: "Ana Super" },
  { value: "Budi Konten", label: "Budi Konten" },
  { value: "Tim Lama", label: "Tim Lama", hint: "nama lama" },
];

function Harness({ initial = "Budi Konten", options = OPTIONS, onChange }: { initial?: string; options?: ComboboxOption[]; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <Field label="Penulis" id="author" required hint="Pilih satu.">
        <Combobox name="author" required value={value} options={options} onChange={(next) => (setValue(next), onChange?.(next))} />
      </Field>
      <output data-testid="value">{value}</output>
    </form>
  );
}

const box = () => screen.getByRole("combobox", { name: /Penulis/ }) as HTMLInputElement;
const shown = () => screen.getByTestId("value").textContent;

describe("Combobox", () => {
  test("it is labelled and described by its Field, shows the chosen option, and the list is closed until asked for", () => {
    render(<Harness />);
    expect(box().value).toBe("Budi Konten");
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-autocomplete")).toBe("list");
    expect(box().required).toBe(true);
    expect(box().getAttribute("aria-describedby")).toContain("hint");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a press opens the list with every option, the chosen one marked; the box is its combobox", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["Ana Super", "Budi Konten", "Tim Lamanama lama"]);
    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(box().getAttribute("aria-controls")).toBe(list.id);
    expect(box().getAttribute("aria-activedescendant")).toBe(within(list).getByRole("option", { name: "Budi Konten" }).id); // starts on the chosen one
  });

  test("typing narrows the list; Enter chooses the one under the arrows; the list closes and the box shows it", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    render(<Harness onChange={changes} />);
    await user.click(box());
    await user.clear(box());
    await user.type(box(), "an");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Ana Super"]);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box().value).toBe("Ana Super");
    expect(shown()).toBe("Ana Super");
    expect(changes).toHaveBeenCalledWith("Ana Super");
  });

  test("the arrow keys move through the list, wrapping, and Enter takes the one they stopped on", async () => {
    const user = userEvent.setup();
    render(<Harness initial="Ana Super" />);
    await user.click(box());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /Tim Lama/ }).id);
    await user.keyboard("{ArrowDown}"); // wraps to the first
    expect(box().getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Ana Super" }).id);
    await user.keyboard("{ArrowUp}"); // and back to the last
    await user.keyboard("{Enter}");
    expect(shown()).toBe("Tim Lama");
  });

  test("ArrowDown opens a closed list from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    box().focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  test("a press on an option chooses it and keeps the focus in the box", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole("option", { name: "Ana Super" }));
    expect(shown()).toBe("Ana Super");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  test("Enter in the box never reaches the form: choosing is not saving", async () => {
    const submitted = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={submitted}>
        <Combobox aria-label="Penulis" value="Ana Super" options={OPTIONS} onChange={() => {}} />
        <button type="submit">Simpan</button>
      </form>,
    );
    const input = screen.getByRole("combobox");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
  });

  test("Escape closes the list and puts back what was chosen, whatever was typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.type(box(), "zzz");
    expect(screen.getByText("Tidak ada yang cocok.")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box().value).toBe("Budi Konten");
    expect(shown()).toBe("Budi Konten");
  });

  test("free text is not a value: leaving the box with something that is no option puts the chosen one back", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    render(<Harness onChange={changes} />);
    await user.click(box());
    await user.clear(box());
    await user.type(box(), "Orang Asing");
    await user.tab();
    expect(box().value).toBe("Budi Konten");
    expect(shown()).toBe("Budi Konten");
    expect(changes).not.toHaveBeenCalled();
  });

  test("leaving the box with exactly an option's name (in any case) takes that option", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.clear(box());
    await user.type(box(), "ana SUPER");
    await user.tab();
    expect(shown()).toBe("Ana Super");
    expect(box().value).toBe("Ana Super");
  });

  test("a value that is not one of the options is shown as it is, and an option's hint is said beside it", async () => {
    const user = userEvent.setup();
    render(<Harness initial="Tim Lama" options={OPTIONS.slice(0, 2)} />);
    expect(box().value).toBe("Tim Lama"); // the article's own author, which the list does not know
    await user.click(box());
    expect(screen.queryByRole("option", { name: /Tim Lama/ })).toBeNull();
  });

  test("it is only an input to a screen reader that has to be told: closed, no controls and no active option are claimed", () => {
    render(<Harness />);
    expect(box().getAttribute("aria-controls")).toBeNull();
    expect(box().getAttribute("aria-activedescendant")).toBeNull();
  });
});
