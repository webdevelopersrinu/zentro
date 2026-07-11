// Loads backend/.env by ABSOLUTE path, independent of the process working
// directory (pm2 / systemd may start us from anywhere).
//
// This lives in its own module and must be the FIRST import in server.js:
// ES modules evaluate every `import` before any code in the importing module's
// body, so a body-level `dotenv.config()` would run AFTER modules like
// config/passport.js have already read process.env — leaving their config
// undefined. Importing this module first guarantees the env is populated before
// anything else evaluates.
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
});

const MIN_SECRET_LENGTH = 32;

/**
 * The security posture that MUST hold before a production process is allowed to
 * serve traffic. Returns the list of problems (empty when safe) rather than
 * throwing, so it can be unit-tested against arbitrary environments.
 *
 * Only enforced in production: dev and the test suites run on defaults on
 * purpose. The point is that a real deploy cannot *silently* come up weak — a
 * missing JWT secret (forgeable tokens) or a wildcard origin (CSRF disabled)
 * must crash the boot, loudly, not degrade in the dark.
 */
export function findConfigProblems(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const problems = [];

  for (const key of ["JWT_SECRET", "SESSION_SECRET", "MONGO_URI"]) {
    if (!env[key]) problems.push(`${key} is required`);
  }

  // A short HMAC secret is brute-forceable, which means forgeable access
  // tokens — treat "too short" as just as fatal as "missing".
  if (env.JWT_SECRET && env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  // Credentialed CORS and the CSRF Origin check both depend on an exact client
  // origin; "*" or missing disables both. (sameOriginOnly also fails closed in
  // production, but the config should never reach it in that state.)
  if (!env.CLIENT_ORIGIN || env.CLIENT_ORIGIN === "*") {
    problems.push("CLIENT_ORIGIN must be an exact origin, never '*' or empty");
  }

  return problems;
}

const problems = findConfigProblems();
if (problems.length) {
  throw new Error(
    `Refusing to start: insecure production configuration —\n  - ${problems.join("\n  - ")}`
  );
}