import { z } from "zod";

export const searchQuerySchema = z.object({
  // Capped at the trust boundary: an unbounded term is an unbounded regex for
  // the database to compile. Short terms are not an error — a half-typed name in
  // the invite box just matches nothing (see user.service.searchUsernames).
  q: z.string().trim().max(30).default(""),
});
