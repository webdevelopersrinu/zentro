import { useState } from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Modal } from "../ui/Modal.jsx";
import { Input } from "../ui/Input.jsx";
import { IconButton } from "../ui/IconButton.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SearchHighlight } from "./SearchHighlight.jsx";
import { useDebounce } from "../../hooks/useDebounce.js";
import * as roomService from "../../services/room.service.js";
import { queryKeys } from "../../lib/queryKeys.js";
import { SEARCH_MIN_LENGTH } from "../../config/index.js";
import styles from "./MessageSearch.module.css";

const when = (iso) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Results({ roomId, query }) {
  const enabled = query.length >= SEARCH_MIN_LENGTH;

  const { data: messages, isFetching } = useQuery({
    queryKey: queryKeys.messageSearch(roomId, query),
    queryFn: () => roomService.searchMessages(roomId, query),
    enabled,
    // Results for a term never change under us; refetching on focus is noise.
    staleTime: 30_000,
  });

  if (!enabled)
    return <p className={styles.hint}>Type at least {SEARCH_MIN_LENGTH} characters.</p>;

  if (isFetching && !messages)
    return (
      <div className={styles.centre}>
        <Spinner label="Searching" />
      </div>
    );

  if (!messages?.length)
    return <EmptyState icon={Search} title="No matches" body={`Nothing found for “${query}”.`} />;

  return (
    <ol className={styles.results}>
      {messages.map((message) => (
        <li key={message.id} className={styles.result}>
          <header className={styles.head}>
            <strong>{message.username}</strong>
            <time dateTime={message.createdAt}>{when(message.createdAt)}</time>
          </header>
          <p className={styles.text}>
            <SearchHighlight text={message.text} query={query} />
          </p>
        </li>
      ))}
    </ol>
  );
}

export function MessageSearch({ room }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  // A request per keystroke would be one per letter of every word typed.
  const query = useDebounce(term.trim(), 300);

  const close = () => {
    setOpen(false);
    setTerm("");
  };

  return (
    <>
      <IconButton label={`Search #${room.name}`} onClick={() => setOpen(true)}>
        <Search size={18} />
      </IconButton>

      <Modal open={open} onClose={close} title={`Search #${room.name}`}>
        <Input
          type="search"
          autoFocus
          value={term}
          startIcon={<Search size={16} />}
          placeholder="Find a message…"
          aria-label="Search messages"
          onChange={(event) => setTerm(event.target.value)}
        />

        <div className={styles.body}>
          {open && <Results roomId={room.id} query={query} />}
        </div>
      </Modal>
    </>
  );
}
