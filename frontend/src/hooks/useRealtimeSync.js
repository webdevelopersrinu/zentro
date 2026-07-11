import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../lib/queryKeys.js";
import { SOCKET_EVENTS } from "../config/index.js";
import { useSocketEvent } from "./useSocketEvent.js";
import { appendMessage, patchMessage } from "./useMessages.js";
import { applyReceipt } from "./useReceipts.js";
import { appendReply, patchThread, bumpReplyCount } from "./useThread.js";
import { useToast } from "../context/ToastContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * The bridge between the socket and the cache.
 *
 * Incoming events WRITE INTO the cache; they never trigger a refetch. Refetching
 * the whole message list on every arriving message would be an N+1 disaster —
 * the socket already handed us the data.
 */
export function useRealtimeSync({ activeRoomId, onUnread, onRead }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const currentUserId = user?.id;

  const refreshRoomLists = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    queryClient.invalidateQueries({ queryKey: queryKeys.discover });
  };

  /** Only ever touches a cache entry we already hold. */
  const patchCache = (key, update) => {
    if (queryClient.getQueryData(key)) queryClient.setQueryData(key, update);
  };

  /**
   * A reconnect means we were deaf for a while, and nothing replays what was
   * broadcast in the gap. Every room-scoped key hangs off ["rooms"], so a single
   * invalidation covers the open room's history, its receipts and the room lists
   * — and only ACTIVE queries actually refetch. Skipped on the first READY: the
   * queries have only just been fetched.
   */
  const connectedBefore = useRef(false);

  useSocketEvent(SOCKET_EVENTS.READY, () => {
    if (connectedBefore.current) queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    connectedBefore.current = true;
  });

  useSocketEvent(SOCKET_EVENTS.MESSAGE_NEW, (message) => {
    if (message.parentId) {
      /**
       * A reply belongs to its thread, never to the main list. The parent's
       * "N replies" label is bumped here rather than re-broadcast: every client
       * sees this event exactly once, so each arrives at the same count.
       */
      patchCache(queryKeys.thread(message.roomId, message.parentId), (thread) =>
        appendReply(thread, message)
      );
      patchCache(queryKeys.messages(message.roomId), (page) =>
        bumpReplyCount(page, message.parentId)
      );
    } else {
      /**
       * Only extend history we already hold. Seeding a cache entry for a room
       * that was never opened would claim `hasMore: false` on a room whose
       * history we have not read a single page of.
       */
      patchCache(queryKeys.messages(message.roomId), (page) => appendMessage(page, message));
    }

    // A message in a room you are not looking at earns a dot, not a toast.
    // One you ARE looking at is read on arrival, so a reload shows no dot.
    // onRead is trailing-debounced by the caller: the server broadcasts every
    // read to every member, so one call per message is quadratic in room size.
    if (message.roomId !== activeRoomId) onUnread(message.roomId);
    else onRead?.(message.roomId);
  });

  /**
   * An edit, a delete or a reaction only rewrites history we already hold, and
   * never counts as unread: nothing new was said. A deleted message keeps its
   * place as a tombstone, so this is a patch in every case, never a removal.
   *
   * The message may be in the main list, or the parent or a reply of an open
   * thread; it is patched wherever it is found.
   */
  const applyPatch = (message) => {
    patchCache(queryKeys.messages(message.roomId), (page) => patchMessage(page, message));

    const threadId = message.parentId ?? message.id;
    patchCache(queryKeys.thread(message.roomId, threadId), (thread) =>
      patchThread(thread, message)
    );
  };

  useSocketEvent(SOCKET_EVENTS.MESSAGE_UPDATED, applyPatch);
  useSocketEvent(SOCKET_EVENTS.MESSAGE_DELETED, applyPatch);

  /**
   * Someone read the room: move their tick mark. The event goes to the whole
   * room, so it comes back to the reader too — and my own mark must never join
   * my own receipt list, or I would count as a reader of my own messages.
   */
  useSocketEvent(SOCKET_EVENTS.ROOM_READ, ({ roomId, userId, lastReadAt }) => {
    if (userId === currentUserId) return;

    const key = queryKeys.receipts(roomId);
    if (queryClient.getQueryData(key)) {
      queryClient.setQueryData(key, (page) => applyReceipt(page, { userId, lastReadAt }));
    }
  });

  /**
   * Presence carries its own roomId — the user may be in several rooms, and the
   * event is not necessarily about the one on screen.
   */
  const setPresence = (roomId, userId, online) => {
    const key = queryKeys.members(roomId);
    const members = queryClient.getQueryData(key);
    if (!members) return;

    // Somebody we have never seen: they joined the room, so the roster and the
    // member counts are both stale.
    if (!members.some((member) => member.id === userId)) {
      queryClient.invalidateQueries({ queryKey: key });
      refreshRoomLists();
      return;
    }

    queryClient.setQueryData(key, (current) =>
      current.map((member) => (member.id === userId ? { ...member, online } : member))
    );
  };

  useSocketEvent(SOCKET_EVENTS.PRESENCE_JOINED, ({ roomId, userId }) =>
    setPresence(roomId, userId, true)
  );

  useSocketEvent(SOCKET_EVENTS.PRESENCE_LEFT, ({ roomId, userId }) =>
    setPresence(roomId, userId, false)
  );

  useSocketEvent(SOCKET_EVENTS.REQUEST_NEW, ({ roomId, roomName, from }) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.requests(roomId) });
    refreshRoomLists(); // the sidebar shows a pending-request badge
    toast(`${from.name} wants to join #${roomName}`);
  });

  useSocketEvent(SOCKET_EVENTS.REQUEST_APPROVED, ({ roomName }) => {
    refreshRoomLists();
    toast(`You were approved for #${roomName}`, { variant: "success" });
  });

  useSocketEvent(SOCKET_EVENTS.REQUEST_REJECTED, ({ roomName }) => {
    refreshRoomLists();
    toast(`Your request for #${roomName} was declined`, { variant: "warning" });
  });

  useSocketEvent(SOCKET_EVENTS.ROOM_INVITED, ({ roomName, from }) => {
    refreshRoomLists();
    toast(`${from} added you to #${roomName}`, { variant: "success" });
  });

  useSocketEvent(SOCKET_EVENTS.ROOM_ADMIN_CHANGED, ({ roomId, roomName, isAdmin }) => {
    // isAdmin lives on the room DTO and on every member row.
    queryClient.invalidateQueries({ queryKey: queryKeys.members(roomId) });
    refreshRoomLists();

    toast(
      isAdmin ? `You are now an admin of #${roomName}` : `You are no longer an admin of #${roomName}`,
      { variant: isAdmin ? "success" : "warning" }
    );
  });

  useSocketEvent(SOCKET_EVENTS.ROOM_DELETED, ({ roomId, name }) => {
    // Drop its history too: the room is gone, and so is every message in it.
    queryClient.removeQueries({ queryKey: queryKeys.messages(roomId) });
    refreshRoomLists();
    toast(`#${name} was deleted by its creator`, { variant: "warning" });
  });
}
