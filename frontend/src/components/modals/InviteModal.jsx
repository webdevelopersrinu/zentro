import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Modal } from "../ui/Modal.jsx";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { Avatar } from "../ui/Avatar.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { useDebounce } from "../../hooks/useDebounce.js";
import { useInviteUser } from "../../hooks/useMembers.js";
import { useToast } from "../../context/ToastContext.jsx";
import { searchUsers } from "../../services/user.service.js";
import { queryKeys } from "../../lib/queryKeys.js";
import { SEARCH_DEBOUNCE_MS } from "../../config/index.js";
import styles from "./InviteModal.module.css";

const MIN_QUERY = 2;

/**
 * The one field the browser cannot validate: only the server knows whether a
 * username exists. So the query is debounced, aborted when superseded, and the
 * result drives the UI — no client-side "is this valid" guessing.
 */
export function InviteModal({ open, onClose, room }) {
  const [query, setQuery] = useState("");
  const [invited, setInvited] = useState(new Set());
  const debounced = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS);
  const invite = useInviteUser(room.id); // reports its own failures as an error toast
  const { toast } = useToast();

  const enabled = open && debounced.length >= MIN_QUERY;
  const { data: users = [], isFetching } = useQuery({
    queryKey: queryKeys.userSearch(debounced),
    queryFn: ({ signal }) => searchUsers(debounced, signal),
    enabled,
  });

  const close = () => {
    setQuery("");
    setInvited(new Set());
    onClose();
  };

  const handleInvite = (username) =>
    invite.mutate(username, {
      onSuccess: () => {
        setInvited((current) => new Set(current).add(username));
        toast(`Invited @${username}`, { variant: "success" });
      },
    });

  return (
    <Modal open={open} onClose={close} title={`Invite to #${room.name}`}>
      <Input
        type="search"
        placeholder="Search by username"
        aria-label="Search users"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        startIcon={<Search size={16} />}
        endSlot={isFetching ? <Spinner size={15} label="Searching" /> : null}
        autoFocus
      />

      <div className={styles.results}>
        {!enabled && <p className={styles.hint}>Keep typing to search…</p>}

        {enabled && !isFetching && users.length === 0 && (
          <p className={styles.hint}>No user named “{debounced}”.</p>
        )}

        <ul className={styles.list}>
          {users.map((user) => (
            <li key={user.id} className={styles.row}>
              <Avatar src={user.avatarUrl} name={user.name} size={32} />
              <span className={styles.identity}>
                <strong>{user.name}</strong>
                <span>@{user.username}</span>
              </span>

              {invited.has(user.username) ? (
                <span className={styles.invited}>Invited ✓</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={invite.isPending && invite.variables === user.username}
                  onClick={() => handleInvite(user.username)}
                >
                  Invite
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
