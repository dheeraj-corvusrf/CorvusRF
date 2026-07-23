import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import type { PlanValue } from "./admin";

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
