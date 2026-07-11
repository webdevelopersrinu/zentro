import nodemailer from "nodemailer";

import { logger } from "./logger.js";

let transporter;

/** Suppressed mail lands here, so tests can assert on what would have been sent. */
export const outbox = [];

/** No SMTP configured (or under test) → collect instead of send. */
const enabled = () =>
  Boolean(process.env.SMTP_HOST) && process.env.NODE_ENV !== "test";

export async function sendMail({ to, subject, text, html }) {
  if (!enabled()) {
    outbox.push({ to, subject, text, html });
    logger.info(`[mail suppressed] "${subject}" -> ${to}`);
    return;
  }

  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false, // 587 upgrades via STARTTLS
    auth: { user: process.env.SMTP_LOGIN, pass: process.env.SMTP_KEY },
  });

  await transporter.sendMail({ from: process.env.SENDER_EMAIL, to, subject, text, html });
}
