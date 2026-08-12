import { defineConfig, devices } from "@playwright/test";

// Only e2e/guest is wired into CI (see deploy.yml) — those specs need no
// sign-in and write no persistent Supabase rows (intake state lives in
// browser state until a user actually saves a property), so they're safe
// to run against the real Supabase project on every push. e2e/authenticated
// needs a seeded test account and is run locally/manually for now — see the
// README note at the top of that folder.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080/CorvusRF/",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080/CorvusRF/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
