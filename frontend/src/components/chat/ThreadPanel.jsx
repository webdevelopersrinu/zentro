import { useCallback } from "react";
import { AlertCircle, X } from "lucide-react";

import { Button } from "../ui/Button.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { IconButton } from "../ui/IconButton.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { MessageBubble } from "./MessageBubble.jsx";
import { MessageComposer } from "./MessageComposer.jsx";
import { useThread, useSendReply } from "../../hooks/useThread.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import styles from "./ThreadPanel.module.css";

/**
 * One thread, opened beside the conversation. Replies never carry tick marks:
 * "read" is tracked per room, not per message, and a thread is not a room.
 */
export function ThreadPanel({ room, parentId, connected, onClose, onEdit, onDelete, onReact }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useThread(room.id, parentId);
  const send = useSendReply(room.id, parentId);

  // A reply is not optimistic, so a refusal has nowhere else to show itself.
  const reply = useCallback(
    async (text) => {
      const ack = await send(text);
      if (!ack?.ok) toast(ack?.error ?? "Could not send the reply", { variant: "error" });
      return ack;
    },
    [send, toast]
  );

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
        ) : /* A failed query leaves `data` undefined: say so, rather than reading .parent off it. */
        isError || !data ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load this thread"
            body="The replies could not be fetched."
            action={
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
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
        restoreOnFailure
      />
    </aside>
  );
}
