// Deploy via CLI: `supabase functions deploy create-checkout-session`.
// Requires only STRIPE_SECRET_KEY — no per-bracket Stripe Price id secrets.
// Prices are computed here and passed to Stripe as price_data (ad hoc, no
// pre-created Price/Product needed), so the 15%-off-2nd-property-per-bracket
// discount can be applied per line item. This mirrors TIER_BRACKET_PRICES /
// ADDITIONAL_PROPERTY_DISCOUNT / bracketLineTotal in src/lib/billing.ts,
// which a Deno function can't import directly — keep both in sync by hand.
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
type Bracket = "under2m" | "mid2m10m" | "over10m";
const BRACKETS: Bracket[] = ["under2m", "mid2m10m", "over10m"];

const TIER_LABEL: Record<Tier, string> = {
  owner_managed: "Owner-Managed",
  corvusrf_managed: "CorvusPT-Managed",
};

// "over10m" is the capped $10M-$25M bracket — see billing.ts.
const BRACKET_LABEL: Record<Bracket, string> = {
  under2m: "$0 - $2M",
  mid2m10m: "$2M - $10M",
  over10m: "$10M - $25M",
};

const TIER_BRACKET_PRICES: Record<Tier, Record<Bracket, number>> = {
  owner_managed: { under2m: 99, mid2m10m: 299, over10m: 499 },
  corvusrf_managed: { under2m: 199, mid2m10m: 499, over10m: 799 },
};

const ADDITIONAL_PROPERTY_DISCOUNT = 0.15;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tier, brackets, successPath, cancelPath } = (await req.json()) as {
      tier?: Tier;
      brackets?: Partial<Record<Bracket, number>>;
      successPath?: string;
      cancelPath?: string;
    };
    if (tier !== "owner_managed" && tier !== "corvusrf_managed") {
      return new Response(
        JSON.stringify({ error: "tier must be owner_managed or corvusrf_managed" }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }
    // Only ever appended to a server-validated origin below, never used as a whole
    // URL — but requiring a leading "/" (not "//", which a browser would treat as
    // protocol-relative) keeps this from being coaxed into pointing off-origin.
    const safePath = (p: string | undefined, fallback: string) =>
      p && p.startsWith("/") && !p.startsWith("//") ? p : fallback;

    const qty: Record<Bracket, number> = { under2m: 0, mid2m10m: 0, over10m: 0 };
    for (const b of BRACKETS) {
      const raw = brackets?.[b];
      qty[b] = Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : 0;
    }
    if (BRACKETS.every((b) => qty[b] === 0)) {
      return new Response(
        JSON.stringify({ error: "At least one property-value bracket must have a quantity" }),
        { status: 400, headers: corsHeaders },
      );
    }

    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) throw new Error("Missing STRIPE_SECRET_KEY");

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    for (const b of BRACKETS) {
      if (qty[b] === 0) continue;
      const basePrice = TIER_BRACKET_PRICES[tier][b];
      const baseCents = Math.round(basePrice * 100);
      const name = `${TIER_LABEL[tier]} — ${BRACKET_LABEL[b]}`;
      // 1st property in this bracket at full price; every additional one at
      // 15% off (see ADDITIONAL_PROPERTY_DISCOUNT above). Two line items
      // instead of one so each unit's price is exact — Stripe quantities
      // don't support a per-unit price break within a single line item.
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: baseCents,
          recurring: { interval: "month" },
          product_data: { name, metadata: { tier, bracket: b } },
        },
      });
      if (qty[b] > 1) {
        const discountedCents = Math.round(baseCents * (1 - ADDITIONAL_PROPERTY_DISCOUNT));
        line_items.push({
          quantity: qty[b] - 1,
          price_data: {
            currency: "usd",
            unit_amount: discountedCents,
            recurring: { interval: "month" },
            product_data: {
              name: `${name} (2nd+ property, 15% off)`,
              metadata: { tier, bracket: b },
            },
          },
        });
      }
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
      line_items,
      client_reference_id: user.id,
      customer: profile?.stripe_customer_id ?? undefined,
      customer_email: profile?.stripe_customer_id ? undefined : (user.email ?? undefined),
      subscription_data: { metadata: { tier } },
      metadata: { tier },
      success_url: `${origin}${safePath(successPath, "/dashboard?checkout=success")}`,
      cancel_url: `${origin}${safePath(cancelPath, "/pricing")}`,
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
