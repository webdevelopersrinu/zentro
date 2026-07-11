import { useEffect, useRef, useState } from "react";

import styles from "./MessageEditor.module.css";

/**
 * Edits a message in place. Enter saves, Escape cancels — the same contract as
 * the composer, so the keyboard behaves the same wherever you are typing.
 *
 * Saving an unchanged or empty message just cancels: neither is worth a request.
 */
export function MessageEditor({ message, onSave, onCancel }) {
  const [text, setText] = useState(message.text);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const save = async () => {
    const next = text.trim();
    if (!next || next === message.text) return onCancel();

    setSaving(true);
    const ack = await onSave(next);
    setSaving(false);

    if (ack?.ok) onCancel();
    else setError(ack?.error ?? "Could not edit the message");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") return onCancel();
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    save();
  };

  return (
    <div className={styles.editor}>
      <textarea
        ref={ref}
        className={styles.input}
        value={text}
        rows={1}
        disabled={saving}
        aria-label="Edit message"
        aria-invalid={Boolean(error)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : (
        <span className={styles.hint}>
          Enter to save · Esc to <button type="button" onClick={onCancel}>cancel</button>
        </span>
      )}
    </div>
  );
}
