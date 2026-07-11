import crypto from "crypto";

import { EmailCode } from "../models/EmailCode.js";
import { sendMail } from "../lib/mailer.js";
import { AppError } from "../utils/AppError.js";
import { findOrCreateSocialUser } from "./auth.service.js";
import { AUTH_PROVIDER, EMAIL_CODE } from "../constants/index.js";

/** Unbiased, unlike `Math.random() * 1e6`. */
const generateCode = () =>
  String(crypto.randomInt(0, 10 ** EMAIL_CODE.LENGTH)).padStart(EMAIL_CODE.LENGTH, "0");

/**
 * Keyed by the app secret and bound to the email, so a hash lifted from one
 * account cannot be replayed against another.
 */
const hashCode = (code, email) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${email}:${code}`).digest("hex");

const matches = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; hex digests are always equal length.
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * Issues a code and emails it. Returns nothing either way: the caller must
 * respond identically whether or not the address exists, or this endpoint
 * becomes a way to enumerate registered users.
 *
 * A cooldown stops the endpoint being used to mail-bomb someone's inbox.
 */
export async function requestCode(email) {
  const existing = await EmailCode.findOne({ email });
  const cooldownMs = EMAIL_CODE.RESEND_COOLDOWN_SECONDS * 1000;

  if (existing && Date.now() - existing.createdAt.getTime() < cooldownMs) return;

  const code = generateCode();
  await EmailCode.findOneAndUpdate(
    { email },
    {
      codeHash: hashCode(code, email),
      attempts: 0,
      expiresAt: new Date(Date.now() + EMAIL_CODE.TTL_SECONDS * 1000),
      createdAt: new Date(),
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const minutes = EMAIL_CODE.TTL_SECONDS / 60;
  await sendMail({
    to: email,
    subject: `${code} is your Zentro sign-in code`,
    text: `Your Zentro sign-in code is ${code}. It expires in ${minutes} minutes.\n\nIf you didn't ask for this, ignore this email.`,
    html: `<p>Your Zentro sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in ${minutes} minutes. If you didn't ask for this, ignore this email.</p>`,
  });
}

/**
 * Verifies a code and returns the user, creating the account on first sign-in.
 * The code is single-use: it is deleted the moment it succeeds.
 */
export async function verifyCode(email, code) {
  const invalid = () => AppError.badRequest("Invalid or expired code");

  const record = await EmailCode.findOne({ email, expiresAt: { $gt: new Date() } });
  if (!record) throw invalid();

  // Burn the code rather than let it be brute-forced one digit at a time.
  if (record.attempts >= EMAIL_CODE.MAX_ATTEMPTS) {
    await record.deleteOne();
    throw AppError.tooManyRequests("Too many attempts. Request a new code.");
  }

  if (!matches(hashCode(code, email), record.codeHash)) {
    await EmailCode.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    throw invalid();
  }

  await record.deleteOne();

  return findOrCreateSocialUser({
    provider: AUTH_PROVIDER.EMAIL,
    providerId: email,
    email,
    name: email.split("@")[0],
  });
}
