import { Router } from "express";
import passport from "../config/passport.js";
import { signToken, verifyToken } from "../utils/token.js";

const router = Router();

const { CLIENT_URL = "http://localhost:5173" } = process.env;

// ────────────────────────────────────────────────────────────────────────────
// ThunderID auth routes (self-hosted social login).
//
//   GET /api/auth/google            → send user to Google
//   GET /api/auth/callback/google   → Google returns here; we issue OUR JWT
//   GET /api/auth/github            → send user to GitHub
//   GET /api/auth/callback/github   → GitHub returns here; we issue OUR JWT
//   GET /api/auth/me                → who am I? (verify my JWT)
//
// After a successful callback we redirect the browser back to the frontend with
// the token in the URL: <CLIENT_URL>/auth/success?token=<JWT>. The frontend
// grabs it, stores it, and uses it for the API + Socket.IO — exactly like before.
// ────────────────────────────────────────────────────────────────────────────

// Shared success handler: turn the Passport user into a JWT and bounce back.
function issueTokenAndRedirect(req, res) {
  const token = signToken(req.user);
  res.redirect(`${CLIENT_URL}/auth/success?token=${token}`);
}

// If OAuth fails (user cancels, bad config), send them back to login with a flag.
function onFailure(res) {
  res.redirect(`${CLIENT_URL}/?error=auth_failed`);
}

// --- Google ---------------------------------------------------------------
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/callback/google",
  passport.authenticate("google", { session: false, failureRedirect: "/api/auth/failure" }),
  issueTokenAndRedirect
);

// --- GitHub ---------------------------------------------------------------
router.get(
  "/github",
  passport.authenticate("github", { scope: ["user:email"] })
);

router.get(
  "/callback/github",
  passport.authenticate("github", { session: false, failureRedirect: "/api/auth/failure" }),
  issueTokenAndRedirect
);

// Shared failure endpoint.
router.get("/failure", (_req, res) => onFailure(res));

// --- Who am I? -------------------------------------------------------------
// Frontend calls this on load with the stored token to confirm it's still valid.
router.get("/me", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    return res.json({ user: verifyToken(token) });
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});

export default router;
