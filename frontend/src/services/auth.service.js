import { api, requestRefresh } from "../lib/apiClient.js";
import { API_BASE } from "../config/index.js";
import { clearAccessToken } from "../lib/tokenStore.js";

/**
 * Social login is a full-page navigation, not an XHR: the browser must follow
 * the provider's redirects and receive the Set-Cookie from our callback.
 */
export const loginUrl = (provider) => `${API_BASE}/auth/${provider}`;

export const startLogin = (provider) => {
  window.location.href = loginUrl(provider);
};

/**
 * Silent login. The httpOnly refresh cookie is sent automatically; we get back
 * a short-lived access token and the current user.
 */
export const refreshSession = () => requestRefresh();

export const getMe = () => api.get("/auth/me").then(({ data }) => data.user);

/** Always resolves, even for an unknown address — the server reveals nothing. */
export const requestEmailCode = (email) => api.post("/auth/email/request", { email });

/** Returns { accessToken, user }, exactly like /auth/refresh. */
export const verifyEmailCode = (email, code) =>
  api.post("/auth/email/verify", { email, code }).then(({ data }) => data);

/** Revokes the whole token family server-side, then drops the in-memory token. */
export async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    clearAccessToken();
  }
}
