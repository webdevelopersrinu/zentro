import { useCallback } from "react";

import { ChatHeader } from "./ChatHeader.jsx";
import { MessageList } from "./MessageList.jsx";
import { MessageComposer } from "./MessageComposer.jsx";
import { TypingIndicator } from "./TypingIndicator.jsx";
import {
  useMessages,
  useSendMessage,
  useLoadOlderMessages,
} from "../../hooks/useMessages.js";
import { useReceipts } from "../../hooks/useReceipts.js";
import { useTyping } from "../../hooks/useTyping.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./ConversationPanel.module.css";

/**
 * The conversation only. The thread lives in the page layout beside it, so that
 * it collapses with the other side panels instead of squeezing this column.
 */
export function ConversationPanel({
  room,
  connected,
  messageActions,
  onOpenThread,
  onToggleMembers,
  onToggleSidebar,
}) {
  const { user } = useAuth();
  const { data: page, isLoading } = useMessages(room.id);
  const send = useSendMessage(room.id, user);
  const { loadOlder, loadingOlder } = useLoadOlderMessages(room.id);
  const { receipts, recipientCount } = useReceipts(room.id);
  const { typists, handleKeystroke, stopTyping } = useTyping(room.id);

  // Stable identity, or MessageBubble's memo never hits.
  const retry = useCallback((message) => send(message.text), [send]);

  return (
    <section className={styles.panel} aria-label={`Conversation in ${room.name}`}>
      <ChatHeader
        room={room}
        onToggleMembers={onToggleMembers}
        onToggleSidebar={onToggleSidebar}
      />

      <MessageList
        roomId={room.id}
        messages={page?.messages}
        hasMore={page?.hasMore}
        loading={isLoading}
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        currentUsername={user.username}
        onRetry={retry}
        {...messageActions}
        onOpenThread={onOpenThread}
        receipts={receipts}
        recipientCount={recipientCount}
        currentUserId={user.id}
      />

      <TypingIndicator typists={typists} />

      <MessageComposer
        roomName={room.name}
        disabled={!connected}
        onSend={send}
        onKeystroke={handleKeystroke}
        onStopTyping={stopTyping}
      />
    </section>
  );
}