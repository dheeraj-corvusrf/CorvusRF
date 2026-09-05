import { describe, it, expect, vi } from "vitest";
import { mockQueryBuilder } from "./test-utils/supabase-query-mock";

const mockFrom = vi.fn();

vi.mock("./supabase", () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));

// Imported after the mock above so app-settings.ts picks up the mocked module.
const { getAppSettings, setEnforcePerPropertyEntitlement, DEFAULT_APP_SETTINGS } =
  await import("./app-settings");

describe("DEFAULT_APP_SETTINGS", () => {
  it("stays off by default — the safe fallback if the settings row is ever missing", () => {
    // Same "can't silently flip on" guard the old hardcoded
    // ENFORCE_PER_PROPERTY_ENTITLEMENT constant had, now pinned to the
    // fallback this module falls back to instead of the real (admin-
    // toggleable, DB-backed) setting.
    expect(DEFAULT_APP_SETTINGS).toEqual({ enforcePerPropertyEntitlement: false });
  });
});

describe("getAppSettings", () => {
  it("maps the real row to AppSettings", async () => {
    mockFrom.mockReturnValue(
      mockQueryBuilder({ data: { enforce_per_property_entitlement: true }, error: null }),
    );
    const result = await getAppSettings();
    expect(mockFrom).toHaveBeenCalledWith("app_settings");
    expect(result).toEqual({ enforcePerPropertyEntitlement: true });
  });

  it("falls back to the safe default if the singleton row is somehow missing", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: null, error: null }));
    const result = await getAppSettings();
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("throws when Supabase returns a real error", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: null, error: new Error("boom") }));
    await expect(getAppSettings()).rejects.toThrow("boom");
  });
});

describe("setEnforcePerPropertyEntitlement", () => {
  it("updates the singleton row", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: null, error: null }));
    await setEnforcePerPropertyEntitlement(true);
    expect(mockFrom).toHaveBeenCalledWith("app_settings");
  });

  it("throws when Supabase returns an error", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: null, error: new Error("nope") }));
    await expect(setEnforcePerPropertyEntitlement(false)).rejects.toThrow("nope");
  });
});
