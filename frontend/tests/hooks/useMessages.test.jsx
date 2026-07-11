import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSendMessage, useLoadOlderMessages } from "../../src/hooks/useMessages.js";
import { MessageComposer } from "../../src/components/chat/MessageComposer.jsx";
import * as roomService from "../../src/services/room.service.js";
import { queryKeys } from "../../src/lib/queryKeys.js";

const ROOM = "r1";
const AUTHOR = { username: "alice" };
const real = { id: "server-1", roomId: ROOM, username: "alice", text: "hi", createdAt: "2026-01-01T00:00:00Z" };

let emit;
vi.mock("../../src/hooks/useSocketEvent.js", () => ({
  useSocketEmit: () => emit,
  useSocketEvent: vi.fn(),
}));

/**
 * The emitter under test in the ack-timeout case is the REAL one, so it is
 * imported past its own mock and given a fake socket through a fake context.
 */
const { useSocketEmit } = await vi.importActual("../../src/hooks/useSocketEvent.js");

const socketRef = { current: null }; // one stable ref, as the real provider holds
vi.mock("../../src/context/SocketContext.jsx", () => ({
  useSocket: () => ({ socketRef, isReady: true }),
}));

// The hook is the unit here; the axios layer has its own tests.
vi.mock("../../src/services/room.service.js", () => ({ listMessages: vi.fn() }));

let queryClient;
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const page = () => queryClient.getQueryData(queryKeys.messages(ROOM));
const messages = () => page()?.messages ?? [];
const seed = (data) => queryClient.setQueryData(queryKeys.messages(ROOM), data);

const renderSend = () =>
  renderHook(() => useSendMessage(ROOM, AUTHOR), { wrapper }).result;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("useSendMessage — optimistic send", () => {
  it("shows the bubble before the server has heard of it", async () => {
    let resolveAck;
    emit = vi.fn(() => new Promise((resolve) => (resolveAck = resolve)));
    const { current: send } = renderSend();

    act(() => void send("hi"));

    await waitFor(() => expect(messages()).toHaveLength(1));
    expect(messages()[0]).toMatchObject({ text: "hi", username: "alice", status: "sending" });

    await act(async () => resolveAck({ ok: true, message: real }));
  });

  it("promotes the placeholder to the real message when the ack wins the race", async () => {
    emit = vi.fn().mockResolvedValue({ ok: true, message: real });
    const { current: send } = renderSend();

    await act(async () => void (await send("hi")));

    expect(messages()).toHaveLength(1);
    expect(messages()[0].id).toBe("server-1");
    expect(messages()[0].status).toBeUndefined();
  });

  it("drops the placeholder when the broadcast wins the race — never doubles", async () => {
    emit = vi.fn(async () => {
      // The socket broadcast lands before the ack resolves.
      seed({ hasMore: false, messages: [...messages(), real] });
      return { ok: true, message: real };
    });
    const { current: send } = renderSend();

    await act(async () => void (await send("hi")));

    expect(messages()).toHaveLength(1);
    expect(messages()[0].id).toBe("server-1");
  });

  it("marks the bubble failed, keeping the text for a retry", async () => {
    emit = vi.fn().mockResolvedValue({ ok: false, error: "Not a member" });
    const { current: send } = renderSend();

    await act(async () => void (await send("hi")));

    expect(messages()[0]).toMatchObject({ status: "failed", error: "Not a member", text: "hi" });
  });

  it("reports a disconnected socket as a failure rather than hanging", async () => {
    emit = vi.fn().mockResolvedValue({ ok: false, error: "Not connected" });
    const { current: send } = renderSend();

    await act(async () => void (await send("hi")));

    expect(messages()[0].status).toBe("failed");
  });
});

