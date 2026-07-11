import mongoose from "mongoose";
import { Room } from "../models/Room.js";
import { Message } from "../models/Message.js";
import { RoomRead } from "../models/RoomRead.js";
import * as userService from "./user.service.js";
import { getOnlineUserIds } from "./presence.service.js";
import { getIO } from "../lib/io.js";
import { notifyUser, notifyRoom } from "../utils/notify.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex } from "../utils/sanitize.js";
import {
  ROOM_VISIBILITY,
  SOCKET_EVENTS,
  MESSAGE_PAGE,
  SEARCH,
  userChannel,
} from "../constants/index.js";

// ── predicates & guards ────────────────────────────────────────────────────
const idEq = (a, b) => String(a) === String(b);
const contains = (list, id) => (list ?? []).some((x) => idEq(x, id));

export const isMember = (room, userId) => contains(room.members, userId);
export const isCreator = (room, userId) => idEq(room.creator, userId);
export const hasRequested = (room, userId) => contains(room.joinRequests, userId);
export const isInvited = (room, userId) => contains(room.invites, userId);

/** The creator is an admin by definition, and cannot be demoted out of it. */
export const isAdmin = (room, userId) =>
  isCreator(room, userId) || contains(room.admins, userId);

/** Everyone who may moderate: the creator, plus whoever they promoted. */
export const adminIds = (room) => [
  String(room.creator),
  ...(room.admins ?? []).map(String).filter((id) => !idEq(id, room.creator)),
];

export function assertMember(room, userId) {
  if (!isMember(room, userId))
    throw AppError.forbidden("Not a member of this room");
}

/** Day-to-day moderation: approving, inviting, renaming. */
export function assertAdmin(room, userId, action = "manage") {
  if (!isAdmin(room, userId))
    throw AppError.forbidden(`Only an admin can ${action} this room`);
}

/** Ownership: deleting the room, and deciding who else may moderate it. */
export function assertCreator(room, userId, action = "manage") {
  if (!isCreator(room, userId))
    throw AppError.forbidden(`Only the creator can ${action} this room`);
}

// ── reads ──────────────────────────────────────────────────────────────────
export async function getRoomOrFail(roomId) {
  if (!mongoose.isValidObjectId(roomId)) throw AppError.notFound("Room not found");
  const room = await Room.findById(roomId);
  if (!room) throw AppError.notFound("Room not found");
  return room;
}

/** Rooms the user belongs to. */
export const listMyRooms = (userId) =>
  Room.find({ members: userId }).sort({ updatedAt: -1 });

/**
 * Rooms the user is NOT in. Private rooms are included on purpose: they are
 * visible-but-locked, so the UI can offer "Request to join".
 */
export const listDiscoverableRooms = (userId) =>
  Room.find({ members: { $ne: userId } }).sort({ updatedAt: -1 });

/**
 * One page of history. `before` is the id of the oldest message the client
 * already holds; omit it to get the newest page. Read newest-first so the page
 * hangs off the index, then reversed so the caller can render it as-is.
 *
 * One extra row is fetched purely to answer `hasMore` without a second query.
 */
export async function listMessages(room, userId, { before, limit } = {}) {
  assertMember(room, userId);

  const size = limit ?? MESSAGE_PAGE.DEFAULT;
  const page = await Message.find({
    room: room._id,
    parent: null, // thread replies live in their thread, not the main list
    ...(before ? { _id: { $lt: before } } : {}),
  })
    .sort({ _id: -1 })
    .limit(size + 1);

  const hasMore = page.length > size;
  if (hasMore) page.pop();

  return { messages: page.reverse(), hasMore };
}

/**
 * A whole thread, oldest first. Threads are short by construction — one level
 * deep, and read in one sitting — so this is not paged.
 */
