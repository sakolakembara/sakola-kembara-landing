import {
  Activity,
  CalendarDays,
  ChartColumn,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Link2,
  type LucideIcon,
  Mail,
  Megaphone,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import type { NavIconName } from "~/lib/nav";

const ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  batch: CalendarDays,
  applicants: Users,
  documents: FolderOpen,
  messages: Mail,
  announcements: Megaphone,
  blog: FileText,
  reports: ChartColumn,
  team: UsersRound,
  shortlinks: Link2,
  activity: Activity,
  settings: Settings,
};

/** The icon of a menu entry (lib/nav.ts), decorative: the entry's text is its name. */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" strokeWidth={1.75} className={className} />;
}
