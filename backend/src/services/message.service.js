import mongoose from "mongoose";

import { Message } from "../models/Message.js";
import { Room } from "../models/Room.js";
import { RoomRead } from "../models/RoomRead.js";
import { AppError } from "../utils/AppError.js";
import { stripHtml, isEmoji } from "../utils/sanitize.js";
import * as roomService from "./room.service.js";
import { MESSAGE_MAX_LENGTH, MESSAGE_EDIT_WINDOW_MS } from "../constants/index.js";

/** Markup is never stored, and an empty body is never a message. */
function cleanBody(text) {
  const body = stripHtml(text);
  if (!body) throw AppError.badRequest("Empty message");
  if (body.length > MESSAGE_MAX_LENGTH)
    throw AppError.badRequest(`Message exceeds ${MESSAGE_MAX_LENGTH} characters`);
  return body;
}

/**
 * Loads a live message in a room the caller belongs to.
 *
 * A non-member is told the message does not exist, rather than that they are
 * forbidden: a 403 would confirm the id is real. Membership is re-checked on
 * every write, so leaving a room ends your ability to touch anything in it —
 * including a message you wrote while you were still there.
 */
async function messageOrFail(messageId, userId, { mine = false } = {}) {
  if (!mongoose.isValidObjectId(messageId)) throw AppError.notFound("Message not found");

  const message = await Message.findById(messageId);
  if (!message) throw AppError.notFound("Message not found");
  if (mine && String(message.sender) !== String(userId))
    throw AppError.notFound("Message not found");

  const room = await roomService.getRoomOrFail(message.room);
  if (!roomService.isMember(room, userId)) throw AppError.notFound("Message not found");

  // Checked last: "it was deleted" is only safe to say to someone who may see it.
  if (message.deletedAt) throw AppError.badRequest("Message was deleted");

  return message;
}

const ownMessageOrFail = (messageId, userId) => messageOrFail(messageId, userId, { mine: true });

/**
 * The message a reply hangs off. It must live in the room being posted to —
 * otherwise a client could graft a reply onto a thread in a room it can see but
 * does not belong to — and it must not itself be a reply: threads are one level.
 */
async function threadParentOrFail(parentId, room) {
  if (!mongoose.isValidObjectId(parentId)) throw AppError.notFound("Message not found");

  // Scoped to the room in the query itself: a parent in another room is simply
  // not found, so nobody learns whether that id exists.
  const parent = await Message.findOne({ _id: parentId, room: room._id });
  if (!parent) throw AppError.notFound("Message not found");

  if (parent.deletedAt) throw AppError.badRequest("Message was deleted");
  if (parent.parent) throw AppError.badRequest("Replies cannot be replied to");

  return parent;
}

/**
 * Persist a message after re-checking membership server-side. The socket layer
 * never trusts the client's claim that it belongs to a room, and never trusts
 * the text: markup is stripped before it is stored.
 *
 * `parentId` turns it into a thread reply, which stays out of the main list.
 */
export async function createMessage({ roomId, sender, username, text, parentId = null }) {
  const body = cleanBody(text);

  const room = await roomService.getRoomOrFail(roomId);
  roomService.assertMember(room, sender);

  const parent = parentId ? await threadParentOrFail(parentId, room) : null;

  const message = await Message.create({
    room: room._id,
    sender,
    username,
    text: body,
    parent: parent?._id ?? null,
  });

  if (parent) await Message.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });

  // Drives the sidebar's unread dot. Stamped after the insert, so a failed
  // write can never mark a room unread for a message nobody will ever see.
  await Room.updateOne({ _id: room._id }, { lastMessageAt: message.createdAt });

  // Sending is reading: without this the author's own room lights up unread.
  // The timestamps are equal, and "unread" is a strict `>`.
  await RoomRead.updateOne(
    { room: room._id, user: sender },
    { lastReadAt: message.createdAt },
    { upsert: true }
  );

  return message;
}

/**
 * Rewrite your own message, within an hour of sending it.
 *
 * The window is measured from `createdAt`, not from the previous edit —
 * otherwise editing every 59 minutes would keep a message editable forever.
 */
export async function editMessage({ messageId, userId, text }) {
  const body = cleanBody(text);
  const message = await ownMessageOrFail(messageId, userId);

  const age = Date.now() - message.createdAt.getTime();
  if (age > MESSAGE_EDIT_WINDOW_MS)
    throw AppError.forbidden("Messages can only be edited within an hour of sending");

  message.text = body;
  message.editedAt = new Date();
  await message.save();

  return message;
}

/**
 * Retract your own message, at any age. The document survives as a tombstone so
 * the surrounding conversation still reads sensibly, but the words are gone.
 */
export async function deleteMessage({ messageId, userId }) {
  const message = await ownMessageOrFail(messageId, userId);

  message.text = "";
  message.deletedAt = new Date();
  await message.save();

  return message;
}

/**
 * Add or remove your reaction — one click does both, as everywhere else.
 * Anyone in the room may react, including to their own message.
 *
 * An emoji group with no users left is removed, so an untouched message never
 * carries the ghost of a reaction somebody withdrew.
 */
export async function toggleReaction({ messageId, userId, emoji }) {
  // Any emoji, but ONLY an emoji: the value lands on someone else's message and
  // is broadcast to the whole room, so it is validated by shape, not by a list.
  if (!isEmoji(emoji)) throw AppError.badRequest("Unsupported reaction");

  const message = await messageOrFail(messageId, userId);
  const group = message.reactions.find((reaction) => reaction.emoji === emoji);

  if (!group) {
    message.reactions.push({ emoji, users: [userId] });
  } else if (group.users.some((id) => String(id) === String(userId))) {
    group.users = group.users.filter((id) => String(id) !== String(userId));
    if (!group.users.length)
      message.reactions = message.reactions.filter((reaction) => reaction.emoji !== emoji);
  } else {
    group.users.push(userId);
  }

  await message.save();
  return message;
}
