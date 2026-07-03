import Valkey from "iovalkey";
import { createAdapter } from "socket.io-valkey-adapter";

// Builds the Valkey-backed adapter and attaches it to the Socket.IO server.
//
// THIS is the piece that keeps multiple servers in sync. Each server opens TWO
// connections to the SAME Valkey:
//   - pubClient: publishes messages out to Valkey
//   - subClient: subscribes to messages coming from other servers
// When EC2 #1 publishes a chat message, Valkey broadcasts it and EC2 #2's
// subClient receives it, so users on different servers still chat together.
//
// Uses the native Valkey stack: `iovalkey` client + `socket.io-valkey-adapter`.
export async function attachValkeyAdapter(io, valkeyUrl) {
  // iovalkey (like ioredis) connects automatically and accepts a connection URL.
  const pubClient = new Valkey(valkeyUrl);
  const subClient = pubClient.duplicate();

  pubClient.on("error", (e) => console.error("Valkey pub error:", e.message));
  subClient.on("error", (e) => console.error("Valkey sub error:", e.message));

  io.adapter(createAdapter(pubClient, subClient));
  console.log("✅ Valkey adapter attached (servers are now in sync)");

  return { pubClient, subClient };
}
