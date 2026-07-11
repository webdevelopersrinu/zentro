/**
 * Base URL of the backend API.
 *   dev:  http://localhost:4000/api   (frontend/.env → VITE_API_URL)
 *   prod: /api                        (same origin, proxied by Nginx)
 */
export const API_BASE = import.meta.env.VITE_API_URL || "/api";

/** Socket.IO connects to the server ORIGIN, not the /api path. */
export const SOCKET_URL =
  API_BASE.replace(/\/api\/?$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

export const ROOM_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  PRIVATE: "private",
});

/** Mirrors backend/src/constants/index.js — keep the two in sync. */
export const SOCKET_EVENTS = Object.freeze({
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  MESSAGE_SEND: "message:send",
  MESSAGE_EDIT: "message:edit",
  MESSAGE_DELETE: "message:delete",
  MESSAGE_REACT: "message:react",
  TYPING: "typing",

  READY: "ready",
  MESSAGE_NEW: "message:new",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",
  PRESENCE_JOINED: "presence:joined",
  PRESENCE_LEFT: "presence:left",
  REQUEST_NEW: "request:new",
  REQUEST_APPROVED: "request:approved",
  REQUEST_REJECTED: "request:rejected",
  ROOM_INVITED: "room:invited",
  ROOM_DELETED: "room:deleted",
  ROOM_READ: "room:read",
  ROOM_ADMIN_CHANGED: "room:admin",
});

/** Mirrors MESSAGE_EDIT_WINDOW_MS. The server enforces it; the UI only hides. */
export const MESSAGE_EDIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * The one-tap row in the picker, not a whitelist: the server accepts any single
 * emoji, and "+" opens the full set.
 */
export const REACTION_EMOJIS = Object.freeze(["👍", "❤️", "😂", "🎉", "👀", "😢"]);

/** Mirrors SEARCH.MIN_LENGTH: a shorter term matches nearly everything. */
export const SEARCH_MIN_LENGTH = 2;

export const THEME_STORAGE_KEY = "zentro_theme";
export const TYPING_THROTTLE_MS = 2000;
export const SEARCH_DEBOUNCE_MS = 300;
