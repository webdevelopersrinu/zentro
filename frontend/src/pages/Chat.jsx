import { useCallback, useEffect, useMemo, useState } from "react";
import { Compass, MessageSquare } from "lucide-react";

import { Sidebar } from "../components/chat/Sidebar.jsx";
import { ConversationPanel } from "../components/chat/ConversationPanel.jsx";
import { ThreadPanel } from "../components/chat/ThreadPanel.jsx";
import { MembersPanel } from "../components/chat/MembersPanel.jsx";
import { LockedRoomCard } from "../components/chat/LockedRoomCard.jsx";
import { ConnectionBanner } from "../components/chat/ConnectionBanner.jsx";
import { CreateRoomModal } from "../components/modals/CreateRoomModal.jsx";
import { InviteModal } from "../components/modals/InviteModal.jsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { useChatState } from "../hooks/useChatState.js";
import { useCreateRoom } from "../hooks/useRooms.js";
import { useEditMessage, useDeleteMessage, useToggleReaction } from "../hooks/useMessages.js";
import { useSocket } from "../context/SocketContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { cx } from "../lib/cx.js";
import styles from "./Chat.module.css";

/**
 * The side panels live here, not inside the conversation, so that all three of
 * them (rooms, thread, members) obey the same responsive rules.
 *
 * Below 1600px the thread and the members panel are mutually exclusive: three
 * columns plus a fourth leave the conversation an unusable sliver. These two
 * queries are the JS half of the tiers in Chat.module.css and must match it.
 */
const DESKTOP = "(min-width: 1200px)";
const WIDE = "(min-width: 1600px)"; // two side panels still leave the conversation >= 560px
const matches = (query) => window.matchMedia?.(query).matches ?? false;

export default function Chat() {
  const chat = useChatState();
  const { isReady } = useSocket();
  const { toast } = useToast();
  const createRoom = useCreateRoom();
  const edit = useEditMessage();
  const remove = useDeleteMessage();
  const react = useToggleReaction();

  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(() => matches(DESKTOP));
  const [threadId, setThreadId] = useState(null);

  // Deleting is irreversible and one mis-click away, so it asks first.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const room = chat.activeRoom;
  const roomId = room?.id;

  const closeThread = useCallback(() => setThreadId(null), []);

  // A thread belongs to the room it was opened in, and must not outlive it.
  useEffect(closeThread, [roomId, closeThread]);

  /**
   * Stable identities, or MessageBubble's memo never hits: a fresh arrow on
   * every render is a changed prop on every bubble in the room.
   */
  const openThread = useCallback((message) => {
    setThreadId(message.id);
    if (!matches(WIDE)) setMembersOpen(false);
  }, []);

  const messageActions = useMemo(
    () => ({ onEdit: edit, onDelete: setPendingDelete, onReact: react }),
    [edit, react]
  );

  // Narrowing past the wide tier with both panels open would crush the conversation.
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE);
    if (!mq || !threadId) return undefined;

    const enforce = () => {
      if (!mq.matches) setMembersOpen(false);
    };
    mq.addEventListener("change", enforce);
    return () => mq.removeEventListener("change", enforce);
  }, [threadId]);

  const toggleMembers = () => {
    const next = !membersOpen;
    setMembersOpen(next);
    if (next && !matches(WIDE)) setThreadId(null);
  };

  // The scrim only exists below the desktop tier, where every panel is an overlay.
  const closeAll = () => {
    setSidebarOpen(false);
    setMembersOpen(false);
    setThreadId(null);
  };

  const handleCreate = ({ name, visibility }, close) =>
    createRoom.mutate(
      { name, visibility },
      {
        onSuccess: (created) => {
          close();
          chat.selectRoom(created.id);
          toast(`Created #${created.name}`, { variant: "success" });
        },
        onError: (error) => toast(error.message, { variant: "error" }),
      }
    );

  const confirmDelete = async () => {
    setDeleting(true);
    const ack = await remove(pendingDelete.id);
    setDeleting(false);
    if (ack?.ok && pendingDelete.id === threadId) closeThread();
    setPendingDelete(null);

    if (!ack?.ok) toast(ack?.error ?? "Could not delete the message", { variant: "error" });
  };

  const threadOpen = Boolean(room?.isMember && threadId);
  const scrimUp = sidebarOpen || membersOpen || threadOpen;

  return (
    <div className={styles.layout}>
      <div className={cx(styles.sidebar, sidebarOpen && styles.open)}>
        <Sidebar
          myRooms={chat.myRooms}
          discoverRooms={chat.discoverRooms}
          loading={chat.loadingRooms}
          activeRoomId={chat.activeRoomId}
          unreadRoomIds={chat.unreadRoomIds}
          joiningRoomId={chat.joiningRoomId}
          onSelectRoom={(id) => {
            chat.selectRoom(id);
            setSidebarOpen(false);
          }}
          onJoinRoom={chat.joinRoom}
          onDeclineInvite={chat.declineInvite}
          onCreateRoom={() => setCreating(true)}
        />
      </div>

      <main className={styles.main}>
        <ConnectionBanner visible={!isReady} />

        {!room ? (
          <EmptyState
            icon={chat.myRooms.length ? MessageSquare : Compass}
            title={chat.myRooms.length ? "Pick a room" : "You're not in any rooms yet"}
            body={
              chat.myRooms.length
                ? "Choose a room from the sidebar to start talking."
                : "Browse the public rooms in the sidebar and join one."
            }
          />
        ) : !room.isMember ? (
          <LockedRoomCard
            room={room}
            requesting={chat.joiningRoomId === room.id}
            onRequest={chat.joinRoom}
          />
        ) : (
          <ConversationPanel
            room={room}
            connected={isReady}
            messageActions={messageActions}
            onOpenThread={openThread}
            onToggleSidebar={() => setSidebarOpen(true)}
            onToggleMembers={toggleMembers}
          />
        )}
      </main>

      {threadOpen && (
        <div className={cx(styles.thread, styles.open)}>
          <ThreadPanel
            room={room}
            parentId={threadId}
            connected={isReady}
            onClose={closeThread}
            {...messageActions}
          />
        </div>
      )}

      {room?.isMember && (
        <div className={cx(styles.members, membersOpen && styles.open)}>
          <MembersPanel room={room} onInvite={() => setInviting(true)} />
        </div>
      )}

      {scrimUp && (
        <button
          type="button"
          className={cx(
            styles.scrim,
            sidebarOpen && styles.scrimNav,
            (membersOpen || threadOpen) && styles.scrimSide
          )}
          aria-label="Close panel"
          onClick={closeAll}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete this message?"
        body="Everyone in the room will see that a message was deleted, but not what it said."
        confirmLabel="Delete message"
      />

      <CreateRoomModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={handleCreate}
        submitting={createRoom.isPending}
      />

      {room?.isMember && (
        <InviteModal open={inviting} onClose={() => setInviting(false)} room={room} />
      )}
    </div>
  );
}