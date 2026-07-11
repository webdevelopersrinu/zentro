import mongoose from "mongoose";

import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import {
  startSocketServer,
  stopSocketServer,
  connectClient,
  waitFor,
  expectNoEvent,
  emitAck,
} from "../helpers/socketServer.js";
import { SOCKET_EVENTS, MESSAGE_EDIT_WINDOW_MS } from "../../src/constants/index.js";
import { Message } from "../../src/models/Message.js";

describe("Editing and deleting your own messages", () => {
  let server;
  let author;
  let bystander;
  let room;
  const clients = [];

  const connect = async (token) => {
    const socket = await connectClient(server.url, token);
    clients.push(socket);
    return socket;
  };

  const say = async (socket, text) => {
    const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_SEND, { roomId: room.id, text });
    expect(ack.ok).toBe(true);
    return ack.message;
  };

  /**
   * Backdates a message so the edit window can be tested without waiting an
   * hour. Goes through the raw driver: `timestamps: true` makes Mongoose treat
   * `createdAt` as immutable and silently drop it from an update.
   */
  const age = (messageId, ms) =>
    Message.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(String(messageId)) },
      { $set: { createdAt: new Date(Date.now() - ms) } }
    );

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
    author = await createUser({ username: "author" });
    bystander = await createUser({ username: "bystander" });
    room = await createRoom(author.client, { name: "lobby" });
    await bystander.client.post(`/api/rooms/${room.id}/join`);
  });

  afterEach(() => clients.splice(0).forEach((socket) => socket.disconnect()));

  describe("editing", () => {
    it("rewrites the message and marks it edited", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "helo");

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "hello",
      });

      expect(ack.ok).toBe(true);
      expect(ack.message).toMatchObject({ id: sent.id, text: "hello", deleted: false });
      expect(ack.message.editedAt).not.toBeNull();
      await expect(Message.findById(sent.id)).resolves.toMatchObject({ text: "hello" });
    });

    it("tells everyone else in the room", async () => {
      const authorSocket = await connect(author.token);
      const otherSocket = await connect(bystander.token);
      const sent = await say(authorSocket, "helo");

      const updated = waitFor(otherSocket, SOCKET_EVENTS.MESSAGE_UPDATED);
      await emitAck(authorSocket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "hello",
      });

      expect(await updated).toMatchObject({ id: sent.id, text: "hello" });
    });

    it("allows an edit just inside the one-hour window", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "helo");
      await age(sent.id, MESSAGE_EDIT_WINDOW_MS - 60_000);

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "hello",
      });

      expect(ack.ok).toBe(true);
    });

    it("refuses an edit once the window has passed", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "helo");
      await age(sent.id, MESSAGE_EDIT_WINDOW_MS + 1000);

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "hello",
      });

      expect(ack).toMatchObject({ ok: false });
      expect(ack.error).toMatch(/within an hour/);
      await expect(Message.findById(sent.id)).resolves.toMatchObject({ text: "helo" });
    });

    it("measures the window from sending, so editing cannot extend it forever", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "one");

      await age(sent.id, MESSAGE_EDIT_WINDOW_MS - 60_000);
      expect((await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, { messageId: sent.id, text: "two" })).ok).toBe(true);

      // The edit refreshed `editedAt`, not `createdAt`: the door still closes.
      await age(sent.id, MESSAGE_EDIT_WINDOW_MS + 1000);
      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "three",
      });

      expect(ack.ok).toBe(false);
    });

    it("refuses to edit someone else's message, and does not admit it exists", async () => {
      const authorSocket = await connect(author.token);
      const otherSocket = await connect(bystander.token);
      const sent = await say(authorSocket, "mine");

      const ack = await emitAck(otherSocket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "hijacked",
      });

      expect(ack).toMatchObject({ ok: false, error: "Message not found" });
      await expect(Message.findById(sent.id)).resolves.toMatchObject({ text: "mine" });
    });

    it("refuses an edit from a member who has left the room", async () => {
      const socket = await connect(bystander.token);
      const sent = await say(socket, "bye");
      await bystander.client.post(`/api/rooms/${room.id}/leave`);

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "still here",
      });

      expect(ack.ok).toBe(false);
    });

    it.each([
      ["an empty edit", ""],
      ["a whitespace-only edit", "   "],
      ["a markup-only edit", "<b></b>"],
    ])("rejects %s", async (_label, text) => {
      const socket = await connect(author.token);
      const sent = await say(socket, "real");

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, { messageId: sent.id, text });

      expect(ack).toMatchObject({ ok: false, error: "Empty message" });
    });

    it("strips markup from an edit, as it does from a new message", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "plain");

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "<img src=x onerror=alert(1)>hi",
      });

      expect(ack.message.text).not.toMatch(/</);
    });

    it("rejects an unknown message id without a 500", async () => {
      const socket = await connect(author.token);

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: "not-an-objectid",
        text: "hi",
      });

      expect(ack).toMatchObject({ ok: false, error: "Message not found" });
    });
  });

  describe("deleting", () => {
    it("keeps the message as a tombstone and drops the words", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "regrettable");

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      expect(ack.message).toMatchObject({ id: sent.id, text: "", deleted: true });
      await expect(Message.findById(sent.id)).resolves.toMatchObject({ text: "" });
    });

    it("has no time limit — you can always retract your own words", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "old news");
      await age(sent.id, MESSAGE_EDIT_WINDOW_MS * 100);

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      expect(ack.ok).toBe(true);
    });

    it("tells everyone else in the room", async () => {
      const authorSocket = await connect(author.token);
      const otherSocket = await connect(bystander.token);
      const sent = await say(authorSocket, "oops");

      const deleted = waitFor(otherSocket, SOCKET_EVENTS.MESSAGE_DELETED);
      await emitAck(authorSocket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      expect(await deleted).toMatchObject({ id: sent.id, deleted: true, text: "" });
    });

    it("refuses to delete someone else's message", async () => {
      const authorSocket = await connect(author.token);
      const otherSocket = await connect(bystander.token);
      const sent = await say(authorSocket, "mine");

      const ack = await emitAck(otherSocket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      expect(ack).toMatchObject({ ok: false, error: "Message not found" });
    });

    it("a second delete is refused, and re-broadcasts nothing", async () => {
      const authorSocket = await connect(author.token);
      const otherSocket = await connect(bystander.token);
      const sent = await say(authorSocket, "oops");
      await emitAck(authorSocket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      const ack = await emitAck(authorSocket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      expect(ack).toMatchObject({ ok: false, error: "Message was deleted" });
      await expectNoEvent(otherSocket, SOCKET_EVENTS.MESSAGE_DELETED);
    });

    it("a deleted message cannot then be edited back into existence", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "oops");
      await emitAck(socket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      const ack = await emitAck(socket, SOCKET_EVENTS.MESSAGE_EDIT, {
        messageId: sent.id,
        text: "undeleted",
      });

      expect(ack).toMatchObject({ ok: false, error: "Message was deleted" });
      await expect(Message.findById(sent.id)).resolves.toMatchObject({ text: "" });
    });

    it("history still serves the tombstone, so the conversation reads sensibly", async () => {
      const socket = await connect(author.token);
      const sent = await say(socket, "oops");
      await emitAck(socket, SOCKET_EVENTS.MESSAGE_DELETE, { messageId: sent.id });

      const res = await author.client.get(`/api/rooms/${room.id}/messages`);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0]).toMatchObject({ deleted: true, text: "" });
    });
  });
});
