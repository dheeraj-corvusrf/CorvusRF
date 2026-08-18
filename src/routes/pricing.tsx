import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ScrollReveal } from "@/components/ScrollReveal";
import {
  startCheckout,
  openBillingPortal,
  resumeSubscription,
  getMyBilling,
  bracketMonthlyTotal,
  bracketPropertyCount,
  EMPTY_BRACKETS,
  VALUE_BRACKETS,
  TIER_BRACKET_PRICES,
  type PlanValue,
  type Tier,
  type BracketQuantities,
  type PropertyValueBracket,
} from "@/lib/billing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — CorvusPT.ai" },
      {
        name: "description",
        content:
          "Property-value-tiered pricing for CorvusPT.ai: free AI review, Owner-Managed, or CorvusPT-Managed protest service.",
      },
      { property: "og:title", content: "CorvusPT.ai Pricing" },
      {
        property: "og:description",
        content: "Free AI review. Then $99–$699/mo per property, priced by property value.",
      },
    ],
  }),
  component: Page,
});

const PAID_PLANS: {
  tier: Tier;
  name: string;
  tag: string;
  features: string[];
  highlight: boolean;
}[] = [
  {
    tier: "owner_managed",
    name: "Owner-Managed",
    tag: "Most popular",
    features: [
      "All 10 premium AI modules unlocked, per property",
      "AI Executive Protest Report",
      "AI Evidence Builder packet",
      "You file and represent yourself, AI-assisted",
    ],
    highlight: true,
  },
  {
    tier: "corvusrf_managed",
    name: "CorvusPT-Managed",
    tag: "White glove",
    features: [
      "Everything in Owner-Managed",
      "CorvusPT staff files your protest",
      "County communication + hearing representation",
      "Settlement approval workflow",
    ],
    highlight: false,
  },
];

// One box per exact price point, in ascending price order (interleaving
// tiers rather than grouping by tier: 99, 199, 299, 499, 499, 699) — the
// $0 Free tier is rendered as its own leading box, for 7 total.
const PRICE_BOXES: { tier: Tier; bracket: PropertyValueBracket }[] = [
  { tier: "owner_managed", bracket: "under2m" },
  { tier: "corvusrf_managed", bracket: "under2m" },
  { tier: "owner_managed", bracket: "mid2m10m" },
  { tier: "owner_managed", bracket: "over10m" },
  { tier: "corvusrf_managed", bracket: "mid2m10m" },
  { tier: "corvusrf_managed", bracket: "over10m" },
];

const SUBSCRIBED_PLANS: PlanValue[] = ["owner_managed", "corvusrf_managed", "ai_report", "managed_protest"];

// "ai_report" (flat-rate, self-file) and "managed_protest" (contingency, staff-filed)
// are the legacy tiers this pricing overhaul replaced — mapped to their closest
// current equivalent so a pre-existing subscriber's card still highlights correctly
// instead of matching neither of the two current tiers.
const CURRENT_TIER: Partial<Record<PlanValue, Tier>> = {
  owner_managed: "owner_managed",
  ai_report: "owner_managed",
  corvusrf_managed: "corvusrf_managed",
  managed_protest: "corvusrf_managed",
};

function Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checkingOutTier, setCheckingOutTier] = useState<Tier | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlanValue | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [subscriptionBrackets, setSubscriptionBrackets] = useState<BracketQuantities>(EMPTY_BRACKETS);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);
  // Separate quantities per tier, not one shared set — a property you'd put
  // on Owner-Managed isn't necessarily the same one you'd put on
  // CorvusPT-Managed, so each card gets its own 3 bracket inputs (6 boxes
  // total) rather than both cards pricing the same shared property list.
  const [ownerBrackets, setOwnerBrackets] = useState<BracketQuantities>(EMPTY_BRACKETS);
  const [managedBrackets, setManagedBrackets] = useState<BracketQuantities>(EMPTY_BRACKETS);

  useEffect(() => {
    // Stripe Checkout/Portal are separate origins, so hitting the browser Back button
    // after starting one commonly restores this page from the back-forward cache
    // instead of reloading it — freezing the button mid-"Redirecting…" forever. The
    // pageshow event's persisted flag is exactly how you detect a bfcache restore.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        setCheckingOutTier(null);
        setOpeningPortal(false);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (!user) {
      setCurrentPlan(null);
      setSubscriptionStatus(null);
      setCancelAtPeriodEnd(false);
      setCancelAt(null);
      return;
    }
    getMyBilling(user.id)
      .then((b) => {
        setCurrentPlan(b.plan);
        setSubscriptionStatus(b.subscriptionStatus);
        setSubscriptionBrackets(b.subscriptionBrackets);
        setCancelAtPeriodEnd(b.cancelAtPeriodEnd);
        setCancelAt(b.cancelAt);
      })
      .catch(() => {
        setCurrentPlan(null);
        setSubscriptionStatus(null);
        setCancelAtPeriodEnd(false);
        setCancelAt(null);
      });
  }, [user]);

  const alreadySubscribed = !!currentPlan && SUBSCRIBED_PLANS.includes(currentPlan);
  const currentTier = currentPlan ? CURRENT_TIER[currentPlan] : undefined;
  const hasPaymentProblem = subscriptionStatus === "past_due" || subscriptionStatus === "unpaid";
  const subscribedCount = bracketPropertyCount(subscriptionBrackets);

  function bracketsFor(tier: Tier): BracketQuantities {
    return tier === "owner_managed" ? ownerBrackets : managedBrackets;
  }
  function setBracketQty(tier: Tier, bracket: PropertyValueBracket, value: number) {
    const setter = tier === "owner_managed" ? setOwnerBrackets : setManagedBrackets;
    setter((prev) => ({ ...prev, [bracket]: Math.max(0, value) }));
  }

  async function handleSubscribe(tier: Tier) {
    if (!user) {
      navigate({ to: "/sign-in" });
      return;
    }
    setCheckingOutTier(tier);
    try {
      await startCheckout(tier, bracketsFor(tier));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start checkout. Please try again.",
      );
      setCheckingOutTier(null);
    }
  }

  async function handleManageSubscription() {
    setOpeningPortal(true);
    try {
      await openBillingPortal();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open billing portal. Please try again.",
      );
      setOpeningPortal(false);
    }
  }

  async function handleResume() {
    setResuming(true);
    try {
      await resumeSubscription();
      setCancelAtPeriodEnd(false);
      setCancelAt(null);
      toast.success("Your subscription will continue — it's no longer set to cancel.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not resume your subscription. Please try again.",
      );
    } finally {
      setResuming(false);
    }
  }

  return (
    <div>
      <div className="container-page pt-16">
        <div className="max-w-3xl">
          <span className="badge-soft">Pricing</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Pricing that scales with property value.</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Start free. Pick Owner-Managed to do it yourself with AI, or CorvusPT-Managed to have our
            staff file and represent you. Priced per property, by property value, billed monthly.
          </p>
        </div>
      </div>

      <div className="container-page pb-16">
      {hasPaymentProblem && (
        <div className="mt-6 max-w-3xl rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          There's a problem with your last payment — update your billing details to keep your
          subscription active.
        </div>
      )}
      {cancelAtPeriodEnd && (
        <div className="mt-6 max-w-3xl rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          Your subscription is set to cancel
          {cancelAt
            ? ` on ${new Date(cancelAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
            : " at the end of your current billing period"}
          . You'll keep full access until then — click Resubscribe below if you'd like to keep
          it going.
        </div>
      )}
      {alreadySubscribed && (
        <div className="mt-6 max-w-3xl rounded-lg border border-border bg-secondary/40 p-4 text-sm">
          <p>
            You're subscribed for {subscribedCount} propert{subscribedCount === 1 ? "y" : "ies"}.
          </p>
          <ul className="mt-1 text-muted-foreground">
            {VALUE_BRACKETS.filter((b) => subscriptionBrackets[b.value] > 0).map((b) => (
              <li key={b.value}>
                {subscriptionBrackets[b.value]} × {b.label}
              </li>
            ))}
          </ul>
          <p className="mt-2">Manage your plan, brackets, or payment method below.</p>
        </div>
      )}

      {!alreadySubscribed && (
        <>
        <div className="mt-8 text-sm font-medium">How many properties, by price?</div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <ScrollReveal>
          <div className="card-elev p-4 flex flex-col items-center text-center gap-1 h-full">
            <div className="text-2xl font-semibold">$0</div>
            <div className="text-xs font-medium">Free AI Review</div>
            <div className="text-xs text-muted-foreground">one property</div>
            <Link to="/" className="btn-outline text-xs mt-2 w-full py-1.5">
              Start Free Review
            </Link>
          </div>
          </ScrollReveal>

          {PRICE_BOXES.map((box, i) => {
            const bracketLabel = VALUE_BRACKETS.find((b) => b.value === box.bracket)!.label;
            const tierName = box.tier === "owner_managed" ? "Owner-Managed" : "CorvusPT-Managed";
            const price = TIER_BRACKET_PRICES[box.tier][box.bracket];
            const brackets = bracketsFor(box.tier);
            return (
              <ScrollReveal key={`${box.tier}-${box.bracket}`} delay={(i + 1) * 60}>
              <div className="card-elev p-4 flex flex-col items-center text-center gap-1 h-full">
                <div className="text-2xl font-semibold">${price}</div>
                <div className="text-xs font-medium">{tierName}</div>
                <div className="text-xs text-muted-foreground">{bracketLabel}</div>
                <label htmlFor={`qty-${box.tier}-${box.bracket}`} className="sr-only">
                  {tierName} {bracketLabel} quantity
                </label>
                <input
                  id={`qty-${box.tier}-${box.bracket}`}
                  type="number"
                  min={0}
                  value={brackets[box.bracket]}
                  onChange={(e) =>
                    setBracketQty(box.tier, box.bracket, parseInt(e.target.value, 10) || 0)
                  }
                  className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center"
                />
              </div>
              </ScrollReveal>
            );
          })}
        </div>
        </>
      )}

      <div className={`mt-8 grid gap-5 ${alreadySubscribed ? "md:grid-cols-2" : "md:grid-cols-2"}`}>
        {PAID_PLANS.map((p) => {
          const isWhiteGlove = p.tier === "corvusrf_managed";
          const tierBrackets = bracketsFor(p.tier);
          const monthlyTotal = bracketMonthlyTotal(p.tier, tierBrackets);
          const propertyCount = bracketPropertyCount(tierBrackets);
          return (
          <div
            key={p.tier}
            className={`card-elev p-6 flex flex-col h-full transition-all hover:-translate-y-0.5 hover:shadow-elev ${p.highlight ? "ring-2 ring-accent" : isWhiteGlove ? "ring-2 ring-warning/60" : ""}`}
          >
            <div className={isWhiteGlove ? "badge-soft-warning self-start" : "badge-soft self-start"}>{p.tag}</div>
            <h3 className="mt-3 font-serif text-2xl">{p.name}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">
                ${TIER_BRACKET_PRICES[p.tier].under2m}–${TIER_BRACKET_PRICES[p.tier].over10m}
              </span>
              <span className="text-muted-foreground text-sm">/mo, per property</span>
            </div>
            {alreadySubscribed && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {VALUE_BRACKETS.map((b) => (
                  <li key={b.value}>
                    {b.label}: ${TIER_BRACKET_PRICES[p.tier][b.value]}/mo
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${isWhiteGlove ? "bg-warning" : "bg-accent"}`} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-2">
              {currentTier === p.tier ? (
                cancelAtPeriodEnd ? (
                  // Scheduled to cancel — two distinct actions rather than one button,
                  // since "keep it" and "manage billing details" are different intents.
                  <>
                    <button
                      onClick={handleResume}
                      disabled={resuming}
                      className="w-full btn-accent disabled:opacity-60"
                    >
                      {resuming ? "Resuming…" : "Resubscribe"}
                    </button>
                    <button
                      onClick={handleManageSubscription}
                      disabled={openingPortal}
                      className="w-full btn-outline disabled:opacity-60"
                    >
                      {openingPortal ? "Redirecting…" : "Manage Subscription"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleManageSubscription}
                    disabled={openingPortal}
                    className="w-full btn-outline disabled:opacity-60"
                  >
                    {openingPortal ? "Redirecting…" : "Manage Subscription"}
                  </button>
                )
              ) : alreadySubscribed ? (
                // Subscribed, but to the *other* tier — switching plans is a change to
                // the existing subscription, not a brand new checkout, so this also
                // opens the billing portal rather than starting a second subscription.
                <button
                  onClick={handleManageSubscription}
                  disabled={openingPortal}
                  className="w-full btn-outline disabled:opacity-60"
                >
                  {openingPortal ? "Redirecting…" : `Switch to ${p.name}`}
                </button>
              ) : (
                <button
                  onClick={() => handleSubscribe(p.tier)}
                  disabled={checkingOutTier !== null || propertyCount === 0}
                  className={`w-full ${p.highlight ? "btn-accent" : "btn-primary btn-primary-hover"} disabled:opacity-60`}
                >
                  {checkingOutTier === p.tier
                    ? "Redirecting to checkout…"
                    : propertyCount === 0
                      ? "Add at least one property above"
                      : `Subscribe — $${monthlyTotal}/mo`}
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
