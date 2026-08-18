import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks the 3 tiers and their real prices render correctly.
test("pricing page renders all 3 tiers with the correct prices", async ({ page }) => {
  await page.goto("pricing");

  // The $0 Free entry is a compact price box (plain text, not a heading —
  // it's one of 7 uniform price-point boxes, not a full feature card like
  // the two paid tiers below get), so this checks text, not heading role.
  await expect(page.getByText("Free AI Review")).toBeVisible();
  await expect(page.getByText("$0", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Owner-Managed" })).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "CorvusPT-Managed" })).toBeVisible();
  await expect(page.getByText("$199", { exact: true })).toBeVisible();

  await expect(page.getByRole("link", { name: "Start Free Review" })).toBeVisible();
});
