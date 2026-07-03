/**
 * Seed sample data into MongoDB and LEAVE it there so you can inspect it in
 * mongosh (db.users.find(), db.rooms.find(), db.messages.find()).
 *
 *   Seed:   node backend/test/seed.js          (or: npm run seed)
 *   Clean:  node backend/test/seed.js --clean   (or: npm run seed:clean)
 *
 * Data goes straight through the Mongoose models (same shapes the app uses).
 * Everything it creates is prefixed "seed-" so it's easy to spot and remove.
 */
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

import mongoose from "mongoose";
import { User } from "../src/models/User.js";
import { Room } from "../src/models/Room.js";
import { Message } from "../src/models/Message.js";

async function clean() {
  const rooms = await Room.find({ name: /^seed-/ }).select("_id");
  await Message.deleteMany({ room: { $in: rooms.map((r) => r._id) } });
  await Room.deleteMany({ name: /^seed-/ });
  await User.deleteMany({ username: /^seed-/ });
  console.log("🧹 removed all seed- data");
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected:", process.env.MONGO_URI);

  if (process.argv.includes("--clean")) {
    await clean();
    await mongoose.disconnect();
    return;
  }

  await clean(); // start fresh so re-running doesn't duplicate

  // Two users (like OAuth-created accounts).
  const alice = await User.create({
    provider: "google", providerId: "seed-google-alice",
    username: "seed-alice", name: "Seed Alice", email: "alice@seed.test",
    avatarUrl: "https://example.com/alice.png",
  });
  const bob = await User.create({
    provider: "github", providerId: "seed-github-bob",
    username: "seed-bob", name: "Seed Bob", email: "bob@seed.test",
  });

  // A room alice created, with bob invited.
  const room = await Room.create({
    name: "seed-general",
    creator: alice._id,
    members: [alice._id, bob._id],
  });

  // A few messages of history.
  await Message.create([
    { room: room._id, sender: alice._id, username: alice.username, text: "Hey Bob 👋" },
    { room: room._id, sender: bob._id, username: bob.username, text: "Hi Alice! This is stored in MongoDB." },
    { room: room._id, sender: alice._id, username: alice.username, text: "And synced across servers via Valkey 🚀" },
  ]);

  console.log("\n🌱 Seeded:");
  console.log(`   users:    ${await User.countDocuments({ username: /^seed-/ })}`);
  console.log(`   rooms:    ${await Room.countDocuments({ name: /^seed-/ })}`);
  console.log(`   messages: ${await Message.countDocuments({ room: room._id })}`);
  console.log("\nInspect it in mongosh:");
  console.log("   use chatapp");
  console.log("   db.users.find()");
  console.log("   db.rooms.find()");
  console.log("   db.messages.find()");
  console.log("\nRemove it later:  npm run seed:clean");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("💥", e);
  process.exitCode = 1;
});
