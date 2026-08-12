import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn } from "./helpers";

// Stops at "got a valid Stripe Checkout session" rather than completing a
// real payment — see playwright.config.ts's top comment. Requires the
// seeded test account to have Stripe test-mode price IDs configured on the
// create-checkout-session edge function (STRIPE_PRICE_ID_OWNER_MANAGED).
test("subscribing on Pricing redirects to a real Stripe Checkout session", async ({ page }) => {
  const { email, password } = requireTestAccount();
  await signIn(page, email, password);

  await page.goto("/pricing");

  const responsePromise = page.waitForResponse((res) =>
    res.url().includes("create-checkout-session"),
  );
  await page.getByRole("button", { name: /^Subscribe/ }).first().click();
  const response = await responsePromise;

  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { url?: string };
  expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
});
