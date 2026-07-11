import { getIO } from "../lib/io.js";

/**
 * Who, among these users, currently has at least one socket open?
 *
 * ONE `fetchSockets()` for the whole answer. It queries every server through
 * the Valkey adapter (a request/response round-trip with a timeout), so doing
 * it per user meant a 100-member room fired 100 cluster round-trips just to
 * paint the members panel.
 *
 * Returns a Set of user ids. Empty when no socket server is running (tests).
 *
 * ponytail: ceiling is one cluster-wide fetch per members-panel open, and it
 * ships every connected socket's data back. Fine at this scale; if the socket
 * count per node ever makes it expensive, keep presence in Valkey instead
 * (SADD/SREM on connect/disconnect) and this becomes a single SMEMBERS.
 */
export async function getOnlineUserIds(userIds) {
  const io = getIO();
  if (!io) return new Set();

  // socket.data.user (not socket.user): a RemoteSocket from another server only
  // carries `data`. socket/index.js mirrors the handshake user onto it.
  const sockets = await io.fetchSockets();
  const online = new Set(
    sockets.map((s) => s.data?.user?.id).filter(Boolean).map(String)
  );

  return new Set(userIds.map(String).filter((id) => online.has(id)));
}