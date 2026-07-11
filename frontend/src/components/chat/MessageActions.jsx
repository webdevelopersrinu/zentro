import { useState } from "react";
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { IconButton } from "../ui/IconButton.jsx";
import { ReactionPicker } from "./ReactionPicker.jsx";
import { MESSAGE_EDIT_WINDOW_MS } from "../../config/index.js";
import styles from "./MessageActions.module.css";

/**
 * The server is what enforces the window; this only decides whether to offer
 * the button, so the user is not handed an action that is going to be refused.
 */
export const withinEditWindow = (message) =>
  Date.now() - new Date(message.createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;

/**
 * Anyone in the room may react or reply. Only the author may edit or delete.
 * `threadable` is false inside a thread: replies cannot be replied to.
 *
 * The "More actions" trigger exists only for coarse pointers, where hover is not
 * a thing and four tightly packed targets next to Delete are a misfire waiting to
 * happen. Which one is shown is decided in CSS by pointer type, not here, so the
 * markup stays the same everywhere and every action keeps a real DOM node for
 * screen readers.
 */
export function MessageActions({ message, mine, threadable, onReact, onReply, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const close =
    (fn) =>
    (...args) => {
      setOpen(false);
      fn(...args);
    };

  return (
    <span className={styles.wrap} data-message-actions data-open={open || undefined}>
      <IconButton
        label="More actions"
        size="sm"
        className={styles.more}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} />
      </IconButton>

      <span className={styles.actions}>
        <ReactionPicker onPick={close(onReact)} />

        {threadable && (
          <IconButton label="Reply in thread" size="sm" onClick={close(onReply)}>
            <MessageSquare size={14} />
          </IconButton>
        )}

        {mine && withinEditWindow(message) && (
          <IconButton label="Edit message" size="sm" onClick={close(onEdit)}>
            <Pencil size={14} />
          </IconButton>
        )}

        {mine && (
          <IconButton label="Delete message" size="sm" onClick={close(onDelete)}>
            <Trash2 size={14} />
          </IconButton>
        )}
      </span>
    </span>
  );
}
