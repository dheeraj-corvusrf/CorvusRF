// @vitest-environment jsdom
// startCheckout/openBillingPortal write to window.location, which doesn't
// exist under the default node environment set in vitest.config.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockQueryBuilder } from "./test-utils/supabase-query-mock";

const mockFrom = vi.fn();
const mockInvoke = vi.fn();

vi.mock("./supabase", () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
vi.mock("./edge-functions", () => ({ invokeEdgeFunction: (...args: unknown[]) => mockInvoke(...args) }));

// Imported after the mocks above so billing.ts picks up the mocked modules.
const { getMyBilling, startCheckout, openBillingPortal, resumeSubscription } = await import("./billing");

describe("getMyBilling", () => {
  it("maps snake_case profile columns to BillingInfo", async () => {
    mockFrom.mockReturnValue(
      mockQueryBuilder({
        data: {
          plan: "owner_managed",
          subscription_status: "active",
          subscription_quantity: 3,
          cancel_at_period_end: false,
          cancel_at: null,
        },
        error: null,
      }),
    );

    const result = await getMyBilling("user-1");

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(result).toEqual({
      plan: "owner_managed",
      subscriptionStatus: "active",
      subscriptionQuantity: 3,
      cancelAtPeriodEnd: false,
      cancelAt: null,
    });
  });

  it("throws when Supabase returns an error", async () => {
    mockFrom.mockReturnValue(mockQueryBuilder({ data: null, error: new Error("row not found") }));
    await expect(getMyBilling("user-1")).rejects.toThrow("row not found");
  });
});

describe("startCheckout", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    mockInvoke.mockReset();
    // jsdom's window.location isn't directly assignable; delete + redefine.
    // @ts-expect-error -- test-only override
    delete window.location;
    // @ts-expect-error -- test-only override
    window.location = { href: "" };
  });

  afterEach(() => {
    // @ts-expect-error -- test-only override
    window.location = originalLocation;
  });

  it("calls create-checkout-session with the tier/quantity and redirects to the returned URL", async () => {
    mockInvoke.mockResolvedValue({ url: "https://checkout.stripe.com/session/abc" });

    await startCheckout("owner_managed", 2);

    expect(mockInvoke).toHaveBeenCalledWith("create-checkout-session", { tier: "owner_managed", quantity: 2 });
    expect(window.location.href).toBe("https://checkout.stripe.com/session/abc");
  });

  it("throws instead of redirecting when Stripe returns no URL", async () => {
    mockInvoke.mockResolvedValue({ url: "" });
    await expect(startCheckout("corvusrf_managed", 1)).rejects.toThrow(/did not return a checkout URL/);
    expect(window.location.href).toBe("");
  });
});

describe("openBillingPortal", () => {
  it("calls create-billing-portal-session and redirects to the returned URL", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ url: "https://billing.stripe.com/portal/abc" });
    // @ts-expect-error -- test-only override
    delete window.location;
    // @ts-expect-error -- test-only override
    window.location = { href: "" };

    await openBillingPortal();

    expect(mockInvoke).toHaveBeenCalledWith("create-billing-portal-session", {});
    expect(window.location.href).toBe("https://billing.stripe.com/portal/abc");
  });
});

describe("resumeSubscription", () => {
  it("calls resume-subscription with no body", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true });
    await resumeSubscription();
    expect(mockInvoke).toHaveBeenCalledWith("resume-subscription", {});
  });
});
