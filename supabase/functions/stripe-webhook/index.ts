// Deploy via CLI: `supabase functions deploy stripe-webhook`.
// Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET secrets. After deploying, add
// this function's URL as a webhook endpoint in the Stripe Dashboard, subscribed to
// checkout.session.completed, customer.subscription.updated, and
// customer.subscription.deleted.
//
// No Supabase auth here — Stripe calls this directly and authenticates via an HMAC
// signature (verified below) instead of a Supabase JWT. The service-role client is
// used to write to profiles, bypassing RLS, since there is no end-user session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Content-Type": "application/json",
};

// Same 6 bracket-specific Price id secrets create-checkout-session uses, read
// here too so a subscription's line items (each pinned to one of these six
// Price ids) can be mapped back to "how many properties in which bracket" —
// see BRACKET_COLUMN below. The old flat-rate STRIPE_PRICE_ID_OWNER_MANAGED/
// STRIPE_PRICE_ID_CORVUSRF_MANAGED prices (same $99/$199 amounts as the
// $0-$2M bracket, and what create-checkout-session falls back to for that
// bracket when the dedicated secret isn't set) are registered as the same
// qty_under_2m bucket too, so both old and new $0-$2M subscriptions count
// correctly. Anything matching neither still counts toward
// subscription_quantity below, just without a bracket breakdown.
const BRACKET_COLUMN: Record<string, "qty_under_2m" | "qty_2m_10m" | "qty_over_10m"> = {};
function registerBracketPrice(envVar: string, column: "qty_under_2m" | "qty_2m_10m" | "qty_over_10m") {
  const id = Deno.env.get(envVar);
  if (id) BRACKET_COLUMN[id] = column;
}
registerBracketPrice("STRIPE_PRICE_ID_OWNER_UNDER_2M", "qty_under_2m");
registerBracketPrice("STRIPE_PRICE_ID_OWNER_MANAGED", "qty_under_2m");
registerBracketPrice("STRIPE_PRICE_ID_CORVUSRF_MANAGED", "qty_under_2m");
registerBracketPrice("STRIPE_PRICE_ID_OWNER_MID_2M_10M", "qty_2m_10m");
registerBracketPrice("STRIPE_PRICE_ID_OWNER_OVER_10M", "qty_over_10m");
registerBracketPrice("STRIPE_PRICE_ID_MANAGED_UNDER_2M", "qty_under_2m");
registerBracketPrice("STRIPE_PRICE_ID_MANAGED_MID_2M_10M", "qty_2m_10m");
registerBracketPrice("STRIPE_PRICE_ID_MANAGED_OVER_10M", "qty_over_10m");

// Sums every line item's quantity (a subscription now has up to 3 — one per
// non-empty value bracket — instead of always exactly 1) for the total, and
// separately buckets each line item's quantity into its matching bracket
// column via BRACKET_COLUMN above.
function summarizeItems(items: Stripe.SubscriptionItem[]) {
  const totals = { qty_under_2m: 0, qty_2m_10m: 0, qty_over_10m: 0 };
  let quantity = 0;
  for (const item of items) {
    const q = item.quantity ?? 0;
    quantity += q;
    const priceId = typeof item.price === "string" ? item.price : item.price?.id;
    const column = priceId ? BRACKET_COLUMN[priceId] : undefined;
    if (column) totals[column] += q;
  }
  return { quantity: quantity || 1, ...totals };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    return new Response(JSON.stringify({ error: "Missing Stripe secrets" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

  // Signature verification needs the raw, unparsed body — read as text first.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const tier = session.metadata?.tier === "corvusrf_managed" ? "corvusrf_managed" : "owner_managed";
      if (userId) {
        let summary = summarizeItems([]);
        if (typeof session.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          summary = summarizeItems(sub.items.data);
        }
        await adminClient
          .from("profiles")
          .update({
            plan: tier,
            subscription_status: "active",
            subscription_quantity: summary.quantity,
            qty_under_2m: summary.qty_under_2m,
            qty_2m_10m: summary.qty_2m_10m,
            qty_over_10m: summary.qty_over_10m,
            stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
            stripe_subscription_id:
              typeof session.subscription === "string" ? session.subscription : null,
          })
          .eq("id", userId);
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
      if (customerId) {
        const tier =
          subscription.metadata?.tier === "corvusrf_managed" ? "corvusrf_managed" : "owner_managed";
        const summary = summarizeItems(subscription.items.data);
        const update: Record<string, string | number | boolean | null> = {
          subscription_status: subscription.status,
          subscription_quantity: summary.quantity,
          qty_under_2m: summary.qty_under_2m,
          qty_2m_10m: summary.qty_2m_10m,
          qty_over_10m: summary.qty_over_10m,
          cancel_at_period_end: subscription.cancel_at_period_end,
          cancel_at: subscription.cancel_at
            ? new Date(subscription.cancel_at * 1000).toISOString()
            : null,
        };
        if (subscription.status === "active") update.plan = tier;
        if (subscription.status === "canceled") update.plan = "free_ai_review";
        await adminClient.from("profiles").update(update).eq("stripe_customer_id", customerId);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
      if (customerId) {
        await adminClient
          .from("profiles")
          .update({
            plan: "free_ai_review",
            subscription_status: "canceled",
            subscription_quantity: 1,
            qty_under_2m: 0,
            qty_2m_10m: 0,
            qty_over_10m: 0,
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq("stripe_customer_id", customerId);
      }
    }
    // All other event types are intentionally ignored but still return 200 below so
    // Stripe doesn't keep retrying events we don't act on.

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Webhook handler failed", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
