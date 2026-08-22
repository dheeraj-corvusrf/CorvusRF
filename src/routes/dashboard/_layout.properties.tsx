import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { currency, resetIntake, updateIntake } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { useSavingsBackfill } from "@/hooks/use-savings-backfill";
import { listProtests, type ProtestRecord, type ProtestStatus } from "@/lib/protests";
import { listHealthScores, type PropertyAiScore } from "@/lib/property-scores";
import { getPropertyProtestStatus, type ActionStatus } from "@/lib/portfolio-status";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtestAuthorizationFlow } from "@/components/ProtestAuthorizationFlow";
import { PortfolioTabs } from "@/components/PortfolioTabs";
import { CaseDetailModal } from "@/components/CaseDetailModal";
import { generateCasePrep } from "@/lib/protest-case";
import { CopyButton } from "@/components/CopyButton";
import { ImportPropertiesModal } from "@/components/ImportPropertiesModal";
import { AddOwnershipsModal } from "@/components/AddOwnershipsModal";

export const Route = createFileRoute("/dashboard/_layout/properties")({
  component: Properties,
});

const CURRENT_YEAR = new Date().getFullYear();

const STATUS_LABEL: Record<ProtestStatus, string> = {
  requested: "Requested",
  filed: "Filed",
  under_review: "Under Review",
  offer_received: "Offer Received",
  hearing_scheduled: "Hearing Scheduled",
  decision_received: "Decision Received",
  appealing: "Appealing",
  arbitrating: "Arbitrating",
  resolved: "Resolved",
};

