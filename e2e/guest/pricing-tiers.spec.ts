import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks the 3 tiers and their real prices render correctly.
test("pricing page renders all 3 tiers with the correct prices", async ({ page }) => {
  // "networkidle" (not just the default "load") so the toggle click below
  // always lands after client-side hydration attaches its onClick handler —
  // see e2e/authenticated/helpers.ts's signIn() for the same gotcha.
  await page.goto("pricing", { waitUntil: "networkidle" });

  // The free tier is a plain inline callout above the toggle, not its own
  // card — this checks the link text, not a heading role.
  await expect(page.getByRole("link", { name: "Start a free review" })).toBeVisible();

  // Only one tier's card shows at a time — Owner-Managed by default — with
  // a toggle to switch, rather than both cards displayed side by side.
  await expect(page.getByRole("heading", { name: "Owner-Managed" })).toBeVisible();
  await expect(page.getByText("$99/mo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CorvusPT-Managed" })).not.toBeVisible();

  await page.getByRole("button", { name: "CorvusPT-Managed" }).click();
  await expect(page.getByRole("heading", { name: "CorvusPT-Managed" })).toBeVisible();
  await expect(page.getByText("$199/mo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Owner-Managed" })).not.toBeVisible();
});
