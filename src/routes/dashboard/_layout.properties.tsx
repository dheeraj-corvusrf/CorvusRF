import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { currency, resetIntake, updateIntake } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { listProtests, requestProtest, type ProtestRecord, type ProtestStatus } from "@/lib/protests";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard/_layout/properties")({
  component: Properties,
});

const STATUS_LABEL: Record<ProtestStatus, string> = {
  requested: "Requested",
  filed: "Filed",
  under_review: "Under Review",
  hearing_scheduled: "Hearing Scheduled",
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
  const [requestingId, setRequestingId] = useState<string | null>(null);

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
  }, [user]);

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

  async function handleRequestProtest(propertyId: string) {
    if (!user) return;
    setRequestingId(propertyId);
    try {
      const created = await requestProtest(user.id, propertyId);
      setProtests((prev) => [created, ...prev]);
      toast.success("Protest filing requested. CorvusRF staff will follow up.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not request a protest.");
    } finally {
      setRequestingId(null);
    }
  }

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
      confirmed: true,
    });
    navigate({ to: "/ai-report" });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold">My Commercial Properties</h1>
        <Link to="/intake" onClick={() => resetIntake()} className="btn-primary btn-primary-hover">
          Add another property
        </Link>
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
            {properties.map((p) => {
              const existingProtest = protests.find((pr) => pr.propertyId === p.id);
              return (
                <div key={p.id} className="card-elev p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="text-xs text-muted-foreground">{p.cad}</div>
                      <h3 className="font-serif text-xl font-semibold">{p.address}</h3>
                      <p className="text-sm text-muted-foreground">
                        {p.propertyType} • Acct {p.accountNumber} • Tax year {p.taxYear}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Assessed value</div>
                      <div className="text-2xl font-semibold">{currency(p.totalValue ?? undefined)}</div>
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
                      <span className="badge-soft">Protest {STATUS_LABEL[existingProtest.status]}</span>
                    ) : (
                      <button
                        disabled={requestingId === p.id}
                        onClick={() => handleRequestProtest(p.id)}
                        className="btn-outline disabled:opacity-60"
                      >
                        {requestingId === p.id ? "Requesting…" : "Request Protest Filing"}
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
            <p className="text-muted-foreground mt-1">Start with an address or upload an appraisal notice.</p>
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
