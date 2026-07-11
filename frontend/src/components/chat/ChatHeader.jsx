import { Hash, Lock, Crown, Users, Menu } from "lucide-react";

import { Badge } from "../ui/Badge.jsx";
import { IconButton } from "../ui/IconButton.jsx";
import { MessageSearch } from "./MessageSearch.jsx";
import { RoomExitAction } from "./RoomExitAction.jsx";
import { ROOM_VISIBILITY } from "../../config/index.js";
import styles from "./ChatHeader.module.css";

export function ChatHeader({ room, onToggleMembers, onToggleSidebar }) {
  const isPrivate = room.visibility === ROOM_VISIBILITY.PRIVATE;
  const Icon = isPrivate ? Lock : Hash;

  return (
    <header className={styles.header}>
      <IconButton label="Show rooms" className={styles.menu} onClick={onToggleSidebar}>
        <Menu size={18} />
      </IconButton>

      <h1 className={styles.title}>
        <Icon size={17} aria-hidden="true" />
        {room.name}
      </h1>

      <Badge tone={isPrivate ? "warning" : "muted"}>{isPrivate ? "Private" : "Public"}</Badge>

      {room.isCreator && (
        <span className={styles.crown} title="You created this room">
          <Crown size={15} aria-label="You are the creator" />
        </span>
      )}

      <span className={styles.spacer} />

      <span className={styles.count}>
        {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
      </span>

      <MessageSearch room={room} />

      <IconButton label="Show members" onClick={onToggleMembers}>
        <Users size={18} />
      </IconButton>

      <RoomExitAction room={room} />
    </header>
  );
}
