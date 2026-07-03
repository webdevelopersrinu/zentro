/**
 * Zentro backend smoke test.
 *
 * Runs the WHOLE backend surface against a LIVE server and proves data really
 * lands in MongoDB and flows through Valkey:
 *
 *   1. HTTP API   — /health, rooms create/list/invite/messages, user search
 *   2. Socket.IO  — real-time message:send → message:new (the live chat path)
 *   3. MongoDB    — reads the rows back and prints them (proof of storage)
 *   4. Valkey     — PING + a pub/sub round-trip (proof the bus works)
 *
 * Login is OAuth (needs a browser), so this script MINTS its own JWTs with your
 * JWT_SECRET and seeds two test users directly — exactly what Google/GitHub
 * find-or-create would have produced.
 *
 * HOW TO RUN
 *   Terminal 1:  cd backend && npm start
 *   Terminal 2:  cd backend && npm run smoke
 */
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
// Load backend/.env no matter which directory this script is run from.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Valkey from "iovalkey";
import { io as ioClient } from "socket.io-client";

import { User } from "../src/models/User.js";
import { Room } from "../src/models/Room.js";
import { Message } from "../src/models/Message.js";

const {
  PORT = 4000,
  MONGO_URI,
  VALKEY_URL,
  JWT_SECRET,
} = process.env;

const BASE = `http://localhost:${PORT}`;

// ── tiny test harness ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const ok = (m) => (passed++, console.log(`  ✅ ${m}`));
const bad = (m) => (failed++, console.log(`  ❌ ${m}`));
function check(cond, m) {
  cond ? ok(m) : bad(m);
  return cond;
}
const section = (t) => console.log(`\n\x1b[36m▸ ${t}\x1b[0m`);

