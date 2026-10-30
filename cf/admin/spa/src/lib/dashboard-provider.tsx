import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { onWrite } from "./api";
import { type Dashboard, type NavCount, navCounts } from "./dashboard";
import { type DashboardState, useDashboard } from "./use-dashboard";

// One copy of the dashboard's answer for the whole signed-in shell: the sidebar reads its counts (what waits in
// Pendaftar and Pesan) and the dashboard page reads the tiles, so opening the dashboard asks the Worker once, not
// twice. It asks again when the user comes back to the dashboard and after every write, because a decision or a
// message read changes what waits.

interface SharedDashboard {
  state: DashboardState;
  reload: () => void;
  /** For the sidebar, by menu path. Keeps the last answer while a new one is on its way, so a badge does not blink. */
  counts: Record<string, NavCount>;
}

const SharedDashboardContext = createContext<SharedDashboard | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { state, reload } = useDashboard();
  const { pathname } = useLocation();

  const [seen, setSeen] = useState<Dashboard | null>(() => (state.status === "ready" ? state.data : null));
  useEffect(() => {
    if (state.status === "ready") setSeen(state.data);
  }, [state]);

  useEffect(() => onWrite(reload), [reload]);

  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (pathname === "/") reload();
  }, [pathname, reload]);

  const counts = useMemo(() => navCounts(seen), [seen]);
  const value = useMemo(() => ({ state, reload, counts }), [state, reload, counts]);
  return <SharedDashboardContext.Provider value={value}>{children}</SharedDashboardContext.Provider>;
}

export function useSharedDashboard(): SharedDashboard {
  const value = useContext(SharedDashboardContext);
  if (!value) throw new Error("useSharedDashboard must be used inside the shell's DashboardProvider");
  return value;
}
