import mongoose from "mongoose";

/**
 * A pending one-time login code. One row per email — requesting a new code
 * replaces the old one, so only the newest is ever valid.
 *
 * Only an HMAC of the code is stored: a dump of this collection must not let
 * anyone log in, for the same reason we never store passwords.
 */
const emailCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Mongo deletes the row once expiresAt passes.
emailCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailCode = mongoose.model("EmailCode", emailCodeSchema);
