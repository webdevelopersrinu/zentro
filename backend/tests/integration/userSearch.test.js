import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser } from "../helpers/factories.js";

/**
 * The invite box feeds its input straight into a Mongo $regex. Unescaped, any
 * logged-in user could make mongod evaluate a catastrophic-backtracking pattern
 * against every user document — a collection scan on the database every app
 * server shares.
 */
describe("GET /api/users/search — untrusted input", () => {
  let alice;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    await createUser({ username: "alexander" });
    await createUser({ username: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it.each([
    ["catastrophic backtracking", "(a+)+$"],
    ["a leading wildcard", ".*"],
    ["an anchor", "^a"],
    ["an alternation", "a|b"],
  ])("treats %s as literal text, matching nothing", async (_label, q) => {
    const res = await alice.client.get(`/api/users/search?q=${encodeURIComponent(q)}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  it("rejects an over-long term rather than compiling it", async () => {
    const res = await alice.client.get(`/api/users/search?q=${"a".repeat(500)}`);

    expect(res.status).toBe(400);
  });

  it("matches on a prefix, which is what an invite box wants", async () => {
    const res = await alice.client.get("/api/users/search?q=alex");

    expect(res.body.users.map((u) => u.username)).toEqual(["alexander"]);
  });

  it("does not match mid-username, and never returns everyone", async () => {
    const res = await alice.client.get("/api/users/search?q=xander");

    expect(res.body.users).toEqual([]);
  });

  it("ignores a term too short to be a search", async () => {
    const res = await alice.client.get("/api/users/search?q=a");

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });
});
