import { test, expect } from "@playwright/test";

import { login, createRoom } from "./helpers.js";

let roomSeq = 0;
const roomName = (label) => `e2e-${label}-${process.pid}-${(roomSeq += 1)}`;

/** The composer for the open room, addressed by its aria-label. */
const composer = (page, room) => page.getByRole("textbox", { name: `Message #${room}` });

test.describe("Messaging in the browser", () => {
  test("creates a room and sends a message into it", async ({ page }) => {
    const room = roomName("solo");
    await login(page);

    await createRoom(page, room);

    // Creating a room opens it: its composer is on screen.
    await expect(composer(page, room)).toBeVisible();

    await composer(page, room).fill("hello world");
    await composer(page, room).press("Enter");

    await expect(page.getByText("hello world")).toBeVisible();
    await expect(composer(page, room)).toHaveValue(""); // cleared after sending
  });

  /**
   * The journey the whole architecture exists for, proven at the UI: two real
   * browsers, and a message typed in one appears in the other with no reload.
   */
  test("delivers a message between two browsers in real time", async ({ browser }) => {
    const room = roomName("live");

    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alice = await aliceCtx.newPage();
    const bob = await bobCtx.newPage();

    try {
      // Alice makes the public room BEFORE Bob signs in, so it is already in
      // his Discover list when he first loads it — there is no push for a room
      // that did not exist when he connected.
      await login(alice);
      await createRoom(alice, room, { visibility: "public" });
      await expect(composer(alice, room)).toBeVisible();

      await login(bob);

      // Bob's Discover row for this room carries a plain "Join"; scope to the row.
      await bob
        .getByRole("listitem")
        .filter({ hasText: room })
        .getByRole("button", { name: "Join" })
        .click();
      await expect(composer(bob, room)).toBeVisible();

      // Alice speaks; Bob hears it live.
      await composer(alice, room).fill("live from alice");
      await composer(alice, room).press("Enter");
      await expect(bob.getByText("live from alice")).toBeVisible();

      // And back the other way.
      await composer(bob, room).fill("bob replies");
      await composer(bob, room).press("Enter");
      await expect(alice.getByText("bob replies")).toBeVisible();
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
