import { useMemo, useState } from "react";
import { Plus, Search, LogOut, Moon, Sun } from "lucide-react";

import { Logo } from "../ui/Logo.jsx";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { Avatar } from "../ui/Avatar.jsx";
import { IconButton } from "../ui/IconButton.jsx";
import { SkeletonList } from "../ui/Skeleton.jsx";
import { RoomListItem } from "./RoomListItem.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import styles from "./Sidebar.module.css";

const matches = (room, query) => room.name.toLowerCase().includes(query.toLowerCase());

export function Sidebar({
  myRooms = [],
  discoverRooms = [],
  loading,
  activeRoomId,
  unreadRoomIds,
  joiningRoomId,
  onSelectRoom,
  onJoinRoom,
  onDeclineInvite,
  onCreateRoom,
}) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");

  const [mine, discover] = useMemo(
    () => [myRooms.filter((r) => matches(r, query)), discoverRooms.filter((r) => matches(r, query))],
    [myRooms, discoverRooms, query]
  );

  const renderRooms = (rooms) =>
    rooms.map((room) => (
      <RoomListItem
        key={room.id}
        room={room}
        active={room.id === activeRoomId}
        unread={unreadRoomIds.has(room.id)}
        joining={joiningRoomId === room.id}
        onSelect={onSelectRoom}
        onJoin={onJoinRoom}
        onDecline={onDeclineInvite}
      />
    ));

  return (
    <nav className={styles.sidebar} aria-label="Rooms">
      <header className={styles.header}>
        <Logo size={24} withWordmark />
      </header>

      <div className={styles.search}>
        <Input
          type="search"
          placeholder="Search rooms"
          aria-label="Search rooms"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          startIcon={<Search size={16} />}
        />
      </div>

      <div className={styles.lists}>
        {loading ? (
          <SkeletonList count={5} />
        ) : (
          <>
            <section>
              <h2 className={styles.sectionTitle}>My rooms</h2>
              {mine.length ? (
                <ul className={styles.list}>{renderRooms(mine)}</ul>
              ) : (
                <p className={styles.hint}>No rooms yet.</p>
              )}
            </section>

            <section>
              <h2 className={styles.sectionTitle}>Discover</h2>
              {discover.length ? (
                <ul className={styles.list}>{renderRooms(discover)}</ul>
              ) : (
                <p className={styles.hint}>You're in every room.</p>
              )}
            </section>
          </>
        )}
      </div>

      <div className={styles.create}>
        <Button fullWidth startIcon={<Plus size={16} />} onClick={onCreateRoom}>
          Create room
        </Button>
      </div>

      <footer className={styles.footer}>
        <Avatar src={user?.avatarUrl} name={user?.name} size={30} />
        <span className={styles.username}>{user?.name}</span>
        <IconButton
          label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          size="sm"
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="Sign out" size="sm" onClick={logout}>
          <LogOut size={15} />
        </IconButton>
      </footer>
    </nav>
  );
}
