import { useQuery } from "@tanstack/react-query";

import * as roomService from "../services/room.service.js";
import { queryKeys } from "../lib/queryKeys.js";

const EMPTY = { receipts: [], memberCount: 0 };

/**
 * How far each other member has read this room. One row per member, not per
 * message: a room with 10 members costs 10 rows however long the history is.
 * The socket keeps it current, so this never refetches on its own.
 */
export function useReceipts(roomId) {
  const { data = EMPTY } = useQuery({
    queryKey: queryKeys.receipts(roomId),
    queryFn: () => roomService.listReceipts(roomId),
    enabled: Boolean(roomId),
  });

  return {
    receipts: data.receipts,
    // Everyone but me: I am never a recipient of my own message.
    recipientCount: Math.max(0, data.memberCount - 1),
  };
}

/** Moves one member's mark forward. Never backward — events can arrive late. */
export function applyReceipt(page = EMPTY, { userId, lastReadAt }) {
  const existing = page.receipts.find((receipt) => receipt.userId === userId);
  if (existing && new Date(existing.lastReadAt) >= new Date(lastReadAt)) return page;

  const others = page.receipts.filter((receipt) => receipt.userId !== userId);
  return { ...page, receipts: [...others, { userId, lastReadAt }] };
}
