import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import { User } from "../../src/models/User.js";
import { Room } from "../../src/models/Room.js";

describe("Security hardening", () => {
  let user;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    user = await createUser({ username: "alice" });
  });

  describe("Test-only login seam is not mounted by default", () => {
    // The Jest app boots without E2E_TEST_LOGIN, exactly as production does.
    // The OTP-leaking seam must simply not exist unless a test harness asks.
    it("does not expose /api/test/last-code", async () => {
      const res = await user.client.get("/api/test/last-code?email=alice@test.local");

      expect(res.status).toBe(404);
      expect(res.body.code).toBeUndefined();
    });

    it("does not expose the /api/test namespace at all", async () => {
      const res = await user.client.get("/api/test/anything");

      expect(res.status).toBe(404);
    });
  });

  describe("Headers (helmet)", () => {
    it("sets hardening headers and hides the framework", async () => {
      const res = await user.client.get("/api/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["x-dns-prefetch-control"]).toBe("off");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("NoSQL injection", () => {
    it("neutralises an operator object in the body", async () => {
      const room = await createRoom(user.client, { name: "room" });

      // Without sanitising, { $ne: null } would match the first user in the DB.
      const res = await user.client.post(`/api/rooms/${room.id}/invite`, {
        username: { $ne: null },
      });

      expect(res.status).toBe(400); // zod rejects a non-string
      const fresh = await Room.findById(room.id);
      expect(fresh.members).toHaveLength(1);
    });

    it("neutralises an operator in the query string", async () => {
      await createUser({ username: "victim" });

      // Unsanitised, ?q[$ne]= reaches Mongo as { username: { $ne: "" } } and
      // matches every user. We strip the $-key, leaving q as a non-string,
      // which zod then rejects — the query never reaches the database.
      const res = await user.client.get("/api/users/search?q[$ne]=");

      expect(res.status).toBe(400);
      expect(res.body.users).toBeUndefined();
    });
  });

  describe("XSS / stored markup", () => {
    it("strips markup from a room name", async () => {
      const res = await user.client.post("/api/rooms", {
        name: '<img src=x onerror=alert(1)>hello',
      });

      expect(res.status).toBe(201);
      expect(res.body.room.name).toBe("hello");
    });

    it("rejects a name that is only markup", async () => {
      const res = await user.client.post("/api/rooms", { name: "<b></b>" });
      expect(res.status).toBe(400);
    });

    it("strips a script tag entirely, not just the angle brackets", async () => {
      const res = await user.client.post("/api/rooms", {
        name: "<script>alert(1)</script>safe",
      });

      expect(res.body.room.name).toBe("safe");
      expect(res.body.room.name).not.toMatch(/script|alert/i);
    });
  });

  describe("HTTP parameter pollution", () => {
    it("collapses a repeated query param to a single value (last wins)", async () => {
      await createUser({ username: "bob" });

      // Without hpp, req.query.q is the array ["zzz","bob"], zod 400s, and any
      // route that skipped validation would pass an array straight to Mongo.
      const res = await user.client.get("/api/users/search?q=zzz&q=bob");

      expect(res.status).toBe(200);
      expect(res.body.users.map((u) => u.username)).toEqual(["bob"]);
    });
  });

  describe("Payload limits", () => {
    it("rejects an oversized body with 413, not a crash", async () => {
      const res = await user.client.post("/api/rooms", {
        name: "x".repeat(20_000),
      });

      expect(res.status).toBe(413);
      expect(res.body.error).toMatch(/too large/i);
    });

    it("rejects malformed JSON with 400", async () => {
      const res = await user.client
        .post("/api/rooms")
        .set("Content-Type", "application/json")
        .send('{"name": ');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/malformed json/i);
    });
  });

  describe("Error responses", () => {
    it("never leaks a stack trace on a 4xx", async () => {
      const res = await user.client.get("/api/rooms/not-an-id/messages");

      expect(res.status).toBe(404);
      expect(res.body.stack).toBeUndefined();
    });

    it("does not leak internal fields in the user DTO", async () => {
      await createUser({ username: "bob", email: "secret@x.com" });
      const res = await user.client.get("/api/users/search?q=bob");

      expect(res.body.users[0]).not.toHaveProperty("email");
      expect(res.body.users[0]).not.toHaveProperty("providerId");
      expect(res.body.users[0]).not.toHaveProperty("_id");
    });
  });

  describe("Authorisation is enforced server-side", () => {
    it("ignores a forged creator id in the body", async () => {
      const attacker = await createUser({ username: "mallory" });
      const room = await createRoom(user.client, {
        name: "private",
        visibility: "private",
      });

      const res = await attacker.client.patch(`/api/rooms/${room.id}`, {
        name: "pwned",
        creator: attacker.user.id, // mass-assignment attempt
      });

      expect(res.status).toBe(403);
      const fresh = await Room.findById(room.id);
      expect(fresh.name).toBe("private");
      expect(String(fresh.creator)).toBe(String(user.user._id));
    });

    it("rejects a token signed with the wrong secret", async () => {
      const { apiClient } = await import("../helpers/factories.js");
      const forged =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyJ9.bogus-signature";

      const res = await apiClient(forged).get("/api/rooms");
      expect(res.status).toBe(401);
    });
  });

  describe("User enumeration", () => {
    it("search never reveals the caller's own account", async () => {
      const res = await user.client.get("/api/users/search?q=alice");
      expect(res.body.users).toEqual([]);
      await expect(User.countDocuments()).resolves.toBe(1);
    });
  });
});
