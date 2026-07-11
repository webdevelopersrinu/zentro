import { useRef, useState } from "react";
import { Send } from "lucide-react";

import { IconButton } from "../ui/IconButton.jsx";
import styles from "./MessageComposer.module.css";

const MAX_ROWS = 6;

/**
 * Enter sends, Shift+Enter adds a newline — the convention every chat app uses.
 * An empty draft disables the send button rather than showing an error: the
 * constraint is obvious, so it needs no words.
 */
// Typing is broadcast per room, so the thread composer simply omits these two.
const noop = () => {};

export function MessageComposer({
  roomName,
  disabled,
  onSend,
  onKeystroke = noop,
  onStopTyping = noop,
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef(null);

  const grow = (node) => {
    node.style.height = "auto";
    const max = parseFloat(getComputedStyle(node).lineHeight) * MAX_ROWS;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) return;

    onSend(text);
    setDraft("");
    onStopTyping();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        className={styles.input}
        placeholder={disabled ? "Reconnecting…" : `Message #${roomName}`}
        aria-label={`Message #${roomName}`}
        disabled={disabled}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          grow(event.target);
          onKeystroke();
        }}
        onKeyDown={handleKeyDown}
      />

      <IconButton
        label="Send message"
        variant="solid"
        type="submit"
        disabled={disabled || !draft.trim()}
      >
        <Send size={17} />
      </IconButton>
    </form>
  );
}
