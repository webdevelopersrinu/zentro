import { useState } from "react";
import { LogOut, Trash2 } from "lucide-react";

import { IconButton } from "../ui/IconButton.jsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.jsx";
import { useLeaveRoom, useDeleteRoom } from "../../hooks/useRooms.js";
import { useToast } from "../../context/ToastContext.jsx";
import { ROOM_VISIBILITY } from "../../config/index.js";

/**
 * The one way out of a room. A member leaves it; the creator cannot — the
 * server refuses, since a room without its creator has nobody to approve
 * requests — so for them the way out is deleting it, messages and all.
 *
 * Neither branch closes the room here: it vanishes from `myRooms`, and the
 * chat screen closes whatever is no longer there.
 */
export function RoomExitAction({ room }) {
  const [confirming, setConfirming] = useState(false);
  const leave = useLeaveRoom();
  const remove = useDeleteRoom();
  const { toast } = useToast();

  const destructive = room.isCreator
    ? {
        mutation: remove,
        icon: <Trash2 size={17} />,
        label: `Delete #${room.name}`,
        title: "Delete this room?",
        body: `#${room.name} and every message in it will be gone for all ${room.memberCount} members. This cannot be undone.`,
        confirmLabel: "Delete room",
        done: `Deleted #${room.name}`,
      }
    : {
        mutation: leave,
        icon: <LogOut size={17} />,
        label: `Leave #${room.name}`,
        title: "Leave this room?",
        body: `You will stop receiving messages from #${room.name}.${
          room.visibility === ROOM_VISIBILITY.PRIVATE
            ? " It is private, so you would need a new invite to return."
            : ""
        }`,
        confirmLabel: "Leave room",
        done: `Left #${room.name}`,
      };

  const confirm = () =>
    destructive.mutation.mutate(room.id, {
      onSuccess: () => {
        setConfirming(false);
        toast(destructive.done);
      },
      onError: (error) => toast(error.message, { variant: "error" }),
    });

  return (
    <>
      <IconButton label={destructive.label} onClick={() => setConfirming(true)}>
        {destructive.icon}
      </IconButton>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
        loading={destructive.mutation.isPending}
        title={destructive.title}
        body={destructive.body}
        confirmLabel={destructive.confirmLabel}
      />
    </>
  );
}
