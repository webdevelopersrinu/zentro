import { REACTION_MAX_CODE_POINTS } from "../constants/index.js";

/**
 * One emoji: a pictographic base, optionally with a variation selector (FE0F)
 * and a skin-tone modifier, optionally ZWJ-joined (200D) into a sequence such as
 * a family. Flags (a regional-indicator pair) and keycaps have their own shapes.
 * Escapes, not literals, so the pattern survives any editor or encoding.
 */
const VS = String.raw`[\uFE0E\uFE0F]`;
const ZWJ = String.raw`\u200D`;
const ATOM = String.raw`\p{Extended_Pictographic}${VS}?\p{Emoji_Modifier}?`;
const KEYCAP = String.raw`[0-9#*]\uFE0F?\u20E3`;
const FLAG = String.raw`\p{Regional_Indicator}{2}`;
const EMOJI = new RegExp(
  String.raw`^(?:${FLAG}|${KEYCAP}|${ATOM}(?:${ZWJ}${ATOM})*)$`,
  "u"
);

/**
 * Whether a value is genuinely a single emoji — the only thing a reaction may be.
 *
 * A reaction is stored on someone else's message and broadcast to every member of
 * the room, so this field is a trust boundary, not a string column. Plain text,
 * markup and an arbitrarily long ZWJ chain are all refused.
 */
export function isEmoji(value) {
  if (typeof value !== "string" || !value) return false;
  if ([...value].length > REACTION_MAX_CODE_POINTS) return false;
  return EMOJI.test(value);
}

/**
 * A complete tag, and nothing else: a script/style element with its contents, an
 * HTML comment, or any single `<tag …>` / `</tag>`. A lone `<` that never closes
 * is NOT a tag — "if a<b then" is a sentence, not markup.
 */
const TAG = /<(?:script|style)\b[^]*?<\/(?:script|style)\s*>|<!--[^]*?-->|<\/?[a-zA-Z][^<>]*>/gi;

/**
 * Strip ALL markup. Chat messages and room names are plain text; there is no
 * legitimate reason for a user to submit HTML.
 *
 * React escapes on render, so this is defence in depth — it protects any other
 * consumer of the data (exports, emails, a future non-React client) and stops
 * stored XSS at the source rather than at the last mile.
 *
 * Deliberately NOT sanitize-html: that library entity-encodes the text it keeps,
 * so "Tom & Jerry" was stored as "Tom &amp; Jerry" (which React then renders
 * literally, and a second edit compounds to &amp;amp;), and its HTML parser
 * swallowed "if a<b then" down to "if a". This removes markup and touches
 * nothing else — no encoding, therefore no mangling and no compounding.
 *
 * Looped to a fixpoint because deleting a tag can leave its neighbours forming a
 * new one ("<scr<b>ipt>").
 */
export const stripHtml = (value) => {
  let text = String(value ?? "");
  for (let previous; previous !== text; ) {
    previous = text;
    text = text.replace(TAG, "");
  }
  // trim() covers every Unicode space, U+00A0 included: a body of one
  // non-breaking space must be an empty message, not a blank bubble.
  return text.trim();
};

/**
 * Neutralise every regex metacharacter, so a search term matches literally.
 *
 * Without this, a user's `(a+)+$` is a catastrophic-backtracking pattern the
 * database will happily evaluate on every message, and `^` or `.` silently
 * change what the query means.
 */
export const escapeRegex = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remove MongoDB operator keys ($gt, $ne, …) and dotted paths from an object
 * IN PLACE. Express defines req.query with a getter only, so the usual
 * `req.query = sanitize(req.query)` silently does nothing — we mutate instead.
 */
export function stripMongoOperators(value) {
  if (!value || typeof value !== "object") return value;

  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete value[key];
    } else {
      stripMongoOperators(value[key]);
    }
  }
  return value;
}