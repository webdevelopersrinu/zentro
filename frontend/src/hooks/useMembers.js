import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as roomService from "../services/room.service.js";
import { queryKeys } from "../lib/queryKeys.js";
import { useToast } from "../context/ToastContext.jsx";

export function useMembers(roomId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.members(roomId),
    queryFn: () => roomService.listMembers(roomId),
    enabled: Boolean(roomId) && enabled,
  });
}

/** Admins only. The server rejects anyone else, so we simply do not render it. */
export function useRequests(roomId, { enabled = false } = {}) {
  return useQuery({
    queryKey: queryKeys.requests(roomId),
    queryFn: () => roomService.listRequests(roomId),
    enabled: Boolean(roomId) && enabled,
  });
}

/**
 * Approve and reject share everything but the verb, so they share a factory.
 * The row disappears optimistically; a failure puts it back.
 */
function useRequestDecision(roomId, decide) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.requests(roomId);

  return useMutation({
    mutationFn: (userId) => decide(roomId, userId),

    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (requests = []) =>
        requests.filter((request) => request.id !== userId)
      );
      return { previous };
    },

    // Rolling the row back is not a report: a request that silently reappears
    // reads as a UI glitch, not as a refusal.
    onError: (error, _userId, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast(error.message, { variant: "error" });
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(roomId) });
    },
  });
}

export const useApproveRequest = (roomId) =>
  useRequestDecision(roomId, roomService.approveRequest);

export const useRejectRequest = (roomId) =>
  useRequestDecision(roomId, roomService.rejectRequest);

/**
 * Granting and revoking moderation is the creator's alone. Both refresh the
 * roster and the room lists: `isAdmin` appears in each.
 */
function useAdminChange(roomId, change) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (userId) => change(roomId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    },
    // Without this the roster simply does not change and the creator walks away
    // believing they granted moderation.
    onError: (error) => toast(error.message, { variant: "error" }),
  });
}

export const usePromoteAdmin = (roomId) => useAdminChange(roomId, roomService.promoteAdmin);
export const useDemoteAdmin = (roomId) => useAdminChange(roomId, roomService.demoteAdmin);

export function useInviteUser(roomId) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (username) => roomService.inviteUser(roomId, username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    },
    onError: (error) => toast(error.message, { variant: "error" }),
  });
}
