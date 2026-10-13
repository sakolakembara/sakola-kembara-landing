import { api } from "@shared/spa/api";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SessionState } from "./guard";
import { purgeStaleLocalDrafts, wipeLocalDrafts } from "./local-drafts";
import { type Me, parseMe } from "./me";
import { ENDPOINTS } from "./paths";

// Who is signed in, loaded once per visit to the signed-in area from `GET /portal/api/me`. The sign-in pages sit
// outside this provider: they have nothing to ask the server before the form is sent.

interface SessionValue {
  state: SessionState;
  /** Asks `/portal/api/me` again (the "Coba lagi" of the load-error screen). */
  reload: () => void;
  /** Ends the session on the server and wipes what the browser kept of this student. Resolves true when it worked. */
  signOut: () => Promise<boolean>;
  /** A data call answered 401: the session is gone. Back to the sign-in page, and the local copies go (shared computer). */
  expire: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The student's id, kept after the session ends so what the browser holds for them can still be wiped.
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    // A local copy nobody has touched for 30 days goes whenever the portal opens (docs/cloudflare/portal-architecture.md#73).
    purgeStaleLocalDrafts();
    api<unknown>(ENDPOINTS.me).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const me = parseMe(result.data);
        if (me) lastUserId.current = me.id;
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
      const result = await api(ENDPOINTS.signOut, { method: "POST", json: {} });
      // 401 means there was no session left to end: the goal is reached.
      if (result.ok || result.status === 401) {
        wipeLocalDrafts(lastUserId.current);
        setState({ status: "signed-out", byUser: true });
        return true;
      }
      return false;
    } finally {
      signingOut.current = false;
    }
  }, []);

  const expire = useCallback(() => {
    wipeLocalDrafts(lastUserId.current);
    setState({ status: "signed-out", byUser: false });
  }, []);

  const value = useMemo(() => ({ state, reload, signOut, expire }), [state, reload, signOut, expire]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/** The signed-in student. Only for pages rendered behind `RequireStudent`, which guarantees one. */
export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== "ready") throw new Error("useMe was used before the session was ready");
  return state.me;
}
