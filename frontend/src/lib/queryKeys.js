/**
 * Every cache key in one place. Hand-written strings scattered through hooks are
 * how invalidation silently stops working.
 */
export const queryKeys = {
  rooms: ["rooms"],
  discover: ["rooms", "discover"],
  messages: (roomId) => ["rooms", roomId, "messages"],
  members: (roomId) => ["rooms", roomId, "members"],
  receipts: (roomId) => ["rooms", roomId, "receipts"],
  messageSearch: (roomId, q) => ["rooms", roomId, "messages", "search", q],
  thread: (roomId, messageId) => ["rooms", roomId, "messages", messageId, "replies"],
  requests: (roomId) => ["rooms", roomId, "requests"],
  userSearch: (query) => ["users", "search", query],
};
