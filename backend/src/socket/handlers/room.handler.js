import * as roomService from "../../services/room.service.js";
import { SOCKET_EVENTS, userChannel } from "../../constants/index.js";
import { withAck, chatRoomsOf } from "../helpers.js";

/**
 * Every presence and typing payload carries its roomId. Without it a client in
 * two rooms cannot tell which one the event belongs to, and would flip the wrong
 * member's dot or show "alice is typing" in the wrong conversation.
 *
 * `.except(userChannel)` excludes the actor's OTHER sockets, not just the one
 * emitting: nobody needs to be told about their own arrival or departure. It is
 * also load-bearing for PRESENCE_LEFT — that one is published only after an
 * awaited cluster-wide fetchSockets (see socket/index.js), and a user who
 * reconnects inside that window would otherwise have the stale departure
 * delivered to their brand-new socket, which has already re-joined the room.
 */
export function broadcastPresence(socket, event, rooms = chatRoomsOf(socket)) {
  const { id: userId, username } = socket.user;
  rooms.forEach((roomId) =>
    socket
      .to(roomId)
      .except(userChannel(userId))
      .emit(event, { roomId, userId, username })
  );
}

export function registerRoomHandlers(io, socket) {
  const { id: userId, username } = socket.user;

  /**
   * Subscribes this socket to a room's broadcasts. The server auto-joins the
   * rooms you belonged to at connect time; a room created or joined afterwards
   * needs this, or `io.to(roomId)` will never reach you.
   */
  socket.on(
    SOCKET_EVENTS.ROOM_JOIN,
    withAck(async (roomId) => {
      const room = await roomService.getRoomOrFail(roomId);
      roomService.assertMember(room, userId);

      socket.join(roomId);
      broadcastPresence(socket, SOCKET_EVENTS.PRESENCE_JOINED, [roomId]);
    })
  );

  /**
   * A socket is only ever joined to rooms the server admitted it to (auto-join
   * at connect, or ROOM_JOIN above, which checks membership). So its own
   * subscription list IS the authorization answer for relay-only events — no
   * need to hit Mongo on every keystroke. Without this a client can name any
   * room id (and /rooms/discover hands out private ones) and inject presence or
   * a permanent "alice is typing…" into a room it was never a member of.
   */
  const isSubscribed = (roomId) => chatRoomsOf(socket).includes(roomId);

  socket.on(SOCKET_EVENTS.ROOM_LEAVE, (roomId) => {
    if (!isSubscribed(roomId)) return;

    // Broadcast BEFORE leaving: `socket.to()` excludes the sender anyway, and
    // reading the room after the leave would find it empty.
    broadcastPresence(socket, SOCKET_EVENTS.PRESENCE_LEFT, [roomId]);
    socket.leave(roomId);
  });

  // `= {}` so a client emitting TYPING with no payload can't throw out of the
  // listener and take the process down with an uncaught exception.
  socket.on(SOCKET_EVENTS.TYPING, ({ roomId, isTyping } = {}) => {
    if (!isSubscribed(roomId)) return;

    socket.to(roomId).emit(SOCKET_EVENTS.TYPING, { roomId, username, isTyping });
  });
}
