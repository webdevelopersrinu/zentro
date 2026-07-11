import { z } from "zod";
import mongoose from "mongoose";
import { MESSAGE_PAGE, ROOM_VISIBILITY, SEARCH } from "../constants/index.js";
import { stripHtml } from "../utils/sanitize.js";

// Strip markup BEFORE length checks, so "<b></b>" can't pass as a name and
// so a 40-char limit can't be smuggled past with tags.
const roomName = z
  .string()
  .transform(stripHtml)
  .pipe(z.string().min(1, "Room name required").max(40));

const visibility = z.enum([ROOM_VISIBILITY.PUBLIC, ROOM_VISIBILITY.PRIVATE]);

export const createRoomSchema = z.object({
  name: roomName,
  visibility: visibility.default(ROOM_VISIBILITY.PUBLIC),
});

export const updateRoomSchema = z
  .object({ name: roomName.optional(), visibility: visibility.optional() })
  .refine((v) => v.name !== undefined || v.visibility !== undefined, {
    message: "Nothing to update",
  });

export const inviteSchema = z.object({
  username: z.string().trim().min(1, "username required").max(30),
});

/**
 * `before` is checked here rather than in the query: an id Mongo can't cast
 * would surface as a 500 instead of the 400 it is. `limit` is capped so a
 * client cannot ask for the whole room in one request.
 */
export const messageQuerySchema = z.object({
  before: z
    .string()
    .refine(mongoose.isValidObjectId, "before must be a message id")
    .optional(),
  limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE.MAX).default(MESSAGE_PAGE.DEFAULT),
});

/**
 * A minimum length, because a one-character search matches nearly every message
 * and is never what anyone meant. A maximum, because the term ends up in a
 * regex.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH.MIN_LENGTH, "Search for at least 2 characters").max(SEARCH.MAX_LENGTH),
  limit: z.coerce.number().int().min(1).max(SEARCH.LIMIT).default(SEARCH.LIMIT),
});