export async function listReplies(room, userId, parentId) {
  assertMember(room, userId);
  if (!mongoose.isValidObjectId(parentId)) throw AppError.notFound("Message not found");

  // Scoped to the room, so a parent id from elsewhere reveals nothing.
  const parent = await Message.findOne({ _id: parentId, room: room._id });
  if (!parent) throw AppError.notFound("Message not found");

  const replies = await Message.find({ parent: parent._id }).sort({ _id: 1 });
  return { parent, replies };
}

/**
 * Substring search within one room, newest first. Deleted messages never match:
 * their text is empty, and a tombstone is not something anyone is looking for.
 *
 * ponytail: an escaped regex, not a text index. It rides the {room, _id} index
 * to stay inside one room, and matches mid-word the way people expect ("stand"
 * finds "standup") — which $text cannot. Revisit if a room's history grows past
 * what a per-room scan can serve.
 */
export async function searchMessages(room, userId, { q, limit = SEARCH.LIMIT }) {
  assertMember(room, userId);

  return Message.find({
    room: room._id,
    deletedAt: null,
    text: { $regex: escapeRegex(q), $options: "i" },
  })
    .sort({ _id: -1 })
    .limit(limit);
}

export async function listMembers(room, userId) {
  assertMember(room, userId);
  const users = await userService.findByIds(room.members);
  const online = await getOnlineUserIds(room.members);
  return users.map((user) => ({ user, online: online.has(String(user._id)) }));
}

export async function listJoinRequests(room, userId) {
  assertAdmin(room, userId, "view requests for");
  return userService.findByIds(room.joinRequests);
}

// ── writes ─────────────────────────────────────────────────────────────────

/**
 * The ONE way membership lists are written.
 *
 * A load-mutate-save is not safe here: `list = list.filter(...)` compiles to a
 * $set of the whole path, so two admins settling two different requests would
 * each write back their own stale copy and one request would survive forever.
 * `push` compiles to $push, so two concurrent joins list the same user twice —
 * which inflates memberCount and permanently breaks that room's read receipts.
 * $addToSet/$pull in a single updateOne are the server-side, idempotent form.
 *
 * The in-memory doc is replayed to match, because callers serialize `room`
 * straight back to the client.
 */
async function mutateMembers(room, ops) {
  await Room.updateOne({ _id: room._id }, ops);

  for (const [path, id] of Object.entries(ops.$addToSet ?? {}))
    if (!contains(room[path], id)) room[path].push(id);

  for (const [path, id] of Object.entries(ops.$pull ?? {}))
    room[path] = (room[path] ?? []).filter((x) => !idEq(x, id));

  return room;
}

export const createRoom = ({ userId, name, visibility }) =>
  Room.create({
    name,
    visibility,
    creator: userId,
    members: [userId],
    joinRequests: [],
  });

/**
 * One entry point for "let me in", because the outcome depends only on who is
 * asking:
 *   invited      → accepted, straight in (the creator already said yes)
 *   public       → straight in
 *   private      → a request is recorded; the caller is NOT a member
 */
export async function joinRoom(room, user) {
  if (isMember(room, user.id)) throw AppError.badRequest("Already a member");

  // An invite is a pre-approved join, so accepting one IS joining.
  if (isInvited(room, user.id)) {
    await mutateMembers(room, {
      $addToSet: { members: user.id },
      $pull: { invites: user.id },
    });
    return { joined: true };
  }

  if (room.visibility === ROOM_VISIBILITY.PUBLIC) {
    await mutateMembers(room, { $addToSet: { members: user.id } });
    return { joined: true };
  }

  if (!hasRequested(room, user.id)) {
    await mutateMembers(room, { $addToSet: { joinRequests: user.id } });

    // Every admin can approve it, so every admin is told about it.
    for (const adminId of adminIds(room)) {
      notifyUser(adminId, SOCKET_EVENTS.REQUEST_NEW, {
        roomId: String(room._id),
        roomName: room.name,
        from: {
          id: user.id,
          username: user.username,
          name: user.name || user.username,
          avatarUrl: user.avatarUrl || "",
        },
      });
    }
  }
  return { requested: true };
}

