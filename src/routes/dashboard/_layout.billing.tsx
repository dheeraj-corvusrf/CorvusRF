import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  getMyBilling,
  openBillingPortal,
  resumeSubscription,
  PLAN_OPTIONS,
  type PlanValue,
} from "@/lib/billing";

export const Route = createFileRoute("/dashboard/_layout/billing")({
  component: Billing,
});

function Billing() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<PlanValue | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [subscriptionQuantity, setSubscriptionQuantity] = useState(1);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (!user) return;
    getMyBilling(user.id)
      .then((b) => {
        setPlan(b.plan);
        setSubscriptionStatus(b.subscriptionStatus);
        setSubscriptionQuantity(b.subscriptionQuantity);
        setCancelAtPeriodEnd(b.cancelAtPeriodEnd);
        setCancelAt(b.cancelAt);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleManage() {
    setOpeningPortal(true);
    try {
      await openBillingPortal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal.");
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
      toast.error(err instanceof Error ? err.message : "Could not resume your subscription.");
    } finally {
      setResuming(false);
    }
  }

  const isPaid = plan && plan !== "free_ai_review";
  const planLabel = PLAN_OPTIONS.find((o) => o.value === plan)?.label ?? plan;
  const hasPaymentProblem = subscriptionStatus === "past_due" || subscriptionStatus === "unpaid";

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold">Billing</h1>
      <p className="text-muted-foreground text-sm">Your CorvusRF subscription.</p>

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-6 card-elev p-6 max-w-xl">
          {hasPaymentProblem && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              There's a problem with your last payment — update your billing details to keep your
              subscription active.
            </div>
          )}
          {cancelAtPeriodEnd && (
            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              Your subscription is set to cancel
              {cancelAt
                ? ` on ${new Date(cancelAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
                : " at the end of your current billing period"}
              . Click Resubscribe if you'd like to keep it going.
            </div>
          )}

          <div className="text-xs text-muted-foreground uppercase tracking-wide">Current plan</div>
          <div className="mt-1 font-serif text-2xl font-semibold">{planLabel}</div>
          {isPaid && (
            <p className="mt-1 text-sm text-muted-foreground">
              {subscriptionQuantity} propert{subscriptionQuantity === 1 ? "y" : "ies"}
            </p>
          )}

          <div className="mt-6 grid gap-2 sm:flex sm:flex-wrap">
            {isPaid ? (
              <>
                {cancelAtPeriodEnd && (
                  <button
                    onClick={handleResume}
                    disabled={resuming}
                    className="btn-accent disabled:opacity-60"
                  >
                    {resuming ? "Resuming…" : "Resubscribe"}
                  </button>
                )}
                <button onClick={handleManage} disabled={openingPortal} className="btn-outline disabled:opacity-60">
                  {openingPortal ? "Redirecting…" : "Manage Subscription"}
                </button>
                <Link to="/pricing" className="btn-outline">
                  Compare Plans
                </Link>
              </>
            ) : (
              <Link to="/pricing" className="btn-primary btn-primary-hover">
                Upgrade Your Plan
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
