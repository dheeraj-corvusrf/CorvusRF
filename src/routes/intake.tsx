import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import {
  readIntake,
  updateIntake,
  classifyAndStoreDocument,
  currency,
  UPLOAD_LIMITS,
  type IntakeState,
  type PropertyKind,
} from "@/lib/intake-store";
import type { CadValueHistoryEntry } from "@/lib/cad-lookup";
import { cadLookup } from "@/lib/cad-lookup";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useAuth } from "@/lib/auth";
import { addProperty } from "@/lib/properties";
import { SampleNoticeDialog } from "@/components/SampleNoticeDialog";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "Property Intake — CorvusRF.ai" },
      {
        name: "description",
        content: "Validate your Texas commercial or residential property and start your free AI review.",
      },
      { property: "og:title", content: "Property Intake" },
      { property: "og:description", content: "Address, notice, and CAD validation." },
    ],
  }),
  component: Intake,
});

type Step = "address" | "validating" | "notice" | "confirm" | "notfound" | "classifying";

function Intake() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  const [step, setStep] = useState<Step>("address");
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [propertyKind, setPropertyKind] = useState<PropertyKind>("commercial");
  const [noticeName, setNoticeName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const s = readIntake();
    setState(s);
    if (s.propertyKind) setPropertyKind(s.propertyKind);
    // Only resume straight into validation for an in-progress intake (address
    // set, not yet confirmed). Once a property has already been confirmed and
    // saved, a fresh visit to /intake should start a new search — otherwise the
    // page silently jumps to the old Confirm step on every revisit, hiding the
    // commercial/residential toggle (which only renders on the address step)
    // behind an "Edit Address" click the user has no reason to expect.
    if (s.address && !s.confirmed) {
      setAddress(s.address);
      runValidation(s.address);
    }
  }, []);

  async function runValidation(addr: string) {
    setStep("validating");
    setError(null);
    try {
      const res = await cadLookup(addr);
      if (!res.matched) {
        setStep("notfound");
        return;
      }
      const next = updateIntake({
        address: res.record.propertyAddress,
        cad: res.record.cad,
        accountNumber: res.record.accountNumber ?? undefined,
        ownerName: res.record.ownerName ?? undefined,
        propertyType: res.record.propertyType ?? undefined,
        landValue: res.record.landValue ?? undefined,
        improvementValue: res.record.improvementValue ?? undefined,
        totalValue: res.record.totalValue ?? undefined,
        taxYear: res.record.taxYear ?? undefined,
        legalDescription: res.record.legalDescription ?? undefined,
        subdivision: res.record.subdivision ?? undefined,
        geoId: res.record.geoId ?? undefined,
        mailingAddress: res.record.mailingAddress ?? undefined,
        ownershipPct: res.record.ownershipPct ?? undefined,
        protestStatus: res.record.protestStatus ?? undefined,
        valueHistory: res.record.valueHistory ?? undefined,
        deeds: res.record.deeds ?? undefined,
      });
      setState(next);
      setStep("confirm");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "Could not look up this property. Please try again.";
      toast.error(message);
      setStep("address");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setNoticeName(f.name);
    setStep("classifying");

    try {
      await classifyAndStoreDocument(f);
      nav({ to: "/document-review" });
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Could not read this document. Please enter the property address above instead.";
      setError(message);
      toast.error(message);
      setStep("address");
    }
  }

  return (
    <div className={`container-page py-12 ${step === "confirm" ? "max-w-5xl" : "max-w-3xl"}`}>
      <Stepper step={step} />

      {step === "address" && (
        <section className="mt-8 card-elev p-6">
          <h1 className="font-serif text-2xl font-semibold capitalize">
            Enter your {propertyKind} property.
          </h1>
          <p className="mt-1 text-muted-foreground">
            Enter an address, or upload your Texas appraisal notice.
          </p>

          <div className="mt-4 inline-flex rounded-full border border-border bg-secondary/40 p-1">
            {(["commercial", "residential"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setPropertyKind(kind);
                  updateIntake({ propertyKind: kind });
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  propertyKind === kind
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {kind}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!address.trim()) return;
              updateIntake({ address: address.trim(), propertyKind });
              runValidation(address.trim());
            }}
            className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]"
          >
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              placeholder="e.g. 500 Main St, Houston, TX 77002"
              className="rounded-md border border-input bg-background px-4 py-3"
            />
            <button className="btn-primary btn-primary-hover">Validate address</button>
          </form>

          <div className="mt-6 rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-sm font-medium">Have your appraisal notice?</p>
            <p className="text-xs text-muted-foreground">
              PDF / PNG / JPG, up to {Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB,
              up to {UPLOAD_LIMITS.maxPages} pages.
            </p>
            <label className="mt-3 btn-outline cursor-pointer inline-flex">
              <input type="file" className="hidden" accept=".pdf,image/*" onChange={onFile} />
              Upload Appraisal Notice
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              <SampleNoticeDialog />
            </p>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            {noticeName && (
              <p className="mt-2 text-xs text-muted-foreground">Selected: {noticeName}</p>
            )}
          </div>
        </section>
      )}

      {step === "validating" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold">Working on it…</h2>
          <AnimatedSteps
            steps={[
              { label: "Validating property address", status: "done" },
              { label: "Identifying county appraisal district", status: "done" },
              { label: "Retrieving official property information", status: "active" },
            ]}
          />
        </section>
      )}

      {step === "classifying" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold">AI is reading your document…</h2>
          <AnimatedSteps
            steps={[
              { label: "OCR & text extraction", status: "done" },
              { label: "Classifying document type", status: "active" },
              { label: "Extracting owner, values, and deadlines", status: "active" },
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            This usually takes a few seconds. Do not close this tab.
          </p>
        </section>
      )}

      {step === "notfound" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold capitalize">
            We couldn't locate this {propertyKind} property.
          </h2>
          <p className="mt-1 text-muted-foreground">
            Please enter a valid property address, or upload your appraisal notice instead.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep("address")} className="btn-outline">
              Edit Address
            </button>
            <button onClick={() => setStep("address")} className="btn-primary btn-primary-hover">
              Search Again
            </button>
          </div>
        </section>
      )}

      {step === "confirm" && state.address && (
        <section className="mt-8 card-elev p-6">
          <div className="flex items-center gap-2">
            <span className="badge-soft">Official CAD Record</span>
            <span className="text-xs text-muted-foreground">Source: County Appraisal District</span>
          </div>
          <h2 className="mt-3 font-serif text-2xl font-semibold">Confirm your property</h2>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm">
            <Field label="Owner Name" value={state.ownerName} />
            <Field label="Property Address" value={state.address} />
            <Field label="County / CAD" value={state.cad} />
            <Field label="CAD Account Number" value={state.accountNumber} />
            <Field label="Property Type" value={state.propertyType} />
            <Field label="Tax Year" value={state.taxYear?.toString()} />
            <Field label="Land Value" value={currency(state.landValue)} />
            <Field label="Improvement Value" value={currency(state.improvementValue)} />
            <Field label="Total Appraised Value" value={currency(state.totalValue)} bold />
            {state.legalDescription && <Field label="Legal Description" value={state.legalDescription} />}
            {state.subdivision && <Field label="Subdivision" value={state.subdivision} />}
            {state.geoId && <Field label="Geographic ID" value={state.geoId} />}
            {state.mailingAddress && <Field label="Owner Mailing Address" value={state.mailingAddress} />}
            {state.ownershipPct != null && (
              <Field label="% Ownership" value={`${state.ownershipPct}%`} />
            )}
            {state.protestStatus && <Field label="Protest Status" value={state.protestStatus} />}
          </dl>
          {state.totalValue == null && (
            <p className="mt-3 text-xs text-muted-foreground">
              Value data is not published in this county's public records.
            </p>
          )}

          {state.valueHistory && state.valueHistory.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Value History</h3>
              <ValueHistoryChart history={state.valueHistory} />
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-4">Year</th>
                      <th className="py-1 pr-4">Land</th>
                      <th className="py-1 pr-4">Improvement</th>
                      <th className="py-1 pr-4">Market</th>
                      <th className="py-1 pr-4">Appraised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.valueHistory.map((v) => (
                      <tr key={v.year} className="border-t border-border">
                        <td className="py-1 pr-4">{v.year}</td>
                        <td className="py-1 pr-4">{currency(v.landValue)}</td>
                        <td className="py-1 pr-4">{currency(v.improvementValue)}</td>
                        <td className="py-1 pr-4">{currency(v.marketValue)}</td>
                        <td className="py-1 pr-4">{currency(v.appraisedValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {state.deeds && state.deeds.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Deed History</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-4">Date</th>
                      <th className="py-1 pr-4">Type</th>
                      <th className="py-1 pr-4">Seller</th>
                      <th className="py-1 pr-4">Buyer</th>
                      <th className="py-1 pr-4">Instrument #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.deeds.map((d, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-4">{d.date?.slice(0, 10) ?? "—"}</td>
                        <td className="py-1 pr-4">{d.description ?? d.type ?? "—"}</td>
                        <td className="py-1 pr-4">{d.seller ?? "—"}</td>
                        <td className="py-1 pr-4">{d.buyer ?? "—"}</td>
                        <td className="py-1 pr-4">{d.instrumentNum ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {saveError && <p className="mt-4 text-sm text-destructive">{saveError}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              disabled={saving}
              onClick={async () => {
                setSaveError(null);
                if (user) {
                  setSaving(true);
                  try {
                    await addProperty(user.id, {
                      address: state.address!,
                      cad: state.cad,
                      accountNumber: state.accountNumber,
                      ownerName: state.ownerName,
                      propertyType: state.propertyType,
                      landValue: state.landValue,
                      improvementValue: state.improvementValue,
                      totalValue: state.totalValue,
                      taxYear: state.taxYear,
                    });
                  } catch (err) {
                    setSaving(false);
                    const message =
                      err instanceof Error
                        ? err.message
                        : "Could not save this property. Please try again.";
                    setSaveError(message);
                    toast.error(message);
                    return;
                  }
                  setSaving(false);
                  toast.success("Property saved.");
                }
                updateIntake({ confirmed: true });
                nav({ to: "/ai-report" });
              }}
              className="btn-primary btn-primary-hover disabled:opacity-60"
            >
              {saving ? "Saving…" : "Confirm Property"}
            </button>
            <button onClick={() => setStep("address")} className="btn-outline">
              Edit Address
            </button>
            <label className="btn-outline cursor-pointer">
              <input type="file" className="hidden" accept=".pdf,image/*" onChange={onFile} />
              Upload Another Notice
            </label>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const items = [
    ["Address", ["address"]],
    ["Validate", ["validating", "notfound"]],
    ["Confirm", ["confirm"]],
  ] as const;
  return (
    <ol className="flex items-center gap-2 text-xs font-medium">
      {items.map(([label, keys], i) => {
        const active = (keys as readonly string[]).includes(step);
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full grid place-items-center ${
                active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            {i < items.length - 1 && <span className="w-8 h-px bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

type StepStatus = "done" | "active" | "pending";

// A vertical stepper for "AI is working" screens — numbered circles connected by
// a line, each animating in place as its status changes: the active circle gets
// a pulsing ring (visibly "in progress"), and done gets a checkmark that pops in
// (tw-animate-css's zoom-in/fade-in) instead of the old plain-checkmark +
// strikethrough-text treatment.
function AnimatedSteps({ steps }: { steps: { label: string; status: StepStatus }[] }) {
  return (
    <ol className="mt-4">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="relative grid h-7 w-7 shrink-0 place-items-center">
              {step.status === "active" && (
                <span className="absolute inset-0 rounded-full bg-accent opacity-60 animate-ping" />
              )}
              <span
                className={`relative grid h-7 w-7 place-items-center rounded-full text-xs font-semibold transition-colors duration-300 ${
                  step.status === "done"
                    ? "bg-success text-success-foreground"
                    : step.status === "active"
                      ? "bg-accent text-accent-foreground"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {step.status === "done" ? (
                  <Check className="h-3.5 w-3.5 animate-in zoom-in-50 fade-in duration-300" />
                ) : (
                  i + 1
                )}
              </span>
            </span>
            {i < steps.length - 1 && (
              <span
                className={`w-0.5 flex-1 min-h-[1.5rem] transition-colors duration-500 ${
                  step.status === "done" ? "bg-success" : "bg-border"
                }`}
              />
            )}
          </div>
          <div
            className={`pb-6 text-sm transition-colors duration-300 ${
              step.status === "pending"
                ? "text-muted-foreground"
                : step.status === "active"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
            }`}
          >
            {step.label}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, value, bold }: { label: string; value?: string; bold?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 ${bold ? "text-lg font-semibold" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

function ValueHistoryChart({ history }: { history: CadValueHistoryEntry[] }) {
  const gradientId = useId();
  const points = history
    .filter((h) => h.appraisedValue != null)
    .sort((a, b) => a.year - b.year)
    .map((h) => ({ year: String(h.year), value: h.appraisedValue as number }));

  // Need at least two real points to draw a trend — a single year is just a dot.
  if (points.length < 2) return null;

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const changePct = first !== 0 ? Math.round(((last - first) / first) * 100) : 0;
  // Rising assessed value is the thing worth flagging to a taxpayer (usually means
  // a higher bill), so it's colored as a caution, not a plain neutral trend line.
  const color = changePct > 0 ? "var(--warning)" : changePct < 0 ? "var(--success)" : "var(--muted-foreground)";

  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold" style={{ color }}>
          {changePct > 0 ? "+" : ""}
          {changePct}%
        </span>
        <span className="text-xs text-muted-foreground">
          since {points[0].year} ({currency(first)} → {currency(last)})
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis hide domain={["dataMin - dataMin * 0.05", "dataMax + dataMax * 0.05"]} />
          <Tooltip formatter={(v: number) => currency(v)} labelFormatter={(l) => `Year ${l}`} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
