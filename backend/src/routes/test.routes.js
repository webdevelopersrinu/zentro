import { Router } from "express";

import { outbox } from "../lib/mailer.js";

/**
 * Test-only endpoints, mounted ONLY when E2E_TEST_LOGIN=1 (see routes/index.js).
 * Never mounted in production — the flag is set exclusively by the browser-E2E
 * harness that boots the server.
 *
 * Browser end-to-end tests drive the real email-OTP login UI. They cannot read
 * a real inbox — neither can CI — so this returns the code the app "sent" to
 * the suppressed outbox. This is the standard programmatic-login seam: fake the
 * one step you cannot automate (reading mail), exercise everything else for real.
 */
const router = Router();

// Belt-and-braces third gate: even if this router were somehow mounted in
// production, every request to it is refused. The real protection is that it is
// never mounted there (routes/index.js), but a leak-proof endpoint costs nothing.
router.use((req, res, next) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();
  next();
});

/** The most recent OTP emailed to an address, or 404 if none is waiting. */
router.get("/last-code", (req, res) => {
  const email = String(req.query.email ?? "").toLowerCase();

  const mail = [...outbox].reverse().find((m) => m.to?.toLowerCase() === email);
  if (!mail) return res.status(404).json({ error: "No code for that address" });

  const code = mail.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) return res.status(404).json({ error: "No code in the message" });

  res.json({ code });
});

export default router;
