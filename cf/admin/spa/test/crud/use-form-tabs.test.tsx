import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { useFormTabs } from "~/lib/crud/useFormTabs";

// The tabs of a form page (cf/admin/DESIGN.md, "Forms: one bar"), through a bare component: which one is open, and what
// the errors do to it. What the blog and the team form do with it is in test/blog.test.tsx and test/team.test.tsx.

type Tab = "a" | "b";
const tabOf = (name: string): Tab | undefined => (name.startsWith("a") ? "a" : name.startsWith("b") ? "b" : undefined);

function Harness({ fields, failures, onReveal }: { fields: Record<string, string>; failures: number; onReveal?: (field: string) => void }) {
  const { tab, setTab, errorTabs } = useFormTabs<Tab>({ initial: "a", tabOf, fields, failures, onReveal });
  return (
    <>
      <p data-testid="tab">{tab}</p>
      <p data-testid="errors">{[...errorTabs].sort().join(",")}</p>
      <button type="button" onClick={() => setTab("a")}>
        buka a
      </button>
      <a href="#b1">ke b1</a>
      <a href="#zzz">ke zzz</a>
    </>
  );
}

const open = () => screen.getByTestId("tab").textContent;
const marked = () => screen.getByTestId("errors").textContent;

describe("useFormTabs", () => {
  test("it starts on the tab it is given, with no tab marked", () => {
    render(<Harness fields={{}} failures={0} />);
    expect(open()).toBe("a");
    expect(marked()).toBe("");
  });

  test("a refused save opens the tab of the first error, and marks every tab that has one", () => {
    const { rerender } = render(<Harness fields={{}} failures={0} />);
    rerender(<Harness fields={{ b2: "salah", a1: "salah juga" }} failures={1} />);
    expect(open()).toBe("b"); // the first error, not the first tab
    expect(marked()).toBe("a,b");
  });

  test("an error on a field it does not know leaves the tab where it is and marks none", () => {
    const { rerender } = render(<Harness fields={{}} failures={0} />);
    rerender(<Harness fields={{ zzz: "salah" }} failures={1} />);
    expect(open()).toBe("a");
    expect(marked()).toBe("");
  });

  test("the first error is looked at once per refusal: choosing another tab afterwards is not undone by a render", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness fields={{}} failures={0} />);
    rerender(<Harness fields={{ b1: "salah" }} failures={1} />);
    expect(open()).toBe("b");
    await user.click(screen.getByRole("button", { name: "buka a" }));
    rerender(<Harness fields={{ b1: "salah" }} failures={1} />); // the same refusal, rendered again
    expect(open()).toBe("a");
    rerender(<Harness fields={{ b1: "masih salah" }} failures={2} />); // a new refusal
    expect(open()).toBe("b");
  });

  test("a link of the error summary shows its field's tab first, and says which field it is for", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(<Harness fields={{}} failures={0} onReveal={onReveal} />);
    await user.click(screen.getByRole("link", { name: "ke b1" }));
    expect(open()).toBe("b");
    expect(onReveal).toHaveBeenCalledWith("b1");
  });

  test("a link to something it does not know changes nothing", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(<Harness fields={{}} failures={0} onReveal={onReveal} />);
    await user.click(screen.getByRole("link", { name: "ke zzz" }));
    expect(open()).toBe("a");
    expect(onReveal).not.toHaveBeenCalled();
  });

  test("a refusal tells its field to `onReveal` too (the blog's text leaves the preview)", () => {
    const onReveal = vi.fn();
    const { rerender } = render(<Harness fields={{}} failures={0} onReveal={onReveal} />);
    rerender(<Harness fields={{ b1: "salah" }} failures={1} onReveal={onReveal} />);
    expect(onReveal).toHaveBeenCalledWith("b1");
  });
});
