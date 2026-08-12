import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn } from "./helpers";

// Requires the seeded test account to already have at least one saved
// property with protestDeadline/totalValue set (add-a-property is exercised
// by the guest intake spec, not repeated here to keep this focused on the
// authorization + request step specifically).
test("signing the authorization and requesting a protest creates a case", async ({ page }) => {
  const { email, password } = requireTestAccount();
  await signIn(page, email, password);

  await page.goto("/dashboard/properties");
  const firstProperty = page.locator(".card-elev", { hasText: "Open AI Report" }).first();
  await firstProperty.getByRole("button", { name: "Open AI Report" }).click();

  await page.getByRole("button", { name: "Request Protest Filing" }).click();

  // Step 1: owner details — first/last/email/phone are prefilled from the
  // account, only fill anything that's blank. Values are read into plain
  // strings now since these inputs unmount once we move to the next step.
  const firstNameField = page.getByLabel("First Name");
  if (!(await firstNameField.inputValue())) await firstNameField.fill("Test");
  const lastNameField = page.getByLabel("Last Name");
  if (!(await lastNameField.inputValue())) await lastNameField.fill("User");
  const phoneField = page.getByLabel("Phone Number");
  if (!(await phoneField.inputValue())) await phoneField.fill("5555555555");
  const fullName = `${await firstNameField.inputValue()} ${await lastNameField.inputValue()}`;
  await page.getByRole("button", { name: "Next" }).click();

  // Step 2: recent-purchase question.
  await page.getByRole("radio").last().check(); // "No"
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: review + typed signature.
  await page.getByRole("checkbox").check();
  await page.getByPlaceholder("Type your full legal name").fill(fullName);
  await page.getByRole("button", { name: "Sign & Submit" }).click();

  await expect(page.getByText(/Protest requested/i)).toBeVisible({ timeout: 15_000 });
});
