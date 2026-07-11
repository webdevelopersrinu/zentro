import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as roomService from "../services/room.service.js";
import { queryKeys } from "../lib/queryKeys.js";

export const useMyRooms = () =>
  useQuery({ queryKey: queryKeys.rooms, queryFn: roomService.listMyRooms });

export const useDiscoverRooms = () =>
  useQuery({ queryKey: queryKeys.discover, queryFn: roomService.listDiscoverableRooms });

/** Both lists must move together, so every room mutation refreshes both. */
const useRefreshRoomLists = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    queryClient.invalidateQueries({ queryKey: queryKeys.discover });
  };
};

export function useCreateRoom() {
  const queryClient = useQueryClient();
  const refresh = useRefreshRoomLists();

  return useMutation({
    mutationFn: roomService.createRoom,
    onSuccess: (room) => {
      // Seed the new room into the cache SYNCHRONOUSLY. The caller opens it
      // immediately (selectRoom), and the "close a room that no longer exists"
      // guard would otherwise slam it shut in the gap before the refetch lands.
      queryClient.setQueryData(queryKeys.rooms, (rooms = []) =>
        rooms.some((r) => r.id === room.id) ? rooms : [room, ...rooms]
      );
      refresh();
    },
  });
}

/**
 * Public rooms admit you instantly; private ones only record a request. The
 * caller reads `joined` / `requested` from the result to decide what to say.
 */
export function useJoinRoom() {
  const refresh = useRefreshRoomLists();
  return useMutation({ mutationFn: roomService.joinRoom, onSuccess: refresh });
}

export function useLeaveRoom() {
  const refresh = useRefreshRoomLists();
  return useMutation({ mutationFn: roomService.leaveRoom, onSuccess: refresh });
}

/**
 * Fire-and-forget: the dot is cleared locally the moment the room is opened, so
 * there is nothing to invalidate and nothing to wait for. A failure here costs
 * a stale dot on the next reload, not a wrong screen now.
 */
export function useMarkRoomRead() {
  return useMutation({ mutationFn: roomService.markRoomRead });
}

/** The creator cannot leave their own room; deleting it is their way out. */
export function useDeleteRoom() {
  const refresh = useRefreshRoomLists();
  return useMutation({ mutationFn: roomService.deleteRoom, onSuccess: refresh });
}

export function useDeclineInvite() {
  const refresh = useRefreshRoomLists();
  return useMutation({ mutationFn: roomService.declineInvite, onSuccess: refresh });
}
