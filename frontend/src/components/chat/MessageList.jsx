import { Fragment, useMemo } from "react";
import { ArrowDown, MessageSquare } from "lucide-react";

import { MessageBubble } from "./MessageBubble.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { readerCount } from "./MessageTicks.jsx";
import { useStickyScroll } from "../../hooks/useStickyScroll.js";
import styles from "./MessageList.module.css";

/** Start fetching before the user actually hits the top, so it feels seamless. */
const LOAD_OLDER_AT_PX = 150;

// ponytail: every loaded message is a real DOM node. A page is 50, so a room
// stays fast into the hundreds. Virtualise (react-virtuoso, which handles
// variable heights and prepending) only once one room holds a few thousand —
// it fights the scroll anchoring in useStickyScroll, so it needs to pay for
// itself first.

const dayOf = (iso) => new Date(iso).toDateString();

const dayLabel = (iso) => {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const day = dayOf(iso);

  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function MessageList({
  roomId,
  messages = [],
  loading,
  currentUsername,
  onRetry,
  onEdit,
  onDelete,
  onReact,
  onOpenThread,
  receipts,
  recipientCount,
  currentUserId,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
}) {
  const { containerRef, handleScroll, missed, scrollToBottom, anchorBeforePrepend } =
    useStickyScroll(roomId, messages);

  /**
   * Reader counts computed once for the whole list. Handing each bubble the
   * receipts array instead would re-render all of them every time anybody read
   * anything, since the array is rebuilt on each receipt.
   */
  const readersById = useMemo(() => {
    const counts = new Map();
    for (const message of messages) counts.set(message.id, readerCount(message, receipts ?? []));
    return counts;
  }, [messages, receipts]);

  const onScroll = (event) => {
    handleScroll(event);

    if (!hasMore || loadingOlder || event.currentTarget.scrollTop > LOAD_OLDER_AT_PX) return;

    // Measure now: once the page is prepended the old height is gone.
    anchorBeforePrepend();
    onLoadOlder?.();
  };

  if (loading) {
    return (
      <div className={styles.list}>
        {[60, 40, 70].map((width, index) => (
          <Skeleton key={index} width={`${width}%`} height={44} radius="var(--radius-xl)" />
        ))}
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className={styles.list}>
        <EmptyState icon={MessageSquare} title="No messages yet" body="Say hello 👋" />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <ol
        ref={containerRef}
        className={styles.list}
        onScroll={onScroll}
        aria-live="polite"
        aria-label="Messages"
      >
        {loadingOlder && (
          <li className={styles.older}>
            <Spinner size={16} label="Loading older messages" />
          </li>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);

          return (
            // Keyed by the server id, never the array index: an optimistic
            // message is removed from the middle when its ack arrives.
            <Fragment key={message.id}>
              {newDay && (
                <li className={styles.divider}>
                  <span>{dayLabel(message.createdAt)}</span>
                </li>
              )}
              <MessageBubble
                message={message}
                mine={message.username === currentUsername}
                showAuthor={newDay || previous?.username !== message.username}
                onRetry={onRetry}
                onEdit={onEdit}
                onDelete={onDelete}
                onReact={onReact}
                onOpenThread={onOpenThread}
                readers={readersById.get(message.id)}
                recipientCount={recipientCount}
                currentUserId={currentUserId}
              />
            </Fragment>
          );
        })}
      </ol>

      {missed > 0 && (
        <button type="button" className={styles.pill} onClick={() => scrollToBottom()}>
          <ArrowDown size={14} />
          {missed} new {missed === 1 ? "message" : "messages"}
        </button>
      )}
    </div>
  );
}