function Properties() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [healthScores, setHealthScores] = useState<Record<string, PropertyAiScore>>({});
  const [authorizingProperty, setAuthorizingProperty] = useState<PropertyRecord | null>(null);
  const [caseProperty, setCaseProperty] = useState<PropertyRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [ownershipsOpen, setOwnershipsOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    listProperties(user.id)
      .then(setProperties)
      .catch((err) =>
        setListError(err instanceof Error ? err.message : "Could not load your properties."),
      )
      .finally(() => setPropertiesLoading(false));
    listProtests(user.id)
      .then(setProtests)
      .catch((err) => console.error(err));
    listHealthScores(user.id)
      .then(setHealthScores)
      .catch((err) => console.error(err));
  }, [user]);

  useSavingsBackfill(properties, setProperties);

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this property from your dashboard?")) return;
    setDeletingId(id);
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
      resetIntake();
      toast.success("Property removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this property.");
    } finally {
      setDeletingId(null);
    }
  }

  // Soonest deadline first — the property that needs attention should always be
  // the first thing you see, not buried in whatever order they were added.
  const sortedProperties = [...properties].sort((a, b) => {
    const rankA = a.protestDeadline ? new Date(a.protestDeadline).getTime() : Infinity;
    const rankB = b.protestDeadline ? new Date(b.protestDeadline).getTime() : Infinity;
    return rankA - rankB;
  });

  function openAiReport(p: PropertyRecord) {
    updateIntake({
      address: p.address,
      cad: p.cad ?? undefined,
      accountNumber: p.accountNumber ?? undefined,
      ownerName: p.ownerName ?? undefined,
      propertyType: p.propertyType ?? undefined,
      landValue: p.landValue ?? undefined,
      improvementValue: p.improvementValue ?? undefined,
      totalValue: p.totalValue ?? undefined,
      taxYear: p.taxYear ?? undefined,
      valueHistory: p.valueHistory ?? undefined,
      confirmed: true,
    });
    navigate({ to: "/ai-report" });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold">My Properties</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setImportOpen(true)} className="btn-outline">
            Import CSV
          </button>
          <button type="button" onClick={() => setOwnershipsOpen(true)} className="btn-outline">
            Add Ownerships
          </button>
          <Link
            to="/intake"
            onClick={() => resetIntake()}
            className="btn-primary btn-primary-hover"
          >
            Add another property
          </Link>
        </div>
      </div>

      {importOpen && user && (
        <ImportPropertiesModal
          userId={user.id}
          onImported={(imported) => setProperties((prev) => [...imported, ...prev])}
          onClose={() => setImportOpen(false)}
        />
      )}

      {ownershipsOpen && user && (
        <AddOwnershipsModal
          userId={user.id}
          onImported={(imported) => setProperties((prev) => [...imported, ...prev])}
          onClose={() => setOwnershipsOpen(false)}
        />
      )}

      <div className="mt-4">
        <PortfolioTabs />
      </div>

      <div className="mt-6">
        {listError && <p className="mb-4 text-sm text-destructive">{listError}</p>}
        {propertiesLoading ? (
          <div className="grid gap-4">
            <PropertyCardSkeleton />
            <PropertyCardSkeleton />
          </div>
        ) : properties.length > 0 ? (
          <div className="grid gap-4">
            {sortedProperties.map((p, i) => {
              const existingProtest = protests.find((pr) => pr.propertyId === p.id);
              // A resolved protest from a prior tax year shouldn't permanently block
              // filing again — only offer re-filing once the case is actually closed
              // and a newer tax year has come around (never for an in-progress case).
              const canReFile =
                existingProtest?.status === "resolved" &&
                existingProtest.taxYear != null &&
                existingProtest.taxYear < CURRENT_YEAR;
              return (
                <div
                  key={p.id}
                  className="card-elev p-6"
                  style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{p.cad}</span>
                        <ActionStatusBadge property={p} protests={protests} />
                      </div>
                      <h3 className="font-serif text-xl font-semibold">{p.address}</h3>
                      <p className="text-sm text-muted-foreground inline-flex items-center flex-wrap gap-1">
                        {p.propertyType} • Acct {p.accountNumber}
                        {p.accountNumber && (
                          <CopyButton value={p.accountNumber} label="Account number copied" />
                        )}
                        • Tax year {p.taxYear}
                      </p>
                      <AiScoreBadge score={healthScores[p.id]} />
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-muted-foreground">Assessed value</div>
                      <div className="text-2xl font-semibold">
                        {currency(p.totalValue ?? undefined)}
                      </div>
                      <SavingsLine
                        estimatedSavings={p.estimatedSavings}
                        savingsBasis={p.savingsBasis}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2 flex-wrap items-center">
                    <button onClick={() => openAiReport(p)} className="btn-outline">
                      Open AI Report
                    </button>
                    <Link to="/pricing" className="btn-outline">
                      Upgrade
                    </Link>
                    {existingProtest ? (
                      <>
                        <span className="badge-soft">
                          Protest {STATUS_LABEL[existingProtest.status]}
                          {existingProtest.taxYear ? ` (${existingProtest.taxYear})` : ""}
                        </span>
                        <button onClick={() => setCaseProperty(p)} className="btn-outline">
                          View Case
                        </button>
                        {canReFile && (
                          <button
                            onClick={() => setAuthorizingProperty(p)}
                            className="btn-primary btn-primary-hover"
                          >
                            Re-file for {CURRENT_YEAR}
                          </button>
                        )}
                      </>
                    ) : (
                      <button onClick={() => setAuthorizingProperty(p)} className="btn-outline">
                        Request Protest Filing
                      </button>
                    )}
                    <button
                      disabled={deletingId === p.id}
                      onClick={() => handleDelete(p.id)}
                      className="btn-outline text-destructive disabled:opacity-60"
                    >
                      {deletingId === p.id ? "Removing…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card-elev p-8 text-center">
            <h3 className="font-serif text-xl font-semibold">No properties yet.</h3>
            <p className="text-muted-foreground mt-1">
              Start with an address or upload an appraisal notice.
            </p>
            <Link
              to="/intake"
              onClick={() => resetIntake()}
              className="btn-primary btn-primary-hover mt-4 inline-flex"
            >
              Start Free AI Property Review
            </Link>
          </div>
        )}
      </div>

      {authorizingProperty && user && (
        <ProtestAuthorizationFlow
          userId={user.id}
          property={authorizingProperty}
          userEmail={user.email}
          open={!!authorizingProperty}
          onOpenChange={(open) => {
            if (!open) setAuthorizingProperty(null);
          }}
          onDone={(created) => {
            setProtests((prev) => [created, ...prev]);
            // Best-effort — the protest request itself is already saved regardless
            // of whether case-prep generation succeeds (see protest-case.ts).
            generateCasePrep(created.id, user.id, authorizingProperty).catch((err) =>
              console.error("Case prep generation failed:", err),
            );
          }}
        />
      )}

      {caseProperty && user && (
        <CaseDetailModal
          userId={user.id}
          property={caseProperty}
          protest={protests.find((pr) => pr.propertyId === caseProperty.id)!}
          onClose={() => setCaseProperty(null)}
        />
      )}
    </div>
  );
}

// Surfaces the same needs_action/in_progress/resolved/on_track status the
// dashboard home nudge banner is driven by (src/lib/portfolio-status.ts) — a
// property never looks different here than it does in that banner, since both
// read from the one shared helper.
const STATUS_TONE: Record<ActionStatus, string> = {
  needs_action: "text-destructive",
  in_progress: "text-accent",
  resolved: "text-success",
  on_track: "text-muted-foreground",
};

function ActionStatusBadge({
  property,
  protests,
}: {
  property: PropertyRecord;
  protests: ProtestRecord[];
}) {
  const { status, label } = getPropertyProtestStatus(property, protests);
  return <span className={`badge-soft ${STATUS_TONE[status]}`}>{label}</span>;
}

// Only appears once the background AI health-score call (fired from addProperty())
// has landed — no loading state or placeholder, since older properties added before
// this feature shipped will simply never have a score and that's fine.
function AiScoreBadge({ score }: { score: PropertyAiScore | undefined }) {
  if (!score) return null;
  return (
    <p className="mt-1 text-sm text-accent">
      AI Score: {score.score}/100 — {score.summary}
    </p>
  );
}

// Shows the real per-property savings estimate computed during intake (see
// intake.tsx's runValidation) — the only number persisted here, never a
// fabricated one. Properties added before this field existed, or where the
// comps/formula method produced nothing usable, simply show nothing.
function SavingsLine({
  estimatedSavings,
  savingsBasis,
}: {
  estimatedSavings: number | null;
  // "ai" and "baseline" are legacy values from before the estimate was made
  // fully deterministic — still shown correctly on old rows, nothing writes
  // them anymore.
  savingsBasis: "comps" | "formula" | "ai" | "baseline" | null;
}) {
  if (!estimatedSavings || estimatedSavings <= 0) return null;
  return (
    <div className="mt-1">
      <div className="text-xs text-muted-foreground">Potential savings</div>
      <div className="text-lg font-semibold text-accent">
        {currency(estimatedSavings)}
        {(savingsBasis === "formula" || savingsBasis === "ai" || savingsBasis === "baseline") && (
          <span className="ml-1 align-middle text-[10px] font-normal text-muted-foreground">
            (estimate)
          </span>
        )}
      </div>
    </div>
  );
}

function PropertyCardSkeleton() {
  return (
    <div className="card-elev p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="grid gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid gap-2 justify-items-end">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}
