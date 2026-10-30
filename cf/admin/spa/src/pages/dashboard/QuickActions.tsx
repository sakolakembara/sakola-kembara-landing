import { FilePlus2, Megaphone, PenSquare, UserPlus } from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import type { Me } from "~/lib/me";
import { type QuickAction, visibleQuickActions } from "~/lib/nav";

const ICONS: Record<QuickAction["icon"], ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>> = {
  blog: PenSquare,
  announcement: Megaphone,
  report: FilePlus2,
  team: UserPlus,
};

/**
 * "Tindakan Cepat": shortcuts that start something new. Each needs write
 * access to its area, so a viewer (and an editor without the area) sees none,
 * and the whole block is left out when nothing is left.
 */
export function QuickActions({ me }: { me: Pick<Me, "role" | "areas"> }) {
  const actions = visibleQuickActions(me);
  if (actions.length === 0) return null;
  return (
    <section aria-labelledby="dash-quick" className="mb-8">
      <h2 id="dash-quick" className="mb-3.5 text-base font-semibold tracking-tight text-gray-900">
        Tindakan Cepat
      </h2>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {actions.map((action) => {
          const Icon = ICONS[action.icon];
          return (
            <Link
              key={action.href}
              to={action.href}
              className="group flex items-center gap-3.5 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-light-blue hover:bg-white"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-gray-900">{action.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
