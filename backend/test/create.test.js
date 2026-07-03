/**
 * CREATE test — POST /api/rooms
 *   Run backend first:  cd backend && npm start
 *   Then:               node backend/test/create.test.js   (or: npm run test:create)
 */
import {
  Room, api, sign, section, check, finish,
  preflight, teardown, seedUser, cleanupSmokeData,
} from "./_helpers.js";

async function main() {
  console.log("🧪 CREATE — rooms");
  await preflight();
  await cleanupSmokeData();

  const alice = await seedUser("alice");
  const token = sign(alice);

  section("Create a room");
  const res = await api("/api/rooms", {
    method: "POST",
    token,
    body: { name: "smoke-create-room" },
  });
  const roomId = res.data?.room?._id;
  check(res.status === 201 && roomId, `POST /api/rooms → 201 (id ${roomId})`);
  check(res.data?.room?.creator === alice._id.toString(), "creator is the caller");
  check(
    res.data?.room?.members?.includes(alice._id.toString()),
    "creator auto-added as first member"
  );

  section("Persisted in MongoDB");
  const inDb = await Room.findById(roomId).lean();
  check(!!inDb, "room document exists in MongoDB");
  check(inDb?.name === "smoke-create-room", "stored name matches");
  console.log("   stored row:", JSON.stringify(inDb));

  section("Shows up in my room list");
  const list = await api("/api/rooms", { token });
  check(list.data.rooms.some((r) => r._id === roomId), "GET /api/rooms includes it");

  section("Validation");
  const bad1 = await api("/api/rooms", { method: "POST", token, body: { name: "" } });
  check(bad1.status === 400, "empty name → 400");
  const bad2 = await api("/api/rooms", { method: "POST", body: { name: "x" } });
  check(bad2.status === 401, "no token → 401");

  await cleanupSmokeData();
  await teardown();
  process.exitCode = finish() ? 0 : 1;
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
