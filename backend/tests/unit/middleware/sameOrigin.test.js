import { jest } from "@jest/globals";

import { sameOriginOnly } from "../../../src/middleware/sameOrigin.js";

const run = ({ clientOrigin, nodeEnv, origin }) => {
  const prevOrigin = process.env.CLIENT_ORIGIN;
  const prevEnv = process.env.NODE_ENV;

  if (clientOrigin === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = clientOrigin;
  process.env.NODE_ENV = nodeEnv;

  const req = { get: (h) => (h.toLowerCase() === "origin" ? origin : undefined) };
  const next = jest.fn();
  try {
    sameOriginOnly(req, {}, next);
  } finally {
    process.env.CLIENT_ORIGIN = prevOrigin;
    process.env.NODE_ENV = prevEnv;
  }

  const arg = next.mock.calls[0]?.[0];
  return { passed: next.mock.calls.length === 1 && !arg, rejected: Boolean(arg) };
};

describe("sameOriginOnly — CSRF Origin guard", () => {
  const ALLOWED = "https://zentro.example.com";

  it("allows a request whose Origin matches the configured client", () => {
    expect(run({ clientOrigin: ALLOWED, nodeEnv: "production", origin: ALLOWED }).passed).toBe(true);
  });

  it("rejects a request from a different origin", () => {
    expect(run({ clientOrigin: ALLOWED, nodeEnv: "production", origin: "https://evil.test" }).rejected).toBe(true);
  });

  it("rejects a request that omits Origin entirely", () => {
    expect(run({ clientOrigin: ALLOWED, nodeEnv: "production", origin: undefined }).rejected).toBe(true);
  });

  describe("misconfiguration (missing/wildcard CLIENT_ORIGIN)", () => {
    it("FAILS CLOSED in production — a wildcard config rejects, never waves through", () => {
      expect(run({ clientOrigin: "*", nodeEnv: "production", origin: "https://evil.test" }).rejected).toBe(true);
    });

    it("FAILS CLOSED in production when CLIENT_ORIGIN is unset", () => {
      expect(run({ clientOrigin: undefined, nodeEnv: "production", origin: "https://evil.test" }).rejected).toBe(true);
    });

    it("stays permissive outside production, for local dev with open CORS", () => {
      expect(run({ clientOrigin: "*", nodeEnv: "development", origin: "http://localhost:5173" }).passed).toBe(true);
    });
  });
});
