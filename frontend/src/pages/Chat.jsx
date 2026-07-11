import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useRoomUrl, useBackToClose } from "../hooks/useHistoryNav.js";
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
const SIDEBAR_DRAWER = "(max-width: 767px)";
const SIDE_PANEL_DRAWER = "(max-width: 1199px)";
const matches = (query) => window.matchMedia?.(query).matches ?? false;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Live answer to "is this panel currently an overlay?", not a boot-time snapshot. */
function useMatchMedia(query) {
  const [active, setActive] = useState(() => matches(query));

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;

    const sync = () => setActive(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);

  return active;
}

/**
 * An overlay drawer must take focus when it opens and hand it back when it
 * closes — otherwise the keyboard user is left on a trigger behind a scrim, or
 * (worse) nowhere at all once the drawer goes inert.
 */
function useDrawerFocus(open, ref) {
  useEffect(() => {
    if (!open) return undefined;

    const trigger = document.activeElement;
    ref.current?.querySelector(FOCUSABLE)?.focus();
    return () => trigger?.focus?.();
  }, [open, ref]);
}

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

  /**
   * The reaction ack was being thrown away, so a refused reaction was a tap that
   * did nothing — forever, with no explanation. Wrapping it here keeps the memo
   * stable, which is what stops every bubble in the room re-rendering.
   */
  const messageActions = useMemo(
    () => ({
      onEdit: edit,
      onDelete: setPendingDelete,
      onReact: async (messageId, emoji) => {
        const ack = await react(messageId, emoji);
        if (!ack?.ok) toast(ack?.error ?? "Could not add that reaction", { variant: "error" });
        return ack;
      },
    }),
    [edit, react, toast]
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
  const closeAll = useCallback(() => {
    setSidebarOpen(false);
    setMembersOpen(false);
    setThreadId(null);
  }, []);

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

  /**
   * A closed drawer is hidden by transform alone, which hides it from the eye and
   * from nobody else: it keeps its place in the tab order and in the a11y tree.
   * At phone width that put ~10 invisible stops (room search, every room, "Create
   * room", "Sign out") in front of a keyboard user's very first Tab. `inert` is
   * the platform's answer — but only where the panel really is an overlay; in the
   * laptop tier these same panels sit in the flow and must stay usable.
   */
  const sidebarIsDrawer = useMatchMedia(SIDEBAR_DRAWER);
  const sidePanelIsDrawer = useMatchMedia(SIDE_PANEL_DRAWER);

  const sidebarRef = useRef(null);
  const membersRef = useRef(null);

  /**
   * The only handle that opens the sidebar lives in the conversation header, so
   * on a phone with no room open there is nothing to press. Before `inert` that
   * merely looked broken; now it would genuinely strand the user. With no room
   * to cover, the drawer simply stays open.
   */
  const sidebarVisible = sidebarOpen || (sidebarIsDrawer && !room);

  const sidebarDrawerOpen = sidebarIsDrawer && sidebarOpen;
  const membersDrawerOpen = sidePanelIsDrawer && membersOpen;
  const overlayUp = sidebarDrawerOpen || membersDrawerOpen || (sidePanelIsDrawer && threadOpen);

  /**
   * The open room lives in the URL, so a reload or a shared link lands back in
   * it; and an open overlay owns a history entry, so the Android Back gesture
   * closes the drawer instead of quitting the app mid-conversation.
   */
  useRoomUrl({
    activeRoomId: chat.activeRoomId,
    selectRoom: chat.selectRoom,
    ready: !chat.loadingRooms,
  });

  useBackToClose(overlayUp, closeAll);

  useDrawerFocus(sidebarDrawerOpen, sidebarRef);
  useDrawerFocus(membersDrawerOpen, membersRef);

  useEffect(() => {
    if (!overlayUp) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") closeAll();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlayUp, closeAll]);

  return (
    <div className={styles.layout}>
      <div
        ref={sidebarRef}
        className={cx(styles.sidebar, sidebarVisible && styles.open)}
        inert={(sidebarIsDrawer && !sidebarVisible) || undefined}
      >
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

      {/* While a drawer is over the conversation, the conversation is not reachable —
          which is the focus trap the drawers were missing, for free. */}
      <main className={styles.main} inert={overlayUp || undefined}>
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
        <div
          ref={membersRef}
          className={cx(styles.members, membersOpen && styles.open)}
          inert={(sidePanelIsDrawer && !membersOpen) || undefined}
        >
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