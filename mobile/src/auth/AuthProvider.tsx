/**
 * The member's session. Signing in exchanges email and password for a session
 * token (Better Auth's bearer plugin), kept in secure storage. The app opens
 * offline with the last known account so downloads still play.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, setSession } from "../api/client";
import type { Me } from "../api/types";
import { API_URL } from "../config";
import { deleteSecure, getSecure, setSecure } from "../lib/secure";

const TOKEN_KEY = "session-token";
const ME_KEY = "me";

type AuthState =
  | { status: "loading"; me: null }
  | { status: "signedOut"; me: null }
  | { status: "signedIn"; me: Me };

type AuthContextValue = AuthState & {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Fetch the account again (membership may have changed). */
  refresh(): Promise<Me | null>;
  /** Run before the session is cleared on sign-out (downloads use it to delete files). */
  onSignOut(cleanup: () => Promise<void>): () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", me: null });
  const cleanups = useRef(new Set<() => Promise<void>>());

  const runCleanups = useCallback(async () => {
    for (const cleanup of cleanups.current) await cleanup().catch(() => {});
  }, []);

  /** Forget the session here (after a 401 the cleanups' server calls fail quietly; local files still go). */
  const clear = useCallback(async () => {
    await runCleanups();
    setSession(null);
    await Promise.all([deleteSecure(TOKEN_KEY), deleteSecure(ME_KEY)]);
    setState({ status: "signedOut", me: null });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("/api/mobile/v1/me");
      await setSecure(ME_KEY, JSON.stringify(me));
      setState({ status: "signedIn", me });
      return me;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [token, cached] = await Promise.all([getSecure(TOKEN_KEY), getSecure(ME_KEY)]);
      if (!token) return setState({ status: "signedOut", me: null });
      setSession(token, () => void clear());
      if (cached) setState({ status: "signedIn", me: JSON.parse(cached) as Me });
      try {
        await refresh();
      } catch {
        // Offline: carry on with the cached account, or ask to sign in if there is none.
        if (!cached) setState({ status: "signedOut", me: null });
      }
    })();
  }, [clear, refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
      } catch {
        throw new ApiError(0, "offline", "You're offline. Connect to sign in.");
      }
      const token = res.headers.get("set-auth-token");
      if (!res.ok || !token) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, "sign_in_failed", res.status === 401 ? "That email and password don't match." : (data?.message ?? "Couldn't sign in. Please try again."));
      }
      await setSecure(TOKEN_KEY, token);
      setSession(token, () => void clear());
      const me = await refresh();
      if (!me) throw new ApiError(401, "sign_in_failed", "Couldn't sign in. Please try again.");
    },
    [clear, refresh],
  );

  const signOut = useCallback(async () => {
    // Clean up while the token still works (downloads release their licenses), then end the session.
    await runCleanups();
    await api("/api/auth/sign-out", { method: "POST", body: {} }).catch(() => {});
    await clear();
  }, [clear, runCleanups]);

  const onSignOut = useCallback((cleanup: () => Promise<void>) => {
    cleanups.current.add(cleanup);
    return () => void cleanups.current.delete(cleanup);
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut, refresh, onSignOut }), [state, signIn, signOut, refresh, onSignOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}

/** The signed-in account (screens behind sign-in only). */
export function useMe(): Me {
  const auth = useAuth();
  if (auth.status !== "signedIn") throw new Error("useMe while signed out");
  return auth.me;
}
