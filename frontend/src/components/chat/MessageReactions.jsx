import { cx } from "../../lib/cx.js";
import styles from "./MessageReactions.module.css";

/**
 * The chips under a message. The server sends who reacted, not whether *you*
 * did — one broadcast serves every member — so "mine" is resolved here.
 */
export function MessageReactions({ reactions = [], currentUserId, onToggle }) {
  if (!reactions.length) return null;

  return (
    <ul className={styles.list}>
      {reactions.map(({ emoji, users }) => {
        const mine = users.includes(currentUserId);
        const label = `${emoji} ${users.length}, ${mine ? "click to remove yours" : "click to add yours"}`;

        return (
          <li key={emoji}>
            <button
              type="button"
              className={cx(styles.chip, mine && styles.mine)}
              aria-pressed={mine}
              aria-label={label}
              title={label}
              onClick={() => onToggle(emoji)}
            >
              <span aria-hidden="true">{emoji}</span>
              <span className={styles.count}>{users.length}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
