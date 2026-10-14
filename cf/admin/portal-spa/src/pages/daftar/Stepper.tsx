import { Check, ChevronDown, CircleDot, Lock } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { UI_STEP_LABELS, UI_STEP_ORDER, type UiStepId } from "@shared/application-form/steps";

/**
 * The list of screens (legacy: the sidebar of `_wizard.tsx`): where the student is, how far they have got, and a way back
 * to any screen they have already been to. A screen they have not reached is locked: going forward is "Selanjutnya", which
 * checks and saves the screen they are on.
 *
 * On a phone the list would push the form far down the page, so there it is folded behind one button that says where the
 * student is ("Bagian 3 dari 8"), and opens the list; from `lg` the list is always open beside the form. Every item is a
 * real button in a list: Tab and Enter work, the current one is `aria-current="step"`, and each state has its own icon and
 * its own words (current, done, locked, not saved), never only a colour.
 */
export function Stepper({ screen, visited, unsaved, busy, onJump }: { screen: number; visited: readonly UiStepId[]; unsaved: Record<UiStepId, boolean>; busy: boolean; onJump: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  const total = UI_STEP_ORDER.length;
  // The legacy bar: how far the current screen is from the last one that holds a form (the review is the end).
  const progress = Math.round((screen / (total - 1)) * 100);
  const current = UI_STEP_ORDER[screen] as UiStepId;

  return (
    <nav aria-label="Bagian formulir" className="rounded-2xl border border-gray-100 bg-white p-3 md:p-4">
      <div className="mb-3 px-2">
        <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500">
          <span>
            Bagian {screen + 1} dari {total}
          </span>
          <span className="font-semibold">{progress}%</span>
        </div>
        <div role="progressbar" aria-label="Kemajuan pengisian formulir" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-primary-blue transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls="daftar-bagian"
        onClick={() => setOpen((on) => !on)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-primary-blue hover:bg-gray-50 lg:hidden"
      >
        <span className="min-w-0 truncate">{UI_STEP_LABELS[current]}</span>
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      <ol id="daftar-bagian" className={cn("space-y-1", open ? "mt-1" : "hidden lg:block")}>
        {UI_STEP_ORDER.map((id, index) => {
          const isCurrent = index === screen;
          const isVisited = visited.includes(id);
          const canJump = isVisited || index <= screen;
          return (
            <li key={id}>
              <button
                type="button"
                disabled={!canJump || busy}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => {
                  setOpen(false);
                  onJump(index);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  isCurrent ? "bg-primary-blue/10 font-semibold text-primary-blue" : canJump ? "text-gray-700 hover:bg-gray-50" : "cursor-not-allowed text-gray-500",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isCurrent ? "bg-primary-blue text-white" : isVisited ? "bg-success-bg text-success-fg" : "bg-gray-100 text-gray-500",
                  )}
                >
                  {isCurrent ? <CircleDot size={12} /> : isVisited ? <Check size={12} /> : canJump ? index + 1 : <Lock size={12} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{UI_STEP_LABELS[id]}</span>
                  {unsaved[id] && <span className="block text-[11px] font-medium text-amber-700">Belum disimpan</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
