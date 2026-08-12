import { type Page, test } from "@playwright/test";

// These specs need a real signed-in account with at least one saved property,
// and they write real rows (a protests insert, a Stripe checkout session) —
// see the "not run in CI by default" note in playwright.config.ts. Run them
// locally against a seeded test account:
//
//   E2E_TEST_EMAIL=you@example.com E2E_TEST_PASSWORD=... npx playwright test e2e/authenticated
//
// Each test calls requireTestAccount() first and skips itself (not fails)
// when the env vars aren't set, so `npm run test:e2e` (guest-only) is
// unaffected and a contributor without a seeded account isn't blocked.
export function requireTestAccount() {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  test.skip(!email || !password, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set — see e2e/authenticated/helpers.ts");
  return { email: email!, password: password! };
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').waitFor({ state: "visible" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}
