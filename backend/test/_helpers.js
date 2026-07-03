/**
 * Shared helpers for the CRUD test scripts (create / update / delete).
 * Loads backend/.env regardless of the directory the script is run from.
 */
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { User } from "../src/models/User.js";
import { Room } from "../src/models/Room.js";
import { Message } from "../src/models/Message.js";

export { User, Room, Message };

export const PORT = process.env.PORT || 4000;
export const BASE = `http://localhost:${PORT}`;
export const { MONGO_URI, JWT_SECRET } = process.env;

// ── tiny assertion harness (one process = one script) ──────────────────────
let passed = 0;
let failed = 0;
export const ok = (m) => (passed++, console.log(`  ✅ ${m}`));
export const bad = (m) => (failed++, console.log(`  ❌ ${m}`));
export const check = (cond, m) => (cond ? ok(m) : bad(m), cond);
export const section = (t) => console.log(`\n\x1b[36m▸ ${t}\x1b[0m`);
export function finish() {
  console.log("\n" + "─".repeat(50));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Sign a JWT the same shape the app issues (utils/token.js).
export const sign = (u) =>
  jwt.sign(
    { id: u._id.toString(), username: u.username, name: u.name, avatarUrl: "" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

// authenticated fetch helper
export async function api(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
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

// Guard: make sure env + server are ready before a script runs.
export async function preflight() {
  if (!JWT_SECRET || !MONGO_URI) {
    console.error("❌ JWT_SECRET / MONGO_URI missing — is backend/.env filled?");
    process.exit(1);
  }
  try {
    const r = await fetch(`${BASE}/health`);
    if (!r.ok) throw new Error();
  } catch {
    console.error(`❌ Backend not reachable at ${BASE}. Start it: cd backend && npm start`);
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
}

export async function teardown() {
  await mongoose.disconnect();
}

// Seed (or reset) a test user that mimics an OAuth-created account.
export async function seedUser(suffix) {
  const username = `smoke-${suffix}`;
  await User.deleteOne({ username });
  return User.create({
    provider: "google",
    providerId: `smoke-${suffix}-id`,
    username,
    name: `Smoke ${suffix}`,
  });
}

// Remove anything this test family created.
export async function cleanupSmokeData() {
  const rooms = await Room.find({ name: /^smoke-/ }).select("_id");
  await Message.deleteMany({ room: { $in: rooms.map((r) => r._id) } });
  await Room.deleteMany({ name: /^smoke-/ });
  await User.deleteMany({ username: /^smoke-/ });
}
