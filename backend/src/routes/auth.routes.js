import { Router } from "express";
import passport from "../config/passport.js";
import { requireAuth } from "../middleware/auth.js";
import { sameOriginOnly } from "../middleware/sameOrigin.js";
import { validateBody } from "../middleware/validate.js";
import * as authController from "../controllers/auth.controller.js";
import * as userController from "../controllers/user.controller.js";
import {
  emailRequestSchema,
  emailVerifySchema,
} from "../validators/auth.validators.js";
import { AUTH_PROVIDER, OAUTH_PROVIDERS } from "../constants/index.js";

const router = Router();

const SCOPES = {
  [AUTH_PROVIDER.GOOGLE]: ["profile", "email"],
  [AUTH_PROVIDER.GITHUB]: ["user:email"],
};

/**
 * Both OAuth providers follow the same shape, so register them from one loop.
 * `email` is a provider too, but it has no Passport strategy — hence
 * OAUTH_PROVIDERS rather than every value of AUTH_PROVIDER.
 */
for (const provider of OAUTH_PROVIDERS) {
  router.get(
    `/${provider}`,
    passport.authenticate(provider, { scope: SCOPES[provider] })
  );

  router.get(
    `/callback/${provider}`,
    passport.authenticate(provider, {
      session: false,
      failureRedirect: "/api/auth/failure",
    }),
    authController.oauthSuccess
  );
}

router.get("/failure", authController.oauthFailure);

/**
 * Passwordless email login. /verify sets the refresh cookie, so a forged
 * cross-site POST could log a victim into the ATTACKER's account — hence the
 * same CSRF guard as /refresh.
 *
 * Brute force is capped twice: the /auth rate limiter (20 per 15 min per IP)
 * and the per-code attempt counter (5, then the code is burned).
 */
router.post(
  "/email/request",
  sameOriginOnly,
  validateBody(emailRequestSchema),
  authController.emailRequest
);

router.post(
  "/email/verify",
  sameOriginOnly,
  validateBody(emailVerifySchema),
  authController.emailVerify
);

// Cookie-authenticated and state-changing: guard against CSRF.
router.post("/refresh", sameOriginOnly, authController.refresh);
router.post("/logout", sameOriginOnly, authController.logout);

router.get("/me", requireAuth, userController.me);

export default router;
