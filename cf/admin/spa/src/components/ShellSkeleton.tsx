import { LoaderCircle } from "lucide-react";
import { readSidebarCollapsed } from "~/lib/sidebar-state";
import { asideClass, FRAME_CLASS, HEADER_CLASS, MOBILE_BAR_CLASS, MobileBrand } from "./shell-parts";
import { SidebarBrand } from "./Sidebar";

/**
 * The signed-in frame with nothing in it yet, shown while `GET /api/me` is on its way: the navy sidebar (as wide as the
 * person left it, 248 or 72 px) with the brand, the top bar, and the spinner in the middle. The menu, the breadcrumb and
 * the page fill in when the session answers, instead of a grey screen being replaced by the whole shell at once. The
 * frame is drawn before this, from the first byte of the page, by `spa/index.html` (`#boot`); the parts both draw are
 * in `shell-parts.tsx`. Only the spinner is for assistive technology: the frame is decoration.
 */
export function ShellSkeleton() {
  const collapsed = readSidebarCollapsed();
  return (
    <div className={FRAME_CLASS}>
      <div aria-hidden="true" className={MOBILE_BAR_CLASS}>
        <MobileBrand />
        {/* Where the menu button will be. */}
        <span className="-mr-3 size-11" />
      </div>
      <aside aria-hidden="true" className={asideClass(collapsed)}>
        <div className="flex h-full min-h-0 flex-col py-5">
          <SidebarBrand collapsed={collapsed} />
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header aria-hidden="true" className={HEADER_CLASS} />
        {/* Not <main>: the page's own landmark comes with the shell, and one that is replaced a moment later would only be announced twice. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">
          <p role="status" className="flex items-center gap-2 text-sm text-gray-500">
            <LoaderCircle size={18} aria-hidden="true" className="animate-spin text-primary-blue motion-reduce:animate-none" />
            Memuat…
          </p>
        </div>
      </div>
    </div>
  );
}
