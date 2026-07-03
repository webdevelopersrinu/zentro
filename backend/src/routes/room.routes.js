import { Router } from "express";
import { Room } from "../models/Room.js";
import { User } from "../models/User.js";
import { Message } from "../models/Message.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// POST /api/rooms  { name }
// Create a room. The caller becomes the creator and first member.
router.post("/", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Room name required" });

  const room = await Room.create({
    name,
    creator: req.user.id,
    members: [req.user.id],
  });
  return res.status(201).json({ room });
});

// GET /api/rooms  -> rooms the current user is a member of
router.get("/", requireAuth, async (req, res) => {
  const rooms = await Room.find({ members: req.user.id })
    .select("name creator members")
    .sort({ updatedAt: -1 });
  return res.json({ rooms });
});

// POST /api/rooms/:id/invite  { username }
// Creator-only. Adds an existing user (found by unique username) to the room.
router.post("/:id/invite", requireAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.creator.toString() !== req.user.id)
    return res.status(403).json({ error: "Only the creator can invite" });

  const invitee = await User.findOne({
    username: (req.body.username || "").toLowerCase(),
  });
  if (!invitee) return res.status(404).json({ error: "User not found" });

  if (!room.members.some((m) => m.toString() === invitee._id.toString())) {
    room.members.push(invitee._id);
    await room.save();
  }
  return res.json({ room });
});

// PATCH /api/rooms/:id  { name }
// Creator-only. Rename the room.
router.patch("/:id", requireAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.creator.toString() !== req.user.id)
    return res.status(403).json({ error: "Only the creator can update" });

  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Room name required" });

  room.name = name;
  await room.save();
  return res.json({ room });
});

// DELETE /api/rooms/:id
// Creator-only. Delete the room AND all its messages.
router.delete("/:id", requireAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.creator.toString() !== req.user.id)
    return res.status(403).json({ error: "Only the creator can delete" });

  await Message.deleteMany({ room: room._id });
  await room.deleteOne();
  return res.json({ ok: true, deletedRoomId: room._id });
});

// GET /api/rooms/:id/messages  -> message history for a room (members only)
router.get("/:id/messages", requireAuth, async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (!room.members.some((m) => m.toString() === req.user.id))
    return res.status(403).json({ error: "Not a member of this room" });

  const messages = await Message.find({ room: room._id })
    .sort({ createdAt: 1 })
    .limit(100);
  return res.json({ messages });
});

export default router;
