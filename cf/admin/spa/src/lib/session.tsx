import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { SessionState } from "./guard";
import { type Me, parseMe } from "./me";

// Who is signed in, loaded once per visit to the signed-in area from
// `GET /api/me`. The sign-in pages sit outside this provider: they have
// nothing to ask the server before the form is sent.

interface SessionValue {
  state: SessionState;
  /** Asks `/api/me` again (the "Coba lagi" of the load-error screen). */
  reload: () => void;
  /** Ends the session on the server. Resolves true when it worked. */
  signOut: () => Promise<boolean>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api<unknown>("/api/me").then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const me = parseMe(result.data);
        setState(me ? { status: "ready", me } : { status: "error" });
      } else if (result.status === 401) {
        setState({ status: "signed-out", byUser: false });
      } else {
        // Offline or a server error: say so, do not pretend the user signed out.
        setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const signingOut = useRef(false);
  const signOut = useCallback(async () => {
    if (signingOut.current) return false;
    signingOut.current = true;
    try {
      const result = await api("/api/auth/sign-out", { method: "POST", json: {} });
      // 401 means there was no session left to end: the goal is reached.
      if (result.ok || result.status === 401) {
        setState({ status: "signed-out", byUser: true });
        return true;
      }
      return false;
    } finally {
      signingOut.current = false;
    }
  }, []);

  const value = useMemo(() => ({ state, reload, signOut }), [state, reload, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/** The signed-in user. Only for pages rendered behind `RequireAuth`, which guarantees one. */
export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== "ready") throw new Error("useMe was used before the session was ready");
  return state.me;
}
