import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import { Message } from "../../src/models/Message.js";
import { MESSAGE_PAGE } from "../../src/constants/index.js";

/**
 * Seeded straight through the model rather than the socket, so a test can
 * cheaply produce more history than a page holds.
 */
const seedMessages = async (room, user, count) => {
  for (let i = 1; i <= count; i += 1) {
    // Sequential on purpose: _id must increase with `text`, since _id is the cursor.
    await Message.create({ room: room.id, sender: user.id, username: user.username, text: `m${i}` });
  }
};

const textsOf = (res) => res.body.messages.map((m) => m.text);

describe("GET /api/rooms/:id/messages — cursor pagination", () => {
  let owner;
  let room;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    owner = await createUser({ username: "owner" });
    room = await createRoom(owner.client, { name: "history" });
  });

  it("returns the whole history oldest-first when it fits in one page", async () => {
    await seedMessages(room, owner.user, 3);

    const res = await owner.client.get(`/api/rooms/${room.id}/messages`);

    expect(res.status).toBe(200);
    expect(textsOf(res)).toEqual(["m1", "m2", "m3"]);
    expect(res.body.hasMore).toBe(false);
  });

  it("returns the NEWEST page first, not the oldest — the bug pagination fixes", async () => {
    await seedMessages(room, owner.user, MESSAGE_PAGE.DEFAULT + 5);

    const res = await owner.client.get(`/api/rooms/${room.id}/messages`);

    expect(res.body.messages).toHaveLength(MESSAGE_PAGE.DEFAULT);
    expect(res.body.hasMore).toBe(true);
    // Oldest-first within the page, but the page itself is the tail of history.
    expect(textsOf(res).at(0)).toBe("m6");
    expect(textsOf(res).at(-1)).toBe(`m${MESSAGE_PAGE.DEFAULT + 5}`);
  });

  it("walks backwards with `before` and reaches the start exactly once", async () => {
    await seedMessages(room, owner.user, 12);

    const first = await owner.client.get(`/api/rooms/${room.id}/messages?limit=5`);
    expect(textsOf(first)).toEqual(["m8", "m9", "m10", "m11", "m12"]);
    expect(first.body.hasMore).toBe(true);

    const cursor = (res) => res.body.messages[0].id;

    const second = await owner.client.get(
      `/api/rooms/${room.id}/messages?limit=5&before=${cursor(first)}`
    );
    expect(textsOf(second)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    expect(second.body.hasMore).toBe(true);

    const third = await owner.client.get(
      `/api/rooms/${room.id}/messages?limit=5&before=${cursor(second)}`
    );
    expect(textsOf(third)).toEqual(["m1", "m2"]);
    expect(third.body.hasMore).toBe(false);
  });

  it("never repeats or skips a message across pages", async () => {
    await seedMessages(room, owner.user, 20);

    const seen = [];
    let before;
    for (;;) {
      const url = `/api/rooms/${room.id}/messages?limit=6${before ? `&before=${before}` : ""}`;
      const res = await owner.client.get(url);
      seen.unshift(...textsOf(res));
      if (!res.body.hasMore) break;
      before = res.body.messages[0].id;
    }

    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => `m${i + 1}`));
    expect(new Set(seen).size).toBe(20);
  });

  it("hasMore is false when the last page lands exactly on the boundary", async () => {
    await seedMessages(room, owner.user, 5);

    const res = await owner.client.get(`/api/rooms/${room.id}/messages?limit=5`);

    expect(res.body.messages).toHaveLength(5);
    expect(res.body.hasMore).toBe(false);
  });

  it("returns an empty page for a room with no messages", async () => {
    const res = await owner.client.get(`/api/rooms/${room.id}/messages`);

    expect(res.body.messages).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  describe("query validation", () => {
    it.each([
      ["a non-id cursor", "?before=not-an-objectid"],
      ["a zero limit", "?limit=0"],
      ["a negative limit", "?limit=-1"],
      ["a fractional limit", "?limit=1.5"],
      ["a non-numeric limit", "?limit=all"],
      [`a limit above ${MESSAGE_PAGE.MAX}`, `?limit=${MESSAGE_PAGE.MAX + 1}`],
    ])("rejects %s with 400, not 500", async (_label, query) => {
      const res = await owner.client.get(`/api/rooms/${room.id}/messages${query}`);
      expect(res.status).toBe(400);
    });

    it("caps the page at MESSAGE_PAGE.MAX rather than trusting the client", async () => {
      await seedMessages(room, owner.user, MESSAGE_PAGE.MAX + 10);

      const res = await owner.client.get(`/api/rooms/${room.id}/messages?limit=${MESSAGE_PAGE.MAX}`);

      expect(res.body.messages).toHaveLength(MESSAGE_PAGE.MAX);
    });

    it("a well-formed but unknown cursor yields an empty page, not an error", async () => {
      await seedMessages(room, owner.user, 2);
      const unknown = "000000000000000000000000"; // sorts before every real _id

      const res = await owner.client.get(`/api/rooms/${room.id}/messages?before=${unknown}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
      expect(res.body.hasMore).toBe(false);
    });
  });

  it("still refuses a non-member, cursor or not", async () => {
    const outsider = await createUser({ username: "outsider" });
    await seedMessages(room, owner.user, 3);

    const res = await outsider.client.get(`/api/rooms/${room.id}/messages?limit=1`);

    expect(res.status).toBe(403);
  });
});
