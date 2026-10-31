import { X } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cn } from "@/lib/cn";
import type { NavCount } from "~/lib/dashboard";
import type { Me } from "~/lib/me";
import type { VisibleNavGroup } from "~/lib/nav";
import { NavIcon } from "./NavIcon";
import { UserMenu } from "./UserMenu";

/** The number on a menu entry: "99+" above 99, and the real count in words for a screen reader. */
function CountBadge({ count, what, collapsed }: NavCount & { collapsed: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-white/18 font-bold text-white",
          collapsed ? "absolute right-1 top-0.5 h-4 min-w-4 px-1 text-[10px]" : "ml-auto h-5 min-w-[22px] px-1.5 text-xs",
        )}
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">
        , {count} {what}
      </span>
    </>
  );
}

/** The mark and the name at the top of the sidebar (and of the skeleton that stands in for it); `children` is the drawer's close button. */
export function SidebarBrand({ collapsed = false, children }: { collapsed?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-4 pb-3.5", collapsed && "justify-center px-0")}>
      <div
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-[13px] font-bold text-sidebar-primary-foreground"
      >
        SK
      </div>
      <div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
        <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">Sakola Kembara</p>
        <p className="text-xs text-white/70">Admin</p>
      </div>
      {children}
    </div>
  );
}

/**
 * What the sidebar and the mobile drawer both show (cf/admin/DESIGN.md, "Shell"): the brand, the menu for this user
 * with an icon for each entry and a count where something waits, and the user menu. `collapsed` is the 72 px icon rail
 * of the desktop sidebar: the text stays in the page for screen readers and becomes a tooltip; the drawer is never
 * collapsed. The groups are new; the menu markup follows the legacy sidebar (app/(admin)/admin/_sidebar.tsx).
 */
export function SidebarBody({
  me,
  groups,
  counts,
  collapsed = false,
  onSignOut,
  signingOut,
  signOutError,
  onNavigate,
  onClose,
}: {
  me: Pick<Me, "name" | "email" | "role">;
  groups: VisibleNavGroup[];
  /** By menu path (lib/dashboard.ts, `navCounts`). */
  counts: Record<string, NavCount>;
  collapsed?: boolean;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: boolean;
  /** Called when a menu link is followed (the drawer closes). */
  onNavigate?: () => void;
  /** Present in the drawer: shows the close button. */
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col py-5">
      <SidebarBrand collapsed={collapsed}>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup menu"
            className="-mr-2 flex size-11 items-center justify-center rounded-lg text-white/70 transition-colors hover:text-white"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </SidebarBrand>

      {/* A thin scrollbar in the sidebar's own tones: the default light track looks like a hole in the navy. */}
      <nav
        aria-label="Menu utama"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 text-sm [scrollbar-color:rgb(255_255_255/0.3)_transparent] [scrollbar-width:thin]"
      >
        {groups.map((group, index) => {
          const headingId = `nav-${group.id}`;
          return (
            <div key={group.id}>
              {group.label && (
                // On the rail the label is only for screen readers; a line sets the groups apart instead.
                <>
                  {collapsed && index > 0 && <div aria-hidden="true" className="mx-3 mb-3 mt-4 h-px bg-sidebar-border" />}
                  <p
                    id={headingId}
                    className={cn("mx-3 mb-1.5 mt-5 text-xs font-semibold text-white/70", collapsed && "sr-only")}
                  >
                    {group.label}
                  </p>
                </>
              )}
              <ul role="list" aria-labelledby={group.label ? headingId : undefined} className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const badge = counts[item.path];
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        end={item.path === "/"}
                        onClick={onNavigate}
                        title={collapsed ? (badge ? `${item.label} (${badge.count} ${badge.what})` : item.label) : undefined}
                        className={({ isActive }) =>
                          cn(
                            "relative flex h-11 items-center gap-3 rounded-lg px-3 font-medium transition-colors md:h-10",
                            collapsed && "justify-center px-0",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-[3px] before:bg-sidebar-primary"
                              : "text-sidebar-foreground hover:bg-white/8 hover:text-white",
                          )
                        }
                      >
                        <NavIcon name={item.icon} className="size-[18px] shrink-0" />
                        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                        {badge && <CountBadge {...badge} collapsed={collapsed} />}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="mt-3 border-t border-sidebar-border px-3 pt-3">
        <UserMenu me={me} collapsed={collapsed} onSignOut={onSignOut} signingOut={signingOut} signOutError={signOutError} />
      </div>
    </div>
  );
}
