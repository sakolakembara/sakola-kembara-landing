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
      <h2 id="dash-quick" className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Tindakan Cepat
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {actions.map((action) => {
          const Icon = ICONS[action.icon];
          return (
            <Link
              key={action.href}
              to={action.href}
              className="group flex flex-col items-start gap-2 rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all hover:border-primary-blue hover:shadow-sm sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-blue/10 text-primary-blue transition-colors group-hover:bg-primary-blue group-hover:text-white">
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
