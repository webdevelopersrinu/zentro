import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import * as roomService from "../services/room.service.js";
import { queryKeys } from "../lib/queryKeys.js";
import { SOCKET_EVENTS } from "../config/index.js";
import { useSocketEmit } from "./useSocketEvent.js";

let tempId = 0;
const nextTempId = () => `temp-${(tempId += 1)}`;

/**
 * A room's cache entry is a PAGE, not a bare array: `hasMore` tells the list
 * whether scrolling up can still fetch older history. Writers live here so
 * every one of them keeps that shape — including useRealtimeSync.
 */
export const EMPTY_PAGE = { messages: [], hasMore: false };

export const appendMessage = (page = EMPTY_PAGE, message) =>
  page.messages.some((existing) => existing.id === message.id)
    ? page
    : { ...page, messages: [...page.messages, message] };

const replaceMessage = (page, id, next) => ({
  ...page,
  messages: page.messages.map((message) => (message.id === id ? next(message) : message)),
});

/** An edit or a delete: same shape, arrives by ack or by broadcast. */
export const patchMessage = (page = EMPTY_PAGE, message) =>
  replaceMessage(page, message.id, () => message);

export function useMessages(roomId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.messages(roomId),
    queryFn: () => roomService.listMessages(roomId),
    enabled: Boolean(roomId) && enabled,
  });
}

/**
 * Fetches the page before the oldest message we hold, and prepends it.
 *
 * Scroll fires continuously, so re-entry is guarded by a ref rather than the
 * `loading` state: state arrives a render too late and we would request the
 * same page several times before the first response landed.
 */
export function useLoadOlderMessages(roomId) {
  const queryClient = useQueryClient();
  const key = queryKeys.messages(roomId);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const inFlight = useRef(false);

  const loadOlder = useCallback(async () => {
    const page = queryClient.getQueryData(key);
    if (inFlight.current || !page?.hasMore || !page.messages.length) return;

    inFlight.current = true;
    setLoadingOlder(true);
    try {
      const older = await roomService.listMessages(roomId, { before: page.messages[0].id });

      // Every fetched id is strictly older than what we hold, so no dedup.
      queryClient.setQueryData(key, (current = EMPTY_PAGE) => ({
        hasMore: older.hasMore,
        messages: [...older.messages, ...current.messages],
      }));
    } finally {
      inFlight.current = false;
      setLoadingOlder(false);
    }
  }, [queryClient, key, roomId]);

  return { loadOlder, loadingOlder };
}

/**
 * Edit and delete. Neither is optimistic: both can be refused (the edit window
 * closes, the message is already gone), and a bubble that changes and then
 * changes back reads as a glitch. The broadcast updates the cache for everyone
 * including the author, so there is nothing to write here on success.
 */
export function useEditMessage() {
  const emit = useSocketEmit();

  return useCallback(
    (messageId, text) => emit(SOCKET_EVENTS.MESSAGE_EDIT, { messageId, text }),
    [emit]
  );
}

export function useDeleteMessage() {
  const emit = useSocketEmit();

  return useCallback((messageId) => emit(SOCKET_EVENTS.MESSAGE_DELETE, { messageId }), [emit]);
}

/**
 * One click adds or removes your reaction. Not optimistic either: the server's
 * broadcast comes back in well under the time it takes to notice, and a chip
 * that appears then vanishes on a refusal is worse than one that appears late.
 */
export function useToggleReaction() {
  const emit = useSocketEmit();

  return useCallback(
    (messageId, emoji) => emit(SOCKET_EVENTS.MESSAGE_REACT, { messageId, emoji }),
    [emit]
  );
}

/**
 * Optimistic send. The bubble appears before the server has heard of it, then
 * the ack either replaces the temporary message with the real one, or marks it
 * failed so the user can retry. The message is never sent over HTTP — the
 * socket both persists it and broadcasts it.
 *
 * A retry passes the failed message's id as `replaceId`: it re-uses that bubble
 * rather than appending a second one. Minting a fresh temp id on every attempt
 * would leave the failed bubble behind forever — nothing reconciles it (no ack
 * carries its id) and nothing can delete it (it has no server id).
 */
export function useSendMessage(roomId, author) {
  const queryClient = useQueryClient();
  const emit = useSocketEmit();
  const key = queryKeys.messages(roomId);

  return useCallback(
    async (text, { replaceId } = {}) => {
      const id = replaceId ?? nextTempId();

      queryClient.setQueryData(key, (page = EMPTY_PAGE) =>
        page.messages.some((message) => message.id === id)
          ? replaceMessage(page, id, (message) => ({
              ...message,
              text,
              status: "sending",
              error: undefined,
            }))
          : appendMessage(page, {
              id,
              roomId,
              text,
              username: author.username,
              createdAt: new Date().toISOString(),
              status: "sending",
            })
      );

      const ack = await emit(SOCKET_EVENTS.MESSAGE_SEND, { roomId, text });

      if (!ack?.ok) {
        queryClient.setQueryData(key, (page = EMPTY_PAGE) =>
          replaceMessage(page, id, (message) => ({
            ...message,
            status: "failed",
            error: ack?.error,
          }))
        );
        return ack;
      }

      /**
       * Swap the placeholder for the server's message in one update. The ack and
       * the `message:new` broadcast race each other, so: if the broadcast won,
       * simply drop the placeholder; if the ack won, promote it in place. Either
       * way the bubble never disappears and never doubles.
       */
      queryClient.setQueryData(key, (page = EMPTY_PAGE) => {
        const alreadyBroadcast = page.messages.some((m) => m.id === ack.message.id);

        return alreadyBroadcast
          ? { ...page, messages: page.messages.filter((m) => m.id !== id) }
          : replaceMessage(page, id, () => ack.message);
      });

      return ack;
    },
    [queryClient, key, roomId, author.username, emit]
  );
}
