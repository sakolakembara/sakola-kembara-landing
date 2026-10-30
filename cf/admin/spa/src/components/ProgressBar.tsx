import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { onActivity, requestsInFlight } from "~/lib/api";

const busyNow = () => requestsInFlight() > 0;

/**
 * A thin bar along the top of the window that slides while any call to the API is waiting for its answer: a page's
 * data, a list asked for again behind rows that are already on screen, a save. It fades in after 200 ms, so an
 * answer that comes at once shows nothing, and the fade is CSS, so no timer has to be kept in step with the calls.
 * Yellow, because it has to show on the dark sidebar and top bar as well as on the page.
 *
 * Decorative: the places that load say so themselves (`role="status"` text, `aria-busy`), and `data-busy` is for the tests.
 */
export function ProgressBar() {
  const busy = useSyncExternalStore(onActivity, busyNow, () => false);
  return (
    <div
      aria-hidden="true"
      data-busy={busy}
      className={cn("pointer-events-none fixed inset-x-0 top-0 z-[60] h-1 overflow-hidden transition-opacity duration-300", busy ? "opacity-100 delay-200" : "opacity-0")}
    >
      <div className={cn("h-full w-2/5 rounded-full bg-secondary-yellow", busy && "animate-progress-slide motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-70")} />
    </div>
  );
}
