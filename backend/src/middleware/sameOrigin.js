import { AppError } from "../utils/AppError.js";

/**
 * CSRF defence for the cookie-authenticated endpoints (/auth/refresh, /logout).
 *
 * `sameSite=lax` already blocks the cookie on cross-site POSTs, but that is one
 * browser setting away from being our only protection. This adds a second,
 * server-side check: the request must declare an Origin we recognise.
 *
 * A cross-site <form> POST cannot set a custom Origin, and fetch() always sends
 * the real one — so a forged request either omits Origin (rejected) or reveals
 * itself (rejected).
 */
export const sameOriginOnly = (req, _res, next) => {
  const allowed = process.env.CLIENT_ORIGIN;

  // Missing or wildcard origin. Outside production this is dev with CORS wide
  // open — nothing to enforce. In production it means the deploy is
  // misconfigured, so fail CLOSED instead of waving the request through. (env
  // validation already refuses to boot in this state; this is the backstop.)
  if (!allowed || allowed === "*") {
    if (process.env.NODE_ENV === "production") {
      return next(AppError.forbidden("Cross-origin request rejected"));
    }
    return next();
  }

  const origin = req.get("origin");
  // Same-origin requests from some browsers omit Origin on GET; these routes
  // are POST-only, where Origin is always present.
  if (origin && origin === allowed) return next();

  next(AppError.forbidden("Cross-origin request rejected"));
};
