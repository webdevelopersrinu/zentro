import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createSocket } from "../lib/socket.js";
import { getAccessToken, onAccessTokenChange } from "../lib/tokenStore.js";
import { SOCKET_EVENTS } from "../config/index.js";

const SocketContext = createContext(null);

export const CONNECTION = {
  CONNECTING: "connecting",
  READY: "ready",
  DISCONNECTED: "disconnected",
};

/**
 * Owns the single socket. Kept in its own provider so a stream of chat events
 * never re-renders anything that only cares about auth or theme.
 *
 * `status` becomes READY on the server's "ready" event, not on "connect" —
 * before that the server has not finished joining this socket to its rooms, so
 * broadcasts would be missed.
 */
export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [status, setStatus] = useState(CONNECTION.CONNECTING);
  const [signedIn, setSignedIn] = useState(() => Boolean(getAccessToken()));

  /**
   * A refreshed token is handed to the LIVE socket, not used to rebuild it. The
   * handshake is only re-read on reconnect, so this is all a future reconnect
   * needs — and tearing the socket down every 15 minutes would drop every
   * message broadcast during the gap, with nothing to refetch them.
   */
  useEffect(
    () =>
      onAccessTokenChange((token) => {
        if (socketRef.current) socketRef.current.auth = { token };
        setSignedIn(Boolean(token));
      }),
    []
  );

  useEffect(() => {
    if (!signedIn) return undefined;

    const socket = createSocket(getAccessToken());
    socketRef.current = socket;
    setStatus(CONNECTION.CONNECTING);

    socket.on(SOCKET_EVENTS.READY, () => setStatus(CONNECTION.READY));
    socket.on("disconnect", () => setStatus(CONNECTION.DISCONNECTED));
    socket.io.on("reconnect_attempt", () => setStatus(CONNECTION.CONNECTING));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [signedIn]);

  const value = useMemo(
    () => ({
      socketRef,
      status,
      isReady: status === CONNECTION.READY,
    }),
    [status]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) throw new Error("useSocket must be used within a SocketProvider");
  return context;
}
