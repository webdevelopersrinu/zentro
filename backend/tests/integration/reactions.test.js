import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import {
  startSocketServer,
  stopSocketServer,
  connectClient,
  waitFor,
  emitAck,
} from "../helpers/socketServer.js";
import { SOCKET_EVENTS, REACTION_EMOJIS } from "../../src/constants/index.js";
import { Message } from "../../src/models/Message.js";

const [THUMBS, HEART] = REACTION_EMOJIS;

describe("Reactions", () => {
  let server;
  let alice;
  let bob;
  let room;
  const clients = [];

  const connect = async (token) => {
    const socket = await connectClient(server.url, token);
    clients.push(socket);
    return socket;
  };

  const say = async (socket, text) =>
    (await emitAck(socket, SOCKET_EVENTS.MESSAGE_SEND, { roomId: room.id, text })).message;

  const react = (socket, messageId, emoji) =>
    emitAck(socket, SOCKET_EVENTS.MESSAGE_REACT, { messageId, emoji });

  /** The reaction groups as the API reports them. */
  const groupsOf = (ack) => ack.message.reactions;

  beforeAll(async () => {
    await connectTestDB();
    server = await startSocketServer();
  });

  afterAll(async () => {
    await stopSocketServer(server);
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    bob = await createUser({ username: "bob" });
    room = await createRoom(alice.client, { name: "lobby" });
    await bob.client.post(`/api/rooms/${room.id}/join`);
  });

  afterEach(() => clients.splice(0).forEach((socket) => socket.disconnect()));

  it("adds a reaction, carrying who reacted", async () => {
    const socket = await connect(bob.token);
    const message = await say(socket, "standup at 10");

    const ack = await react(socket, message.id, THUMBS);

    expect(ack.ok).toBe(true);
    expect(groupsOf(ack)).toEqual([{ emoji: THUMBS, users: [String(bob.user.id)] }]);
  });

  it("a second click by the same user removes it", async () => {
    const socket = await connect(bob.token);
    const message = await say(socket, "hi");
    await react(socket, message.id, THUMBS);

    const ack = await react(socket, message.id, THUMBS);

    expect(groupsOf(ack)).toEqual([]);
  });

  it("groups two users under one emoji", async () => {
    const aliceSocket = await connect(alice.token);
    const bobSocket = await connect(bob.token);
    const message = await say(aliceSocket, "ship it");

    await react(aliceSocket, message.id, THUMBS);
    const ack = await react(bobSocket, message.id, THUMBS);

    expect(groupsOf(ack)).toHaveLength(1);
    expect(groupsOf(ack)[0].users).toHaveLength(2);
  });

  it("one user removing theirs leaves the others intact", async () => {
    const aliceSocket = await connect(alice.token);
    const bobSocket = await connect(bob.token);
    const message = await say(aliceSocket, "ship it");
    await react(aliceSocket, message.id, THUMBS);
    await react(bobSocket, message.id, THUMBS);

    const ack = await react(aliceSocket, message.id, THUMBS);

    expect(groupsOf(ack)[0].users).toEqual([String(bob.user.id)]);
  });

  it("keeps different emojis as separate groups", async () => {
    const socket = await connect(bob.token);
    const message = await say(socket, "hi");

    await react(socket, message.id, THUMBS);
    const ack = await react(socket, message.id, HEART);

    expect(groupsOf(ack).map((g) => g.emoji)).toEqual([THUMBS, HEART]);
  });

  it("lets one user hold several different reactions at once", async () => {
    const socket = await connect(bob.token);
    const message = await say(socket, "hi");

    await react(socket, message.id, THUMBS);
    const ack = await react(socket, message.id, HEART);

    expect(groupsOf(ack).every((g) => g.users.includes(String(bob.user.id)))).toBe(true);
  });

  it("removes the group entirely when its last user withdraws", async () => {
    const socket = await connect(bob.token);
    const message = await say(socket, "hi");
    await react(socket, message.id, THUMBS);

    await react(socket, message.id, THUMBS);

    const stored = await Message.findById(message.id);
    expect(stored.reactions).toHaveLength(0);
  });

  it("you may react to your own message", async () => {
    const socket = await connect(alice.token);
    const message = await say(socket, "my own");

    const ack = await react(socket, message.id, THUMBS);

    expect(ack.ok).toBe(true);
  });

  it("tells everyone in the room", async () => {
    const aliceSocket = await connect(alice.token);
    const bobSocket = await connect(bob.token);
    const message = await say(aliceSocket, "did you see this");

    const updated = waitFor(bobSocket, SOCKET_EVENTS.MESSAGE_UPDATED);
    await react(aliceSocket, message.id, THUMBS);

    expect(await updated).toMatchObject({
      id: message.id,
      reactions: [{ emoji: THUMBS, users: [String(alice.user.id)] }],
    });
  });

  it("a new message starts with no reactions", async () => {
    const socket = await connect(alice.token);

    const message = await say(socket, "fresh");

    expect(message.reactions).toEqual([]);
  });

  describe("any emoji, not just the quick row", () => {
    it.each([
      ["an emoji outside the quick row", "🍕"],
      ["a ZWJ family sequence", "👨‍👩‍👧‍👦"],
      ["a skin-tone modifier", "👍🏽"],
      ["a flag", "🇮🇳"],
    ])("accepts %s", async (_label, emoji) => {
      const socket = await connect(alice.token);
      const message = await say(socket, "hi");

      const ack = await react(socket, message.id, emoji);

      expect(ack.ok).toBe(true);
      expect(groupsOf(ack)).toEqual([{ emoji, users: [String(alice.user.id)] }]);
    });
  });

  describe("what is refused", () => {
    it.each([
      ["arbitrary text", "not-an-emoji"],
      ["an HTML string", "<script>alert(1)</script>"],
      ["an emoji with text tacked on", "👍 pwned"],
      ["an over-long ZWJ chain", "👍".repeat(64)],
      ["an empty string", ""],
    ])("rejects %s", async (_label, emoji) => {
      const socket = await connect(alice.token);
      const message = await say(socket, "hi");

      const ack = await react(socket, message.id, emoji);

      expect(ack).toMatchObject({ ok: false, error: "Unsupported reaction" });
    });

    it("rejects a reaction on a deleted message", async () => {
      const socket = await connect(alice.token);
      const message = await say(socket, "oops");
      await emitAck(socket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: message.id });

      const ack = await react(socket, message.id, THUMBS);

      expect(ack).toMatchObject({ ok: false, error: "Message was deleted" });
    });

    it("rejects a reaction from someone who is not in the room", async () => {
      const aliceSocket = await connect(alice.token);
      const message = await say(aliceSocket, "private");
      const outsider = await createUser({ username: "outsider" });
      const outsiderSocket = await connect(outsider.token);

      const ack = await react(outsiderSocket, message.id, THUMBS);

      // "Not found", never "forbidden": a 403 would confirm the id is real.
      expect(ack).toMatchObject({ ok: false, error: "Message not found" });
    });

    it("rejects an unknown message id", async () => {
      const socket = await connect(alice.token);

      const ack = await react(socket, "not-an-objectid", THUMBS);

      expect(ack).toMatchObject({ ok: false, error: "Message not found" });
    });
  });

  // The old read-modify-write let both writers see "no group yet" and each push
  // one, corrupting the document into two groups for the same emoji: the UI drew
  // the emoji twice, and every later toggle only ever found the FIRST group — so
  // the second user could never take their own reaction back.
  describe("two people reacting at the same instant", () => {
    it("produces exactly one group holding both of them", async () => {
      const aliceSocket = await connect(alice.token);
      const bobSocket = await connect(bob.token);
      const message = await say(aliceSocket, "race");

      await Promise.all([
        react(aliceSocket, message.id, THUMBS),
        react(bobSocket, message.id, THUMBS),
      ]);

      const stored = await Message.findById(message.id);
      expect(stored.reactions).toHaveLength(1);
      expect(stored.reactions[0].emoji).toBe(THUMBS);
      expect(stored.reactions[0].users.map(String).sort()).toEqual(
        [String(alice.user.id), String(bob.user.id)].sort()
      );
    });

    it("still lets each of them take their own reaction back", async () => {
      const aliceSocket = await connect(alice.token);
      const bobSocket = await connect(bob.token);
      const message = await say(aliceSocket, "race");
      await Promise.all([
        react(aliceSocket, message.id, THUMBS),
        react(bobSocket, message.id, THUMBS),
      ]);

      await react(aliceSocket, message.id, THUMBS);
      const ack = await react(bobSocket, message.id, THUMBS);

      expect(groupsOf(ack)).toEqual([]);
      const stored = await Message.findById(message.id);
      expect(stored.reactions).toHaveLength(0);
    });
  });

  it("survives in history, so reactions are not lost on reload", async () => {
    const socket = await connect(bob.token);
    const message = await say(socket, "persisted");
    await react(socket, message.id, HEART);

    const res = await alice.client.get(`/api/rooms/${room.id}/messages`);

    expect(res.body.messages[0].reactions).toEqual([
      { emoji: HEART, users: [String(bob.user.id)] },
    ]);
  });
});
