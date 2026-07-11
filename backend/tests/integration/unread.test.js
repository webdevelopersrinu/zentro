import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import { createMessage } from "../../src/services/message.service.js";
import { RoomRead } from "../../src/models/RoomRead.js";

/** Goes through the service, so lastMessageAt and the sender's read row are set. */
const say = (room, author, text) =>
  createMessage({
    roomId: room.id,
    sender: author.user.id,
    username: author.user.username,
    text,
  });

const myRooms = async (who) => (await who.client.get("/api/rooms")).body.rooms;

const unreadFor = async (who, roomId) =>
  (await myRooms(who)).find((room) => room.id === roomId).unread;

describe("Unread state survives a reload", () => {
  let alice;
  let bob;
  let room;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    bob = await createUser({ username: "bob" });
    room = await createRoom(alice.client, { name: "town-square" });
    await bob.client.post(`/api/rooms/${room.id}/join`);
  });

  it("a room with no messages is not unread", async () => {
    expect(await unreadFor(bob, room.id)).toBe(false);
  });

  it("a message from someone else makes the room unread", async () => {
    await say(room, alice, "hello");

    expect(await unreadFor(bob, room.id)).toBe(true);
  });

  it("does not mark the AUTHOR's own room unread", async () => {
    await say(room, alice, "hello");

    expect(await unreadFor(alice, room.id)).toBe(false);
  });

  it("stays unread across requests until the room is opened", async () => {
    await say(room, alice, "hello");

    expect(await unreadFor(bob, room.id)).toBe(true);
    expect(await unreadFor(bob, room.id)).toBe(true); // a reload changes nothing
  });

  it("clears once the room is marked read", async () => {
    await say(room, alice, "hello");

    const res = await bob.client.post(`/api/rooms/${room.id}/read`);

    expect(res.status).toBe(200);
    expect(await unreadFor(bob, room.id)).toBe(false);
  });

  it("goes unread again on the next message", async () => {
    await say(room, alice, "one");
    await bob.client.post(`/api/rooms/${room.id}/read`);

    await say(room, alice, "two");

    expect(await unreadFor(bob, room.id)).toBe(true);
  });

  it("a member who never opened a room with history sees it as unread", async () => {
    await say(room, alice, "said before carol arrived");
    const carol = await createUser({ username: "carol" });
    await carol.client.post(`/api/rooms/${room.id}/join`);

    expect(await unreadFor(carol, room.id)).toBe(true);
    await expect(RoomRead.findOne({ room: room.id, user: carol.user.id })).resolves.toBeNull();
  });

  it("tracks each member separately", async () => {
    await say(room, alice, "hello");
    await bob.client.post(`/api/rooms/${room.id}/read`);
    const carol = await createUser({ username: "carol" });
    await carol.client.post(`/api/rooms/${room.id}/join`);

    expect(await unreadFor(bob, room.id)).toBe(false);
    expect(await unreadFor(carol, room.id)).toBe(true);
  });

  it("keeps one read row per member, however often they open the room", async () => {
    await bob.client.post(`/api/rooms/${room.id}/read`);
    await bob.client.post(`/api/rooms/${room.id}/read`);
    await bob.client.post(`/api/rooms/${room.id}/read`);

    await expect(RoomRead.countDocuments({ room: room.id, user: bob.user.id })).resolves.toBe(1);
  });

  describe("access control and cleanup", () => {
    it("a non-member cannot mark a room read", async () => {
      const outsider = await createUser({ username: "outsider" });

      const res = await outsider.client.post(`/api/rooms/${room.id}/read`);

      expect(res.status).toBe(403);
    });

    it("an anonymous caller cannot mark a room read", async () => {
      const { anonymous } = await import("../helpers/factories.js");

      const res = await anonymous().post(`/api/rooms/${room.id}/read`);

      expect(res.status).toBe(401);
    });

    it("forgets the read state when a member leaves", async () => {
      await bob.client.post(`/api/rooms/${room.id}/read`);

      await bob.client.post(`/api/rooms/${room.id}/leave`);

      await expect(RoomRead.findOne({ room: room.id, user: bob.user.id })).resolves.toBeNull();
    });

    it("forgets every read state when the room is deleted", async () => {
      await bob.client.post(`/api/rooms/${room.id}/read`);

      await alice.client.delete(`/api/rooms/${room.id}`);

      await expect(RoomRead.countDocuments({ room: room.id })).resolves.toBe(0);
    });
  });
});
