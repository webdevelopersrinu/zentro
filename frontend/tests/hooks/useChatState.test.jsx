import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { useChatState } from "../../src/hooks/useChatState.js";
import { ToastProvider } from "../../src/context/ToastContext.jsx";
import { AuthProvider } from "../../src/context/AuthContext.jsx";
import { server } from "../msw/server.js";
import { API_BASE } from "../../src/config/index.js";

// The socket is not the unit under test; the unread bookkeeping is.
vi.mock("../../src/hooks/useRoomSubscriptions.js", () => ({ useRoomSubscriptions: vi.fn() }));
vi.mock("../../src/hooks/useSocketEvent.js", () => ({
  useSocketEvent: vi.fn(),
  useSocketEmit: () => vi.fn(),
}));

const url = (path) => `${API_BASE}${path}`;
const room = (id, unread) => ({
  id,
  name: id,
  visibility: "public",
  isMember: true,
  isCreator: false,
  memberCount: 2,
  requestCount: 0,
  unread,
});

let queryClient;
// useRealtimeSync reads the current user, to ignore its own read receipts.
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  </QueryClientProvider>
);

const mockRooms = (rooms) => {
  server.use(
    http.get(url("/rooms"), () => HttpResponse.json({ rooms })),
    http.get(url("/rooms/discover"), () => HttpResponse.json({ rooms: [] }))
  );
};

const renderChat = async () => {
  const { result } = renderHook(() => useChatState(), { wrapper });
  await waitFor(() => expect(result.current.loadingRooms).toBe(false));
  return result;
};

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe("useChatState — unread state", () => {
  it("seeds the dots from the server, so a reload does not lose them", async () => {
    mockRooms([room("r1", true), room("r2", false)]);

    const result = await renderChat();

    await waitFor(() => expect(result.current.unreadRoomIds.has("r1")).toBe(true));
    expect(result.current.unreadRoomIds.has("r2")).toBe(false);
  });

  it("clears the dot and tells the server when a room is opened", async () => {
    const read = vi.fn(() => HttpResponse.json({ ok: true }));
    mockRooms([room("r1", true)]);
    server.use(http.post(url("/rooms/r1/read"), read));

    const result = await renderChat();
    await waitFor(() => expect(result.current.unreadRoomIds.has("r1")).toBe(true));

    act(() => result.current.selectRoom("r1"));

    expect(result.current.unreadRoomIds.has("r1")).toBe(false);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });

  it("never re-dots the open room when a stale refetch still calls it unread", async () => {
    mockRooms([room("r1", true)]); // the server keeps insisting r1 is unread
    server.use(http.post(url("/rooms/r1/read"), () => HttpResponse.json({ ok: true })));

    const result = await renderChat();
    act(() => result.current.selectRoom("r1"));

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["rooms"] });
    });

    expect(result.current.unreadRoomIds.has("r1")).toBe(false);
  });

  it("still dots OTHER rooms the server reports as unread", async () => {
    mockRooms([room("r1", true), room("r2", true)]);
    server.use(http.post(url("/rooms/r1/read"), () => HttpResponse.json({ ok: true })));

    const result = await renderChat();
    act(() => result.current.selectRoom("r1"));

    await waitFor(() => expect(result.current.unreadRoomIds.has("r2")).toBe(true));
    expect(result.current.unreadRoomIds.has("r1")).toBe(false);
  });

  it("opening a room the server has not marked unread still records the read", async () => {
    const read = vi.fn(() => HttpResponse.json({ ok: true }));
    mockRooms([room("r1", false)]);
    server.use(http.post(url("/rooms/r1/read"), read));

    const result = await renderChat();
    act(() => result.current.selectRoom("r1"));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });
});
