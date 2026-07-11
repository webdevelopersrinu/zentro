import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads backend/.env without pulling dotenv into the frontend. Only KEY=value
 * lines are needed (MONGO_URI, VALKEY_URL, JWT_SECRET); existing process.env
 * wins, matching dotenv's non-override behaviour.
 */
function loadBackendEnv() {
  try {
    const raw = readFileSync(path.resolve(here, "../../backend/.env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trimStart().startsWith("#")) continue;
      const [, key, value] = match;
      if (process.env[key] === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env: fall back to the localhost defaults below.
  }
}

loadBackendEnv();

// Private ports, clear of the usual dev servers (backend 4000, vite 5173), so a
// browser-E2E run never collides with a dev session you already have open.
const API_PORT = 4190;
const WEB_PORT = 5190;

export const E2E = Object.freeze({
  API_PORT,
  WEB_PORT,
  API_URL: `http://127.0.0.1:${API_PORT}`,
  WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
  // A database of its own, so a browser run never touches dev or Jest data.
  MONGO_URI: (process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chatapp").replace(
    /\/([^/?]+)(\?|$)/,
    "/zentro_ui_e2e$2"
  ),
  VALKEY_URL: process.env.VALKEY_URL ?? "redis://127.0.0.1:6379",
});

/**
 * Env for the spawned backend. Two deliberate choices:
 *   • SMTP_HOST is stripped, so the OTP mailer falls back to its in-memory
 *     outbox instead of sending real email — which /api/test/last-code reads.
 *   • E2E_TEST_LOGIN mounts that test-only route; nothing else does.
 */
export function backendEnv() {
  const env = {
    ...process.env,
    NODE_ENV: "development", // production would force a Secure cookie over plain http
    E2E_TEST_LOGIN: "1",
    PORT: String(E2E.API_PORT),
    MONGO_URI: E2E.MONGO_URI,
    VALKEY_URL: E2E.VALKEY_URL,
    CLIENT_ORIGIN: E2E.WEB_URL,
    CLIENT_URL: E2E.WEB_URL,
    JWT_SECRET: process.env.JWT_SECRET ?? "ui_e2e_jwt_secret",
    SESSION_SECRET: process.env.SESSION_SECRET ?? "ui_e2e_session_secret",
    // Empty, not deleted: the child reloads backend/.env via dotenv, which would
    // re-add a deleted key but leaves a defined one alone. Blank → the mailer
    // suppresses to its outbox, which the test-login seam reads.
    SMTP_HOST: "",
  };
  return env;
}

/** Env for the Vite dev server: point the browser's API calls at our backend. */
export function frontendEnv() {
  return { ...process.env, VITE_API_URL: `${E2E.API_URL}/api` };
}