describe("useSendMessage — a send that never comes back", () => {
  /** socket.io calls the ack with an Error when its own timeout expires. */
  const deafSocket = () => ({
    timeout: (ms) => ({
      emit: (event, payload, ack) => setTimeout(() => ack(new Error("operation has timed out")), ms),
    }),
  });

  afterEach(() => {
    vi.useRealTimers();
    socketRef.current = null;
  });

  it("fails the bubble once the ack times out, instead of leaving it 'sending' forever", async () => {
    vi.useFakeTimers();
    socketRef.current = deafSocket();
    emit = renderHook(() => useSocketEmit()).result.current;

    const { current: send } = renderSend();
    let sent;
    act(() => {
      sent = send("hi");
    });

    expect(messages()[0].status).toBe("sending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await sent;
    });

    expect(messages()[0]).toMatchObject({ status: "failed", error: "Timed out", text: "hi" });
  });

  it("hands back the same emitter across renders, so the bubbles' memo can hit", () => {
    socketRef.current = deafSocket();
    const { result, rerender } = renderHook(() => useSocketEmit());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});

describe("useSendMessage — retry", () => {
  it("re-uses the failed bubble rather than appending a second one", async () => {
    emit = vi.fn().mockResolvedValue({ ok: false, error: "Timed out" });
    const { current: send } = renderSend();

    await act(async () => void (await send("hi")));
    const failedId = messages()[0].id;

    // Two further attempts, both refused: still one bubble, and still the same one.
    await act(async () => void (await send("hi", { replaceId: failedId })));
    await act(async () => void (await send("hi", { replaceId: failedId })));

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ id: failedId, status: "failed" });
  });

  it("promotes the retried bubble in place when the resend succeeds", async () => {
    emit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Timed out" })
      .mockResolvedValueOnce({ ok: true, message: real });
    const { current: send } = renderSend();

    await act(async () => void (await send("hi")));
    const failedId = messages()[0].id;

    await act(async () => void (await send("hi", { replaceId: failedId })));

    expect(messages()).toHaveLength(1);
    expect(messages()[0].id).toBe("server-1");
    expect(messages()[0].status).toBeUndefined();
  });
});

describe("MessageComposer — a refused send with no bubble to fail", () => {
  const composer = (onSend) => {
    render(<MessageComposer roomName="general" onSend={onSend} restoreOnFailure />);
    return screen.getByRole("textbox", { name: "Message #general" });
  };

  it("puts the text back in the box when the reply is refused", async () => {
    const input = composer(vi.fn().mockResolvedValue({ ok: false, error: "Not a member" }));

    await userEvent.type(input, "does this survive{Enter}");

    await waitFor(() => expect(input.value).toBe("does this survive"));
  });

  it("leaves the box empty when the reply lands", async () => {
    const input = composer(vi.fn().mockResolvedValue({ ok: true, message: real }));

    await userEvent.type(input, "landed{Enter}");

    await waitFor(() => expect(input.value).toBe(""));
  });
});

describe("useLoadOlderMessages", () => {
  const message = (id) => ({ id, roomId: ROOM, username: "alice", text: id, createdAt: "2026-01-01T00:00:00Z" });

  const renderLoadOlder = () => renderHook(() => useLoadOlderMessages(ROOM), { wrapper }).result;

  beforeEach(() => {
    roomService.listMessages.mockReset();
  });

  it("prepends the older page and carries its hasMore forward", async () => {
    roomService.listMessages.mockResolvedValue({
      messages: [message("m1"), message("m2")],
      hasMore: false,
    });
    seed({ hasMore: true, messages: [message("m3")] });
    const result = renderLoadOlder();

    await act(async () => void (await result.current.loadOlder()));

    expect(messages().map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(page().hasMore).toBe(false);
  });

  it("asks for the page before the OLDEST message it holds", async () => {
    const spy = roomService.listMessages.mockResolvedValue({ messages: [], hasMore: false });
    seed({ hasMore: true, messages: [message("m5"), message("m6")] });
    const result = renderLoadOlder();

    await act(async () => void (await result.current.loadOlder()));

    expect(spy).toHaveBeenCalledWith(ROOM, { before: "m5" });
  });

  it("does nothing when there is no more history", async () => {
    const spy = roomService.listMessages;
    seed({ hasMore: false, messages: [message("m1")] });
    const result = renderLoadOlder();

    await act(async () => void (await result.current.loadOlder()));

    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing before the first page has loaded", async () => {
    const spy = roomService.listMessages;
    const result = renderLoadOlder();

    await act(async () => void (await result.current.loadOlder()));

    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches once even though scrolling calls it repeatedly", async () => {
    let release;
    const spy = roomService.listMessages.mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );
    seed({ hasMore: true, messages: [message("m3")] });
    const result = renderLoadOlder();

    act(() => {
      result.current.loadOlder();
      result.current.loadOlder();
      result.current.loadOlder();
    });

    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => release({ messages: [message("m2")], hasMore: false }));
    expect(messages().map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  it("clears the in-flight guard when the request fails, so a retry is possible", async () => {
    const spy = roomService.listMessages.mockRejectedValue(new Error("offline"));
    seed({ hasMore: true, messages: [message("m3")] });
    const result = renderLoadOlder();

    await act(async () => {
      await expect(result.current.loadOlder()).rejects.toThrow("offline");
    });

    spy.mockResolvedValue({ messages: [message("m2")], hasMore: false });
    await act(async () => void (await result.current.loadOlder()));

    expect(messages().map((m) => m.id)).toEqual(["m2", "m3"]);
  });
});
