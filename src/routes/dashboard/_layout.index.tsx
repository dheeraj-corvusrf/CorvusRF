import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Briefcase, Upload, Sparkles, ArrowUpRight, Trash2, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList, ResponsiveContainer, PieChart, Pie } from "recharts";
import { useAuth } from "@/lib/auth";
import { currency, resetIntake, classifyAndStoreDocument } from "@/lib/intake-store";
import { listProperties, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { useSavingsBackfill } from "@/hooks/use-savings-backfill";
import { getEffectiveTaxRate, getBaseReductionPct, classifyPropertyCategory } from "@/lib/texas-tax-rates";
import { listBppAccounts, type BppAccountRecord } from "@/lib/bpp-accounts";
import { listDocuments, type DocumentRecord } from "@/lib/documents";
import { listProtests, type ProtestRecord, type ProtestStatus } from "@/lib/protests";
import { getPropertyProtestStatus } from "@/lib/portfolio-status";
import { askRouter } from "@/lib/ask-router";
import { getDeadlineNudge } from "@/lib/deadline-nudge";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export const Route = createFileRoute("/dashboard/_layout/")({
  component: Overview,
});

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
  const [nudge, setNudge] = useState<string | null>(null);
  const nudgedPropertyId = useRef<string | null>(null);

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

  useSavingsBackfill(properties, setProperties);

  const addressFor = (propertyId: string) =>
    properties.find((p) => p.id === propertyId)?.address ?? "Property removed";

  // Prefers the real per-property estimate computed during intake (comps- or
  // formula-grounded — see src/lib/savings-estimate.ts) whenever it's on file.
  // Only falls back to the same deterministic formula's base reduction rate for
  // properties useSavingsBackfill hasn't caught up to yet — deliberately not
  // calling estimateSavings() synchronously here, since that's what the
  // backfill hook above already does in the background and persists.
  const estimatedSavings = useMemo(
    () =>
      properties.reduce((sum, p) => {
        if (p.estimatedSavings != null) return sum + p.estimatedSavings;
        if (!p.totalValue) return sum;
        const category = classifyPropertyCategory(p.propertyType);
        return sum + Math.round(p.totalValue * getBaseReductionPct(p.cad, category) * getEffectiveTaxRate(p.cad));
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

  // Properties flagged "needs_action" by the shared status helper (see
  // src/lib/portfolio-status.ts — also used for the Properties page's per-property
  // badges, so this banner and those badges never disagree). Drives the AI reminder
  // banner below.
  const urgentProperties = properties
    .map((p) => ({ property: p, ...getPropertyProtestStatus(p, protests) }))
    .filter(
      (u): u is typeof u & { daysLeft: number } => u.status === "needs_action" && u.daysLeft != null,
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);

  useEffect(() => {
    if (urgentProperties.length === 0) return;
    const soonest = urgentProperties[0];
    if (nudgedPropertyId.current === soonest.property.id) return;
    nudgedPropertyId.current = soonest.property.id;
    getDeadlineNudge({
      address: soonest.property.address,
      daysLeft: soonest.daysLeft,
      totalValue: soonest.property.totalValue ?? undefined,
    })
      .then((r) => setNudge(r.message))
      .catch((err) => console.error("Deadline nudge failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgentProperties.length > 0 ? urgentProperties[0].property.id : null]);

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
    <div className="grid grid-cols-1 min-w-0 gap-6">
      <div>
        <span className="badge-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI is watching your properties
        </span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">
          Welcome back{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-muted-foreground">Pick any entry point below — AI figures out the right workflow.</p>
      </div>

      {nudge && urgentProperties.length > 0 && (
        <div className="card-elev p-4 border-destructive/30 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{nudge}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {urgentProperties[0].property.address}
              {urgentProperties.length > 1 &&
                ` — +${urgentProperties.length - 1} other propert${urgentProperties.length - 1 === 1 ? "y" : "ies"} also need attention`}
            </p>
            <Link to="/dashboard/properties" className="btn-outline text-sm mt-3 inline-flex">
              Review &amp; Request Protest
            </Link>
          </div>
        </div>
      )}

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
        <StatCard label="Properties" value={loaded ? properties.length : null} to="/dashboard/properties" />
        <StatCard label="BPP Accounts" value={loaded ? bppAccounts.length : null} to="/dashboard/bpp-accounts" />
        <StatCard label="Documents" value={loaded ? documents.length : null} to="/dashboard/documents" />
        <StatCard label="Cases" value={loaded ? protests.length : null} to="/dashboard/properties" />
        <StatCard label="Est. Savings" value={loaded ? estimatedSavings : null} format={currency} />
      </div>

      {properties.length > 0 && (
        <div className="card-elev p-5 min-w-0">
          <h3 className="font-semibold">Portfolio Value</h3>
          <PortfolioValueChart properties={properties} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card-elev p-5 min-w-0">
          <h3 className="font-semibold">Cases & AI Recommendations</h3>
          {protests.length > 0 ? (
            <ProtestStatusChart protests={protests} addressFor={addressFor} />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No cases yet. Use an entry point above.</p>
          )}
        </div>

        <div className="card-elev p-5 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deadlines</h3>
            <Link to="/dashboard/deadlines" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          {upcoming.length > 0 ? (
            <div className="mt-3 grid min-w-0 gap-2">
              {upcoming.map((u, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm min-w-0">
                  <span className="truncate min-w-0">
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

      <div className="card-elev p-5 min-w-0">
        <h3 className="font-semibold">Recent Activity</h3>
        {activity.length > 0 ? (
          <div className="mt-3 grid min-w-0 gap-2">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm min-w-0">
                <span className="shrink-0 text-muted-foreground">{a.label}</span>
                <span className="truncate min-w-0">{a.detail}</span>
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

function StatCard({
  label,
  value,
  to,
  format,
}: {
  label: string;
  value: number | null;
  to?: "/dashboard/properties" | "/dashboard/bpp-accounts" | "/dashboard/documents";
  format?: (n: number) => string;
}) {
  const content = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-2xl font-semibold">
        {value === null ? "…" : <AnimatedNumber value={value} format={format} />}
      </div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="card-elev p-4 block transition-colors hover:bg-secondary/40">
        {content}
      </Link>
    );
  }
  return <div className="card-elev p-4">{content}</div>;
}

const PORTFOLIO_COLORS = ["var(--accent)", "var(--success)", "var(--warning)", "#8b5cf6", "#ec4899", "#14b8a6"];

function PortfolioValueChart({ properties }: { properties: PropertyRecord[] }) {
  const data = properties
    .filter((p) => p.totalValue != null)
    .sort((a, b) => (b.totalValue ?? 0) - (a.totalValue ?? 0))
    .slice(0, 8)
    .map((p) => ({
      name: p.address.length > 28 ? `${p.address.slice(0, 26)}…` : p.address,
      value: p.totalValue ?? 0,
    }));

  if (data.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">Value data not available yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }}>
        <XAxis type="number" hide domain={[0, (max: number) => max * 1.2]} />
        <YAxis
          type="category"
          dataKey="name"
          width={160}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length]} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: number) => currency(v)}
            style={{ fontSize: 12, fontWeight: 600, fill: "var(--foreground)" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const STATUS_COLORS: Record<ProtestStatus, string> = {
  requested: "var(--muted-foreground)",
  filed: "var(--accent)",
  under_review: "var(--warning)",
  offer_received: "#f59e0b",
  hearing_scheduled: "#8b5cf6",
  decision_received: "#0ea5e9",
  appealing: "#ec4899",
  arbitrating: "#ec4899",
  resolved: "var(--success)",
};

function ProtestStatusChart({
  protests,
  addressFor,
}: {
  protests: ProtestRecord[];
  addressFor: (propertyId: string) => string;
}) {
  const counts = protests.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<ProtestStatus, number>,
  );
  const data = (Object.keys(STATUS_LABEL) as ProtestStatus[])
    .filter((s) => counts[s] > 0)
    .map((s) => ({ name: STATUS_LABEL[s], value: counts[s], status: s }));

  return (
    <>
      <div className="mt-3 grid grid-cols-[7rem_1fr] items-center gap-3">
        <ResponsiveContainer width="100%" height={110}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={30} outerRadius={50} paddingAngle={2}>
              {data.map((d) => (
                <Cell key={d.status} fill={STATUS_COLORS[d.status]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="grid gap-1.5">
          {data.map((d) => (
            <div key={d.status} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: STATUS_COLORS[d.status] }}
              />
              <span className="flex-1">{d.name}</span>
              <span className="font-medium">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid min-w-0 gap-2 border-t border-border pt-3">
        {protests.slice(0, 3).map((pr) => (
          <div key={pr.id} className="flex items-center justify-between gap-2 text-sm min-w-0">
            <span className="truncate min-w-0">{addressFor(pr.propertyId)}</span>
            <span className="badge-soft shrink-0">{STATUS_LABEL[pr.status]}</span>
          </div>
        ))}
      </div>
    </>
  );
}
