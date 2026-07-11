import styles from "./MessageSearch.module.css";

/**
 * Marks every occurrence of `query` inside `text`, case-insensitively.
 *
 * Split on indices found by hand rather than by regex: the query is whatever the
 * user typed, and building a regex out of it is how a search box becomes an
 * injection point — the same reason the server escapes it before querying.
 */
export function SearchHighlight({ text, query }) {
  if (!query) return text;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts = [];

  let cursor = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, cursor)) {
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <mark key={at} className={styles.mark}>
        {text.slice(at, at + needle.length)}
      </mark>
    );
    cursor = at + needle.length;
  }
  parts.push(text.slice(cursor));

  return parts;
}
