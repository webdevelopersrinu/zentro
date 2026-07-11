import mongoose from "mongoose";

/**
 * How far a user has read in a room. Kept out of Room.members so that opening a
 * room writes one small document instead of rewriting the room's member array
 * — which every other member is reading at the same time.
 *
 * A member with no row here has never opened the room: everything is unread.
 */
const roomReadSchema = new mongoose.Schema({
  room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  lastReadAt: { type: Date, required: true },
});

// One row per (room, user); the upsert on read relies on this to stay unique.
roomReadSchema.index({ room: 1, user: 1 }, { unique: true });

// Serves "every room this user has read", the query behind the sidebar.
roomReadSchema.index({ user: 1 });

export const RoomRead = mongoose.model("RoomRead", roomReadSchema);
