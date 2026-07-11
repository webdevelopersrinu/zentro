import mongoose from "mongoose";

// One account. Users sign in with Google, GitHub, or a one-time code emailed to
// them. We store WHO they are (provider + providerId uniquely identify them)
// plus their display name and avatar. There is no password, anywhere.
//
// `username` stays unique (used for @mentions / invites). It is derived from the
// profile — or the email's local part — the first time they log in.
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
    },

    // A user is uniquely a (provider, providerId) pair — ("google", "10934…"),
    // ("github", "5821"), or ("email", "someone@example.com").
    provider: { type: String, enum: ["google", "github", "email"], required: true },
    providerId: { type: String, required: true },

    // Profile pulled from the provider.
    name: { type: String, trim: true },       // full display name, e.g. "Srinu Desetti"
    email: { type: String, trim: true, lowercase: true },
    avatarUrl: { type: String },              // profile picture URL
  },
  { timestamps: true }
);

// Fast look-up + guarantee one account per social identity.
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

export const User = mongoose.model("User", userSchema);