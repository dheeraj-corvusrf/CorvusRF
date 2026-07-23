import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import type { PlanValue } from "./admin";

export async function getMyPlan(userId: string): Promise<PlanValue> {
  const { data, error } = await supabase.from("profiles").select("plan").eq("id", userId).single();
  if (error) throw error;
  return (data as { plan: PlanValue }).plan;
}

export async function startCheckout(): Promise<void> {
  const { url } = await invokeEdgeFunction<{ url: string }>("create-checkout-session", {});
  window.location.href = url;
}
