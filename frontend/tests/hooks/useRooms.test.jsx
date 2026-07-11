import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useCreateRoom } from "../../src/hooks/useRooms.js";
import * as roomService from "../../src/services/room.service.js";
import { queryKeys } from "../../src/lib/queryKeys.js";

vi.mock("../../src/services/room.service.js", () => ({ createRoom: vi.fn() }));

let queryClient;
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const roomsCache = () => queryClient.getQueryData(queryKeys.rooms);

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe("useCreateRoom", () => {
  const room = { id: "r-new", name: "town-square", isMember: true, isCreator: true };

  it("seeds the new room into the cache synchronously, so it can be opened at once", async () => {
    roomService.createRoom.mockResolvedValue(room);
    queryClient.setQueryData(queryKeys.rooms, []);
    const { result } = renderHook(() => useCreateRoom(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "town-square", visibility: "public" });
    });

    // Present the instant the mutation resolves — not after a later refetch.
    // This is what stops the "close a room that doesn't exist yet" race.
    expect(roomsCache().map((r) => r.id)).toContain("r-new");
  });

  it("puts the new room first", async () => {
    roomService.createRoom.mockResolvedValue(room);
    queryClient.setQueryData(queryKeys.rooms, [{ id: "old", name: "old" }]);
    const { result } = renderHook(() => useCreateRoom(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "town-square" });
    });

    expect(roomsCache()[0].id).toBe("r-new");
  });

  it("does not duplicate a room a refetch already delivered", async () => {
    roomService.createRoom.mockResolvedValue(room);
    queryClient.setQueryData(queryKeys.rooms, [room]);
    const { result } = renderHook(() => useCreateRoom(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "town-square" });
    });

    expect(roomsCache().filter((r) => r.id === "r-new")).toHaveLength(1);
  });

  it("marks both room lists stale so they reconcile with the server", async () => {
    roomService.createRoom.mockResolvedValue(room);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateRoom(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "town-square" });
    });

    const keys = invalidate.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(queryKeys.rooms);
    expect(keys).toContainEqual(queryKeys.discover);
  });
});
