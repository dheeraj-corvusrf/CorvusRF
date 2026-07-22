import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { readIntake, currency, type IntakeState } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Your Dashboard — CorvusRF.ai" },
      { name: "description", content: "Your Texas property tax dashboard: properties, protests, documents, and savings." },
      { property: "og:title", content: "CorvusRF Dashboard" },
      { property: "og:description", content: "Your Texas property tax dashboard." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/sign-in" });
      return;
    }
    setState(readIntake());
  }, [loading, user, nav]);

  const hasProperty = !!state.confirmed;
  const tabs = ["My Commercial Properties", "AI Reports", "Active Protests", "Documents", "Notifications"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);

  if (loading || !user) return null;

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="badge-soft">Your Journey</span>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Welcome back.</h1>
          <p className="text-muted-foreground">Every property, protest, deadline, and dollar — connected.</p>
        </div>
        <Link to="/intake" className="btn-primary btn-primary-hover">Add another property</Link>
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px ${
              tab === t ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "My Commercial Properties" && (
          <>
            {hasProperty ? (
              <div className="card-elev p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs text-muted-foreground">{state.cad}</div>
                    <h3 className="font-serif text-xl font-semibold">{state.address}</h3>
                    <p className="text-sm text-muted-foreground">
                      {state.propertyType} • Acct {state.accountNumber} • Tax year {state.taxYear}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Assessed value</div>
                    <div className="text-2xl font-semibold">{currency(state.totalValue)}</div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap">
                  <Link to="/ai-report" className="btn-primary btn-primary-hover">Open AI Report</Link>
                  <Link to="/pricing" className="btn-outline">Upgrade</Link>
                </div>
              </div>
            ) : (
              <EmptyState />
            )}
          </>
        )}
        {tab === "AI Reports" && (
          hasProperty ? (
            <Link to="/ai-report" className="card-elev p-5 flex items-center justify-between hover:bg-secondary/40">
              <div>
                <div className="font-medium">AI Property Review — {state.address}</div>
                <div className="text-xs text-muted-foreground">10 modules • preview available</div>
              </div>
              <span className="btn-outline text-sm">Open</span>
            </Link>
          ) : <EmptyState />
        )}
        {tab === "Active Protests" && <PlaceholderPanel label="No active protests yet. Start with an AI review." />}
        {tab === "Documents" && <PlaceholderPanel label="Documents you upload will appear here — notices, evidence, and filings." />}
        {tab === "Notifications" && <PlaceholderPanel label="You're all caught up. We'll notify you about deadlines and status changes." />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card-elev p-8 text-center">
      <h3 className="font-serif text-xl font-semibold">No properties yet.</h3>
      <p className="text-muted-foreground mt-1">Start with an address or upload an appraisal notice.</p>
      <Link to="/intake" className="btn-primary btn-primary-hover mt-4 inline-flex">Start Free AI Property Review</Link>
    </div>
  );
}

function PlaceholderPanel({ label }: { label: string }) {
  return <div className="card-elev p-8 text-center text-muted-foreground">{label}</div>;
}
