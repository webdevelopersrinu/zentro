import { api } from "../lib/apiClient.js";

const rooms = "/rooms";
const room = (id) => `${rooms}/${id}`;

export const listMyRooms = () => api.get(rooms).then(({ data }) => data.rooms);

/** Rooms I'm not in. Private ones are included: visible, but locked. */
export const listDiscoverableRooms = () =>
  api.get(`${rooms}/discover`).then(({ data }) => data.rooms);

export const createRoom = (payload) =>
  api.post(rooms, payload).then(({ data }) => data.room);

/**
 * Invited → { joined: true } (accepting an invite IS joining).
 * Public   → { joined: true }.
 * Private  → { requested: true }, no membership.
 */
export const joinRoom = (id) => api.post(`${room(id)}/join`).then(({ data }) => data);

export const declineInvite = (id) => api.post(`${room(id)}/invite/decline`);

export const leaveRoom = (id) => api.post(`${room(id)}/leave`);

/** Creator only. The creator cannot leave a room — they delete it. */
export const deleteRoom = (id) => api.delete(room(id));

/** One page of history, oldest-first. `before` is the oldest id already held. */
export const listMessages = (id, { before } = {}) =>
  api
    .get(`${room(id)}/messages`, { params: before ? { before } : undefined })
    .then(({ data }) => ({ messages: data.messages, hasMore: data.hasMore }));

/** Records that the caller has seen everything in the room up to now. */
export const markRoomRead = (id) => api.post(`${room(id)}/read`);

/** A whole thread: the parent message and every reply, oldest first. */
export const listReplies = (id, messageId) =>
  api.get(`${room(id)}/messages/${messageId}/replies`).then(({ data }) => data);

/** Substring search inside one room, newest first. */
export const searchMessages = (id, q) =>
  api.get(`${room(id)}/messages/search`, { params: { q } }).then(({ data }) => data.messages);

/** How far every other member has read, plus how many members there are. */
export const listReceipts = (id) =>
  api.get(`${room(id)}/receipts`).then(({ data }) => data);

export const listMembers = (id) =>
  api.get(`${room(id)}/members`).then(({ data }) => data.members);

export const listRequests = (id) =>
  api.get(`${room(id)}/requests`).then(({ data }) => data.requests);

export const approveRequest = (id, userId) =>
  api.post(`${room(id)}/requests/${userId}/approve`).then(({ data }) => data.room);

export const rejectRequest = (id, userId) =>
  api.post(`${room(id)}/requests/${userId}/reject`).then(({ data }) => data.room);

export const promoteAdmin = (id, userId) =>
  api.post(`${room(id)}/admins/${userId}`).then(({ data }) => data.room);

export const demoteAdmin = (id, userId) =>
  api.delete(`${room(id)}/admins/${userId}`).then(({ data }) => data.room);

export const inviteUser = (id, username) =>
  api.post(`${room(id)}/invite`, { username }).then(({ data }) => data.room);
