import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import * as authService from "../services/auth.service.js";
import { onSessionExpired } from "../lib/apiClient.js";
import { setAccessToken } from "../lib/tokenStore.js";

const AuthContext = createContext(null);

const STATUS = { LOADING: "loading", AUTHENTICATED: "authenticated", ANONYMOUS: "anonymous" };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(STATUS.LOADING);

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus(STATUS.ANONYMOUS);
  }, []);

  /**
   * Silent login on boot. There is no token in the URL and none in storage —
   * the httpOnly refresh cookie is the only thing that survived the reload, and
   * only the browser can see it.
   */
  useEffect(() => {
    let cancelled = false;

    authService
      .refreshSession()
      .then(({ user: me }) => {
        if (cancelled) return;
        setUser(me);
        setStatus(STATUS.AUTHENTICATED);
      })
      .catch(() => {
        if (!cancelled) setStatus(STATUS.ANONYMOUS);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** The axios interceptor calls this when a refresh finally fails. */
  useEffect(() => onSessionExpired(endSession), [endSession]);

  const logout = useCallback(async () => {
    await authService.logout().catch(() => {});
    endSession();
  }, [endSession]);

  /** Email login already returned the tokens — no redirect, no refresh call. */
  const completeLogin = useCallback(({ accessToken, user: me }) => {
    setAccessToken(accessToken);
    setUser(me);
    setStatus(STATUS.AUTHENTICATED);
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === STATUS.AUTHENTICATED,
      isLoading: status === STATUS.LOADING,
      login: authService.startLogin,
      completeLogin,
      logout,
    }),
    [user, status, completeLogin, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
