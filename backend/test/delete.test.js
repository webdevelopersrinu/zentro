/**
 * DELETE test — DELETE /api/rooms/:id  (creator deletes room + its messages)
 *   Run backend first:  cd backend && npm start
 *   Then:               node backend/test/delete.test.js   (or: npm run test:delete)
 */
import {
  Room, Message, api, sign, section, check, finish,
  preflight, teardown, seedUser, cleanupSmokeData,
} from "./_helpers.js";

async function main() {
  console.log("🧪 DELETE — rooms");
  await preflight();
  await cleanupSmokeData();

  const alice = await seedUser("alice"); // creator
  const mallory = await seedUser("mallory"); // not the creator
  const aliceToken = sign(alice);
  const malloryToken = sign(mallory);

  // arrange: alice creates a room and it has a message in history
  const created = await api("/api/rooms", {
    method: "POST",
    token: aliceToken,
    body: { name: "smoke-delete-room" },
  });
  const roomId = created.data.room._id;
  await Message.create({
    room: roomId,
    sender: alice._id,
    username: alice.username,
    text: "message that should be deleted with the room",
  });
  check((await Message.countDocuments({ room: roomId })) === 1, "seeded 1 message in the room");

  section("Guards (before deleting)");
  const forbidden = await api(`/api/rooms/${roomId}`, { method: "DELETE", token: malloryToken });
  check(forbidden.status === 403, "non-creator cannot delete → 403");
  check(!!(await Room.findById(roomId)), "room still exists after rejected delete");

  section("Creator deletes the room");
  const del = await api(`/api/rooms/${roomId}`, { method: "DELETE", token: aliceToken });
  check(del.status === 200 && del.data?.ok, "DELETE /api/rooms/:id → 200 { ok: true }");

  section("Gone from MongoDB (room + messages)");
  check((await Room.findById(roomId)) === null, "room removed from MongoDB");
  check((await Message.countDocuments({ room: roomId })) === 0, "its messages removed too (cascade)");

  section("Idempotency");
  const again = await api(`/api/rooms/${roomId}`, { method: "DELETE", token: aliceToken });
  check(again.status === 404, "deleting again → 404 (already gone)");

  await cleanupSmokeData();
  await teardown();
  process.exitCode = finish() ? 0 : 1;
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
