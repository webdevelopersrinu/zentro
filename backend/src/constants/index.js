export const ROOM_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  PRIVATE: "private",
});

export const AUTH_PROVIDER = Object.freeze({
  GOOGLE: "google",
  GITHUB: "github",
  EMAIL: "email",
});

/** Only these get a Passport strategy and /auth/:provider routes. */
export const OAUTH_PROVIDERS = Object.freeze([
  AUTH_PROVIDER.GOOGLE,
  AUTH_PROVIDER.GITHUB,
]);

/**
 * A 6-digit code is one in a million — trivially brute-forced without these.
 * Attempts and TTL are the real guards; the code itself is not a secret worth
 * much on its own.
 */
export const EMAIL_CODE = Object.freeze({
  LENGTH: 6,
  TTL_SECONDS: 10 * 60,
  MAX_ATTEMPTS: 5,
  RESEND_COOLDOWN_SECONDS: 60,
});

export const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
});

/** Every event name used on the wire. Never type these as string literals. */
export const SOCKET_EVENTS = Object.freeze({
  // client → server
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  MESSAGE_SEND: "message:send",
  MESSAGE_EDIT: "message:edit",
  MESSAGE_DELETE: "message:delete",
  MESSAGE_REACT: "message:react",
  TYPING: "typing",

  // server → client
  READY: "ready", // server finished per-connection setup; safe to emit
  MESSAGE_NEW: "message:new",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",
  PRESENCE_JOINED: "presence:joined",
  PRESENCE_LEFT: "presence:left",
  REQUEST_NEW: "request:new",
  REQUEST_APPROVED: "request:approved",
  REQUEST_REJECTED: "request:rejected",
  ROOM_INVITED: "room:invited",
  INVITE_DECLINED: "invite:declined",
  ROOM_DELETED: "room:deleted",
  ROOM_READ: "room:read", // someone read up to a point; drives the tick marks
  ROOM_ADMIN_CHANGED: "room:admin", // you were promoted, or demoted
});

/**
 * Access tokens are short-lived and live in the client's MEMORY.
 * Refresh tokens are long-lived, opaque, stored server-side (revocable), and
 * travel only in an httpOnly cookie scoped to the auth routes.
 */
export const TOKEN = Object.freeze({
  ACCESS_TTL: "15m",
  REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60, // 30 days
  /** Grace window in which a rotated token is retained purely to detect reuse. */
  REUSE_DETECTION_TTL_SECONDS: 30 * 24 * 60 * 60,
  COOKIE_NAME: "zentro_rt",
  COOKIE_PATH: "/api/auth",
});

/**
 * History is paged backwards from the newest message: `before` is the id of the
 * oldest message the client already holds. MAX caps what a client may ask for.
 */
export const MESSAGE_PAGE = Object.freeze({ DEFAULT: 50, MAX: 100 });
export const MESSAGE_MAX_LENGTH = 2000; // matches the Message schema

/**
 * How long after sending a message its author may still edit it. Past this,
 * what everyone else has already read is what stays on the record.
 * Deleting has no window — you can always retract your own words.
 */
export const MESSAGE_EDIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * The client's one-tap quick row, kept here only so the two stay in step. It is
 * NOT the accepted set: any single emoji is allowed (see isEmoji), because an
 * emoji field that accepts free text is an open text field on someone else's
 * message — the guard is the shape of the value, not a list of six.
 */
export const REACTION_EMOJIS = Object.freeze(["👍", "❤️", "😂", "🎉", "👀", "😢"]);

/**
 * Longest real ZWJ sequence is 10 code points (👨🏻‍❤️‍💋‍👨🏻). The cap stops a
 * megabyte of ZWJ-joined emoji from passing the shape check and being stored.
 */
export const REACTION_MAX_CODE_POINTS = 16;

/** Search is scoped to one room, newest first, and never unbounded. */
export const SEARCH = Object.freeze({ MIN_LENGTH: 2, MAX_LENGTH: 100, LIMIT: 25 });
export const USER_SEARCH_LIMIT = 10;

/** Per-socket flood control for message:send. */
export const SOCKET_RATE_LIMIT = Object.freeze({
  WINDOW_MS: 10_000,
  MAX_EVENTS: 20,
});

/** Personal Socket.IO room; lets us push an event to one user, cluster-wide. */
export const userChannel = (userId) => `user:${userId}`;
