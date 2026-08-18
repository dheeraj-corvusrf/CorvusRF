// Deploy via CLI: `supabase functions deploy create-checkout-session`.
// Requires STRIPE_SECRET_KEY and 6 real Stripe Price id secrets — one per
// (tier, property-value-bracket) combination, all monthly recurring prices
// created in the Stripe Dashboard:
//   STRIPE_PRICE_ID_OWNER_UNDER_2M     ($99/mo,  Owner-Managed,   $0-$2M)
//   STRIPE_PRICE_ID_OWNER_MID_2M_10M   ($299/mo, Owner-Managed,   $2M-$10M)
//   STRIPE_PRICE_ID_OWNER_OVER_10M     ($499/mo, Owner-Managed,   $10M+)
//   STRIPE_PRICE_ID_MANAGED_UNDER_2M   ($199/mo, CorvusPT-Managed, $0-$2M)
//   STRIPE_PRICE_ID_MANAGED_MID_2M_10M ($499/mo, CorvusPT-Managed, $2M-$10M)
//   STRIPE_PRICE_ID_MANAGED_OVER_10M   ($699/mo, CorvusPT-Managed, $10M+)
// The $0-$2M pair (STRIPE_PRICE_ID_OWNER_UNDER_2M / _MANAGED_UNDER_2M) is
// optional — they already exist under their old flat-rate names from before
// this bracket pricing overhaul (STRIPE_PRICE_ID_OWNER_MANAGED /
// STRIPE_PRICE_ID_CORVUSRF_MANAGED, $99/$199, same amounts as the $0-$2M
// bracket), so priceIdFor() below falls back to those rather than requiring
// the same two Prices to be re-created under new secret names.
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

const PRICE_ENV_VAR: Record<Tier, Record<Bracket, string>> = {
  owner_managed: {
    under2m: "STRIPE_PRICE_ID_OWNER_UNDER_2M",
    mid2m10m: "STRIPE_PRICE_ID_OWNER_MID_2M_10M",
    over10m: "STRIPE_PRICE_ID_OWNER_OVER_10M",
  },
  corvusrf_managed: {
    under2m: "STRIPE_PRICE_ID_MANAGED_UNDER_2M",
    mid2m10m: "STRIPE_PRICE_ID_MANAGED_MID_2M_10M",
    over10m: "STRIPE_PRICE_ID_MANAGED_OVER_10M",
  },
};

// The under2m bracket alone also has a legacy fallback secret name (see the
// header comment above).
const LEGACY_UNDER_2M_ENV_VAR: Record<Tier, string> = {
  owner_managed: "STRIPE_PRICE_ID_OWNER_MANAGED",
  corvusrf_managed: "STRIPE_PRICE_ID_CORVUSRF_MANAGED",
};

function priceIdFor(tier: Tier, bracket: Bracket): string | undefined {
  const id = Deno.env.get(PRICE_ENV_VAR[tier][bracket]);
  if (id) return id;
  if (bracket === "under2m") return Deno.env.get(LEGACY_UNDER_2M_ENV_VAR[tier]);
  return undefined;
};

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
      return new Response(JSON.stringify({ error: "tier must be owner_managed or corvusrf_managed" }), {
        status: 400,
        headers: corsHeaders,
      });
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

    const line_items: { price: string; quantity: number }[] = [];
    for (const b of BRACKETS) {
      if (qty[b] === 0) continue;
      const priceId = priceIdFor(tier, b);
      if (!priceId) throw new Error(`Missing ${PRICE_ENV_VAR[tier][b]} secret`);
      line_items.push({ price: priceId, quantity: qty[b] });
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
