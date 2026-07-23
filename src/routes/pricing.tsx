import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { startCheckout, openBillingPortal, getMyBilling } from "@/lib/billing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — CorvusRF.ai" },
      {
        name: "description",
        content:
          "Simple pricing for CorvusRF.ai: free AI review, subscription for full report, and contingency-based protest filing.",
      },
      { property: "og:title", content: "CorvusRF.ai Pricing" },
      {
        property: "og:description",
        content: "Free AI review. Subscription for the full report. Contingency for filing.",
      },
    ],
  }),
  component: Page,
});

const PLANS = [
  {
    name: "Free AI Review",
    price: "$0",
    unit: "one property",
    tag: "No account required",
    features: [
      "Property validation & CAD match",
      "AI Property Health Score preview",
      "3 premium AI insight previews",
      "Google Maps location",
    ],
    cta: "Start Free Review",
    highlight: false,
  },
  {
    name: "AI Report",
    price: "$29",
    unit: "per year, all your properties",
    tag: "Most popular",
    features: [
      "All 10 premium AI modules unlocked",
      "AI Executive Protest Report",
      "AI Evidence Builder packet",
      "Deadline reminders & document library",
    ],
    cta: "Subscribe & Unlock",
    highlight: true,
  },
  {
    name: "Managed Protest",
    price: "25%",
    unit: "of tax savings",
    tag: "Contingency",
    features: [
      "CorvusRF-filed protest",
      "County communication + hearings",
      "Settlement approval workflow",
      "Annual savings report",
    ],
    cta: "Talk to Us",
    highlight: false,
  },
];

function Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checkingOut, setCheckingOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setAlreadySubscribed(false);
      setSubscriptionStatus(null);
      setCancelAtPeriodEnd(false);
      setCancelAt(null);
      return;
    }
    getMyBilling(user.id)
      .then(({ plan, subscriptionStatus, cancelAtPeriodEnd, cancelAt }) => {
        setAlreadySubscribed(plan === "ai_report" || plan === "managed_protest");
        setSubscriptionStatus(subscriptionStatus);
        setCancelAtPeriodEnd(cancelAtPeriodEnd);
        setCancelAt(cancelAt);
      })
      .catch(() => {
        setAlreadySubscribed(false);
        setSubscriptionStatus(null);
        setCancelAtPeriodEnd(false);
        setCancelAt(null);
      });
  }, [user]);

  const hasPaymentProblem = subscriptionStatus === "past_due" || subscriptionStatus === "unpaid";

  async function handleSubscribe() {
    if (!user) {
      navigate({ to: "/sign-in" });
      return;
    }
    setCheckingOut(true);
    try {
      await startCheckout();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start checkout. Please try again.",
      );
      setCheckingOut(false);
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

  return (
    <div className="container-page py-16">
      <div className="max-w-3xl">
        <span className="badge-soft">Pricing</span>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Simple pricing. AI included.</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free. Subscribe to unlock the full AI report. Only pay for managed protests when we
          save you money.
        </p>
      </div>
      {hasPaymentProblem && (
        <div className="mt-6 max-w-3xl rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          There's a problem with your last payment — update your billing details to keep your AI
          Report access.
        </div>
      )}
      {cancelAtPeriodEnd && (
        <div className="mt-6 max-w-3xl rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          Your AI Report subscription is set to cancel
          {cancelAt
            ? ` on ${new Date(cancelAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
            : " at the end of your current billing period"}
          . You'll keep full access until then — use Manage Subscription below if you'd like to
          resume it.
        </div>
      )}
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={`card-elev p-6 flex flex-col ${p.highlight ? "ring-2 ring-accent" : ""}`}
          >
            <div className="badge-soft self-start">{p.tag}</div>
            <h3 className="mt-3 font-serif text-2xl">{p.name}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">{p.price}</span>
              <span className="text-muted-foreground text-sm">{p.unit}</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {p.name === "AI Report" ? (
                alreadySubscribed ? (
                  <button
                    onClick={handleManageSubscription}
                    disabled={openingPortal}
                    className="w-full btn-outline disabled:opacity-60"
                  >
                    {openingPortal ? "Redirecting…" : "Manage Subscription"}
                  </button>
                ) : (
                  <button
                    onClick={handleSubscribe}
                    disabled={checkingOut}
                    className={`w-full ${p.highlight ? "btn-accent" : "btn-primary btn-primary-hover"} disabled:opacity-60`}
                  >
                    {checkingOut ? "Redirecting to checkout…" : p.cta}
                  </button>
                )
              ) : (
                <Link
                  to={p.name === "Managed Protest" ? "/contact" : "/"}
                  className={
                    p.highlight ? "btn-accent w-full" : "btn-primary btn-primary-hover w-full"
                  }
                >
                  {p.cta}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
