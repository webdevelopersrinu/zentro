import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, anonymous } from "../helpers/factories.js";

describe("Users API", () => {
  let alice;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    await createUser({ username: "alexander" });
    await createUser({ username: "bob" });
  });

  describe("GET /api/users/search", () => {
    // Prefix, not substring: the query is anchored (`^al`) so it can use the
    // username index instead of scanning every user.
    it("matches on a username prefix", async () => {
      const res = await alice.client.get("/api/users/search?q=al");

      expect(res.status).toBe(200);
      expect(res.body.users.map((u) => u.username)).toEqual(["alexander"]);
    });

    it("never returns the searcher", async () => {
      const res = await alice.client.get("/api/users/search?q=alice");
      expect(res.body.users).toEqual([]);
    });

    it("returns nothing for an empty query rather than everyone", async () => {
      const res = await alice.client.get("/api/users/search?q=");
      expect(res.body.users).toEqual([]);
    });

    it("exposes only public fields", async () => {
      const res = await alice.client.get("/api/users/search?q=bob");

      expect(res.body.users[0]).toEqual({
        id: expect.any(String),
        username: "bob",
        name: expect.any(String),
        avatarUrl: expect.any(String),
      });
    });

    it("requires authentication", async () => {
      const res = await anonymous().get("/api/users/search?q=bob");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/auth/me", () => {
    it("identifies the bearer of the token", async () => {
      const res = await alice.client.get("/api/auth/me");

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe("alice");
    });

    it("rejects a missing token", async () => {
      const res = await anonymous().get("/api/auth/me");
      expect(res.status).toBe(401);
    });
  });
});
