import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import roomRoutes from "./room.routes.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true, pid: process.pid }));

// OAuth endpoints get a much tighter budget than the rest of the API.
router.use("/auth", authLimiter, authRoutes);
router.use("/users", userRoutes);
router.use("/rooms", roomRoutes);

// Test-only login seam, mounted only when the browser-E2E harness asks for it.
//
// It hands out OTPs, so a leaked flag in production would be account takeover.
// Two gates, not one: refuse to even boot if the flag is ever seen in
// production (fail loud, not silent), and otherwise mount lazily so the module
// never parses in a normal process.
if (process.env.E2E_TEST_LOGIN === "1") {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "E2E_TEST_LOGIN must never be set in production: it exposes login codes. Refusing to start."
    );
  }
  const { default: testRoutes } = await import("./test.routes.js");
  router.use("/test", testRoutes);
}

export default router;
