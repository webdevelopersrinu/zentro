import { authenticateSocket } from "./authenticate.js";
import { registerRoomHandlers, broadcastPresence } from "./handlers/room.handler.js";
import { registerMessageHandlers } from "./handlers/message.handler.js";
import * as roomService from "../services/room.service.js";
import { chatRoomsOf } from "./helpers.js";
import { SOCKET_EVENTS, userChannel } from "../constants/index.js";
import { logger } from "../lib/logger.js";

/**
 * Auto-join every room the user belongs to, so they receive `message:new` for
 * rooms they aren't currently looking at — that's what drives unread badges.
 */
async function joinOwnRooms(socket, userId) {
  const rooms = await roomService.listMyRooms(userId);
  rooms.forEach((room) => socket.join(String(room._id)));
}

function onConnection(io, socket) {
  const { id: userId, username } = socket.user;
  logger.info(`🔌 ${username} connected (${socket.id})`);

  // fetchSockets() hands back RemoteSocket objects for sockets living on other
  // servers, and those only carry `data` — not the ad-hoc `socket.user` the
  // handshake sets. Mirror it so presence lookups work cluster-wide, not just
  // for the sockets that happen to be attached to this node.
  socket.data.user = socket.user;

  // Register listeners SYNCHRONOUSLY, before any await. A client may emit the
  // instant it sees "connect"; if we awaited first, that event would arrive
  // with no listener attached and its ack would never fire.
  socket.join(userChannel(userId)); // personal channel for targeted notifications
  registerRoomHandlers(io, socket);
  registerMessageHandlers(io, socket);

  // "disconnecting", not "disconnect": by the latter Socket.IO has already
  // emptied socket.rooms, so there would be nobody left to notify.
  socket.on("disconnecting", async () => {
    // Snapshot the rooms NOW: Socket.IO clears socket.rooms the moment this
    // listener yields, so anything read after the await below is already empty.
    const rooms = chatRoomsOf(socket);

    // A user with two tabs open is still online when one of them closes.
    // Every socket joins the user's personal channel, so ask the cluster (one
    // call, not one per room) whether any OTHER socket of theirs survives. We
    // filter by id rather than counting: whether this socket has already left
    // the channel by the time the fetch resolves is a timing detail.
    const sockets = await io.in(userChannel(userId)).fetchSockets();
    if (sockets.some((s) => s.id !== socket.id)) return;

    broadcastPresence(socket, SOCKET_EVENTS.PRESENCE_LEFT, rooms);
  });
  socket.on("disconnect", () => logger.info(`❌ ${username} disconnected`));

  // Async setup. Clients that care about receiving broadcasts should wait for
  // "ready" — until the room joins land, this socket isn't subscribed yet.
  joinOwnRooms(socket, userId)
    .then(() => broadcastPresence(socket, SOCKET_EVENTS.PRESENCE_JOINED))
    .catch((err) => logger.error("auto-join failed:", err.message))
    .finally(() => socket.emit(SOCKET_EVENTS.READY));
}

export function registerSocketHandlers(io) {
  io.use(authenticateSocket);
  io.on("connection", (socket) => onConnection(io, socket));
}
