import jwt from "jsonwebtoken";

import {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  refreshCookieOptions,
} from "../../../src/services/token.service.js";
import { setTokenStore, MemoryTokenStore } from "../../../src/lib/tokenStore.js";
import { TOKEN } from "../../../src/constants/index.js";

const USER = {
  _id: { toString: () => "user-1" },
  username: "alice",
  name: "Alice",
  avatarUrl: "http://x/a.png",
};

describe("Access token", () => {
  it("expires in 15 minutes, not days", () => {
    const { iat, exp } = jwt.decode(signAccessToken(USER));
    expect((exp - iat) / 60).toBe(15);
  });

  it("carries the display profile so the UI needs no extra round-trip", () => {
    expect(jwt.decode(signAccessToken(USER))).toMatchObject({
      id: "user-1",
      username: "alice",
      name: "Alice",
      avatarUrl: "http://x/a.png",
    });
  });

  it("accepts a plain id when there is no _id", () => {
    expect(jwt.decode(signAccessToken({ id: "u2", username: "bob" })).id).toBe("u2");
  });

  it("falls back to username when the profile is bare", () => {
    const payload = jwt.decode(signAccessToken({ id: "u3", username: "carol" }));
    expect(payload).toMatchObject({ name: "carol", avatarUrl: "" });
  });

  it("round-trips through verifyAccessToken", () => {
    expect(verifyAccessToken(signAccessToken(USER)).username).toBe("alice");
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign({ id: "u" }, "not-our-secret");
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it("rejects an expired token", () => {
    const stale = jwt.sign({ id: "u" }, process.env.JWT_SECRET, { expiresIn: "-1s" });
    expect(() => verifyAccessToken(stale)).toThrow(/expired/i);
  });

  it("is signed with HS256", () => {
    const { header } = jwt.decode(signAccessToken(USER), { complete: true });
    expect(header.alg).toBe("HS256");
  });

  it("rejects an unsigned (alg:none) token — the algorithm is pinned", () => {
    // A classic forgery: drop the signature and claim alg:none.
    const unsigned = jwt.sign({ id: "u", username: "mallory" }, "", { algorithm: "none" });
    expect(() => verifyAccessToken(unsigned)).toThrow();
  });
});

describe("Refresh token", () => {
  let store;

  beforeEach(() => {
    store = new MemoryTokenStore();
    setTokenStore(store);
  });

  it("issues an opaque, high-entropy token", async () => {
    const token = await issueRefreshToken("user-1");

    expect(token).toMatch(/^[a-f0-9]{64}$/); // 32 random bytes, hex
    expect(() => jwt.decode(token)).not.toThrow();
    expect(jwt.decode(token)).toBeNull(); // it is NOT a JWT — nothing to read
  });

  it("stores only a hash, never the token itself", async () => {
    const token = await issueRefreshToken("user-1");

    expect(store.tokens.has(token)).toBe(false);
    expect([...store.tokens.keys()][0]).not.toBe(token);
  });

  it("is unguessable — two issues never collide", async () => {
    const a = await issueRefreshToken("user-1");
    const b = await issueRefreshToken("user-1");
    expect(a).not.toBe(b);
  });

  describe("rotation", () => {
    it("returns a new token and the owning user", async () => {
      const first = await issueRefreshToken("user-1");

      const { token: second, userId } = await rotateRefreshToken(first);

      expect(userId).toBe("user-1");
      expect(second).not.toBe(first);
    });

    it("keeps the rotated child in the same family", async () => {
      const first = await issueRefreshToken("user-1");
      await rotateRefreshToken(first);

      expect(store.families.size).toBe(1);
    });

    it("rejects a missing token", async () => {
      await expect(rotateRefreshToken(undefined)).rejects.toThrow(/Missing refresh/i);
    });

    it("rejects an unknown token", async () => {
      await expect(rotateRefreshToken("deadbeef")).rejects.toThrow(/Invalid refresh/i);
    });
  });

  describe("reuse detection", () => {
    it("throws and revokes the family when a rotated token is replayed", async () => {
      const first = await issueRefreshToken("user-1");
      const { token: second } = await rotateRefreshToken(first);

      await expect(rotateRefreshToken(first)).rejects.toThrow(/reuse detected/i);

      // The whole chain is dead, including the victim's current token.
      await expect(rotateRefreshToken(second)).rejects.toThrow(/Invalid refresh/i);
    });

    it("does not touch other families", async () => {
      const laptop = await issueRefreshToken("user-1"); // family A
      const phone = await issueRefreshToken("user-1"); // family B

      await rotateRefreshToken(laptop);
      await expect(rotateRefreshToken(laptop)).rejects.toThrow(/reuse/i);

      await expect(rotateRefreshToken(phone)).resolves.toMatchObject({
        userId: "user-1",
      });
    });
  });

  describe("revocation", () => {
    it("kills every token in the family", async () => {
      const first = await issueRefreshToken("user-1");
      const { token: second } = await rotateRefreshToken(first);

      await revokeRefreshToken(second);

      await expect(rotateRefreshToken(second)).rejects.toThrow(/Invalid refresh/i);
      expect(store.families.size).toBe(0);
    });

    it("is a no-op for a missing or unknown token", async () => {
      await expect(revokeRefreshToken(undefined)).resolves.toBeUndefined();
      await expect(revokeRefreshToken("nope")).resolves.toBeUndefined();
    });
  });
});

describe("refreshCookieOptions", () => {
  const withEnv = (value, fn) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try {
      fn();
    } finally {
      process.env.NODE_ENV = previous;
    }
  };

  it("is httpOnly so XSS cannot read it", () => {
    expect(refreshCookieOptions().httpOnly).toBe(true);
  });

  it("is scoped to the auth path, not sent on ordinary API calls", () => {
    expect(refreshCookieOptions().path).toBe(TOKEN.COOKIE_PATH);
  });

  it("uses sameSite=lax so it survives the OAuth redirect but not a cross-site POST", () => {
    expect(refreshCookieOptions().sameSite).toBe("lax");
  });

  it("is Secure in production and not in development", () => {
    withEnv("production", () => expect(refreshCookieOptions().secure).toBe(true));
    withEnv("development", () => expect(refreshCookieOptions().secure).toBe(false));
  });

  it("lives for 30 days", () => {
    expect(refreshCookieOptions().maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
