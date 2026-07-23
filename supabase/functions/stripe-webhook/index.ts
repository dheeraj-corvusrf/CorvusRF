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
        let quantity = 1;
        if (typeof session.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          quantity = sub.items.data[0]?.quantity ?? 1;
        }
        await adminClient
          .from("profiles")
          .update({
            plan: tier,
            subscription_status: "active",
            subscription_quantity: quantity,
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
        const update: Record<string, string | number | boolean | null> = {
          subscription_status: subscription.status,
          subscription_quantity: subscription.items.data[0]?.quantity ?? 1,
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
