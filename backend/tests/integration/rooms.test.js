import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom, anonymous } from "../helpers/factories.js";
import {
  startSocketServer,
  stopSocketServer,
  connectClient,
  expectNoEvent,
  emitAck,
} from "../helpers/socketServer.js";
import { ROOM_VISIBILITY, SOCKET_EVENTS } from "../../src/constants/index.js";
import { Room } from "../../src/models/Room.js";

const PUBLIC = { name: "town-square", visibility: ROOM_VISIBILITY.PUBLIC };
const PRIVATE = { name: "war-room", visibility: ROOM_VISIBILITY.PRIVATE };

describe("Rooms API", () => {
  let owner; // creator / admin
  let outsider;

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    owner = await createUser({ username: "owner" });
    outsider = await createUser({ username: "outsider" });
  });

  describe("POST /api/rooms", () => {
    it("creates a room with the caller as creator and sole member", async () => {
      const res = await owner.client.post("/api/rooms", PUBLIC);

      expect(res.status).toBe(201);
      expect(res.body.room).toMatchObject({
        name: PUBLIC.name,
        visibility: ROOM_VISIBILITY.PUBLIC,
        isCreator: true,
        isMember: true,
        memberCount: 1,
        requestCount: 0,
      });
    });

    it("defaults to public", async () => {
      const room = await createRoom(owner.client, { name: "defaulted" });
      expect(room.visibility).toBe(ROOM_VISIBILITY.PUBLIC);
    });

    it.each([
      ["an invalid visibility", { name: "x", visibility: "secret" }],
      ["a blank name", { name: "   " }],
      ["a missing name", {}],
    ])("rejects %s", async (_label, body) => {
      const res = await owner.client.post("/api/rooms", body);
      expect(res.status).toBe(400);
    });

    it("rejects an anonymous caller", async () => {
      const res = await anonymous().post("/api/rooms", PUBLIC);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/rooms/discover", () => {
    it("lists rooms you are not in, including locked private ones", async () => {
      await createRoom(owner.client, PUBLIC);
      await createRoom(owner.client, PRIVATE);

      const res = await outsider.client.get("/api/rooms/discover");

      expect(res.status).toBe(200);
      expect(res.body.rooms.map((r) => r.name).sort()).toEqual([
        "town-square",
        "war-room",
      ]);
      expect(res.body.rooms.every((r) => r.isMember === false)).toBe(true);
    });

    it("excludes rooms you already belong to", async () => {
      await createRoom(owner.client, PUBLIC);
      const res = await owner.client.get("/api/rooms/discover");
      expect(res.body.rooms).toEqual([]);
    });
  });

  describe("Joining a PUBLIC room", () => {
    it("anyone may join instantly", async () => {
      const room = await createRoom(owner.client, PUBLIC);

      const res = await outsider.client.post(`/api/rooms/${room.id}/join`);
      expect(res.status).toBe(200);
      expect(res.body.joined).toBe(true);

      const mine = await outsider.client.get("/api/rooms");
      expect(mine.body.rooms).toHaveLength(1);
      expect(mine.body.rooms[0].memberCount).toBe(2);
    });

    it("rejects joining twice", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const res = await outsider.client.post(`/api/rooms/${room.id}/join`);
      expect(res.status).toBe(400);
    });
  });

  describe("Joining a PRIVATE room", () => {
    it("records a request without granting membership", async () => {
      const room = await createRoom(owner.client, PRIVATE);

      const res = await outsider.client.post(`/api/rooms/${room.id}/join`);
      expect(res.status).toBe(200);
      expect(res.body.requested).toBe(true);
      expect(res.body.room).toMatchObject({ isMember: false, hasRequested: true });
    });

    it("still denies message history to a requester", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const res = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(res.status).toBe(403);
    });

    it("does not duplicate a repeated request", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await outsider.client.post(`/api/rooms/${room.id}/join`);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const res = await owner.client.get(`/api/rooms/${room.id}/requests`);
      expect(res.body.requests).toHaveLength(1);
    });
  });

  describe("Approving and rejecting requests", () => {
    let room;

    beforeEach(async () => {
      room = await createRoom(owner.client, PRIVATE);
      await outsider.client.post(`/api/rooms/${room.id}/join`);
    });

    it("lets only the creator list requests", async () => {
      await expect(
        outsider.client.get(`/api/rooms/${room.id}/requests`)
      ).resolves.toMatchObject({ status: 403 });
    });

    it("lets only the creator approve", async () => {
      const res = await outsider.client.post(
        `/api/rooms/${room.id}/requests/${outsider.user.id}/approve`
      );
      expect(res.status).toBe(403);
    });

    it("grants membership and read access on approval", async () => {
      const res = await owner.client.post(
        `/api/rooms/${room.id}/requests/${outsider.user.id}/approve`
      );
      expect(res.status).toBe(200);
      expect(res.body.room).toMatchObject({ memberCount: 2, requestCount: 0 });

      const read = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(read.status).toBe(200);
    });

    it("404s when approving an already-cleared request", async () => {
      const url = `/api/rooms/${room.id}/requests/${outsider.user.id}/approve`;
      await owner.client.post(url);

      const res = await owner.client.post(url);
      expect(res.status).toBe(404);
    });

    it("removes the request without granting access on rejection", async () => {
      const res = await owner.client.post(
        `/api/rooms/${room.id}/requests/${outsider.user.id}/reject`
      );
      expect(res.status).toBe(200);
      expect(res.body.room.memberCount).toBe(1);

      const read = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(read.status).toBe(403);
    });
  });

  describe("Invites", () => {
    const inviteOutsider = (room) =>
      owner.client.post(`/api/rooms/${room.id}/invite`, {
        username: outsider.user.username,
      });

    // An invite is an OFFER. Nobody joins a room without their own consent.
    it("does not make the invitee a member until they accept", async () => {
      const room = await createRoom(owner.client, PRIVATE);

      const res = await inviteOutsider(room);
      expect(res.status).toBe(200);
      expect(res.body.room.memberCount).toBe(1);

      const read = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(read.status).toBe(403);
    });

    it("flags the pending invite on the room the invitee sees", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await inviteOutsider(room);

      const { body } = await outsider.client.get("/api/rooms/discover");

      expect(body.rooms.find((r) => r.id === room.id)).toMatchObject({
        isInvited: true,
        isMember: false,
      });
    });

    // Accepting an invite IS joining — the invite is a pre-approved join.
    it("admits the invitee on accept, even to a private room", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await inviteOutsider(room);

      const accept = await outsider.client.post(`/api/rooms/${room.id}/join`);
      expect(accept.body).toMatchObject({ joined: true });

      const read = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(read.status).toBe(200);
    });

    it("lets the invitee decline, leaving them outside", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await inviteOutsider(room);

      const res = await outsider.client.post(`/api/rooms/${room.id}/invite/decline`);
      expect(res.status).toBe(200);

      const { body } = await outsider.client.get("/api/rooms/discover");
      expect(body.rooms.find((r) => r.id === room.id).isInvited).toBe(false);

      const read = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(read.status).toBe(403);
    });

    it("404s when declining an invite that was never made", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      const res = await outsider.client.post(`/api/rooms/${room.id}/invite/decline`);

      expect(res.status).toBe(404);
    });

    it("does not queue a duplicate invite", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await inviteOutsider(room);
      await inviteOutsider(room);

      await outsider.client.post(`/api/rooms/${room.id}/invite/decline`);

      // A single decline must clear it; a duplicate would still be pending.
      const { body } = await outsider.client.get("/api/rooms/discover");
      expect(body.rooms.find((r) => r.id === room.id).isInvited).toBe(false);
    });

    // Both sides said yes, so there is nothing left to decide.
    it("admits immediately when the invitee had already requested to join", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await outsider.client.post(`/api/rooms/${room.id}/join`); // request

      const res = await inviteOutsider(room);

      expect(res.body.room).toMatchObject({ memberCount: 2, requestCount: 0 });
      const read = await outsider.client.get(`/api/rooms/${room.id}/messages`);
      expect(read.status).toBe(200);
    });

    it("rejects inviting someone who is already a member", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const res = await inviteOutsider(room);
      expect(res.status).toBe(400);
    });

    it("forbids non-creators from inviting", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const res = await outsider.client.post(`/api/rooms/${room.id}/invite`, {
        username: owner.user.username,
      });
      expect(res.status).toBe(403);
    });

    it("404s on an unknown username", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      const res = await owner.client.post(`/api/rooms/${room.id}/invite`, {
        username: "ghost",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Leaving", () => {
    it("lets a member leave", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const res = await outsider.client.post(`/api/rooms/${room.id}/leave`);
      expect(res.status).toBe(200);

      const mine = await outsider.client.get("/api/rooms");
      expect(mine.body.rooms).toEqual([]);
    });

    it("forbids the creator from leaving their own room", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      const res = await owner.client.post(`/api/rooms/${room.id}/leave`);
      expect(res.status).toBe(400);
    });
  });

  describe("Update and delete", () => {
    it("lets the creator rename and change visibility", async () => {
      const room = await createRoom(owner.client, PUBLIC);

      const res = await owner.client.patch(`/api/rooms/${room.id}`, {
        name: "renamed",
        visibility: ROOM_VISIBILITY.PRIVATE,
      });
      expect(res.status).toBe(200);
      expect(res.body.room).toMatchObject({
        name: "renamed",
        visibility: ROOM_VISIBILITY.PRIVATE,
      });
    });

    it("forbids non-creators from updating or deleting", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const patched = await outsider.client.patch(`/api/rooms/${room.id}`, {
        name: "x",
      });
      const deleted = await outsider.client.delete(`/api/rooms/${room.id}`);

      expect(patched.status).toBe(403);
      expect(deleted.status).toBe(403);
    });

    it("deletes the room, and 404s on a second delete", async () => {
      const room = await createRoom(owner.client, PUBLIC);

      await expect(
        owner.client.delete(`/api/rooms/${room.id}`)
      ).resolves.toMatchObject({ status: 200 });
      await expect(
        owner.client.delete(`/api/rooms/${room.id}`)
      ).resolves.toMatchObject({ status: 404 });
    });
  });

  // Two tabs, or two admins clicking at the same time. Every one of these used
  // to leave a duplicate member (→ inflated memberCount → read receipts in that
  // room never turn blue again) or a phantom pending request.
  describe("Concurrent membership mutations", () => {
    const memberIds = async (id) =>
      (await Room.findById(id)).members.map(String);

    it("admits a user exactly once when two joins race", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      const join = () => outsider.client.post(`/api/rooms/${room.id}/join`);

      await Promise.all([join(), join()]);

      const ids = await memberIds(room.id);
      expect(ids.filter((m) => m === outsider.user.id)).toHaveLength(1);
      expect(ids).toHaveLength(2);
    });

    it("admits a user exactly once when two approvals of the same request race", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const approve = () =>
        owner.client.post(
          `/api/rooms/${room.id}/requests/${outsider.user.id}/approve`
        );
      await Promise.all([approve(), approve()]);

      const ids = await memberIds(room.id);
      expect(ids.filter((m) => m === outsider.user.id)).toHaveLength(1);
    });

    it("clears both requests when two admins approve two different ones at once", async () => {
      const second = await createUser({ username: "second-admin" });
      const other = await createUser({ username: "other" });

      const room = await createRoom(owner.client, PRIVATE);
      await owner.client.post(`/api/rooms/${room.id}/invite`, {
        username: second.user.username,
      });
      await second.client.post(`/api/rooms/${room.id}/join`); // accepts
      await owner.client.post(`/api/rooms/${room.id}/admins/${second.user.id}`);

      await outsider.client.post(`/api/rooms/${room.id}/join`);
      await other.client.post(`/api/rooms/${room.id}/join`);

      await Promise.all([
        owner.client.post(
          `/api/rooms/${room.id}/requests/${outsider.user.id}/approve`
        ),
        second.client.post(
          `/api/rooms/${room.id}/requests/${other.user.id}/approve`
        ),
      ]);

      const fresh = await Room.findById(room.id);
      expect(fresh.joinRequests).toHaveLength(0);
      expect(fresh.members.map(String)).toEqual(
        expect.arrayContaining([outsider.user.id, other.user.id])
      );
    });
  });

  // Fan-out is io.to(roomId): membership is checked on WRITE, never on delivery.
  // Leaving must therefore take the leaver's sockets out of the socket room too.
  describe("Leaving cuts off the socket stream", () => {
    let server;

    beforeAll(async () => {
      server = await startSocketServer();
    });
    afterAll(async () => {
      await stopSocketServer(server);
    });

    it("stops delivering messages to a member who left", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      await owner.client.post(`/api/rooms/${room.id}/invite`, {
        username: outsider.user.username,
      });
      await outsider.client.post(`/api/rooms/${room.id}/join`);

      const ownerSocket = await connectClient(server.url, owner.token);
      const leaverSocket = await connectClient(server.url, outsider.token);

      try {
        await outsider.client.post(`/api/rooms/${room.id}/leave`);

        const leaked = expectNoEvent(leaverSocket, SOCKET_EVENTS.MESSAGE_NEW);
        const ack = await emitAck(ownerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
          roomId: room.id,
          text: "members only",
        });

        expect(ack.ok).toBe(true);
        await expect(leaked).resolves.toBe(false);
      } finally {
        ownerSocket.disconnect();
        leaverSocket.disconnect();
      }
    });
  });

  describe("Bad identifiers", () => {
    it("404s a malformed room id rather than 500ing", async () => {
      const res = await owner.client.get("/api/rooms/not-an-objectid/messages");
      expect(res.status).toBe(404);
    });
  });
});
