import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { User } from "../models/User.js";

// ────────────────────────────────────────────────────────────────────────────
// ThunderID — self-hosted social login.
//
// Each strategy sends the user to Google / GitHub, and when they come back we
// receive their `profile`. We then find-or-create ONE User row for that social
// identity and hand it to Passport. The route layer turns that User into our
// own app JWT (see routes/auth.routes.js).
// ────────────────────────────────────────────────────────────────────────────

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  SERVER_URL = "http://localhost:4000",
} = process.env;

// Turn a display name / email into a unique, URL-safe username.
// e.g. "Srinu Desetti" -> "srinu-desetti", and if taken -> "srinu-desetti-2".
async function makeUniqueUsername(seed) {
  const base =
    (seed || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // spaces/symbols -> dashes
      .replace(/^-+|-+$/g, "")     // trim leading/trailing dashes
      .slice(0, 24) || "user";

  let candidate = base;
  let n = 1;
  // Keep bumping the suffix until the username is free.
  while (await User.exists({ username: candidate })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

// Find the existing account for this social identity, or create it the first
// time. Shared by both providers.
async function findOrCreateUser({ provider, providerId, name, email, avatarUrl }) {
  let user = await User.findOne({ provider, providerId });
  if (user) return user;

  const username = await makeUniqueUsername(name || (email || "").split("@")[0]);
  user = await User.create({
    provider,
    providerId,
    name,
    email,
    avatarUrl,
    username,
  });
  return user;
}

// --- Google ---------------------------------------------------------------
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `${SERVER_URL}/api/auth/callback/google`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await findOrCreateUser({
            provider: "google",
            providerId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            avatarUrl: profile.photos?.[0]?.value,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

// --- GitHub ---------------------------------------------------------------
if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        callbackURL: `${SERVER_URL}/api/auth/callback/github`,
        scope: ["user:email"], // ask for email so we can store it
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await findOrCreateUser({
            provider: "github",
            providerId: profile.id,
            name: profile.displayName || profile.username,
            email: profile.emails?.[0]?.value,
            avatarUrl: profile.photos?.[0]?.value,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

// Passport needs these for the session used DURING the OAuth handshake.
// We only stash the id; the JWT (not the session) is what the app uses after.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findById(id));
  } catch (err) {
    done(err);
  }
});

export default passport;
