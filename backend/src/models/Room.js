import mongoose from "mongoose";

// A chat room. `creator` is the user who made it — the admin.
//
//   visibility: "public"  → anyone logged in can see it and join instantly.
//   visibility: "private" → anyone can SEE it exists, but must send a join
//                           request that the creator approves. Only `members`
//                           can read or send messages.
//
// Two pending queues, pointing opposite ways:
//   joinRequests — the user asked to come in; the creator decides.
//   invites      — the creator asked them in; the user decides.
// Nobody is added to `members` without their own consent.
const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
      index: true,
    },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    /**
     * Members the creator has given moderation powers: approving requests,
     * inviting, renaming. The creator is ALWAYS an admin and is not listed
     * here — a room that predates this field still has a working admin.
     *
     * Deleting the room and changing who is an admin stay with the creator.
     */
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    joinRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    invites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Compared against each member's RoomRead.lastReadAt to decide "unread".
    // `updatedAt` cannot serve: it also moves when someone joins or is invited.
    lastMessageAt: { type: Date },
  },
  { timestamps: true }
);

export const Room = mongoose.model("Room", roomSchema);
