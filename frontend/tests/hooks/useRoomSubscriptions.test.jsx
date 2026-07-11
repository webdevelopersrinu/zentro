import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useRoomSubscriptions } from "../../src/hooks/useRoomSubscriptions.js";
import { SOCKET_EVENTS } from "../../src/config/index.js";

let socket;
let isReady;

vi.mock("../../src/context/SocketContext.jsx", () => ({
  useSocket: () => ({ socketRef: { current: socket }, isReady }),
}));

const room = (id, isMember = true) => ({ id, isMember });

/** Captures emits without acking, so the in-flight window can be tested. */
const pendingSocket = () => {
  const acks = [];
  return {
    emit: vi.fn((_event, roomId, ack) => acks.push({ roomId, ack })),
    acks,
  };
};

const joinsOf = (s) =>
  s.emit.mock.calls.filter(([event]) => event === SOCKET_EVENTS.ROOM_JOIN).map(([, id]) => id);

beforeEach(() => {
  socket = pendingSocket();
  isReady = true;
});

describe("useRoomSubscriptions", () => {
  it("joins every room I am a member of", () => {
    renderHook(() => useRoomSubscriptions([room("r1"), room("r2")]));

    expect(joinsOf(socket)).toEqual(["r1", "r2"]);
  });

  it("never joins a room I am not in", () => {
    renderHook(() => useRoomSubscriptions([room("r1", false)]));

    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("emits nothing until the socket is ready", () => {
    isReady = false;
    renderHook(() => useRoomSubscriptions([room("r1")]));

    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("joins a room added after the socket connected", () => {
    const { rerender } = renderHook(({ rooms }) => useRoomSubscriptions(rooms), {
      initialProps: { rooms: [room("r1")] },
    });

    rerender({ rooms: [room("r1"), room("r2")] });

    expect(joinsOf(socket)).toEqual(["r1", "r2"]);
  });

  it("does not re-join a room it already joined", () => {
    const { rerender } = renderHook(({ rooms }) => useRoomSubscriptions(rooms), {
      initialProps: { rooms: [room("r1")] },
    });
    socket.acks.forEach(({ ack }) => ack({ ok: true }));

    rerender({ rooms: [room("r1")] }); // a refetch: same rooms, new array

    expect(joinsOf(socket)).toEqual(["r1"]);
  });

  it("does not re-join while the first join is still in flight", () => {
    const { rerender } = renderHook(({ rooms }) => useRoomSubscriptions(rooms), {
      initialProps: { rooms: [room("r1")] },
    });

    // The room list refetches before the ack lands.
    rerender({ rooms: [room("r1")] });
    rerender({ rooms: [room("r1")] });

    expect(joinsOf(socket)).toEqual(["r1"]);
  });

  it("retries a join the server refused", () => {
    const { rerender } = renderHook(({ rooms }) => useRoomSubscriptions(rooms), {
      initialProps: { rooms: [room("r1")] },
    });
    socket.acks.forEach(({ ack }) => ack({ ok: false, error: "Not a member" }));

    rerender({ rooms: [room("r1")] });

    expect(joinsOf(socket)).toEqual(["r1", "r1"]);
  });

  it("re-joins everything after a reconnect — a new socket has joined nothing", () => {
    const { rerender } = renderHook(({ rooms }) => useRoomSubscriptions(rooms), {
      initialProps: { rooms: [room("r1")] },
    });
    socket.acks.forEach(({ ack }) => ack({ ok: true }));

    isReady = false;
    rerender({ rooms: [room("r1")] });

    isReady = true;
    socket = pendingSocket();
    rerender({ rooms: [room("r1")] });

    expect(joinsOf(socket)).toEqual(["r1"]);
  });
});
