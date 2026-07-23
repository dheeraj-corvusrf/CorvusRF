import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  readIntake,
  updateIntake,
  appendAudit,
  detectMismatch,
  currency,
  LOW_CONFIDENCE_THRESHOLD,
  type IntakeState,
} from "@/lib/intake-store";
import { classifyDocument } from "@/lib/document-ai";
import { cadLookup } from "@/lib/cad-lookup";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useAuth } from "@/lib/auth";
import { addProperty } from "@/lib/properties";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "Property Intake — CorvusRF.ai" },
      {
        name: "description",
        content: "Validate your Texas commercial property and start your free AI review.",
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
  const [noticeName, setNoticeName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const s = readIntake();
    setState(s);
    if (s.address) {
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
    if (f.size > 15 * 1024 * 1024) {
      setError("Document exceeds 15 MB maximum file size.");
      return;
    }
    if (!/pdf|png|jpe?g/i.test(f.type)) {
      setError("Supported types: PDF, PNG, JPG.");
      return;
    }
    setError(null);
    setNoticeName(f.name);
    updateIntake({ noticeFileName: f.name });
    setStep("classifying");

    try {
      const dataUrl = await fileToDataUrl(f);
      appendAudit({ actor: "user", action: "upload_document", to: f.name });
      const extraction = await classifyDocument({ fileName: f.name, mimeType: f.type, dataUrl });
      appendAudit({
        actor: "ai",
        action: "classify_document",
        to: `${extraction.documentType} (conf ${(extraction.confidence * 100).toFixed(0)}%)`,
      });
      const prior = readIntake();
      const mismatchFlag = detectMismatch(extraction, prior);
      const lowConfidenceFlag = extraction.confidence < LOW_CONFIDENCE_THRESHOLD;
      if (lowConfidenceFlag) {
        appendAudit({ actor: "ai", action: "flag_low_confidence" });
      }
      if (mismatchFlag) {
        appendAudit({ actor: "ai", action: "flag_mismatch" });
      }
      updateIntake({
        extraction,
        extractionEdited: undefined,
        extractionConfirmed: false,
        lowConfidenceFlag,
        mismatchFlag,
      });
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

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Failed to read file"));
      r.readAsDataURL(file);
    });
  }

  return (
    <div className="container-page py-12 max-w-3xl">
      <Stepper step={step} />

      {step === "address" && (
        <section className="mt-8 card-elev p-6">
          <h1 className="font-serif text-2xl font-semibold">Enter your commercial property.</h1>
          <p className="mt-1 text-muted-foreground">
            Enter an address, or upload your Texas appraisal notice.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!address.trim()) return;
              updateIntake({ address: address.trim() });
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
              PDF / PNG / JPG, up to 15 MB, up to 5 pages.
            </p>
            <label className="mt-3 btn-outline cursor-pointer inline-flex">
              <input type="file" className="hidden" accept=".pdf,image/*" onChange={onFile} />
              Upload Appraisal Notice
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              <Link to="/how-it-works" className="underline">
                View sample appraisal notice
              </Link>
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
          <ul className="mt-4 space-y-2 text-sm">
            <ProgressLine label="Validating Property Address..." done />
            <ProgressLine label="Identifying County Appraisal District..." done />
            <ProgressLine label="Retrieving Official Property Information..." active />
          </ul>
        </section>
      )}

      {step === "classifying" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold">AI is reading your document…</h2>
          <ul className="mt-4 space-y-2 text-sm">
            <ProgressLine label="OCR & text extraction" done />
            <ProgressLine label="Classifying document type" active />
            <ProgressLine label="Extracting owner, values, and deadlines" active />
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            This usually takes a few seconds. Do not close this tab.
          </p>
        </section>
      )}

      {step === "notfound" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold">
            We couldn't locate this commercial property.
          </h2>
          <p className="mt-1 text-muted-foreground">
            Please enter a valid commercial property address.
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
          </dl>
          {state.totalValue == null && (
            <p className="mt-3 text-xs text-muted-foreground">
              Value data is not published in this county's public records.
            </p>
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

function ProgressLine({
  label,
  done,
  active,
}: {
  label: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <span className="h-4 w-4 rounded-full bg-success text-success-foreground grid place-items-center text-[10px]">
          ✓
        </span>
      ) : (
        <span
          className={`h-4 w-4 rounded-full border-2 ${active ? "border-accent border-t-transparent animate-spin" : "border-border"}`}
        />
      )}
      <span className={done ? "text-muted-foreground line-through" : ""}>{label}</span>
    </li>
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
