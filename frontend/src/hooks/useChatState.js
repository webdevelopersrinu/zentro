import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useMyRooms,
  useDiscoverRooms,
  useJoinRoom,
  useDeclineInvite,
  useMarkRoomRead,
} from "./useRooms.js";
import { useRealtimeSync } from "./useRealtimeSync.js";
import { useRoomSubscriptions } from "./useRoomSubscriptions.js";
import { useToast } from "../context/ToastContext.jsx";

/** One read per burst of chatter, not one per message. */
const READ_TRAIL_MS = 2000;

/**
 * All of the chat screen's CLIENT state — which room is open, which rooms have
 * unread activity, which room is mid-join. Server state stays in React Query.
 */
export function useChatState() {
  const { data: myRooms = [], isLoading: loadingRooms } = useMyRooms();
  const { data: discoverRooms = [] } = useDiscoverRooms();
  const join = useJoinRoom();
  const decline = useDeclineInvite();
  const markRead = useMarkRoomRead();
  const { toast } = useToast();

  const [activeRoomId, setActiveRoomId] = useState(null);
  const [unreadRoomIds, setUnreadRoomIds] = useState(() => new Set());

  const markUnread = useCallback((roomId) => {
    setUnreadRoomIds((current) => new Set(current).add(roomId));
  }, []);

  const markReadOnServer = markRead.mutate;

  /**
   * Reading the open room is trailing-debounced. The server upserts the receipt
   * AND broadcasts it to every member, so one POST per arriving message costs
   * members² socket frames — and at more than 20 messages a minute it burns
   * through the API rate limiter, 429-ing the user's whole session.
   */
  const readTimer = useRef(null);

  const markReadSoon = useCallback(
    (roomId) => {
      clearTimeout(readTimer.current);
      readTimer.current = setTimeout(() => markReadOnServer(roomId), READ_TRAIL_MS);
    },
    [markReadOnServer]
  );

  useEffect(() => () => clearTimeout(readTimer.current), []);

  /**
   * The server says what was unread when the tab was last closed; the socket
   * adds to that while it is open. Two rules keep the two from fighting:
   *
   * Only ever a union — never clear a dot because the server has not caught up.
   * And never the open room — a refetch racing the /read we just sent would
   * otherwise put a dot on the very room being read.
   */
  useEffect(() => {
    const unread = myRooms
      .filter((room) => room.unread && room.id !== activeRoomId)
      .map((room) => room.id);
    if (!unread.length) return;

    setUnreadRoomIds((current) => {
      const missing = unread.filter((id) => !current.has(id));
      return missing.length ? new Set([...current, ...missing]) : current;
    });
  }, [myRooms, activeRoomId]);

  useRealtimeSync({ activeRoomId, onUnread: markUnread, onRead: markReadSoon });

  // Subscribe the socket to every room we belong to — including rooms created
  // or joined after the socket connected, which the server cannot auto-join.
  useRoomSubscriptions(myRooms);

  const selectRoom = useCallback(
    (roomId) => {
      setActiveRoomId(roomId);

      // Opening a room reads it immediately. Any read still trailing belongs to
      // the room being left and is allowed to land: it is still true.
      markReadOnServer(roomId);

      setUnreadRoomIds((current) => {
        if (!current.has(roomId)) return current;
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    },
    [markReadOnServer]
  );

  /** Public rooms admit you instantly; private ones only record a request. */
  const joinRoom = useCallback(
    (room) =>
      join.mutate(room.id, {
        onSuccess: (result) => {
          if (result.joined) {
            toast(`Joined #${room.name}`, { variant: "success" });
            selectRoom(room.id); // opening it is reading it — a joined room has history
          } else {
            toast(`Request sent to the creator of #${room.name}`);
          }
        },
        onError: (error) => toast(error.message, { variant: "error" }),
      }),
    [join, toast, selectRoom]
  );

  const declineInvite = useCallback(
    (room) =>
      decline.mutate(room.id, {
        onSuccess: () => toast(`Declined the invite to #${room.name}`),
        onError: (error) => toast(error.message, { variant: "error" }),
      }),
    [decline, toast]
  );

  const activeRoom = useMemo(
    () =>
      myRooms.find((room) => room.id === activeRoomId) ??
      discoverRooms.find((room) => room.id === activeRoomId) ??
      null,
    [myRooms, discoverRooms, activeRoomId]
  );

  // A room we left, or were rejected from, must not stay open.
  useEffect(() => {
    if (activeRoomId && !activeRoom) setActiveRoomId(null);
  }, [activeRoomId, activeRoom]);

  return {
    myRooms,
    discoverRooms,
    loadingRooms,
    activeRoom,
    activeRoomId,
    unreadRoomIds,
    joiningRoomId: join.isPending ? join.variables : null,
    selectRoom,
    joinRoom,
    declineInvite,
  };
}
