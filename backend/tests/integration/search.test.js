import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom, anonymous } from "../helpers/factories.js";
import { createMessage, deleteMessage } from "../../src/services/message.service.js";
import { SEARCH } from "../../src/constants/index.js";

describe("Searching a room's messages", () => {
  let alice;
  let room;

  const say = (text, author = alice) =>
    createMessage({
      roomId: room.id,
      sender: author.user.id,
      username: author.user.username,
      text,
    });

  const search = (who, q, extra = "") =>
    who.client.get(`/api/rooms/${room.id}/messages/search?q=${encodeURIComponent(q)}${extra}`);

  const hits = async (q) => (await search(alice, q)).body.messages.map((m) => m.text);

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    room = await createRoom(alice.client, { name: "lobby" });
  });

  it("finds a message by a word in it", async () => {
    await say("standup is at ten");
    await say("lunch is at noon");

    expect(await hits("standup")).toEqual(["standup is at ten"]);
  });

  it("matches mid-word, the way people expect", async () => {
    await say("standup is at ten");

    expect(await hits("andu")).toEqual(["standup is at ten"]);
  });

  it("ignores case", async () => {
    await say("Standup Is At Ten");

    expect(await hits("standup")).toHaveLength(1);
  });

  it("returns newest first", async () => {
    await say("deploy one");
    await say("deploy two");
    await say("deploy three");

    expect(await hits("deploy")).toEqual(["deploy three", "deploy two", "deploy one"]);
  });

  it("returns nothing when nothing matches", async () => {
    await say("standup is at ten");

    expect(await hits("kubernetes")).toEqual([]);
  });

  it("never returns a deleted message", async () => {
    const message = await say("secret plan");
    await deleteMessage({ messageId: message.id, userId: alice.user.id });

    expect(await hits("secret")).toEqual([]);
  });

  it("caps how many results it will return", async () => {
    for (let i = 0; i < SEARCH.LIMIT + 5; i += 1) await say(`deploy ${i}`);

    const res = await search(alice, "deploy");

    expect(res.body.messages).toHaveLength(SEARCH.LIMIT);
  });

  it("honours a smaller limit", async () => {
    await say("deploy one");
    await say("deploy two");

    const res = await search(alice, "deploy", "&limit=1");

    expect(res.body.messages).toHaveLength(1);
  });

  describe("the query is data, never a pattern", () => {
    it("treats regex metacharacters literally", async () => {
      await say("cost is $5.00");
      await say("cost is 5x00");

      expect(await hits("$5.00")).toEqual(["cost is $5.00"]);
    });

    it("does not let a wildcard match everything", async () => {
      await say("hello");
      await say("goodbye");

      expect(await hits(".*")).toEqual([]);
    });

    it("does not let an anchor change the meaning of the search", async () => {
      await say("hello world");

      expect(await hits("^hello")).toEqual([]);
    });

    it("survives a catastrophic-backtracking pattern without hanging", async () => {
      await say("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!");

      const res = await search(alice, "(a+)+$");

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });

    it("is not fooled by a mongo operator in the query string", async () => {
      await say("hello");

      const res = await alice.client.get(`/api/rooms/${room.id}/messages/search?q[$ne]=x`);

      expect(res.status).toBe(400);
    });
  });

  describe("what is refused", () => {
    it.each([
      ["a missing query", ""],
      ["a one-character query", "?q=a"],
      ["a blank query", "?q=%20%20"],
    ])("rejects %s with 400", async (_label, query) => {
      const res = await alice.client.get(`/api/rooms/${room.id}/messages/search${query}`);
      expect(res.status).toBe(400);
    });

    it("rejects a query longer than the limit", async () => {
      const res = await search(alice, "x".repeat(SEARCH.MAX_LENGTH + 1));
      expect(res.status).toBe(400);
    });

    it("rejects a limit above the cap", async () => {
      const res = await search(alice, "deploy", `&limit=${SEARCH.LIMIT + 1}`);
      expect(res.status).toBe(400);
    });

    it("refuses a non-member — the history is not theirs to read", async () => {
      const outsider = await createUser({ username: "outsider" });
      await say("members only");

      const res = await search(outsider, "members");

      expect(res.status).toBe(403);
    });

    it("refuses an anonymous caller", async () => {
      const res = await anonymous().get(`/api/rooms/${room.id}/messages/search?q=hello`);
      expect(res.status).toBe(401);
    });
  });

  it("searches only within the room asked for", async () => {
    const other = await createRoom(alice.client, { name: "other" });
    await createMessage({
      roomId: other.id,
      sender: alice.user.id,
      username: "alice",
      text: "deploy elsewhere",
    });
    await say("deploy here");

    expect(await hits("deploy")).toEqual(["deploy here"]);
  });
});
