import { useEffect, useRef } from "react";

import { SOCKET_EVENTS } from "../config/index.js";
import { useSocket } from "../context/SocketContext.jsx";

/**
 * Subscribes the socket to every room we belong to.
 *
 * The server auto-joins the rooms you were a member of when the socket
 * connected. A room you CREATE or JOIN afterwards is not among them, so
 * `io.to(roomId)` never reaches you: no messages, no typing, no presence.
 * Your own messages still appear, because those are optimistic — which makes
 * this bug look like "it works locally but never syncs".
 *
 * The joined set is cleared on disconnect: a reconnected socket is a new socket
 * on the server and has joined nothing.
 *
 * A room is marked BEFORE its ack arrives. Marking it on the ack instead leaves
 * a window in which the room list refetches, the effect re-runs, and the same
 * room:join is emitted again — every unread dot and every refetch reopens it.
 * A failed join is unmarked, so the next render retries.
 */
export function useRoomSubscriptions(rooms) {
  const { socketRef, isReady } = useSocket();
  const joined = useRef(new Set());

  useEffect(() => {
    if (!isReady) {
      joined.current = new Set();
      return;
    }

    const socket = socketRef.current;
    if (!socket) return;

    rooms
      .filter((room) => room.isMember && !joined.current.has(room.id))
      .forEach((room) => {
        joined.current.add(room.id);

        socket.emit(SOCKET_EVENTS.ROOM_JOIN, room.id, (ack) => {
          if (!ack?.ok) joined.current.delete(room.id);
        });
      });
  }, [rooms, isReady, socketRef]);
}
