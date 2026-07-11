import { Check, CheckCheck, Clock } from "lucide-react";

import { cx } from "../../lib/cx.js";
import styles from "./MessageTicks.module.css";

/**
 * WhatsApp's tick marks, adapted to a room with many recipients rather than one.
 *
 *   clock       still in flight, the server has not stored it
 *   ✓           stored, nobody else has read it yet
 *   ✓✓ muted    some members have read it
 *   ✓✓ accent   every other member has read it
 *
 * There is deliberately no "delivered" tick: we track when a member last READ
 * the room, not when their device received a message. A grey double-tick that
 * silently meant "some have read this" would be read as "nobody has", which is
 * worse than not showing it. Every state carries an exact label instead.
 */
export function readerCount(message, receipts) {
  const sentAt = new Date(message.createdAt);
  return receipts.filter((receipt) => new Date(receipt.lastReadAt) >= sentAt).length;
}

/**
 * `readers` is a count, not the receipts array: the array gets a new identity
 * every time anyone reads anything, which would re-render every bubble in the
 * room. A number that has not changed lets memo do its job.
 */
export function MessageTicks({ message, readers = 0, recipientCount = 0 }) {
  if (message.status === "sending") {
    return (
      <span className={styles.ticks} role="img" aria-label="Sending">
        <Clock size={13} />
      </span>
    );
  }

  // Nothing to report on a failed send, or on a message nobody can read.
  if (message.status || message.deleted) return null;

  const readByAll = recipientCount > 0 && readers === recipientCount;

  const label = recipientCount
    ? `Read by ${readers} of ${recipientCount}`
    : "Sent";

  return (
    <span
      className={cx(styles.ticks, readByAll && styles.readByAll)}
      role="img"
      aria-label={label}
      title={label}
    >
      {readers > 0 ? <CheckCheck size={14} /> : <Check size={14} />}
    </span>
  );
}
