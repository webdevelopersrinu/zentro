// ThunderID auth helper (frontend side).
//
// Flow: user clicks a social button -> full-page redirect to the backend
// (`API_BASE/auth/google`) -> provider login -> backend redirects back to
// `/auth/success?token=<JWT>`. We capture that token, store it, and decode it
// to know who the user is. The same token is sent on every API call and in the
// Socket.IO handshake.

// Base URL of the backend API.
//   dev:  http://localhost:4000/api   (set via frontend .env -> VITE_API_URL)
//   prod: /api                        (same domain: zentro.srinudesetti.in/api)
export const API_BASE = import.meta.env.VITE_API_URL || "/api";

const TOKEN_KEY = "zentro_token";

// Decode the payload half of a JWT (no verification — the server already
// verifies on every request; this is just to read name/avatar for display).
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

// Returns { id, username, name, avatarUrl } or null. Also treats an expired
// token as logged-out.
export function getUser() {
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    logout();
    return null;
  }
  return {
    id: payload.id,
    username: payload.username,
    name: payload.name || payload.username,
    avatarUrl: payload.avatarUrl || "",
  };
}

export function isAuthenticated() {
  return !!getUser();
}

// Where each social button sends the browser (full-page navigation).
export const loginUrls = {
  google: `${API_BASE}/auth/google`,
  github: `${API_BASE}/auth/github`,
};

// Called on app load: if the backend just redirected us back with a token in
// the URL, store it and clean the address bar. Returns true if we captured one.
export function captureTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    setToken(token);
    window.history.replaceState({}, document.title, "/");
    return true;
  }
  return false;
}

// Handy wrapper so API calls always carry the token.
export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
