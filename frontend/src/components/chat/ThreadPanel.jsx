import { X } from "lucide-react";

import { IconButton } from "../ui/IconButton.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { MessageBubble } from "./MessageBubble.jsx";
import { MessageComposer } from "./MessageComposer.jsx";
import { useThread, useSendReply } from "../../hooks/useThread.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./ThreadPanel.module.css";

/**
 * One thread, opened beside the conversation. Replies never carry tick marks:
 * "read" is tracked per room, not per message, and a thread is not a room.
 */
export function ThreadPanel({ room, parentId, connected, onClose, onEdit, onDelete, onReact }) {
  const { user } = useAuth();
  const { data, isLoading } = useThread(room.id, parentId);
  const reply = useSendReply(room.id, parentId);

  const bubbleProps = {
    currentUsername: user.username,
    currentUserId: user.id,
    onEdit,
    onDelete,
    onReact,
    inThread: true,
  };

  return (
    <aside className={styles.panel} aria-label="Thread">
      <header className={styles.header}>
        <h2 className={styles.title}>Thread</h2>
        <IconButton label="Close thread" size="sm" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>

      <div className={styles.body}>
        {isLoading ? (
          <Skeleton width="70%" height={44} radius="var(--radius-xl)" />
        ) : (
          <ol className={styles.list}>
            <MessageBubble
              {...bubbleProps}
              message={data.parent}
              mine={data.parent.username === user.username}
              showAuthor
            />

            <li className={styles.divider}>
              <span>
                {data.replies.length} {data.replies.length === 1 ? "reply" : "replies"}
              </span>
            </li>

            {data.replies.map((message, index) => (
              <MessageBubble
                key={message.id}
                {...bubbleProps}
                message={message}
                mine={message.username === user.username}
                showAuthor={data.replies[index - 1]?.username !== message.username}
              />
            ))}
          </ol>
        )}
      </div>

      <MessageComposer
        roomName={`thread in #${room.name}`}
        disabled={!connected}
        onSend={reply}
      />
    </aside>
  );
}
