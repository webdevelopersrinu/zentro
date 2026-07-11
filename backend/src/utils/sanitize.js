import sanitizeHtml from "sanitize-html";

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
 * Strip ALL markup. Chat messages and room names are plain text; there is no
 * legitimate reason for a user to submit HTML.
 *
 * React escapes on render, so this is defence in depth — it protects any other
 * consumer of the data (exports, emails, a future non-React client) and stops
 * stored XSS at the source rather than at the last mile.
 */
export const stripHtml = (value) =>
  sanitizeHtml(String(value ?? ""), {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  }).trim();

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