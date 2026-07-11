import { expect } from "@playwright/test";

import { E2E } from "./env.js";

let seq = 0;

/** A fresh address per test, so runs never collide on an existing account. */
export const uniqueEmail = (name = "user") => `${name}-${(seq += 1)}-${process.pid}@e2e.test`;

/**
 * Logs in through the REAL email-OTP UI: type the address, ask for a code,
 * read the code the app "emailed" (from the test-only seam), type it, submit.
 * Only the inbox is faked — every screen and request is the real thing.
 *
 * Returns the address, which doubles as the account's username prefix.
 */
export async function login(page, email = uniqueEmail()) {
  await page.goto("/");

  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();

  // The code step appears only once the request resolves — i.e. once the server
  // has written the code to its outbox. Gate on it so the seam read never races
  // the request that produces the code.
  const codeField = page.getByLabel("6-digit code");
  await expect(codeField).toBeVisible();

  await codeField.fill(await fetchCode(page.request, email));
  await page.getByRole("button", { name: "Verify and sign in" }).click();

  // Landed in the app: the composer only exists once authenticated.
  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
  return email;
}

/**
 * Reads the most recent OTP for an address from the backend's test seam, with a
 * short poll: the code field can render a beat before the outbox settles.
 */
async function fetchCode(request, email) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await request.get(`${E2E.API_URL}/api/test/last-code`, { params: { email } });
    if (res.ok()) return (await res.json()).code;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`test login seam never returned a code for ${email}`);
}

/** Creates a room through the modal and opens it. */
export async function createRoom(page, name, { visibility = "public" } = {}) {
  await page.getByRole("button", { name: "Create room" }).click();
  await page.getByLabel("Room name").fill(name);
  if (visibility === "private") await page.getByRole("radio", { name: /Private/ }).check();
  await page.getByRole("button", { name: "Create", exact: true }).click();
}
