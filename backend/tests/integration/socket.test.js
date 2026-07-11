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
import {
  SOCKET_EVENTS,
  ROOM_VISIBILITY,
  SOCKET_RATE_LIMIT,
} from "../../src/constants/index.js";
import { Message } from "../../src/models/Message.js";
import { getOnlineUserIds } from "../../src/services/presence.service.js";

const PUBLIC = { name: "lobby", visibility: ROOM_VISIBILITY.PUBLIC };
const PRIVATE = { name: "vault", visibility: ROOM_VISIBILITY.PRIVATE };

describe("Socket layer", () => {
  let server;
  let owner;
  let member;
  let stranger;
  const clients = [];

  const connect = async (token) => {
    const socket = await connectClient(server.url, token);
    clients.push(socket);
    return socket;
  };

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
    owner = await createUser({ username: "owner" });
    member = await createUser({ username: "member" });
    stranger = await createUser({ username: "stranger" });
  });

  afterEach(() => {
    clients.splice(0).forEach((socket) => socket.disconnect());
  });

  describe("Handshake", () => {
    it("accepts a valid JWT", async () => {
      const socket = await connect(owner.token);
      expect(socket.connected).toBe(true);
    });

    it("rejects an invalid token", async () => {
      await expect(connect("not-a-jwt")).rejects.toThrow("Unauthorized");
    });
  });

  describe("Messaging", () => {
    let room;

    beforeEach(async () => {
      room = await createRoom(owner.client, PUBLIC);
      await member.client.post(`/api/rooms/${room.id}/join`);
    });

    it("auto-joins your rooms, so members receive messages without room:join", async () => {
      const ownerSocket = await connect(owner.token);
      const memberSocket = await connect(member.token);

      const delivered = waitFor(memberSocket, SOCKET_EVENTS.MESSAGE_NEW);
      const ack = await emitAck(ownerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
        roomId: room.id,
        text: "hello world",
      });

      expect(ack.ok).toBe(true);
      await expect(delivered).resolves.toMatchObject({
        text: "hello world",
        username: "owner",
        roomId: room.id,
      });
    });

    it("persists the message to MongoDB", async () => {
      const ownerSocket = await connect(owner.token);
      await emitAck(ownerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
        roomId: room.id,
        text: "durable",
      });

      const stored = await Message.find({ room: room.id });
      expect(stored).toHaveLength(1);
      expect(stored[0].text).toBe("durable");
    });

    it("delivers to the sender's other tabs", async () => {
      const tabOne = await connect(owner.token);
      const tabTwo = await connect(owner.token);

      const delivered = waitFor(tabTwo, SOCKET_EVENTS.MESSAGE_NEW);
      await emitAck(tabOne, SOCKET_EVENTS.MESSAGE_SEND, {
        roomId: room.id,
        text: "multi-tab",
      });

      await expect(delivered).resolves.toMatchObject({ text: "multi-tab" });
    });

    it("refuses a non-member and stores nothing", async () => {
      const strangerSocket = await connect(stranger.token);

      const ack = await emitAck(strangerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
        roomId: room.id,
        text: "let me in",
      });

      expect(ack).toMatchObject({ ok: false, error: expect.stringMatching(/Not a member/) });
      await expect(Message.countDocuments()).resolves.toBe(0);
    });

    it("refuses an empty message", async () => {
      const ownerSocket = await connect(owner.token);

      const ack = await emitAck(ownerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
        roomId: room.id,
        text: "   ",
      });

      expect(ack).toMatchObject({ ok: false, error: expect.stringMatching(/Empty message/) });
    });

    it("strips markup before storing", async () => {
      const ownerSocket = await connect(owner.token);

      const ack = await emitAck(ownerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
        roomId: room.id,
        text: '<img src=x onerror=alert(1)>hi <b>there</b>',
      });

      expect(ack.message.text).toBe("hi there");
      const [stored] = await Message.find({ room: room.id });
      expect(stored.text).not.toMatch(/<|onerror/);
    });

    it("throttles a flood of messages from one socket", async () => {
      const ownerSocket = await connect(owner.token);

      const acks = [];
      for (let i = 0; i < SOCKET_RATE_LIMIT.MAX_EVENTS + 5; i += 1) {
        acks.push(
          await emitAck(ownerSocket, SOCKET_EVENTS.MESSAGE_SEND, {
            roomId: room.id,
            text: `flood ${i}`,
          })
        );
      }

      const accepted = acks.filter((a) => a.ok);
      const blocked = acks.filter((a) => !a.ok);

      expect(accepted).toHaveLength(SOCKET_RATE_LIMIT.MAX_EVENTS);
      expect(blocked).toHaveLength(5);
      expect(blocked[0].error).toMatch(/Slow down/);
      await expect(Message.countDocuments()).resolves.toBe(
        SOCKET_RATE_LIMIT.MAX_EVENTS
      );
    });
  });

  describe("Typing", () => {
    it("relays to other members but not back to the sender", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await member.client.post(`/api/rooms/${room.id}/join`);

      const ownerSocket = await connect(owner.token);
      const memberSocket = await connect(member.token);

      const seen = waitFor(memberSocket, SOCKET_EVENTS.TYPING);
      const echoed = expectNoEvent(ownerSocket, SOCKET_EVENTS.TYPING);

      ownerSocket.emit(SOCKET_EVENTS.TYPING, { roomId: room.id, isTyping: true });

      await expect(seen).resolves.toMatchObject({ username: "owner", isTyping: true });
      await expect(echoed).resolves.toBe(false);
    });

    // /rooms/discover hands out private room ids by design, so knowing an id
    // must not be enough to push "stranger is typing…" into a room you're not in.
    it("ignores TYPING for a room the sender is not a member of", async () => {
      const room = await createRoom(owner.client, PRIVATE);

      const ownerSocket = await connect(owner.token);
      const strangerSocket = await connect(stranger.token);

      const leaked = expectNoEvent(ownerSocket, SOCKET_EVENTS.TYPING);
      strangerSocket.emit(SOCKET_EVENTS.TYPING, { roomId: room.id, isTyping: true });

      await expect(leaked).resolves.toBe(false);
    });

    it("ignores ROOM_LEAVE for a room the sender is not a member of", async () => {
      const room = await createRoom(owner.client, PRIVATE);

      const ownerSocket = await connect(owner.token);
      const strangerSocket = await connect(stranger.token);

      const leaked = expectNoEvent(ownerSocket, SOCKET_EVENTS.PRESENCE_LEFT);
      strangerSocket.emit(SOCKET_EVENTS.ROOM_LEAVE, room.id);

      await expect(leaked).resolves.toBe(false);
    });
  });

  describe("Presence", () => {
    it("announces arrival to the rooms you belong to", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await member.client.post(`/api/rooms/${room.id}/join`);

      const ownerSocket = await connect(owner.token);
      const arrival = waitFor(ownerSocket, SOCKET_EVENTS.PRESENCE_JOINED);

      await connect(member.token);

      await expect(arrival).resolves.toMatchObject({ username: "member" });
    });

    // Regression guard: on "disconnect" Socket.IO has already emptied
    // socket.rooms, so this passes only because we listen on "disconnecting".
    it("announces departure on disconnect", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await member.client.post(`/api/rooms/${room.id}/join`);

      const ownerSocket = await connect(owner.token);
      // connect() resolves on "ready", which the server emits after the socket
      // has joined its rooms — so no need to wait for presence:joined here.
      const memberSocket = await connect(member.token);

      const departure = waitFor(ownerSocket, SOCKET_EVENTS.PRESENCE_LEFT);
      memberSocket.disconnect();

      await expect(departure).resolves.toMatchObject({ username: "member" });
    });

    // Closing one of two tabs must not grey you out for everyone: the members
    // query has a 30s staleTime and no refetch-on-focus, so a wrong dot sticks.
    it("stays online while another tab of the same user is open", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await member.client.post(`/api/rooms/${room.id}/join`);

      const ownerSocket = await connect(owner.token);
      const tabOne = await connect(member.token);
      const tabTwo = await connect(member.token);

      const premature = expectNoEvent(ownerSocket, SOCKET_EVENTS.PRESENCE_LEFT);
      tabOne.disconnect();
      await expect(premature).resolves.toBe(false);

      const departure = waitFor(ownerSocket, SOCKET_EVENTS.PRESENCE_LEFT);
      tabTwo.disconnect();
      await expect(departure).resolves.toMatchObject({
        username: "member",
        roomId: room.id,
      });
    });
  });

  describe("Targeted notifications (HTTP action → socket event)", () => {
    it("notifies the creator when someone requests to join", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      const ownerSocket = await connect(owner.token);

      const notified = waitFor(ownerSocket, SOCKET_EVENTS.REQUEST_NEW);
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      await expect(notified).resolves.toMatchObject({
        roomId: room.id,
        roomName: "vault",
        from: { username: "stranger" },
      });
    });

    it("notifies the requester on approval", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      const strangerSocket = await connect(stranger.token);
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      const notified = waitFor(strangerSocket, SOCKET_EVENTS.REQUEST_APPROVED);
      await owner.client.post(
        `/api/rooms/${room.id}/requests/${stranger.user.id}/approve`
      );

      await expect(notified).resolves.toMatchObject({ roomId: room.id });
    });

    it("notifies the requester on rejection", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      const strangerSocket = await connect(stranger.token);
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      const notified = waitFor(strangerSocket, SOCKET_EVENTS.REQUEST_REJECTED);
      await owner.client.post(
        `/api/rooms/${room.id}/requests/${stranger.user.id}/reject`
      );

      await expect(notified).resolves.toMatchObject({ roomId: room.id });
    });

    it("notifies an invited user", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      const strangerSocket = await connect(stranger.token);

      const notified = waitFor(strangerSocket, SOCKET_EVENTS.ROOM_INVITED);
      await owner.client.post(`/api/rooms/${room.id}/invite`, {
        username: stranger.user.username,
      });

      await expect(notified).resolves.toMatchObject({
        roomName: "vault",
        from: "owner",
      });
    });

    it("sends notifications only to the target user", async () => {
      const room = await createRoom(owner.client, PRIVATE);
      const memberSocket = await connect(member.token);
      await connect(owner.token);

      const leaked = expectNoEvent(memberSocket, SOCKET_EVENTS.REQUEST_NEW);
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      await expect(leaked).resolves.toBe(false);
    });
  });

  describe("Presence service (GET /rooms/:id/members)", () => {
    it("marks members with an open socket as online", async () => {
      const room = await createRoom(owner.client, PUBLIC);
      await member.client.post(`/api/rooms/${room.id}/join`);

      await connect(owner.token); // only the owner connects

      const res = await owner.client.get(`/api/rooms/${room.id}/members`);
      const byName = Object.fromEntries(res.body.members.map((m) => [m.username, m]));

      expect(byName.owner).toMatchObject({ online: true, isCreator: true });
      expect(byName.member).toMatchObject({ online: false, isCreator: false });
    });

    it("getOnlineUserIds returns only the connected users, in one lookup", async () => {
      await connect(owner.token);
      await connect(stranger.token);
      await connect(stranger.token); // a second tab must not duplicate anything

      const online = await getOnlineUserIds([
        owner.user.id,
        member.user.id, // never connects
        stranger.user.id,
      ]);

      expect(online).toEqual(new Set([owner.user.id, stranger.user.id]));
    });

    it("returns an empty Set for users that are all offline", async () => {
      await expect(getOnlineUserIds([owner.user.id])).resolves.toEqual(new Set());
    });
  });
});
