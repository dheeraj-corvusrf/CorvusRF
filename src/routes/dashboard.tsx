import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { currency, resetIntake, updateIntake } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { listProtests, requestProtest, type ProtestRecord, type ProtestStatus } from "@/lib/protests";
import { listDocuments, getDocumentUrl, type DocumentRecord } from "@/lib/documents";
import { Skeleton } from "@/components/ui/skeleton";
import { JourneyTracker } from "@/components/JourneyTracker";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Your Dashboard — CorvusRF.ai" },
      {
        name: "description",
        content: "Your Texas property tax dashboard: properties, protests, documents, and savings.",
      },
      { property: "og:title", content: "CorvusRF Dashboard" },
      { property: "og:description", content: "Your Texas property tax dashboard." },
    ],
  }),
  component: Dashboard,
});

const STATUS_LABEL: Record<ProtestStatus, string> = {
  requested: "Requested",
  filed: "Filed",
  under_review: "Under Review",
  hearing_scheduled: "Hearing Scheduled",
  resolved: "Resolved",
};

function Dashboard() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/sign-in" });
      return;
    }
    listProperties(user.id)
      .then(setProperties)
      .catch((err) =>
        setListError(err instanceof Error ? err.message : "Could not load your properties."),
      )
      .finally(() => setPropertiesLoading(false));
    listProtests(user.id)
      .then(setProtests)
      .catch((err) => console.error(err));
    listDocuments(user.id)
      .then(setDocuments)
      .catch((err) => console.error(err));
  }, [loading, user, nav]);

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this property from your dashboard?")) return;
    setDeletingId(id);
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
      // The journey tracker reads session state that has no link to a specific
      // property id, so a deleted property's "completed" journey would otherwise
      // keep showing as in-progress forever. Deleting is a deliberate action, so
      // treat it as a clean-slate signal.
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

  async function handleDownload(doc: DocumentRecord) {
    try {
      const url = await getDocumentUrl(doc.storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open this document.");
    }
  }

  const hasProperty = properties.length > 0;
  const tabs = [
    "My Commercial Properties",
    "AI Reports",
    "Active Protests",
    "Documents",
    "Notifications",
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);

  if (loading || !user) return null;

  const addressFor = (propertyId: string) =>
    properties.find((p) => p.id === propertyId)?.address ?? "Property removed";

  const deadlines = properties
    .filter((p) => !!p.protestDeadline)
    .map((p) => {
      const deadline = new Date(p.protestDeadline as string);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return { property: p, deadline, daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold">Always know where you are.</h1>
          <p className="text-muted-foreground">
            One unified profile. Every property, every account, every deadline.
          </p>
        </div>
        <Link to="/intake" onClick={() => resetIntake()} className="btn-primary btn-primary-hover">
          Add another property
        </Link>
      </div>

      <div className="mt-6">
        {/* Remount on every list change (e.g. a delete) so it re-reads session state
            fresh, instead of keeping a stale render from before a resetIntake(). */}
        <JourneyTracker key={properties.length} />
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px ${
              tab === t
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "My Commercial Properties" && (
          <>
            {listError && <p className="mb-4 text-sm text-destructive">{listError}</p>}
            {propertiesLoading ? (
              <div className="grid gap-4">
                <PropertyCardSkeleton />
                <PropertyCardSkeleton />
              </div>
            ) : hasProperty ? (
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
                          <div className="text-2xl font-semibold">
                            {currency(p.totalValue ?? undefined)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2 flex-wrap items-center">
                        <Link to="/pricing" className="btn-outline">
                          Upgrade
                        </Link>
                        {existingProtest ? (
                          <span className="badge-soft">
                            Protest {STATUS_LABEL[existingProtest.status]}
                          </span>
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
              <EmptyState />
            )}
          </>
        )}
        {tab === "AI Reports" &&
          (hasProperty ? (
            <div className="grid gap-4">
              {properties.map((p) => (
                <Link
                  key={p.id}
                  to="/ai-report"
                  onClick={() =>
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
                    })
                  }
                  className="card-elev p-5 flex items-center justify-between hover:bg-secondary/40"
                >
                  <div>
                    <div className="font-medium">AI Property Review — {p.address}</div>
                    <div className="text-xs text-muted-foreground">
                      10 modules • preview available
                    </div>
                  </div>
                  <span className="btn-outline text-sm">Open</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState />
          ))}
        {tab === "Active Protests" &&
          (protests.length > 0 ? (
            <div className="grid gap-4">
              {protests.map((pr) => (
                <div key={pr.id} className="card-elev p-5 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{addressFor(pr.propertyId)}</div>
                    <div className="text-xs text-muted-foreground">
                      Requested {new Date(pr.requestedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="badge-soft">{STATUS_LABEL[pr.status]}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-8 text-center">
              <h3 className="font-serif text-xl font-semibold">No active protests.</h3>
              <p className="text-muted-foreground mt-1">
                Request a protest filing from a property in "My Commercial Properties" and
                CorvusRF staff will take it from there.
              </p>
            </div>
          ))}
        {tab === "Documents" &&
          (documents.length > 0 ? (
            <div className="grid gap-3">
              {documents.map((doc) => (
                <div key={doc.id} className="card-elev p-4 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{doc.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {addressFor(doc.propertyId)} • Uploaded{" "}
                      {new Date(doc.uploadedAt).toLocaleDateString()}
                      {doc.documentType ? ` • ${doc.documentType}` : ""}
                    </div>
                  </div>
                  <button onClick={() => handleDownload(doc)} className="btn-outline text-sm">
                    Download
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-8 text-center">
              <h3 className="font-serif text-xl font-semibold">No documents yet.</h3>
              <p className="text-muted-foreground mt-1">
                Documents you upload during property intake are stored here automatically.
              </p>
            </div>
          ))}
        {tab === "Notifications" &&
          (deadlines.length > 0 ? (
            <div className="grid gap-3">
              {deadlines.map(({ property, deadline, daysLeft }) => (
                <div key={property.id} className="card-elev p-4 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{property.address}</div>
                    <div className="text-xs text-muted-foreground">
                      Protest deadline: {deadline.toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}
                  >
                    {daysLeft < 0
                      ? "Deadline passed"
                      : daysLeft === 0
                        ? "Due today"
                        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-8 text-center">
              <h3 className="font-serif text-xl font-semibold">No notifications.</h3>
              <p className="text-muted-foreground mt-1">
                Upload an appraisal notice with a protest deadline and it'll show up here.
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
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
