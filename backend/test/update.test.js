/**
 * UPDATE test — PATCH /api/rooms/:id  (creator renames the room)
 *   Run backend first:  cd backend && npm start
 *   Then:               node backend/test/update.test.js   (or: npm run test:update)
 */
import {
  Room, api, sign, section, check, finish,
  preflight, teardown, seedUser, cleanupSmokeData,
} from "./_helpers.js";

async function main() {
  console.log("🧪 UPDATE — rooms");
  await preflight();
  await cleanupSmokeData();

  const alice = await seedUser("alice"); // creator
  const mallory = await seedUser("mallory"); // not the creator
  const aliceToken = sign(alice);
  const malloryToken = sign(mallory);

  // arrange: alice creates a room
  const created = await api("/api/rooms", {
    method: "POST",
    token: aliceToken,
    body: { name: "smoke-old-name" },
  });
  const roomId = created.data.room._id;

  section("Creator renames the room");
  const upd = await api(`/api/rooms/${roomId}`, {
    method: "PATCH",
    token: aliceToken,
    body: { name: "smoke-new-name" },
  });
  check(upd.status === 200, "PATCH /api/rooms/:id → 200");
  check(upd.data?.room?.name === "smoke-new-name", "response shows new name");

  section("Change persisted in MongoDB");
  const inDb = await Room.findById(roomId).lean();
  check(inDb?.name === "smoke-new-name", "MongoDB has the updated name");
  console.log("   stored row:", JSON.stringify(inDb));

  section("Guards");
  const forbidden = await api(`/api/rooms/${roomId}`, {
    method: "PATCH",
    token: malloryToken,
    body: { name: "smoke-hacked" },
  });
  check(forbidden.status === 403, "non-creator → 403");

  const empty = await api(`/api/rooms/${roomId}`, {
    method: "PATCH",
    token: aliceToken,
    body: { name: "  " },
  });
  check(empty.status === 400, "empty name → 400");

  const missing = await api(`/api/rooms/64b64b64b64b64b64b64b64b`, {
    method: "PATCH",
    token: aliceToken,
    body: { name: "x" },
  });
  check(missing.status === 404, "unknown room id → 404");

  // confirm the forbidden/empty attempts did NOT change the name
  const stillNew = await Room.findById(roomId).lean();
  check(stillNew?.name === "smoke-new-name", "name unchanged after rejected updates");

  await cleanupSmokeData();
  await teardown();
  process.exitCode = finish() ? 0 : 1;
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
