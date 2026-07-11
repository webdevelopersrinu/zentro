/**
 * The single source of truth for every shape the API returns.
 * Controllers never hand a Mongoose document to res.json().
 */
const idOf = (v) => (v?._id ?? v).toString();
const has = (list, id) => (list ?? []).some((x) => idOf(x) === id);

export const toUserDTO = (user) => ({
  id: idOf(user),
  username: user.username,
  name: user.name || user.username,
  avatarUrl: user.avatarUrl || "",
});

/**
 * `reactions` carries user ids rather than a `mine` flag: one broadcast goes to
 * every member, so "mine" cannot be baked in — each client resolves it.
 */
export const toMessageDTO = (message) => ({
  id: idOf(message),
  roomId: idOf(message.room),
  username: message.username,
  text: message.text,
  createdAt: message.createdAt,
  editedAt: message.editedAt ?? null,
  deleted: Boolean(message.deletedAt),
  parentId: message.parent ? idOf(message.parent) : null,
  replyCount: message.replyCount ?? 0,
  reactions: (message.reactions ?? []).map(({ emoji, users }) => ({
    emoji,
    users: users.map(idOf),
  })),
});

/**
 * Room as seen *by a specific viewer*. The flags tell the UI which button to
 * render: Open / Join / Request to join / Requested / Accept invite.
 *
 * `unread` is passed in rather than derived here: answering it costs a second
 * query, which only the sidebar's room list makes.
 */
export const toRoomDTO = (room, viewerId, { unread = false } = {}) => {
  const viewer = String(viewerId);
  return {
    id: idOf(room),
    name: room.name,
    visibility: room.visibility,
    creator: idOf(room.creator),
    isCreator: idOf(room.creator) === viewer,
    isAdmin: idOf(room.creator) === viewer || has(room.admins, viewer),
    isMember: has(room.members, viewer),
    hasRequested: has(room.joinRequests, viewer),
    isInvited: has(room.invites, viewer),
    memberCount: (room.members ?? []).length,
    requestCount: (room.joinRequests ?? []).length,
    unread,
  };
};

export const toMemberDTO = (user, { room, online }) => {
  const isCreator = idOf(room.creator) === idOf(user);
  return {
    ...toUserDTO(user),
    online,
    isCreator,
    // The creator is an admin without being listed as one.
    isAdmin: isCreator || has(room.admins, idOf(user)),
  };
};
