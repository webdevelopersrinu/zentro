import request from "supertest";
import jwt from "jsonwebtoken";

import { app, connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { setTokenStore, MongoTokenStore } from "../../src/lib/tokenStore.js";
import { EmailCode } from "../../src/models/EmailCode.js";
import { User } from "../../src/models/User.js";
import { requestCode } from "../../src/services/emailAuth.service.js";
import { outbox } from "../../src/lib/mailer.js";
import { EMAIL_CODE, TOKEN } from "../../src/constants/index.js";

const EMAIL = "someone@example.com";
const ORIGIN = process.env.CLIENT_ORIGIN;

const post = (path, body) =>
  request(app).post(path).set("Origin", ORIGIN).send(body);

const askForCode = (email = EMAIL) => post("/api/auth/email/request", { email });
const verify = (code, email = EMAIL) => post("/api/auth/email/verify", { email, code });

/**
 * The code never leaves the process under test, so we read it from the mailer's
 * outbox — the only place it exists in the clear. That the database holds a hash
 * instead is asserted separately.
 */
const currentCode = (email = EMAIL) => {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no code emailed to ${email}`);
  return mail.subject.match(/^(\d+)/)[1];
};

describe("Email one-time-code login", () => {
  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    setTokenStore(new MongoTokenStore());
    outbox.length = 0;
  });

  describe("POST /auth/email/request", () => {
    it("stores a hashed code, never the code itself", async () => {
      const res = await askForCode();
      expect(res.status).toBe(200);

      const record = await EmailCode.findOne({ email: EMAIL });
      expect(record.codeHash).toHaveLength(64);
      expect(record.attempts).toBe(0);

      const code = currentCode();
      expect(record.codeHash).not.toContain(code);
    });

    it("expires the code in 10 minutes via a TTL index", async () => {
      await askForCode();
      const { expiresAt } = await EmailCode.findOne({ email: EMAIL });
      const minutes = (expiresAt - Date.now()) / 60_000;

      expect(minutes).toBeGreaterThan(9);
      expect(minutes).toBeLessThanOrEqual(10);

      // Mongoose builds indexes in the background, so without this the check
      // races the build and fails only when the suite runs under load.
      await EmailCode.init();

      const indexes = await EmailCode.collection.indexes();
      expect(indexes.some((i) => i.expireAfterSeconds === 0)).toBe(true);
    });

    // Otherwise this endpoint tells an attacker which addresses have accounts.
    it("answers 200 for an unknown address, revealing nothing", async () => {
      const res = await askForCode("nobody@example.com");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("rejects a malformed address", async () => {
      const res = await askForCode("not-an-email");
      expect(res.status).toBe(400);
    });

    // Otherwise the endpoint mail-bombs whichever inbox you point it at.
    it("does not reissue a code within the cooldown", async () => {
      await askForCode();
      const first = currentCode();

      await askForCode();

      expect(outbox).toHaveLength(1); // no second email = no inbox flooding
      expect(currentCode()).toBe(first);
    });

    it("is rejected from a foreign origin", async () => {
      const res = await request(app)
        .post("/api/auth/email/request")
        .set("Origin", "https://evil.example.com")
        .send({ email: EMAIL });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /auth/email/verify", () => {
    it("creates the account on first sign-in and returns working tokens", async () => {
      await askForCode();
      const res = await verify(currentCode());

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ username: "someone" });
      expect(jwt.decode(res.body.accessToken).username).toBe("someone");

      const cookie = res.headers["set-cookie"].find((c) =>
        c.startsWith(TOKEN.COOKIE_NAME)
      );
      expect(cookie).toMatch(/HttpOnly/i);

      const rooms = await request(app)
        .get("/api/rooms")
        .set("Authorization", `Bearer ${res.body.accessToken}`);
      expect(rooms.status).toBe(200);
    });

    it("reuses the account on the second sign-in", async () => {
      await askForCode();
      await verify(currentCode());

      await EmailCode.deleteMany({});
      await requestCode(EMAIL);
      await verify(currentCode());

      await expect(User.countDocuments()).resolves.toBe(1);
    });

    it("burns the code on success — it cannot be replayed", async () => {
      await askForCode();
      const code = currentCode();

      await verify(code);
      const replay = await verify(code);

      expect(replay.status).toBe(400);
    });

    it("rejects a wrong code and counts the attempt", async () => {
      await askForCode();

      const res = await verify("000000".replace("0", "9"));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });

    it("burns the code after 5 wrong attempts, so it cannot be brute-forced", async () => {
      await askForCode();
      const real = currentCode();
      const wrong = real === "111111" ? "222222" : "111111";

      for (let i = 0; i < EMAIL_CODE.MAX_ATTEMPTS; i += 1) await verify(wrong);

      const res = await verify(wrong);
      expect(res.status).toBe(429);

      // Even the CORRECT code no longer works.
      await expect(EmailCode.countDocuments()).resolves.toBe(0);
      expect((await verify(real)).status).toBe(400);
    });

    it("rejects an expired code", async () => {
      await askForCode();
      const code = currentCode();
      await EmailCode.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      expect((await verify(code)).status).toBe(400);
    });

    it("will not accept another address's code", async () => {
      await askForCode("alice@example.com");
      const code = currentCode("alice@example.com");

      await askForCode("bob@example.com");
      const res = await verify(code, "bob@example.com");

      expect(res.status).toBe(400);
    });

    it.each([["12345"], ["1234567"], ["abcdef"], [""]])(
      "rejects a malformed code (%p)",
      async (code) => {
        await askForCode();
        expect((await verify(code)).status).toBe(400);
      }
    );

    it("is rejected from a foreign origin", async () => {
      await askForCode();
      const res = await request(app)
        .post("/api/auth/email/verify")
        .set("Origin", "https://evil.example.com")
        .send({ email: EMAIL, code: currentCode() });

      expect(res.status).toBe(403);
    });
  });
});
