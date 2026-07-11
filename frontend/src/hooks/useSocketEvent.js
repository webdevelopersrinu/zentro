import { useCallback, useEffect, useRef } from "react";

import { useSocket } from "../context/SocketContext.jsx";

/** Long enough to survive a slow network, short enough to still offer a retry. */
const ACK_TIMEOUT_MS = 10_000;

/**
 * Subscribes to a socket event for the lifetime of the component.
 *
 * The handler is held in a ref so callers may pass an inline arrow function
 * without the listener being torn down and re-attached on every render — which
 * would drop events in the gap.
 */
export function useSocketEvent(event, handler) {
  const { socketRef, isReady } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !event) return undefined;

    const listener = (...args) => handlerRef.current?.(...args);
    socket.on(event, listener);

    return () => socket.off(event, listener);
    // isReady re-runs this once the socket exists.
  }, [event, socketRef, isReady]);
}

/**
 * Promisified emit-with-ack. Resolves to the server's { ok, ... } response.
 *
 * Timed out rather than left open: Socket.IO BUFFERS an emit made on a dropped
 * connection, so without a deadline the ack never fires, the promise never
 * settles, and the caller is stuck forever — a bubble frozen on "sending" with
 * no retry, a delete dialog spinning, an editor disabled. A refusal the user can
 * act on beats a wait that never ends.
 *
 * Stable identity: every memo in the message list has this in its dependency
 * chain, and socketRef is a ref, so the emitter need never change.
 */
export function useSocketEmit() {
  const { socketRef } = useSocket();

  return useCallback(
    (event, payload) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket) return resolve({ ok: false, error: "Not connected" });

        socket
          .timeout(ACK_TIMEOUT_MS)
          .emit(event, payload, (error, ack) =>
            resolve(error ? { ok: false, error: "Timed out" } : ack)
          );
      }),
    [socketRef]
  );
}
