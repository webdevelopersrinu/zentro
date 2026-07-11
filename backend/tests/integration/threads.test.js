import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import { createMessage, deleteMessage } from "../../src/services/message.service.js";
import { Message } from "../../src/models/Message.js";

describe("Threads", () => {
  let alice;
  let bob;
  let room;

  const say = (text, { parentId = null, author = alice, inRoom = room } = {}) =>
    createMessage({
      roomId: inRoom.id,
      sender: author.user.id,
      username: author.user.username,
      text,
      parentId,
    });

  const mainList = async (who = alice) =>
    (await who.client.get(`/api/rooms/${room.id}/messages`)).body.messages;

  const thread = (parentId, who = alice) =>
    who.client.get(`/api/rooms/${room.id}/messages/${parentId}/replies`);

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    bob = await createUser({ username: "bob" });
    room = await createRoom(alice.client, { name: "lobby" });
    await bob.client.post(`/api/rooms/${room.id}/join`);
  });

  it("a plain message has no parent and no replies", async () => {
    await say("standalone");

    const [message] = await mainList();
    expect(message).toMatchObject({ parentId: null, replyCount: 0 });
  });

  it("a reply names its parent", async () => {
    const parent = await say("standup at ten?");

    const reply = await say("works for me", { parentId: parent.id, author: bob });

    expect(String(reply.parent)).toBe(String(parent.id));
  });

  it("keeps replies OUT of the main list", async () => {
    const parent = await say("standup at ten?");
    await say("works for me", { parentId: parent.id, author: bob });

    const messages = await mainList();

    expect(messages.map((m) => m.text)).toEqual(["standup at ten?"]);
  });

  it("counts replies on the parent, so the main list needs no extra query", async () => {
    const parent = await say("standup at ten?");
    await say("works for me", { parentId: parent.id, author: bob });
    await say("me too", { parentId: parent.id });

    const [message] = await mainList();

    expect(message.replyCount).toBe(2);
  });

  it("returns the whole thread, oldest first, with its parent", async () => {
    const parent = await say("standup at ten?");
    await say("first", { parentId: parent.id, author: bob });
    await say("second", { parentId: parent.id });

    const res = await thread(parent.id);

    expect(res.status).toBe(200);
    expect(res.body.parent.text).toBe("standup at ten?");
    expect(res.body.replies.map((r) => r.text)).toEqual(["first", "second"]);
  });

  it("an unanswered message has an empty thread", async () => {
    const parent = await say("nobody cares");

    const res = await thread(parent.id);

    expect(res.body.replies).toEqual([]);
  });

  it("a reply keeps its own reactions and edits, like any message", async () => {
    const parent = await say("standup at ten?");
    const reply = await say("works", { parentId: parent.id });

    const res = await thread(parent.id);

    expect(res.body.replies[0]).toMatchObject({ reactions: [], editedAt: null, deleted: false });
  });

  it("a deleted reply stays in the thread as a tombstone", async () => {
    const parent = await say("standup at ten?");
    const reply = await say("oops", { parentId: parent.id });
    await deleteMessage({ messageId: reply.id, userId: alice.user.id });

    const res = await thread(parent.id);

    expect(res.body.replies).toHaveLength(1);
    expect(res.body.replies[0]).toMatchObject({ deleted: true, text: "" });
  });

  it("deleting a reply does not change the count — its tombstone is still there", async () => {
    const parent = await say("standup at ten?");
    const reply = await say("oops", { parentId: parent.id });
    await deleteMessage({ messageId: reply.id, userId: alice.user.id });

    const [message] = await mainList();

    expect(message.replyCount).toBe(1);
  });

  describe("what is refused", () => {
    it("a reply to a reply — threads are one level deep", async () => {
      const parent = await say("standup at ten?");
      const reply = await say("works", { parentId: parent.id });

      await expect(say("nested", { parentId: reply.id })).rejects.toThrow(
        "Replies cannot be replied to"
      );
    });

    it("a reply to a deleted message", async () => {
      const parent = await say("standup at ten?");
      await deleteMessage({ messageId: parent.id, userId: alice.user.id });

      await expect(say("too late", { parentId: parent.id })).rejects.toThrow("Message was deleted");
    });

    it("a reply to a message in another room, reported as simply not found", async () => {
      const other = await createRoom(alice.client, { name: "other" });
      const elsewhere = await say("over here", { inRoom: other });

      await expect(say("grafted", { parentId: elsewhere.id })).rejects.toThrow("Message not found");
    });

    it("a reply to an id that does not exist", async () => {
      await expect(say("into the void", { parentId: "not-an-objectid" })).rejects.toThrow(
        "Message not found"
      );
    });

    it("reading a thread in a room you are not in", async () => {
      const parent = await say("members only");
      const outsider = await createUser({ username: "outsider" });

      const res = await thread(parent.id, outsider);

      expect(res.status).toBe(403);
    });

    it("reading a thread whose parent lives in another room", async () => {
      const other = await createRoom(alice.client, { name: "other" });
      const elsewhere = await say("over here", { inRoom: other });

      const res = await thread(elsewhere.id);

      expect(res.status).toBe(404);
    });
  });

  it("a reply still marks the room unread for everyone else", async () => {
    const parent = await say("standup at ten?");
    await bob.client.post(`/api/rooms/${room.id}/read`);

    await say("a late reply", { parentId: parent.id });

    const rooms = (await bob.client.get("/api/rooms")).body.rooms;
    expect(rooms.find((r) => r.id === room.id).unread).toBe(true);
  });

  it("search finds a reply, even though the main list hides it", async () => {
    const parent = await say("standup at ten?");
    await say("kubernetes upgrade too", { parentId: parent.id });

    const res = await alice.client.get(`/api/rooms/${room.id}/messages/search?q=kubernetes`);

    expect(res.body.messages.map((m) => m.text)).toEqual(["kubernetes upgrade too"]);
  });

  it("the parent's counter and the stored replies never disagree", async () => {
    const parent = await say("standup at ten?");
    await say("one", { parentId: parent.id });
    await say("two", { parentId: parent.id, author: bob });

    const stored = await Message.findById(parent.id);
    const actual = await Message.countDocuments({ parent: parent.id });

    expect(stored.replyCount).toBe(actual);
  });
});
