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
  const triggerRef = useRef(null);

  /**
   * The picker unmounts on close, so whatever was focused inside it disappears
   * and focus falls to <body> — throwing a keyboard user back to the top of the
   * page. Send focus back to the trigger instead.
   *
   * Not when the user dismissed it by clicking elsewhere, though: they chose
   * where to go, and yanking focus back would fight them.
   */
  const restoreFocus = useRef(true);

  const close = ({ restore = true } = {}) => {
    restoreFocus.current = restore;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const dismiss = (event) => {
      if (!ref.current?.contains(event.target)) close({ restore: false });
    };
    const onKeyDown = (event) => event.key === "Escape" && close();

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Guards the effect below: on first render the picker is closed but was never
  // open, and focusing the trigger then would steal focus on page load.
  const hasOpened = useRef(false);
  if (open) hasOpened.current = true;

  // Reopening should always land on the quick row, never on a stale search.
  useEffect(() => {
    if (open || !hasOpened.current) return;

    setFull(false);
    setQuery("");
    if (restoreFocus.current) triggerRef.current?.focus();
    restoreFocus.current = true;
  }, [open]);

  useEffect(() => {
    if (full) searchRef.current?.focus();
  }, [full]);

  const pick = (emoji) => {
    onPick(emoji);
    close();
  };

  const groups = full ? searchEmoji(query) : [];

  return (
    <span className={styles.wrap} ref={ref}>
      <IconButton
        ref={triggerRef}
        label="Add reaction"
        size="sm"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <SmilePlus size={14} />
      </IconButton>

      {/*
        A group of buttons, not a `menu`. role="menu" is a promise of arrow-key
        roving navigation (WAI-ARIA), and we implement none — so it told screen
        readers to expect a keyboard model that does not exist. Plain buttons in
        a labelled group tell the truth, and Tab already works.
      */}
      {open && !full && (
        <div className={styles.palette} role="group" aria-label="Pick a reaction">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.option}
              aria-label={`React with ${emoji}`}
              onClick={() => pick(emoji)}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}

          <button
            type="button"
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