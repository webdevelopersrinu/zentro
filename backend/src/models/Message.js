import mongoose from "mongoose";

// One chat message saved for history, so users see past messages on rejoin.
const messageSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true }, // denormalized for quick display

    /**
     * A reply's thread parent, `null` for a message in the main list. Threads
     * are exactly one level deep: a reply cannot be replied to, so the main
     * list stays a list and never becomes a tree.
     */
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },

    // Denormalised onto the parent so rendering the main list costs no extra
    // query. Counts every reply ever posted, including deleted ones — their
    // tombstones still occupy the thread.
    replyCount: { type: Number, default: 0 },
    // Not `required`: a deleted message keeps its place with an empty body.
    // createMessage rejects empty text, which is where that rule belongs.
    text: { type: String, default: "", maxlength: 2000 },

    /**
     * Grouped by emoji rather than one row per (user, emoji): a message carries
     * a handful of groups, and rendering wants exactly this shape. `_id: false`
     * because a group is identified by its emoji, not by an id of its own.
     */
    reactions: [
      {
        _id: false,
        // maxlength is defence in depth; toggleReaction() already validates shape.
        emoji: { type: String, required: true, maxlength: 64 },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      },
    ],

    editedAt: { type: Date },

    /**
     * A tombstone, not a row deletion: the bubble stays in place reading
     * "message deleted", so the conversation around it still makes sense.
     * `text` is emptied, so the words themselves are genuinely gone.
     */
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

/**
 * Serves the history query exactly: equality on `room` and `parent`, then a
 * descending walk of `_id` from the cursor. Without it every page scans the
 * whole collection. The cursor is `_id`, not `createdAt`, because `_id` is
 * unique — two messages sharing a millisecond would make a timestamp cursor
 * skip one.
 */
messageSchema.index({ room: 1, parent: 1, _id: -1 });

/** Serves a thread: every reply to one parent, oldest first. */
messageSchema.index({ parent: 1, _id: 1 });

export const Message = mongoose.model("Message", messageSchema);
