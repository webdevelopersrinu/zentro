import mongoose from "mongoose";

// One account. Users sign in with a social provider (Google / GitHub) — this is
// the "ThunderID" social-login identity. We store WHO they are (provider +
// providerId uniquely identify them) plus their display name and avatar.
//
// `username` stays unique (used for @mentions / invites). For social users we
// derive it from their profile the first time they log in.
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

    // Social identity (ThunderID). A user is uniquely a (provider, providerId)
    // pair — e.g. ("google", "10934...") or ("github", "5821").
    provider: { type: String, enum: ["google", "github"], required: true },
    providerId: { type: String, required: true },

    // Profile pulled from the provider.
    name: { type: String, trim: true },       // full display name, e.g. "Srinu Desetti"
    email: { type: String, trim: true, lowercase: true },
    avatarUrl: { type: String },              // profile picture URL

    // Legacy password login is no longer used, kept optional so old rows work.
    passwordHash: { type: String },
  },
  { timestamps: true }
);

// Fast look-up + guarantee one account per social identity.
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

export const User = mongoose.model("User", userSchema);