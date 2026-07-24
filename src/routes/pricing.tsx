import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { HeroBackground } from "@/components/HeroBackground";
import {
  startCheckout,
  openBillingPortal,
  resumeSubscription,
  getMyBilling,
  type PlanValue,
} from "@/lib/billing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — CorvusRF.ai" },
      {
        name: "description",
        content:
          "Simple per-property pricing for CorvusRF.ai: free AI review, Owner-Managed, or CorvusRF-Managed protest service.",
      },
      { property: "og:title", content: "CorvusRF.ai Pricing" },
      {
        property: "og:description",
        content: "Free AI review. Then $99 or $199 per property, per month.",
      },
    ],
  }),
  component: Page,
});

type Tier = "owner_managed" | "corvusrf_managed";

const PAID_PLANS: {
  tier: Tier;
  name: string;
  price: string;
  tag: string;
  features: string[];
  highlight: boolean;
}[] = [
  {
    tier: "owner_managed",
    name: "Owner-Managed",
    price: "$99",
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
    name: "CorvusRF-Managed",
    price: "$199",
    tag: "White glove",
    features: [
      "Everything in Owner-Managed",
      "CorvusRF staff files your protest",
      "County communication + hearing representation",
      "Settlement approval workflow",
    ],
    highlight: false,
  },
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
  const [subscriptionQuantity, setSubscriptionQuantity] = useState(1);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

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
        setSubscriptionQuantity(b.subscriptionQuantity);
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

  async function handleSubscribe(tier: Tier) {
    if (!user) {
      navigate({ to: "/sign-in" });
      return;
    }
    setCheckingOutTier(tier);
    try {
      await startCheckout(tier, quantity);
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
    <div className="relative overflow-hidden min-h-[70vh]">
      <HeroBackground blurred />
      <div className="container-page py-16">
      <div className="max-w-3xl">
        <span className="badge-soft">Pricing</span>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Simple, per-property pricing.</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free. Pick Owner-Managed to do it yourself with AI, or CorvusRF-Managed to have our
          staff file and represent you. Priced per property, billed monthly.
        </p>
      </div>
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
          You're subscribed for {subscriptionQuantity} propert{subscriptionQuantity === 1 ? "y" : "ies"}.
          Manage your plan, quantity, or payment method below.
        </div>
      )}

      {!alreadySubscribed && (
        <div className="mt-8 flex items-center gap-3 max-w-md">
          <label className="text-sm font-medium" htmlFor="property-qty">
            Number of properties
          </label>
          <input
            id="property-qty"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <div className="card-elev p-6 flex flex-col">
          <div className="badge-soft self-start">No account required</div>
          <h3 className="mt-3 font-serif text-2xl">Free AI Review</h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-semibold">$0</span>
            <span className="text-muted-foreground text-sm">one property</span>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "Property validation & CAD match",
              "AI Property Health Score preview",
              "3 premium AI insight previews",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Link to="/" className="btn-primary btn-primary-hover w-full">
              Start Free Review
            </Link>
          </div>
        </div>

        {PAID_PLANS.map((p) => (
          <div
            key={p.tier}
            className={`card-elev p-6 flex flex-col ${p.highlight ? "ring-2 ring-accent" : ""}`}
          >
            <div className="badge-soft self-start">{p.tag}</div>
            <h3 className="mt-3 font-serif text-2xl">{p.name}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">{p.price}</span>
              <span className="text-muted-foreground text-sm">/mo, per property</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
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
                  disabled={checkingOutTier !== null}
                  className={`w-full ${p.highlight ? "btn-accent" : "btn-primary btn-primary-hover"} disabled:opacity-60`}
                >
                  {checkingOutTier === p.tier
                    ? "Redirecting to checkout…"
                    : `Subscribe — $${p.tier === "owner_managed" ? 99 * quantity : 199 * quantity}/mo`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
