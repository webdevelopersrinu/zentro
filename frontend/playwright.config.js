import { defineConfig, devices } from "@playwright/test";

import { E2E, backendEnv, frontendEnv } from "./e2e/env.js";

/**
 * Browser (UI) end-to-end tests: a real Chromium driving the real React app,
 * which talks to a real backend, MongoDB and Valkey.
 *
 * This is the layer the backend's own Playwright suite does NOT cover — that
 * one drives the HTTP/WebSocket API directly. Here we assert the thing a user
 * actually touches: the rendered app, real clicks, real navigation.
 *
 * Kept deliberately small. E2E is the slow, brittle top of the pyramid; it
 * covers the few journeys that matter, not the branches unit/integration
 * already own.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one backend, one database
  workers: 1,
  // Browser E2E sits at the top of the pyramid, driving real sockets across two
  // contexts; a little timing variance is irreducible. One retry absorbs a flake
  // without hiding a real break — a genuine failure fails both attempts.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: E2E.WEB_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "node src/server.js",
      cwd: "../backend",
      port: E2E.API_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: backendEnv(),
    },
    {
      // --host 127.0.0.1: Vite defaults to IPv6 localhost, but the tests and
      // the backend's CLIENT_ORIGIN speak IPv4 127.0.0.1.
      command: `npx vite --port ${E2E.WEB_PORT} --strictPort --host 127.0.0.1`,
      port: E2E.WEB_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: frontendEnv(),
    },
  ],
});
