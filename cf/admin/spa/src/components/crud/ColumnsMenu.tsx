import { ChevronDown, Columns3 } from "lucide-react";
import { Button, buttonVariants } from "~/components/ui/button";
import type { ColumnChoice } from "~/lib/crud/useColumnChoice";
import { useDisclosure } from "~/lib/use-disclosure";

/**
 * "Kolom": which columns of the list show. A button with a panel of checkboxes under it (`useDisclosure`: Escape,
 * a press outside or Tab out closes it). The first column is not offered, it names the row. Nothing is saved on a
 * server, the choice stays in this browser (`useColumnChoice`). A list with no other column has no button.
 */
export function ColumnsMenu({ choice }: { choice: Pick<ColumnChoice<never>, "options" | "toggle" | "anyHidden" | "showAll"> }) {
  const menu = useDisclosure();
  if (choice.options.length === 0) return null;

  return (
    <div {...menu.rootProps} className="relative">
      {/* The kit's Button does not hand out a ref, and the disclosure needs one to give the focus back. */}
      <button
        ref={menu.trigger}
        type="button"
        onClick={menu.toggle}
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.panelId : undefined}
        className={buttonVariants({ variant: "neutral" })}
      >
        <Columns3 aria-hidden="true" />
        Kolom
        <ChevronDown aria-hidden="true" className="opacity-60" />
      </button>
      {menu.open && (
        <fieldset id={menu.panelId} className="absolute right-0 top-full z-30 mt-2 w-60 min-w-0 rounded-xl border border-border bg-card p-2 shadow-lg">
          <legend className="sr-only">Kolom yang ditampilkan</legend>
          <ul>
            {choice.options.map((option) => (
              <li key={option.key}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                  <input type="checkbox" checked={option.shown} onChange={() => choice.toggle(option.key)} className="size-4 cursor-pointer rounded border-gray-300 accent-primary" />
                  {option.label}
                </label>
              </li>
            ))}
          </ul>
          {choice.anyHidden && (
            <Button variant="ghost" size="sm" fullWidth onClick={choice.showAll} className="mt-1">
              Tampilkan semua
            </Button>
          )}
        </fieldset>
      )}
    </div>
  );
}
