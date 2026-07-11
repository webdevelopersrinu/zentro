import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import * as roomService from "../services/room.service.js";
import { queryKeys } from "../lib/queryKeys.js";
import { SOCKET_EVENTS } from "../config/index.js";
import { useSocketEmit } from "./useSocketEvent.js";

/** The parent plus every reply. Threads are short, so this is not paged. */
export function useThread(roomId, messageId) {
  return useQuery({
    queryKey: queryKeys.thread(roomId, messageId),
    queryFn: () => roomService.listReplies(roomId, messageId),
    enabled: Boolean(roomId && messageId),
  });
}

/**
 * Replying is sending with a parent. Not optimistic: a thread is opened
 * deliberately and read attentively, so a bubble that appears and then fails is
 * more jarring here than a bubble that appears a moment late.
 */
export function useSendReply(roomId, parentId) {
  const emit = useSocketEmit();

  return useCallback(
    (text) => emit(SOCKET_EVENTS.MESSAGE_SEND, { roomId, text, parentId }),
    [emit, roomId, parentId]
  );
}

/** Appends a reply to its thread, if that thread is open. Deduped by id. */
export const appendReply = (thread, reply) =>
  !thread || thread.replies.some((existing) => existing.id === reply.id)
    ? thread
    : { ...thread, replies: [...thread.replies, reply] };

/**
 * Patches one message wherever it lives — the parent of an open thread, or one
 * of its replies. An edit, a delete or a reaction can land on either.
 */
export const patchThread = (thread, message) => {
  if (!thread) return thread;

  if (thread.parent.id === message.id) return { ...thread, parent: message };

  return {
    ...thread,
    replies: thread.replies.map((reply) => (reply.id === message.id ? message : reply)),
  };
};

/** Keeps the "N replies" label on the parent honest as replies arrive. */
export const bumpReplyCount = (page, parentId) =>
  !page
    ? page
    : {
        ...page,
        messages: page.messages.map((message) =>
          message.id === parentId
            ? { ...message, replyCount: (message.replyCount ?? 0) + 1 }
            : message
        ),
      };
