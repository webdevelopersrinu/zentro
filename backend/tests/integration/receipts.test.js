import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom, anonymous } from "../helpers/factories.js";
import { createMessage } from "../../src/services/message.service.js";

const say = (room, author, text) =>
  createMessage({
    roomId: room.id,
    sender: author.user.id,
    username: author.user.username,
    text,
  });

const receipts = async (who, roomId) => (await who.client.get(`/api/rooms/${roomId}/receipts`)).body;

/** How many other members have read a message sent at this instant. */
const readersOf = (body, sentAt) =>
  body.receipts.filter((r) => new Date(r.lastReadAt) >= new Date(sentAt)).length;

describe("Read receipts", () => {
  let alice;
  let bob;
  let carol;
  let room;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    alice = await createUser({ username: "alice" });
    bob = await createUser({ username: "bob" });
    carol = await createUser({ username: "carol" });
    room = await createRoom(alice.client, { name: "town-square" });
    await bob.client.post(`/api/rooms/${room.id}/join`);
    await carol.client.post(`/api/rooms/${room.id}/join`);
  });

  it("reports the room's member count, so the UI knows what 'everyone' means", async () => {
    const body = await receipts(alice, room.id);

    expect(body.memberCount).toBe(3);
  });

  it("leaves the caller out — you are never a reader of your own message", async () => {
    await alice.client.post(`/api/rooms/${room.id}/read`);

    const body = await receipts(alice, room.id);

    expect(body.receipts).toEqual([]);
  });

  it("a member who has read nothing is simply absent", async () => {
    const body = await receipts(alice, room.id);

    expect(body.receipts).toEqual([]);
  });

  it("nobody has read a message the moment it is sent", async () => {
    const message = await say(room, alice, "hello");

    const body = await receipts(alice, room.id);

    expect(readersOf(body, message.createdAt)).toBe(0);
  });

  it("counts one reader once a single member opens the room", async () => {
    const message = await say(room, alice, "hello");

    await bob.client.post(`/api/rooms/${room.id}/read`);

    const body = await receipts(alice, room.id);
    expect(readersOf(body, message.createdAt)).toBe(1);
    expect(body.memberCount - 1).toBe(2); // still waiting on carol
  });

  it("counts every reader once they have all opened the room", async () => {
    const message = await say(room, alice, "hello");

    await bob.client.post(`/api/rooms/${room.id}/read`);
    await carol.client.post(`/api/rooms/${room.id}/read`);

    const body = await receipts(alice, room.id);
    expect(readersOf(body, message.createdAt)).toBe(body.memberCount - 1);
  });

  it("an older read does not count for a newer message", async () => {
    await bob.client.post(`/api/rooms/${room.id}/read`);
    const later = await say(room, alice, "sent after bob looked away");

    const body = await receipts(alice, room.id);

    expect(readersOf(body, later.createdAt)).toBe(0);
  });

  it("a reader's mark moves forward when they come back", async () => {
    await bob.client.post(`/api/rooms/${room.id}/read`);
    const later = await say(room, alice, "sent after bob looked away");

    await bob.client.post(`/api/rooms/${room.id}/read`);

    const body = await receipts(alice, room.id);
    expect(readersOf(body, later.createdAt)).toBe(1);
  });

  it("sending counts as reading, so an author never waits on themselves", async () => {
    const message = await say(room, bob, "from bob");

    // Alice asks: has bob read it? He wrote it, so his mark is at least that late.
    const body = await receipts(alice, room.id);
    const bobsMark = body.receipts.find((r) => r.userId === String(bob.user.id));

    expect(new Date(bobsMark.lastReadAt) >= new Date(message.createdAt)).toBe(true);
  });

  it("forgets a member's receipt once they leave", async () => {
    await bob.client.post(`/api/rooms/${room.id}/read`);

    await bob.client.post(`/api/rooms/${room.id}/leave`);

    const body = await receipts(alice, room.id);
    expect(body.receipts).toEqual([]);
    expect(body.memberCount).toBe(2);
  });

  describe("access control", () => {
    it("refuses a non-member — receipts say who is in the room and when they looked", async () => {
      const outsider = await createUser({ username: "outsider" });

      const res = await outsider.client.get(`/api/rooms/${room.id}/receipts`);

      expect(res.status).toBe(403);
    });

    it("refuses an anonymous caller", async () => {
      const res = await anonymous().get(`/api/rooms/${room.id}/receipts`);

      expect(res.status).toBe(401);
    });

    it("never leaks a lastReadAt for someone who is not a member", async () => {
      const outsider = await createUser({ username: "outsider" });
      await outsider.client.post(`/api/rooms/${room.id}/read`); // forbidden, writes nothing

      const body = await receipts(alice, room.id);

      expect(body.receipts.map((r) => r.userId)).not.toContain(String(outsider.user.id));
    });
  });
});
