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

export const PLAN_OPTIONS: { value: PlanValue; label: string }[] = [
  { value: "free_ai_review", label: "Free AI Review" },
  { value: "owner_managed", label: "Owner-Managed ($99/mo/property)" },
  { value: "corvusrf_managed", label: "CorvusRF-Managed ($199/mo/property)" },
];

export type BillingInfo = {
  plan: PlanValue;
  subscriptionStatus: string | null;
  subscriptionQuantity: number;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
};

export async function getMyBilling(userId: string): Promise<BillingInfo> {
  const { data, error } = await supabase
    .from("profiles")
    .select("plan, subscription_status, subscription_quantity, cancel_at_period_end, cancel_at")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const row = data as {
    plan: PlanValue;
    subscription_status: string | null;
    subscription_quantity: number;
    cancel_at_period_end: boolean;
    cancel_at: string | null;
  };
  return {
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    subscriptionQuantity: row.subscription_quantity,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at,
  };
}

export async function startCheckout(
  tier: "owner_managed" | "corvusrf_managed",
  quantity: number,
): Promise<void> {
  const { url } = await invokeEdgeFunction<{ url: string }>("create-checkout-session", {
    tier,
    quantity,
  });
  if (!url) throw new Error("Stripe did not return a checkout URL. Please try again.");
  window.location.href = url;
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await invokeEdgeFunction<{ url: string }>("create-billing-portal-session", {});
  if (!url) throw new Error("Stripe did not return a billing portal URL. Please try again.");
  window.location.href = url;
}

// Undoes a scheduled cancel-at-period-end in one click, rather than sending the user
// into the full Stripe Customer Portal to find the "renew" option.
export async function resumeSubscription(): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>("resume-subscription", {});
}
