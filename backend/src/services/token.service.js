import crypto from "crypto";
import jwt from "jsonwebtoken";

import { getTokenStore } from "../lib/tokenStore.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../lib/logger.js";
import { TOKEN } from "../constants/index.js";

const randomToken = () => crypto.randomBytes(32).toString("hex");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// ── access token (stateless, short-lived, lives in client memory) ───────────

/**
 * Profile fields ride along so the UI can render immediately without an extra
 * round-trip. They can be at most ACCESS_TTL stale, which is acceptable.
 */
export const signAccessToken = (user) =>
  jwt.sign(
    {
      id: user._id ? user._id.toString() : user.id,
      username: user.username,
      name: user.name || user.username,
      avatarUrl: user.avatarUrl || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN.ACCESS_TTL, algorithm: "HS256" }
  );

// Pin the algorithm on verify: never let a token's own `alg` header choose how
// it is checked. Defence in depth against algorithm-confusion forgery.
export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

// ── refresh token (opaque, long-lived, server-side, revocable) ─────────────

/**
 * Starts a new family — one per login — unless an existing family is passed in
 * by rotation. `ip` and `userAgent` are recorded for the audit trail.
 */
export async function issueRefreshToken(userId, meta = {}) {
  const { family = randomToken(), ip, userAgent } = meta;
  const token = randomToken();

  await getTokenStore().save(
    sha256(token),
    { userId: String(userId), family, used: false, ip, userAgent },
    TOKEN.REFRESH_TTL_SECONDS
  );
  return token;
}

/**
 * Exchange a refresh token for a new one, invalidating the old.
 *
 * Reuse detection: a rotated token is kept and flagged `used` rather than
 * deleted. If it is ever presented again, the chain has leaked — someone is
 * replaying a stolen token — so we revoke the entire family. The legitimate
 * user is logged out too, which is the correct, conservative outcome.
 */
export async function rotateRefreshToken(token, meta = {}) {
  if (!token) throw AppError.unauthorized("Missing refresh token");

  const store = getTokenStore();
  const hash = sha256(token);
  const record = await store.get(hash);

  if (!record) throw AppError.unauthorized("Invalid refresh token");

  if (record.used) {
    logger.error(
      `Refresh token reuse detected for user ${record.userId} — revoking family`
    );
    await store.revokeFamily(record.family);
    throw AppError.unauthorized("Refresh token reuse detected");
  }

  await store.markUsed(hash, record, TOKEN.REUSE_DETECTION_TTL_SECONDS);
  const next = await issueRefreshToken(record.userId, {
    ...meta,
    family: record.family,
  });

  return { token: next, userId: record.userId };
}

/** Logout: kills every token descended from that login. */
export async function revokeRefreshToken(token) {
  if (!token) return;
  const record = await getTokenStore().get(sha256(token));
  if (record) await getTokenStore().revokeFamily(record.family);
}

// ── cookie ─────────────────────────────────────────────────────────────────

/**
 * httpOnly so JavaScript (and therefore XSS) cannot read it.
 * sameSite=lax so it survives the provider's top-level redirect back to us,
 * while still not being sent on cross-site POSTs (our first CSRF layer).
 * Path-scoped so it is never attached to ordinary API calls.
 */
export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: TOKEN.COOKIE_PATH,
  maxAge: TOKEN.REFRESH_TTL_SECONDS * 1000,
});
