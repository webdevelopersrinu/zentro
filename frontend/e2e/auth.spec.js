import { test, expect } from "@playwright/test";

import { login, uniqueEmail } from "./helpers.js";

/**
 * The login journey through the real browser: the passwordless email-code flow,
 * end to end. Only the inbox is faked (see the test-login seam); every screen,
 * request and cookie is real.
 */
test.describe("Signing in", () => {
  test("swaps an emailed code for a session and lands in the app", async ({ page }) => {
    await page.goto("/");

    // The login screen, before anything is typed.
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create room" })).toHaveCount(0);

    await login(page);

    // Inside the app now: the sidebar and its actions exist.
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("keeps you signed in across a reload", async ({ page }) => {
    await login(page);

    await page.reload();

    // The httpOnly refresh cookie is all that survives a reload; it is enough.
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("signs out back to the login screen", async ({ page }) => {
    await login(page);

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create room" })).toHaveCount(0);
  });

  test("rejects a wrong code and stays on the code step", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email address").fill(uniqueEmail());
    await page.getByRole("button", { name: "Email me a code" }).click();

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify and sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(/invalid|expired/i);
    await expect(page.getByRole("button", { name: "Create room" })).toHaveCount(0);
  });
});
