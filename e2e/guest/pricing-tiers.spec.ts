import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks the 3 tiers and their real prices render correctly.
test("pricing page renders all 3 tiers with the correct prices", async ({ page }) => {
  // Relative, no leading slash: baseURL is http://localhost:8080/CorvusRF/,
  // and a leading-slash path resolves from the origin root per the WHATWG
  // URL spec, silently dropping the /CorvusRF/ base path (confirmed via a
  // plain curl: /pricing 404s, /CorvusRF/pricing 200s).
  await page.goto("pricing");

  await expect(page.getByRole("heading", { name: "Free AI Review" })).toBeVisible();
  await expect(page.getByText("$0", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Owner-Managed" })).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "CorvusRF-Managed" })).toBeVisible();
  await expect(page.getByText("$199", { exact: true })).toBeVisible();

  await expect(page.getByRole("link", { name: "Start Free Review" })).toBeVisible();
});
