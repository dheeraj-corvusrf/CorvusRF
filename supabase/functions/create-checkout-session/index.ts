// Deploy via CLI: `supabase functions deploy create-checkout-session`.
// Requires STRIPE_SECRET_KEY, STRIPE_PRICE_ID_OWNER_MANAGED, and
// STRIPE_PRICE_ID_CORVUSRF_MANAGED secrets — the two real per-property monthly
// Price ids created in the Stripe Dashboard ($99/mo and $199/mo respectively).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Without this, supabase-js's functions.invoke() parses the body as plain text
  // (a JSON string) instead of a parsed object, based on the response Content-Type.
  "Content-Type": "application/json",
};

type Tier = "owner_managed" | "corvusrf_managed";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tier, quantity } = (await req.json()) as { tier?: Tier; quantity?: number };
    if (tier !== "owner_managed" && tier !== "corvusrf_managed") {
      return new Response(JSON.stringify({ error: "tier must be owner_managed or corvusrf_managed" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    const qty = Number.isInteger(quantity) && (quantity as number) > 0 ? (quantity as number) : 1;

    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId =
      tier === "owner_managed"
        ? Deno.env.get("STRIPE_PRICE_ID_OWNER_MANAGED")
        : Deno.env.get("STRIPE_PRICE_ID_CORVUSRF_MANAGED");
    if (!secretKey || !priceId) {
      throw new Error(
        `Missing STRIPE_SECRET_KEY or price id secret for ${tier}`,
      );
    }

    // Identify the caller from their own JWT (forwarded from the client's session) —
    // subscriptions must be tied to a real signed-in user, same auth pattern as the
    // admin-create-user/admin-delete-user functions.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await adminClient
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: qty }],
      client_reference_id: user.id,
      customer: profile?.stripe_customer_id ?? undefined,
      customer_email: profile?.stripe_customer_id ? undefined : (user.email ?? undefined),
      subscription_data: { metadata: { tier } },
      metadata: { tier },
      success_url: `${origin}/CorvusRF/dashboard?checkout=success`,
      cancel_url: `${origin}/CorvusRF/pricing`,
    });

    if (!session.url) throw new Error("Stripe did not return a Checkout URL");

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