// Sign a JWT the same shape the app issues (see utils/token.js).
const sign = (u) =>
  jwt.sign(
    { id: u._id.toString(), username: u.username, name: u.name, avatarUrl: "" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

// authenticated fetch helper
async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

// Wait for a socket event (or time out).
function waitFor(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function main() {
  console.log("🧪 Zentro backend smoke test\n" + "─".repeat(50));
  console.log(`   API   : ${BASE}`);
  console.log(`   Mongo : ${MONGO_URI}`);
  console.log(`   Valkey: ${VALKEY_URL}`);

  if (!JWT_SECRET) {
    console.error("\n❌ JWT_SECRET missing in .env — cannot mint test tokens.");
    process.exit(1);
  }

  // 0. Is the server even up?
  section("0. Server reachable");
  try {
    const h = await api("/health");
    check(h.status === 200 && h.data?.ok, `GET /health → 200 (pid ${h.data?.pid})`);
  } catch {
    console.error(`\n❌ Backend not reachable at ${BASE}. Start it: cd backend && npm start`);
    process.exit(1);
  }

  // 1. Connect to Mongo & seed two clean test users (mimics OAuth users).
  section("1. Seed test users in MongoDB");
  await mongoose.connect(MONGO_URI);
  await User.deleteMany({ username: /^smoke-/ });
  await Room.deleteMany({ name: /^smoke-/ });

  const alice = await User.create({
    provider: "google", providerId: "smoke-google-1",
    username: "smoke-alice", name: "Smoke Alice", email: "alice@smoke.test",
  });
  const bob = await User.create({
    provider: "github", providerId: "smoke-github-1",
    username: "smoke-bob", name: "Smoke Bob", email: "bob@smoke.test",
  });
  check(!!alice._id && !!bob._id, "created smoke-alice + smoke-bob");
  const aliceToken = sign(alice);
  const bobToken = sign(bob);

  // 2. Auth guard — protected route must reject a missing token.
  section("2. Auth guard");
  const noAuth = await api("/api/rooms");
  check(noAuth.status === 401, "GET /api/rooms without token → 401");
  const me = await api("/api/auth/me", { token: aliceToken });
  check(me.status === 200 && me.data?.user?.username === "smoke-alice", "GET /api/auth/me → identifies alice");

  // 3. Rooms: create / list.
  section("3. Rooms API");
  const created = await api("/api/rooms", { method: "POST", token: aliceToken, body: { name: "smoke-room" } });
  const roomId = created.data?.room?._id;
  check(created.status === 201 && roomId, `POST /api/rooms → 201 (id ${roomId})`);

  const list = await api("/api/rooms", { token: aliceToken });
  check(list.status === 200 && list.data.rooms.some((r) => r._id === roomId), "GET /api/rooms → contains new room");

  // 4. User search (for invites).
  section("4. User search");
  const search = await api("/api/users/search?q=smoke-bob", { token: aliceToken });
  check(search.status === 200 && search.data.users.some((u) => u.username === "smoke-bob"), "GET /api/users/search?q=smoke-bob → finds bob");

  // 5. Invite bob into the room.
  section("5. Invite");
  const invite = await api(`/api/rooms/${roomId}/invite`, { method: "POST", token: aliceToken, body: { username: "smoke-bob" } });
  check(invite.status === 200, "POST /api/rooms/:id/invite → 200");

  // 6. Real-time message via Socket.IO (the live path + Valkey adapter + Mongo save).
  section("6. Socket.IO real-time message");
  const aliceSock = ioClient(BASE, { auth: { token: aliceToken }, transports: ["websocket"] });
  const bobSock = ioClient(BASE, { auth: { token: bobToken }, transports: ["websocket"] });
  let sentText = "";
  try {
    await Promise.all([waitFor(aliceSock, "connect"), waitFor(bobSock, "connect")]);
    ok("both sockets connected (JWT handshake accepted)");

    await new Promise((res, rej) =>
      aliceSock.emit("room:join", roomId, (a) => (a?.ok ? res() : rej(new Error(a?.error))))
    );
    await new Promise((res, rej) =>
      bobSock.emit("room:join", roomId, (a) => (a?.ok ? res() : rej(new Error(a?.error))))
    );
    ok("alice + bob joined the room");

    sentText = `hello from smoke test ${Date.now()}`;
    const bobReceives = waitFor(bobSock, "message:new");
    const ack = await new Promise((res) => aliceSock.emit("message:send", { roomId, text: sentText }, res));
    check(ack?.ok, "message:send acked ok");
    const delivered = await bobReceives;
    check(delivered?.text === sentText, "bob received message:new in real time");
  } catch (e) {
    bad(`socket flow failed: ${e.message}`);
  } finally {
    aliceSock.close();
    bobSock.close();
  }

  // 7. MongoDB proof — read the data back.
  section("7. MongoDB — data actually stored");
  const roomDoc = await Room.findById(roomId).lean();
  check(roomDoc?.members?.length === 2, `room has 2 members (alice + invited bob) — stored in Mongo`);
  const msgs = await Message.find({ room: roomId }).lean();
  check(msgs.some((m) => m.text === sentText), "sent message persisted in messages collection");
  console.log("   ── stored message row ──");
  console.log("   ", JSON.stringify(msgs.find((m) => m.text === sentText) ?? msgs[0], null, 0));
  const counts = {
    users: await User.countDocuments({ username: /^smoke-/ }),
    rooms: await Room.countDocuments({ name: /^smoke-/ }),
    messages: msgs.length,
  };
  console.log("   collection counts:", counts);

  // 8. Valkey proof — connectivity + pub/sub round-trip.
  section("8. Valkey — reachable + pub/sub works");
  const pub = new Valkey(VALKEY_URL);
  const sub = pub.duplicate();
  try {
    const pong = await pub.ping();
    check(pong === "PONG", `PING → ${pong}`);

    const channel = "smoke:channel";
    const gotMsg = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no pub/sub message")), 3000);
      sub.on("message", (ch, msg) => {
        if (ch === channel) {
          clearTimeout(t);
          resolve(msg);
        }
      });
    });
    await sub.subscribe(channel);
    await pub.publish(channel, "ping-through-valkey");
    const got = await gotMsg.catch(() => null);
    check(got === "ping-through-valkey", "pub/sub round-trip through Valkey (this is what syncs 2 servers)");
  } catch (e) {
    bad(`Valkey check failed: ${e.message}`);
  } finally {
    pub.disconnect();
    sub.disconnect();
  }

  // 9. Cleanup.
  section("9. Cleanup");
  await Message.deleteMany({ room: roomId });
  await Room.deleteMany({ name: /^smoke-/ });
  await User.deleteMany({ username: /^smoke-/ });
  ok("removed smoke test data");

  await mongoose.disconnect();

  // Summary.
  console.log("\n" + "─".repeat(50));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\n💥 Smoke test crashed:", e);
  process.exit(1);
});
