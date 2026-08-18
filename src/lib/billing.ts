import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// "ai_report" and the old contingency-based "managed_protest" are retained only for
// backward compatibility with any pre-existing rows from before the per-property
// pricing overhaul — new subscriptions always write owner_managed/corvusrf_managed.
export type PlanValue =
  | "free_ai_review"
  | "ai_report"
  | "managed_protest"
  | "owner_managed"
  | "corvusrf_managed";

export type Tier = "owner_managed" | "corvusrf_managed";

// Property-value-tiered pricing — each paid tier has 3 monthly price points
// instead of one flat per-property rate, keyed by which value bracket a
// given property falls in. The real amount charged is whatever Stripe Price
// each STRIPE_PRICE_ID_* secret points at (see create-checkout-session) —
// these numbers are for display/estimate only, kept in sync by hand.
export type PropertyValueBracket = "under2m" | "mid2m10m" | "over10m";

export type BracketQuantities = Record<PropertyValueBracket, number>;

export const EMPTY_BRACKETS: BracketQuantities = { under2m: 0, mid2m10m: 0, over10m: 0 };

export const VALUE_BRACKETS: { value: PropertyValueBracket; label: string }[] = [
  { value: "under2m", label: "$0 - $2M" },
  { value: "mid2m10m", label: "$2M - $10M" },
  { value: "over10m", label: "$10M+" },
];

export const TIER_BRACKET_PRICES: Record<Tier, Record<PropertyValueBracket, number>> = {
  owner_managed: { under2m: 99, mid2m10m: 299, over10m: 499 },
  corvusrf_managed: { under2m: 199, mid2m10m: 499, over10m: 699 },
};

export function bracketMonthlyTotal(tier: Tier, brackets: BracketQuantities): number {
  return VALUE_BRACKETS.reduce(
    (sum, { value }) => sum + brackets[value] * TIER_BRACKET_PRICES[tier][value],
    0,
  );
}

export function bracketPropertyCount(brackets: BracketQuantities): number {
  return VALUE_BRACKETS.reduce((sum, { value }) => sum + brackets[value], 0);
}

export const PLAN_OPTIONS: { value: PlanValue; label: string }[] = [
  { value: "free_ai_review", label: "Free AI Review" },
  { value: "owner_managed", label: "Owner-Managed ($99–$499/mo/property, by value)" },
  { value: "corvusrf_managed", label: "CorvusPT-Managed ($199–$699/mo/property, by value)" },
];

export type BillingInfo = {
  plan: PlanValue;
  subscriptionStatus: string | null;
  subscriptionQuantity: number;
  subscriptionBrackets: BracketQuantities;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
};

export async function getMyBilling(userId: string): Promise<BillingInfo> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "plan, subscription_status, subscription_quantity, qty_under_2m, qty_2m_10m, qty_over_10m, cancel_at_period_end, cancel_at",
    )
    .eq("id", userId)
    .single();
  if (error) throw error;
  const row = data as {
    plan: PlanValue;
    subscription_status: string | null;
    subscription_quantity: number;
    qty_under_2m: number;
    qty_2m_10m: number;
    qty_over_10m: number;
    cancel_at_period_end: boolean;
    cancel_at: string | null;
  };
  return {
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    subscriptionQuantity: row.subscription_quantity,
    subscriptionBrackets: {
      under2m: row.qty_under_2m,
      mid2m10m: row.qty_2m_10m,
      over10m: row.qty_over_10m,
    },
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at,
  };
}

export async function startCheckout(tier: Tier, brackets: BracketQuantities): Promise<void> {
  // Stripe redirects back to a path the edge function can't know on its own (it
  // runs server-side, with no view of Vite's base path) — the client computes it
  // via import.meta.env.BASE_URL, same pattern already used in
  // forgot-password.tsx's redirectTo, and passes it along instead of the edge
  // function guessing/hardcoding it (which is exactly how this one went stale
  // pointing at a pre-custom-domain path).
  const basePath = import.meta.env.BASE_URL;
  const { url } = await invokeEdgeFunction<{ url: string }>("create-checkout-session", {
    tier,
    brackets,
    successPath: `${basePath}dashboard?checkout=success`,
    cancelPath: `${basePath}pricing`,
  });
  if (!url) throw new Error("Stripe did not return a checkout URL. Please try again.");
  window.location.href = url;
}

export async function openBillingPortal(): Promise<void> {
  const basePath = import.meta.env.BASE_URL;
  const { url } = await invokeEdgeFunction<{ url: string }>("create-billing-portal-session", {
    returnPath: `${basePath}dashboard`,
  });
  if (!url) throw new Error("Stripe did not return a billing portal URL. Please try again.");
  window.location.href = url;
}

// Undoes a scheduled cancel-at-period-end in one click, rather than sending the user
// into the full Stripe Customer Portal to find the "renew" option.
export async function resumeSubscription(): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>("resume-subscription", {});
}