export async function approveRequest(room, actorId, targetUserId) {
  assertAdmin(room, actorId, "approve requests for");
  if (!hasRequested(room, targetUserId))
    throw AppError.notFound("No such pending request");

  await mutateMembers(room, {
    $addToSet: { members: targetUserId },
    $pull: { joinRequests: targetUserId },
  });

  notifyUser(targetUserId, SOCKET_EVENTS.REQUEST_APPROVED, {
    roomId: String(room._id),
    roomName: room.name,
  });
  return room;
}

export async function rejectRequest(room, actorId, targetUserId) {
  assertAdmin(room, actorId, "reject requests for");
  if (!hasRequested(room, targetUserId))
    throw AppError.notFound("No such pending request");

  await mutateMembers(room, { $pull: { joinRequests: targetUserId } });

  notifyUser(targetUserId, SOCKET_EVENTS.REQUEST_REJECTED, {
    roomId: String(room._id),
    roomName: room.name,
  });
  return room;
}

/**
 * The creator OFFERS membership. Nobody is added to a room without their own
 * consent — the invitee accepts via joinRoom, or declines.
 *
 * If they had already asked to join, the invite settles it: both sides said
 * yes, so admit them immediately.
 */
export async function inviteByUsername(room, actor, username) {
  assertAdmin(room, actor.id, "invite to");

  const invitee = await userService.findByUsername(username);
  if (!invitee) throw AppError.notFound("User not found");
  if (isMember(room, invitee._id)) throw AppError.badRequest("Already a member");

  if (hasRequested(room, invitee._id)) {
    await mutateMembers(room, {
      $addToSet: { members: invitee._id },
      $pull: { joinRequests: invitee._id },
    });

    notifyUser(invitee._id, SOCKET_EVENTS.REQUEST_APPROVED, {
      roomId: String(room._id),
      roomName: room.name,
    });
    return room;
  }

  if (!isInvited(room, invitee._id)) {
    await mutateMembers(room, { $addToSet: { invites: invitee._id } });

    notifyUser(invitee._id, SOCKET_EVENTS.ROOM_INVITED, {
      roomId: String(room._id),
      roomName: room.name,
      from: actor.username,
    });
  }
  return room;
}

/** The invitee says no. The creator may invite again later. */
export async function declineInvite(room, userId) {
  if (!isInvited(room, userId)) throw AppError.notFound("No pending invite");

  await mutateMembers(room, { $pull: { invites: userId } });

  notifyUser(room.creator, SOCKET_EVENTS.INVITE_DECLINED, {
    roomId: String(room._id),
    roomName: room.name,
    userId: String(userId),
  });
  return room;
}

export async function leaveRoom(room, userId) {
  if (isCreator(room, userId))
    throw AppError.badRequest("The creator cannot leave; delete the room instead");
  assertMember(room, userId);

  // Moderation powers do not survive leaving the room they applied to.
  await mutateMembers(room, { $pull: { members: userId, admins: userId } });
  await RoomRead.deleteOne({ room: room._id, user: userId });

  // Membership is only checked when a message is WRITTEN; delivery is decided
  // purely by socket-room occupancy. Without this, an ex-member keeps receiving
  // the room's messages, edits, typing and presence until they reconnect.
  // socketsLeave reaches every server through the Valkey adapter.
  await getIO()?.in(userChannel(userId)).socketsLeave(String(room._id));
}

// ── admins ─────────────────────────────────────────────────────────────────

/**
 * The creator decides who else may moderate. An admin cannot promote another,
 * or a single promotion would let a room's moderation escape its owner.
 *
 * Only a member can be an admin: powers over a room you are not in make no
 * sense, and `leaveRoom` gives them up.
 */
export async function promoteToAdmin(room, actorId, targetUserId) {
  assertCreator(room, actorId, "choose admins for");
  if (!isMember(room, targetUserId)) throw AppError.notFound("Not a member of this room");
  if (isAdmin(room, targetUserId)) throw AppError.badRequest("Already an admin");

  await mutateMembers(room, { $addToSet: { admins: targetUserId } });

  notifyUser(targetUserId, SOCKET_EVENTS.ROOM_ADMIN_CHANGED, {
    roomId: String(room._id),
    roomName: room.name,
    isAdmin: true,
  });
  return room;
}

