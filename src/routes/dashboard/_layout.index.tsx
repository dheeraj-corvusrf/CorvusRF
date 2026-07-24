import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Briefcase, Upload, Sparkles, ArrowUpRight, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { currency, resetIntake, classifyAndStoreDocument } from "@/lib/intake-store";
import { listProperties, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { listBppAccounts, type BppAccountRecord } from "@/lib/bpp-accounts";
import { listDocuments, type DocumentRecord } from "@/lib/documents";
import { listProtests, type ProtestRecord, type ProtestStatus } from "@/lib/protests";
import { askRouter } from "@/lib/ask-router";

export const Route = createFileRoute("/dashboard/_layout/")({
  component: Overview,
});

const STATUS_LABEL: Record<ProtestStatus, string> = {
  requested: "Requested",
  filed: "Filed",
  under_review: "Under Review",
  hearing_scheduled: "Hearing Scheduled",
  resolved: "Resolved",
};

type ActivityItem = { ts: number; label: string; detail: string; propertyId?: string };

function Overview() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [bppAccounts, setBppAccounts] = useState<BppAccountRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [askQuery, setAskQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      listProperties(user.id),
      listBppAccounts(user.id),
      listDocuments(user.id),
      listProtests(user.id),
    ])
      .then(([props, bpp, docs, prot]) => {
        setProperties(props);
        setBppAccounts(bpp);
        setDocuments(docs);
        setProtests(prot);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoaded(true));
  }, [user]);

  const addressFor = (propertyId: string) =>
    properties.find((p) => p.id === propertyId)?.address ?? "Property removed";

  // Same fixed 12% reduction / 2.5% effective-rate assumption used as the pre-AI
  // fallback estimate elsewhere (ai-report.tsx, pricing) — deliberately not calling
  // the AI modules here, since that would defeat the point of making those lazy
  // (loadModule-on-unlock) to save tokens.
  const estimatedSavings = useMemo(
    () =>
      properties.reduce((sum, p) => {
        if (!p.totalValue) return sum;
        return sum + Math.round(p.totalValue * 0.12 * 0.025);
      }, 0),
    [properties],
  );

  const deadlines = properties
    .filter((p) => !!p.protestDeadline)
    .map((p) => ({
      property: p,
      when: new Date(p.protestDeadline as string),
      label: "Protest deadline",
    }));
  const bills = properties
    .filter((p) => !!p.paymentDueDate && !p.paidAt)
    .map((p) => ({
      property: p,
      when: new Date(p.paymentDueDate as string),
      label: "Tax bill due",
    }));
  const upcoming = [...deadlines, ...bills].sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, 4);

  const activity: ActivityItem[] = [
    ...properties.map((p) => ({
      ts: new Date(p.createdAt).getTime(),
      label: "Property added",
      detail: p.address,
      propertyId: p.id,
    })),
    ...bppAccounts.map((b) => ({
      ts: new Date(b.createdAt).getTime(),
      label: "BPP account added",
      detail: b.businessName,
    })),
    ...documents.map((d) => ({
      ts: new Date(d.uploadedAt).getTime(),
      label: "Document uploaded",
      detail: d.fileName,
    })),
    ...protests.map((pr) => ({
      ts: new Date(pr.requestedAt).getTime(),
      label: "Protest requested",
      detail: addressFor(pr.propertyId),
    })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);

  async function onUploadNotice(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await classifyAndStoreDocument(f);
      nav({ to: "/document-review" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this document.");
      setUploading(false);
    }
  }

  async function handleDeleteProperty(id: string) {
    if (!window.confirm("Remove this property from your dashboard?")) return;
    setDeletingId(id);
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
      toast.success("Property removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this property.");
    } finally {
      setDeletingId(null);
    }
  }

  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!askQuery.trim()) return;
    setAsking(true);
    try {
      const result = await askRouter(askQuery.trim());
      nav({ to: result.destination });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process that. Please try again.");
    } finally {
      setAsking(false);
    }
  }

  const firstName = user?.user_metadata?.first_name as string | undefined;

  return (
    <div className="grid gap-6">
      <div>
        <span className="badge-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI is watching your properties
        </span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">
          Welcome back{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-muted-foreground">Pick any entry point below — AI figures out the right workflow.</p>
      </div>

      {/* Entry points */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/intake" onClick={() => resetIntake()} className="card-elev p-4 hover:bg-secondary/40">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
            <Plus className="h-4 w-4" />
          </span>
          <div className="mt-3 flex items-center gap-1 font-medium">
            Add Property <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            AI normalizes, checks county records, flags mismatches.
          </p>
        </Link>

        <Link to="/dashboard/bpp-accounts" className="card-elev p-4 hover:bg-secondary/40">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
            <Briefcase className="h-4 w-4" />
          </span>
          <div className="mt-3 flex items-center gap-1 font-medium">
            Add BPP Account <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Track a business personal property account.</p>
        </Link>

        <label className={`card-elev p-4 cursor-pointer block ${uploading ? "opacity-60 pointer-events-none" : "hover:bg-secondary/40"}`}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
            <Upload className="h-4 w-4" />
          </span>
          <div className="mt-3 font-medium">{uploading ? "Reading document…" : "Upload Notice"}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Drop any tax notice — AI extracts fields and routes it.
          </p>
          <input type="file" className="hidden" accept=".pdf,image/*" disabled={uploading} onChange={onUploadNotice} />
        </label>

        <form onSubmit={submitAsk} className="card-elev p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="mt-3 font-medium">Ask AI</div>
          <input
            value={askQuery}
            onChange={(e) => setAskQuery(e.target.value)}
            placeholder="Describe the situation…"
            disabled={asking}
            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
        </form>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Properties" value={loaded ? properties.length : "…"} />
        <StatCard label="BPP Accounts" value={loaded ? bppAccounts.length : "…"} />
        <StatCard label="Documents" value={loaded ? documents.length : "…"} />
        <StatCard label="Cases" value={loaded ? protests.length : "…"} />
        <StatCard label="Est. Savings" value={loaded ? currency(estimatedSavings) : "…"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-elev p-5">
          <h3 className="font-semibold">Cases & AI Recommendations</h3>
          {protests.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {protests.slice(0, 5).map((pr) => (
                <div key={pr.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{addressFor(pr.propertyId)}</span>
                  <span className="badge-soft shrink-0">{STATUS_LABEL[pr.status]}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No cases yet. Use an entry point above.</p>
          )}
        </div>

        <div className="card-elev p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deadlines</h3>
            <Link to="/dashboard/deadlines" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          {upcoming.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {upcoming.map((u, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {u.label} — {u.property.address}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {u.when.toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No deadlines yet. AI will surface them as you add properties.
            </p>
          )}
        </div>
      </div>

      <div className="card-elev p-5">
        <h3 className="font-semibold">Recent Activity</h3>
        {activity.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{a.label}</span>
                <span className="truncate">{a.detail}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {new Date(a.ts).toLocaleDateString()}
                  {a.propertyId && (
                    <button
                      onClick={() => handleDeleteProperty(a.propertyId!)}
                      disabled={deletingId === a.propertyId}
                      aria-label="Delete property"
                      title="Delete property"
                      className="text-muted-foreground hover:text-destructive disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-elev p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-2xl font-semibold">{value}</div>
    </div>
  );
}
