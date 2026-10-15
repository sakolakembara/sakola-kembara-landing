import type { Ref } from "react";
import type { SummaryItem } from "~/lib/wizard/summary";

/**
 * Moves focus to the control (or the first control of the group) a line of the summary is about. `data-field` is on the
 * input itself for a text field, and on the box around the options for a group of radios, the list of organisations
 * or a document's file field.
 */
export function focusField(root: ParentNode, key: string): void {
  const marked = root.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!marked) return;
  const target = marked.matches("input, textarea, select, button, [tabindex]") ? marked : marked.querySelector<HTMLElement>("input:not([disabled]), textarea, select, button:not([disabled])");
  (target ?? marked).focus();
}

/**
 * What needs fixing on this screen. It takes focus when it appears (the screen asks, `summaryToken`), so a keyboard or
 * screen reader user lands on it and not on a button they can no longer see; each line is a link that moves focus to its
 * field. The fields carry their own message too: nothing here depends on colour, and the heading says what the box is.
 */
export function ErrorSummary({ title, message, items, onSelect, ref }: { title: string; message: string | null; items: SummaryItem[]; onSelect: (key: string) => void; ref: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="mb-6 rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm leading-relaxed text-danger-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-fg">
      {message && <p className="font-medium">{message}</p>}
      {items.length > 0 && (
        <>
          <p className="font-medium">{title}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {items.map((item) => (
              <li key={item.key}>
                <a
                  href={`#${item.key}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(item.key);
                  }}
                  className="font-semibold underline"
                >
                  {item.label}
                </a>
                : {item.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
