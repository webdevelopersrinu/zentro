import { memo } from "react";
import { Hash, Lock } from "lucide-react";

import { Badge, UnreadDot } from "../ui/Badge.jsx";
import { Button } from "../ui/Button.jsx";
import { cx } from "../../lib/cx.js";
import { ROOM_VISIBILITY } from "../../config/index.js";
import styles from "./RoomListItem.module.css";

/**
 * The most reused component in the app. The row is identical everywhere; only
 * the trailing slot changes:
 *
 *   my room                  → unread dot, or a ⏳ badge if requests are pending
 *   discover, public         → Join
 *   discover, private        → Request to join / Requested ✓
 *
 * memo'd because the sidebar re-renders on every incoming message.
 */
export const RoomListItem = memo(function RoomListItem({
  room,
  active,
  unread,
  joining,
  onSelect,
  onJoin,
  onDecline,
}) {
  const isPrivate = room.visibility === ROOM_VISIBILITY.PRIVATE;
  const Icon = isPrivate ? Lock : Hash;

  if (!room.isMember) {
    return (
      <li className={styles.row}>
        <span className={styles.name}>
          <Icon size={15} aria-hidden="true" />
          {room.name}
        </span>

        {/* An invite is the creator's offer: the user decides, and can say no. */}
        {room.isInvited ? (
          <span className={styles.actions}>
            <Button size="sm" loading={joining} onClick={() => onJoin(room)}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDecline(room)}>
              Decline
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant={room.hasRequested ? "ghost" : "secondary"}
            loading={joining}
            disabled={room.hasRequested}
            onClick={() => onJoin(room)}
          >
            {room.hasRequested ? "Requested ✓" : isPrivate ? "Request" : "Join"}
          </Button>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={cx(styles.row, styles.button, active && styles.active)}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(room.id)}
      >
        <span className={styles.name}>
          <Icon size={15} aria-hidden="true" />
          {room.name}
        </span>

        {room.isAdmin && room.requestCount > 0 ? (
          <Badge tone="warning" aria-label={`${room.requestCount} pending requests`}>
            {room.requestCount}
          </Badge>
        ) : (
          unread && <UnreadDot />
        )}
      </button>
    </li>
  );
});
