import { useEffect, useRef, useState } from "react";
import { SmilePlus, Plus, Search } from "lucide-react";

import { IconButton } from "../ui/IconButton.jsx";
import { REACTION_EMOJIS } from "../../config/index.js";
import { searchEmoji } from "../../lib/emoji.js";
import styles from "./ReactionPicker.module.css";

/**
 * Two steps, like WhatsApp: a quick row of the common few — one tap, no reading —
 * and behind "+", the full searchable set. The quick row is the fast path, so it
 * is what opens first.
 */
export function ReactionPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const searchRef = useRef(null);

  // Clicking anywhere else, or pressing Escape, dismisses it.
  useEffect(() => {
    if (!open) return;

    const dismiss = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => event.key === "Escape" && setOpen(false);

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Reopening should always land on the quick row, never on a stale search.
  useEffect(() => {
    if (!open) {
      setFull(false);
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (full) searchRef.current?.focus();
  }, [full]);

  const pick = (emoji) => {
    onPick(emoji);
    setOpen(false);
  };

  const groups = full ? searchEmoji(query) : [];

  return (
    <span className={styles.wrap} ref={ref}>
      <IconButton
        label="Add reaction"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SmilePlus size={14} />
      </IconButton>

      {open && !full && (
        <div className={styles.palette} role="menu" aria-label="Pick a reaction">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              className={styles.option}
              aria-label={`React with ${emoji}`}
              onClick={() => pick(emoji)}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}

          <button
            type="button"
            role="menuitem"
            className={styles.more}
            aria-label="More emoji"
            onClick={() => setFull(true)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {open && full && (
        <div className={styles.sheet} role="dialog" aria-label="Emoji picker">
          <div className={styles.searchRow}>
            <Search size={14} aria-hidden="true" className={styles.searchIcon} />
            <input
              ref={searchRef}
              type="search"
              className={styles.search}
              placeholder="Search emoji"
              aria-label="Search emoji"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className={styles.scroll}>
            {groups.map((group) => (
              <section key={group.name} aria-label={group.name}>
                <h3 className={styles.groupName}>{group.name}</h3>
                <div className={styles.grid}>
                  {group.emojis.map(({ char }) => (
                    <button
                      key={char}
                      type="button"
                      className={styles.option}
                      aria-label={`React with ${char}`}
                      onClick={() => pick(char)}
                    >
                      <span aria-hidden="true">{char}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {!groups.length && <p className={styles.empty}>No emoji match “{query}”.</p>}
          </div>
        </div>
      )}
    </span>
  );
}