import { test, expect, request } from "@playwright/test";

import { E2E } from "../env.js";
import {
  fixtures,
  bearer,
  connectSocket,
  waitFor,
  emitAck,
  closeAll,
} from "../helpers.js";

/**
 * THE test this whole architecture exists for.
 *
 * Two independent Node processes (:4101 and :4102) share one MongoDB and one
 * Valkey. A user on server A sends a message; a user connected to server B must
 * receive it. Server A has no knowledge of B's sockets — the only path between
 * them is Valkey pub/sub, via socket.io-valkey-adapter.
 *
 * If this suite passes, the Valkey adapter works. If Valkey is stopped, it fails.
 */
test.describe("Cross-server sync via Valkey", () => {
  let users;
  let api;
  let sockets = [];

  test.beforeAll(async () => {
    users = fixtures().users;
    api = await request.newContext({ baseURL: E2E.SERVER_A });
  });

  test.afterAll(async () => await api.dispose());
  test.afterEach(() => closeAll(...sockets.splice(0)));

  const track = async (url, token) => {
    const socket = await connectSocket(url, token);
    sockets.push(socket);
    return socket;
  };

  /** Alice creates a public room on server A; Bob joins it. */
  const sharedRoom = async (name) => {
    const created = await api.post("/api/rooms", {
      headers: bearer(users.alice.accessToken),
      data: { name, visibility: "public" },
    });
    expect(created.status()).toBe(201);
    const room = (await created.json()).room;

    const joined = await api.post(`/api/rooms/${room.id}/join`, {
      headers: bearer(users.bob.accessToken),
    });
    expect(joined.status()).toBe(200);

    return room;
  };

  test("both servers are up and are different processes", async () => {
    const a = await api.get("/api/health");
    const b = await (await request.newContext()).get(`${E2E.SERVER_B}/api/health`);

    const pidA = (await a.json()).pid;
    const pidB = (await b.json()).pid;

    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    expect(pidA).not.toBe(pidB); // genuinely two servers, not one behind a proxy
  });

  test("a message sent on server A reaches a member on server B", async () => {
    const room = await sharedRoom("cross-server");

    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);

    const delivered = waitFor(bobOnB, "message:new");
    const ack = await emitAck(aliceOnA, "message:send", {
      roomId: room.id,
      text: "hello across the cluster",
    });

    expect(ack.ok).toBe(true);
    expect(await delivered).toMatchObject({
      roomId: room.id,
      username: "alice",
      text: "hello across the cluster",
    });
  });

  /**
   * The production scenario, and the one every other test here misses: the
   * sockets are ALREADY connected when the room is created and joined. The
   * server can only auto-join rooms that existed at connect time, so each
   * client must emit `room:join` itself — otherwise io.to(roomId) reaches
   * nobody and the chat silently never syncs, while optimistic bubbles make it
   * look like it works.
   */
  test("a room created AFTER the sockets connect still syncs", async () => {
    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);

    const room = await sharedRoom("created-after-connect");

    // Each client subscribes its own socket, exactly as the frontend now does.
    expect(await emitAck(aliceOnA, "room:join", room.id)).toMatchObject({ ok: true });
    expect(await emitAck(bobOnB, "room:join", room.id)).toMatchObject({ ok: true });

    const delivered = waitFor(bobOnB, "message:new");
    await emitAck(aliceOnA, "message:send", { roomId: room.id, text: "after join" });

    expect(await delivered).toMatchObject({ text: "after join" });
  });

  test("presence and typing carry the roomId they belong to", async () => {
    const room = await sharedRoom("payload-shape");

    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);

    const typing = waitFor(bobOnB, "typing");
    aliceOnA.emit("typing", { roomId: room.id, isTyping: true });

    // Without roomId a client in two rooms cannot attribute the event.
    expect(await typing).toMatchObject({ roomId: room.id, username: "alice" });

    const departure = waitFor(bobOnB, "presence:left");
    aliceOnA.disconnect();
    expect(await departure).toMatchObject({ roomId: room.id, username: "alice" });
  });

  test("messages flow in both directions", async () => {
    const room = await sharedRoom("bidirectional");

    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);

    const toBob = waitFor(bobOnB, "message:new");
    await emitAck(aliceOnA, "message:send", { roomId: room.id, text: "ping" });
    expect((await toBob).text).toBe("ping");

    const toAlice = waitFor(aliceOnA, "message:new");
    await emitAck(bobOnB, "message:send", { roomId: room.id, text: "pong" });
    expect((await toAlice).text).toBe("pong");
  });

  test("typing indicators cross servers", async () => {
    const room = await sharedRoom("typing-across");

    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);

    const seen = waitFor(bobOnB, "typing");
    aliceOnA.emit("typing", { roomId: room.id, isTyping: true });

    expect(await seen).toMatchObject({ username: "alice", isTyping: true });
  });

  test("presence: leaving server A notifies a user on server B", async () => {
    const room = await sharedRoom("presence-across");

    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);
    const aliceOnA = await connectSocket(E2E.SERVER_A, users.alice.accessToken);

    const departure = waitFor(bobOnB, "presence:left");
    aliceOnA.disconnect();

    expect(await departure).toMatchObject({ username: "alice" });
  });

  test("a join request on server A notifies the creator on server B", async () => {
    // The targeted `user:<id>` channel must also cross the Valkey bus.
    const created = await api.post("/api/rooms", {
      headers: bearer(users.alice.accessToken),
      data: { name: "private-across", visibility: "private" },
    });
    const room = (await created.json()).room;

    const aliceOnB = await track(E2E.SERVER_B, users.alice.accessToken);
    const notified = waitFor(aliceOnB, "request:new");

    // Request issued over HTTP to server A.
    const res = await api.post(`/api/rooms/${room.id}/join`, {
      headers: bearer(users.mallory.accessToken),
    });
    expect((await res.json()).requested).toBe(true);

    expect(await notified).toMatchObject({
      roomId: room.id,
      from: { username: "mallory" },
    });
  });

  test("a non-member on server B never receives the room's messages", async () => {
    const room = await sharedRoom("leak-check");

    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    const malloryOnB = await track(E2E.SERVER_B, users.mallory.accessToken);

    let leaked = false;
    malloryOnB.on("message:new", () => (leaked = true));

    await emitAck(aliceOnA, "message:send", { roomId: room.id, text: "secret" });
    await new Promise((r) => setTimeout(r, 500)); // give the bus time to misbehave

    expect(leaked).toBe(false);
  });

  test("a read on server B turns the author's tick marks on server A", async () => {
    const room = await sharedRoom("receipts");
    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);
    await emitAck(aliceOnA, "message:send", { roomId: room.id, text: "did you see this?" });

    const seen = waitFor(aliceOnA, "room:read");
    const apiB = await request.newContext({ baseURL: E2E.SERVER_B });
    const res = await apiB.post(`/api/rooms/${room.id}/read`, {
      headers: bearer(users.bob.accessToken),
    });
    expect(res.status()).toBe(200);

    expect(await seen).toMatchObject({ roomId: room.id, userId: users.bob.id });
    await apiB.dispose();
  });

  test("deleting a room on A reaches its members on B, leaving no ghost room", async () => {
    const room = await sharedRoom("doomed");
    const bobOnB = await track(E2E.SERVER_B, users.bob.accessToken);

    const deleted = waitFor(bobOnB, "room:deleted");
    const res = await api.delete(`/api/rooms/${room.id}`, {
      headers: bearer(users.alice.accessToken),
    });
    expect(res.status()).toBe(200);

    expect(await deleted).toMatchObject({ roomId: room.id, name: "doomed" });
  });

  test("message history written on A is readable from B", async () => {
    const room = await sharedRoom("shared-history");
    const aliceOnA = await track(E2E.SERVER_A, users.alice.accessToken);

    await emitAck(aliceOnA, "message:send", { roomId: room.id, text: "persisted" });

    const apiB = await request.newContext({ baseURL: E2E.SERVER_B });
    const res = await apiB.get(`/api/rooms/${room.id}/messages`, {
      headers: bearer(users.bob.accessToken),
    });

    expect(res.status()).toBe(200);
    expect((await res.json()).messages.map((m) => m.text)).toContain("persisted");
    await apiB.dispose();
  });
});
