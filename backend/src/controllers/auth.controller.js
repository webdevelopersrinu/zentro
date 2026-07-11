import { asyncHandler } from "../middleware/asyncHandler.js";
import * as tokenService from "../services/token.service.js";
import * as userService from "../services/user.service.js";
import * as emailAuth from "../services/emailAuth.service.js";
import { toUserDTO } from "../utils/serializers.js";
import { AppError } from "../utils/AppError.js";
import { TOKEN, HTTP_STATUS } from "../constants/index.js";

const clientUrl = () => process.env.CLIENT_URL ?? "http://localhost:5173";
const readRefreshCookie = (req) => req.cookies?.[TOKEN.COOKIE_NAME];

/** Audit trail: what a "your active devices" screen would show. */
const auditMeta = (req) => ({ ip: req.ip, userAgent: req.get("user-agent") });

const setRefreshCookie = (res, token) =>
  res.cookie(TOKEN.COOKIE_NAME, token, tokenService.refreshCookieOptions());

const clearRefreshCookie = (res) =>
  res.clearCookie(TOKEN.COOKIE_NAME, { path: TOKEN.COOKIE_PATH });

/**
 * Passport has authenticated the user; req.user is set. We now issue OUR tokens.
 *
 * The access token is NOT put in the redirect URL — URLs leak into browser
 * history, Referer headers and access logs. Only the httpOnly refresh cookie
 * crosses the wire; the SPA then calls /auth/refresh to obtain an access token.
 */
export const oauthSuccess = asyncHandler(async (req, res) => {
  const refreshToken = await tokenService.issueRefreshToken(
    req.user._id,
    auditMeta(req)
  );
  setRefreshCookie(res, refreshToken);
  res.redirect(`${clientUrl()}/auth/success`);
});

export const oauthFailure = (_req, res) =>
  res.redirect(`${clientUrl()}/?error=auth_failed`);

/**
 * Always answers 200, whether or not the address is registered. Reporting
 * "no such user" would turn this endpoint into a way to enumerate accounts.
 */
export const emailRequest = asyncHandler(async (req, res) => {
  await emailAuth.requestCode(req.body.email);
  res.json({ ok: true });
});

/** Same tokens, same cookie, same rotation as an OAuth login. */
export const emailVerify = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const user = await emailAuth.verifyCode(email, code);

  const refreshToken = await tokenService.issueRefreshToken(user._id, auditMeta(req));
  setRefreshCookie(res, refreshToken);

  res.json({
    accessToken: tokenService.signAccessToken(user),
    user: toUserDTO(user),
  });
});

/**
 * Exchange the refresh cookie for a fresh access token, rotating the refresh
 * token in the process. Called on app boot (silent login) and whenever an API
 * call comes back 401.
 */
export const refresh = asyncHandler(async (req, res) => {
  const { token, userId } = await tokenService.rotateRefreshToken(
    readRefreshCookie(req),
    auditMeta(req)
  );

  const user = await userService.findById(userId);
  if (!user) {
    // Account deleted since the token was issued.
    await tokenService.revokeRefreshToken(token);
    clearRefreshCookie(res);
    throw AppError.unauthorized("Account no longer exists");
  }

  setRefreshCookie(res, token);
  res.json({
    accessToken: tokenService.signAccessToken(user),
    user: toUserDTO(user),
  });
});

/** Revokes the entire token family, so every device from that login is out. */
export const logout = asyncHandler(async (req, res) => {
  await tokenService.revokeRefreshToken(readRefreshCookie(req));
  clearRefreshCookie(res);
  res.status(HTTP_STATUS.NO_CONTENT).end();
});
