import { memo, useState } from "react";
import { MessageSquare } from "lucide-react";

import { Avatar } from "../ui/Avatar.jsx";
import { MessageActions } from "./MessageActions.jsx";
import { MessageEditor } from "./MessageEditor.jsx";
import { MessageTicks } from "./MessageTicks.jsx";
import { MessageReactions } from "./MessageReactions.jsx";
import { cx } from "../../lib/cx.js";
import styles from "./MessageBubble.module.css";

const time = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * memo'd: a room with 100 messages re-renders all of them on every keystroke in
 * the composer otherwise.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  showAuthor,
  onRetry,
  onEdit,
  onDelete,
  onReact,
  onOpenThread,
  readers,
  recipientCount,
  currentUserId,
  inThread = false,
}) {
  const [editing, setEditing] = useState(false);
  const failed = message.status === "failed";

  // A message still in flight has no server id yet, so nothing can be done to
  // it; a deleted one has nothing left to act on.
  const actionable = !message.deleted && !message.status;

  return (
    <li className={cx(styles.row, mine && styles.rowMine)}>
      {!mine && (
        <span className={styles.gutter}>
          {showAuthor && <Avatar name={message.username} size={28} />}
        </span>
      )}

      <div className={styles.stack}>
        {showAuthor && !mine && <span className={styles.author}>{message.username}</span>}

        {editing ? (
          <MessageEditor
            message={message}
            onSave={(text) => onEdit(message.id, text)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className={styles.line}>
            {actionable && (
              <MessageActions
                message={message}
                mine={mine}
                threadable={!inThread && !message.parentId}
                onReact={(emoji) => onReact(message.id, emoji)}
                onReply={() => onOpenThread(message)}
                onEdit={() => setEditing(true)}
                onDelete={() => onDelete(message)}
              />
            )}

            <div
              className={cx(
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                message.status === "sending" && styles.sending,
                failed && styles.failed,
                message.deleted && styles.deleted
              )}
            >
              {message.deleted ? <em>This message was deleted</em> : message.text}
            </div>
          </div>
        )}

        {!inThread && message.replyCount > 0 && (
          <button type="button" className={styles.thread} onClick={() => onOpenThread(message)}>
            <MessageSquare size={13} aria-hidden="true" />
            {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {!message.deleted && (
          <MessageReactions
            reactions={message.reactions}
            currentUserId={currentUserId}
            onToggle={(emoji) => onReact(message.id, emoji)}
          />
        )}

        <span className={styles.meta}>
          {failed ? (
            <button type="button" className={styles.retry} onClick={() => onRetry(message)}>
              Failed · Retry
            </button>
          ) : (
            <>
              <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
              {message.editedAt && !message.deleted && (
                <span className={styles.edited} title={`Edited at ${time(message.editedAt)}`}>
                  edited
                </span>
              )}
              {/* Only the author is told who has read it. */}
              {mine && (
                <MessageTicks
                  message={message}
                  readers={readers}
                  recipientCount={recipientCount}
                />
              )}
            </>
          )}
        </span>
      </div>
    </li>
  );
});
