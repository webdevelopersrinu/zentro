import { z } from "zod";

import { EMAIL_CODE } from "../constants/index.js";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), "Invalid email address");

export const emailRequestSchema = z.object({ email });

export const emailVerifySchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${EMAIL_CODE.LENGTH}}$`), "Invalid code"),
});
