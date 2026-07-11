import { User } from "../models/User.js";
import { escapeRegex } from "../utils/sanitize.js";
import { USER_SEARCH_LIMIT } from "../constants/index.js";

const PUBLIC_FIELDS = "username name avatarUrl";

export const findById = (id) => User.findById(id).select(PUBLIC_FIELDS);

export const findByIds = (ids) =>
  User.find({ _id: { $in: ids } }).select(PUBLIC_FIELDS);

export const findByUsername = (username) =>
  User.findOne({ username: String(username ?? "").toLowerCase() });

const USERNAME_SEARCH_MIN = 2;

/**
 * Live username search for the invite box, excluding the searcher.
 *
 * The term is escaped and anchored: unescaped, a logged-in user could send
 * `(a+)+$` and have mongod evaluate a catastrophic-backtracking pattern against
 * every user document — a collection scan on the database every app server
 * shares. Anchoring also lets the username index serve the query, and a prefix
 * match is what an invite box actually wants.
 */
export const searchUsernames = (query, excludeUserId) => {
  const term = String(query ?? "").trim();
  if (term.length < USERNAME_SEARCH_MIN) return [];

  return User.find({
    username: { $regex: `^${escapeRegex(term)}`, $options: "i" },
    _id: { $ne: excludeUserId },
  })
    .select(PUBLIC_FIELDS)
    .limit(USER_SEARCH_LIMIT);
};

export const existsWithUsername = (username) => User.exists({ username });

export const findByProvider = (provider, providerId) =>
  User.findOne({ provider, providerId });

export const createUser = (data) => User.create(data);
