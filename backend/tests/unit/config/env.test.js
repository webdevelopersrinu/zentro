import { findConfigProblems } from "../../../src/config/env.js";

/** A fully-valid production environment; each test breaks one thing. */
const prod = (over = {}) => ({
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(32),
  SESSION_SECRET: "another-strong-secret",
  MONGO_URI: "mongodb://db/app",
  CLIENT_ORIGIN: "https://zentro.example.com",
  ...over,
});

describe("findConfigProblems — production boot guard", () => {
  it("passes a correctly configured production environment", () => {
    expect(findConfigProblems(prod())).toEqual([]);
  });

  it("never blocks a non-production environment, however empty", () => {
    expect(findConfigProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(findConfigProblems({ NODE_ENV: "test" })).toEqual([]);
  });

  it.each(["JWT_SECRET", "SESSION_SECRET", "MONGO_URI"])(
    "flags a missing %s",
    (key) => {
      const problems = findConfigProblems(prod({ [key]: undefined }));
      expect(problems.some((p) => p.includes(key))).toBe(true);
    }
  );

  it("flags a JWT secret that is too short to be safe", () => {
    const problems = findConfigProblems(prod({ JWT_SECRET: "short" }));
    expect(problems.some((p) => /JWT_SECRET.*32/.test(p))).toBe(true);
  });

  it("accepts a JWT secret exactly at the minimum length", () => {
    expect(findConfigProblems(prod({ JWT_SECRET: "x".repeat(32) }))).toEqual([]);
  });

  it("flags a missing CLIENT_ORIGIN — CSRF and credentialed CORS depend on it", () => {
    const problems = findConfigProblems(prod({ CLIENT_ORIGIN: undefined }));
    expect(problems.some((p) => p.includes("CLIENT_ORIGIN"))).toBe(true);
  });

  it("flags a wildcard CLIENT_ORIGIN", () => {
    const problems = findConfigProblems(prod({ CLIENT_ORIGIN: "*" }));
    expect(problems.some((p) => p.includes("CLIENT_ORIGIN"))).toBe(true);
  });

  it("reports every problem at once, so one boot shows the whole list", () => {
    const problems = findConfigProblems({ NODE_ENV: "production" });
    expect(problems.length).toBeGreaterThanOrEqual(4); // 3 missing + wildcard origin
  });
});