export async function demoteAdmin(room, actorId, targetUserId) {
  assertCreator(room, actorId, "choose admins for");
  if (isCreator(room, targetUserId))
    throw AppError.badRequest("The creator is always an admin");
  if (!isAdmin(room, targetUserId)) throw AppError.badRequest("Not an admin");

  await mutateMembers(room, { $pull: { admins: targetUserId } });

  notifyUser(targetUserId, SOCKET_EVENTS.ROOM_ADMIN_CHANGED, {
    roomId: String(room._id),
    roomName: room.name,
    isAdmin: false,
  });
  return room;
}

// ── read state ─────────────────────────────────────────────────────────────

/**
 * Marks the room read up to now. Upsert, because a member who has never opened
 * the room has no row — and a member who has must not gain a second one.
 */
export async function markRead(room, userId) {
  assertMember(room, userId);

  const lastReadAt = new Date();
  await RoomRead.updateOne({ room: room._id, user: userId }, { lastReadAt }, { upsert: true });

  // Turns the authors' tick marks blue, wherever in the cluster they are sitting.
  notifyRoom(room._id, SOCKET_EVENTS.ROOM_READ, {
    roomId: String(room._id),
    userId: String(userId),
    lastReadAt,
  });

  return lastReadAt;
}

/**
 * How far every OTHER member has read. The caller's own row is left out: you
 * are never a recipient of your own message, and never one of its readers.
 *
 * A member with no row has read nothing, and is simply absent from the result —
 * `memberCount` is what says how many readers a message is still waiting for.
 */
export async function listReceipts(room, userId) {
  assertMember(room, userId);

  const reads = await RoomRead.find({
    room: room._id,
    user: { $in: room.members.filter((m) => !idEq(m, userId)) },
  });

  return reads.map((read) => ({ userId: String(read.user), lastReadAt: read.lastReadAt }));
}

/**
 * Which of these rooms have messages the user has not seen.
 *
 * A room is unread when its newest message is newer than the user's last read —
 * or when they have never opened it at all, yet it already has messages.
 */
export async function unreadRoomIds(rooms, userId) {
  const withMessages = rooms.filter((room) => room.lastMessageAt);
  if (!withMessages.length) return new Set();

  const reads = await RoomRead.find({
    user: userId,
    room: { $in: withMessages.map((room) => room._id) },
  });

  const readAt = new Map(reads.map((read) => [String(read.room), read.lastReadAt]));

  return new Set(
    withMessages
      .filter((room) => {
        const lastRead = readAt.get(String(room._id));
        return !lastRead || room.lastMessageAt > lastRead;
      })
      .map((room) => String(room._id))
  );
}

export async function updateRoom(room, actorId, { name, visibility }) {
  assertAdmin(room, actorId, "update");
  if (name !== undefined) room.name = name;
  if (visibility !== undefined) room.visibility = visibility;
  await room.save();
  return room;
}

export async function deleteRoom(room, actorId) {
  assertCreator(room, actorId, "delete");

  // Captured before the document goes: members are needed to tell them.
  const members = room.members.map(String);
  const roomId = String(room._id);

  await Message.deleteMany({ room: room._id });
  await RoomRead.deleteMany({ room: room._id });
  await room.deleteOne();

  // The room is gone, so nobody may stay subscribed to its socket channel —
  // otherwise in-flight traffic still reaches sockets that are sitting in it.
  await getIO()?.socketsLeave(roomId);

  // Otherwise a member sitting in the room keeps a ghost open until a refetch.
  for (const memberId of members) {
    if (memberId !== String(actorId))
      notifyUser(memberId, SOCKET_EVENTS.ROOM_DELETED, { roomId, name: room.name });
  }

  return roomId;
}
