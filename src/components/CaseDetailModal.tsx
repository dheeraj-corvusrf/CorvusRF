import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import {
  getCase,
  generateCasePrep,
  linkEvidenceDocument,
  recordSettlementOffer,
  acceptSettlement,
  scheduleHearing,
  getHearingPrep,
  recordArbDecision,
  recordEscalation,
  closeCase,
  getCaseResults,
  type ProtestCase,
} from "@/lib/protest-case";
import { uploadDocument } from "@/lib/documents";
import { Skeleton } from "@/components/ui/skeleton";

export function CaseDetailModal({
  userId,
  property,
  protest,
  onClose,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  onClose: () => void;
}) {
  const [caseData, setCaseData] = useState<ProtestCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [current, setCurrent] = useState<ProtestRecord>(protest);

  function load() {
    setLoading(true);
    getCase(protest.id)
      .then(setCaseData)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load this case."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [protest.id]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateCasePrep(protest.id, userId, property);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate the case plan.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpload(itemId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingItemId(itemId);
    try {
      const doc = await uploadDocument(userId, property.id, file, "Protest Evidence");
      await linkEvidenceDocument(itemId, doc.id);
      load();
      toast.success("Evidence uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload this file.");
    } finally {
      setUploadingItemId(null);
    }
  }

  const hasAnyPlan = !!caseData && (!!caseData.strategyRecommendation || caseData.evidenceItems.length > 0);
  const uploadedCount = caseData?.evidenceItems.filter((i) => i.documentId).length ?? 0;
  const totalCount = caseData?.evidenceItems.length ?? 0;

  return (
    <Modal onClose={onClose}>
      <h3 className="font-serif text-xl font-semibold">Case: {property.address}</h3>
      <p className="text-xs text-muted-foreground">AI-generated from your property's official CAD record.</p>

      {loading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          {!hasAnyPlan ? (
            <div className="mt-4 grid gap-3">
              <p className="text-sm text-muted-foreground">No case plan yet.</p>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="btn-accent w-fit text-sm disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate Case Plan"}
              </button>
            </div>
          ) : (
            <div className="mt-4 grid gap-5">
              <section>
                <h4 className="text-sm font-semibold">Strategy</h4>
                {caseData?.strategyRecommendation ? (
                  <div className="mt-1">
                    <span className="badge-soft">{caseData.strategyRecommendation}</span>
                    {caseData.strategyConfidencePct != null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {caseData.strategyConfidencePct}% confidence
                      </span>
                    )}
                    {caseData.strategyRationale && (
                      <p className="mt-1.5 text-sm text-muted-foreground">{caseData.strategyRationale}</p>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Not available yet.</span>
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="text-xs text-accent hover:underline disabled:opacity-60"
                    >
                      {generating ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Evidence Checklist</h4>
                  {totalCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {uploadedCount} of {totalCount} uploaded
                    </span>
                  )}
                </div>
                {totalCount > 0 ? (
                  <div className="mt-2 grid gap-2">
                    {caseData!.evidenceItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm"
                      >
                        <span className="min-w-0 truncate">{item.label}</span>
                        {item.documentFileName ? (
                          <span className="shrink-0 text-xs text-success">✓ {item.documentFileName}</span>
                        ) : (
                          <label
                            className={`shrink-0 btn-outline text-xs py-1 cursor-pointer ${
                              uploadingItemId === item.id ? "opacity-60 pointer-events-none" : ""
                            }`}
                          >
                            {uploadingItemId === item.id ? "Uploading…" : "Upload"}
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,image/*"
                              onChange={(e) => handleUpload(item.id, e)}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Not available yet.</span>
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="text-xs text-accent hover:underline disabled:opacity-60"
                    >
                      {generating ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          <CaseProgress
            protest={current}
            property={property}
            caseData={caseData}
            onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
          />
        </>
      )}

      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="btn-outline text-sm">
          Close
        </button>
      </div>
    </Modal>
  );
}

function CaseProgress({
  protest,
  property,
  caseData,
  onUpdate,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  caseData: ProtestCase | null;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerValue, setOfferValue] = useState("");
  const [offerDate, setOfferDate] = useState(new Date().toISOString().slice(0, 10));
  const [showHearingForm, setShowHearingForm] = useState(false);
  const [hearingDateInput, setHearingDateInput] = useState("");
  const [showHearingSummary, setShowHearingSummary] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionType, setDecisionType] = useState<"approved" | "partial" | "denied">("partial");
  const [decisionDate, setDecisionDate] = useState(new Date().toISOString().slice(0, 10));
  const [decisionValue, setDecisionValue] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeValue, setCloseValue] = useState("");

  async function submitOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerValue) return;
    setBusy(true);
    try {
      const value = Number(offerValue);
      await recordSettlementOffer(protest.id, { value, receivedAt: offerDate });
      onUpdate({
        settlementOfferValue: value,
        settlementOfferReceivedAt: offerDate,
        status: "offer_received",
      });
      setShowOfferForm(false);
      toast.success("Settlement offer recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this offer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptOffer() {
    if (protest.settlementOfferValue == null) return;
    setBusy(true);
    try {
      await acceptSettlement(protest.id, protest.settlementOfferValue);
      onUpdate({
        finalValue: protest.settlementOfferValue,
        escalationPath: "accept",
        closedAt: new Date().toISOString(),
        status: "resolved",
      });
      toast.success("Offer accepted — case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept this offer.");
    } finally {
      setBusy(false);
    }
  }

  async function submitHearing(e: FormEvent) {
    e.preventDefault();
    if (!hearingDateInput) return;
    setBusy(true);
    try {
      await scheduleHearing(protest.id, hearingDateInput);
      onUpdate({ hearingDate: hearingDateInput, status: "hearing_scheduled" });
      setShowHearingForm(false);
      toast.success("Hearing date recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this hearing date.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(e: FormEvent) {
    e.preventDefault();
    if (!decisionValue) return;
    setBusy(true);
    try {
      const finalValue = Number(decisionValue);
      await recordArbDecision(protest.id, { type: decisionType, date: decisionDate, finalValue });
      const resolved = decisionType === "approved";
      onUpdate({
        arbDecision: decisionType,
        arbDecisionDate: decisionDate,
        finalValue,
        status: resolved ? "resolved" : "decision_received",
        ...(resolved ? { closedAt: new Date().toISOString(), escalationPath: "accept" } : {}),
      });
      setShowDecisionForm(false);
      toast.success("ARB decision recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this decision.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEscalate(path: "appeal" | "arbitration") {
    setBusy(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this next step.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptDecision() {
    if (protest.finalValue == null) return;
    setBusy(true);
    try {
      await acceptSettlement(protest.id, protest.finalValue);
      onUpdate({ escalationPath: "accept", closedAt: new Date().toISOString(), status: "resolved" });
      toast.success("Decision accepted — case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(e: FormEvent) {
    e.preventDefault();
    if (!closeValue) return;
    setBusy(true);
    try {
      const finalValue = Number(closeValue);
      await closeCase(protest.id, finalValue);
      onUpdate({ finalValue, closedAt: new Date().toISOString(), status: "resolved" });
      setShowCloseForm(false);
      toast.success("Case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  const results = getCaseResults(protest, property);

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">Case Progress</h4>

      {protest.status === "resolved" ? (
        results ? (
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Field label="Original Value" value={currency(protest.originalValue ?? undefined)} />
            <Field label="Final Value" value={currency(protest.finalValue ?? undefined)} />
            <Field label="Value Reduction" value={currency(results.valueReduction)} bold />
            <Field label="Actual Tax Savings" value={currency(results.actualSavings)} bold success />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Case closed — no final value on file.</p>
        )
      ) : (
        <div className="mt-3 grid gap-4">
          {/* Settlement offer */}
          {protest.status === "offer_received" ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                Settlement offer: {currency(protest.settlementOfferValue ?? undefined)}
                {protest.settlementOfferReceivedAt && ` (${protest.settlementOfferReceivedAt})`}
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={handleAcceptOffer} disabled={busy} className="btn-accent text-xs py-1.5 disabled:opacity-60">
                  Accept Offer
                </button>
                <span className="text-xs text-muted-foreground self-center">
                  or schedule a hearing below to proceed instead
                </span>
              </div>
            </div>
          ) : (
            protest.status !== "decision_received" &&
            protest.status !== "appealing" &&
            protest.status !== "arbitrating" && (
              <div>
                {showOfferForm ? (
                  <form onSubmit={submitOffer} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
                    <label className="grid gap-1 text-xs">
                      Offer amount
                      <input
                        required
                        value={offerValue}
                        onChange={(e) => setOfferValue(e.target.value)}
                        inputMode="decimal"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      Date received
                      <input
                        required
                        type="date"
                        value={offerDate}
                        onChange={(e) => setOfferDate(e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button type="submit" disabled={busy} className="btn-accent text-xs py-1.5 disabled:opacity-60">
                      Save
                    </button>
                  </form>
                ) : (
                  <button onClick={() => setShowOfferForm(true)} className="btn-outline text-xs py-1.5">
                    Record Settlement Offer
                  </button>
                )}
              </div>
            )
          )}

          {/* Hearing */}
          {(protest.status === "hearing_scheduled" ||
            (protest.status !== "decision_received" &&
              protest.status !== "appealing" &&
              protest.status !== "arbitrating")) && (
            <div>
              {protest.status === "hearing_scheduled" ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">Hearing scheduled: {protest.hearingDate}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => setShowHearingSummary((v) => !v)}
                      className="btn-outline text-xs py-1.5"
                    >
                      {showHearingSummary ? "Hide" : "View"} Hearing Summary
                    </button>
                    <button
                      onClick={() => setShowDecisionForm((v) => !v)}
                      className="btn-outline text-xs py-1.5"
                    >
                      Record ARB Decision
                    </button>
                  </div>
                  {showHearingSummary && caseData && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs">
                      {getHearingPrep(caseData, property.address)}
                    </pre>
                  )}
                  {showDecisionForm && (
                    <form onSubmit={submitDecision} className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">
                        Decision
                        <select
                          value={decisionType}
                          onChange={(e) => setDecisionType(e.target.value as typeof decisionType)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="approved">Approved (full reduction granted)</option>
                          <option value="partial">Partial reduction</option>
                          <option value="denied">Denied</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        Decision date
                        <input
                          required
                          type="date"
                          value={decisionDate}
                          onChange={(e) => setDecisionDate(e.target.value)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="grid gap-1 text-xs sm:col-span-2">
                        Final determined value
                        <input
                          required
                          value={decisionValue}
                          onChange={(e) => setDecisionValue(e.target.value)}
                          inputMode="decimal"
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="btn-accent text-xs py-1.5 w-fit disabled:opacity-60"
                      >
                        Save Decision
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div>
                  {showHearingForm ? (
                    <form onSubmit={submitHearing} className="flex flex-wrap items-end gap-2">
                      <label className="grid gap-1 text-xs">
                        Hearing date
                        <input
                          required
                          type="date"
                          value={hearingDateInput}
                          onChange={(e) => setHearingDateInput(e.target.value)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button type="submit" disabled={busy} className="btn-accent text-xs py-1.5 disabled:opacity-60">
                        Save
                      </button>
                    </form>
                  ) : (
                    <button onClick={() => setShowHearingForm(true)} className="btn-outline text-xs py-1.5">
                      Schedule a Hearing
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Decision received, non-approved — next steps */}
          {protest.status === "decision_received" && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                ARB decision: {protest.arbDecision} — final value {currency(protest.finalValue ?? undefined)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">What's next?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={handleAcceptDecision} disabled={busy} className="btn-accent text-xs py-1.5 disabled:opacity-60">
                  Accept
                </button>
                <button
                  onClick={() => handleEscalate("appeal")}
                  disabled={busy}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  File Judicial Appeal
                </button>
                <button
                  onClick={() => handleEscalate("arbitration")}
                  disabled={busy}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  Request Binding Arbitration
                </button>
              </div>
            </div>
          )}

          {/* Appealing / arbitrating */}
          {(protest.status === "appealing" || protest.status === "arbitrating") && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                {protest.status === "appealing" ? "Judicial appeal in progress." : "Binding arbitration in progress."}
              </div>
              {showCloseForm ? (
                <form onSubmit={submitClose} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-xs">
                    Final determined value
                    <input
                      required
                      value={closeValue}
                      onChange={(e) => setCloseValue(e.target.value)}
                      inputMode="decimal"
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button type="submit" disabled={busy} className="btn-accent text-xs py-1.5 disabled:opacity-60">
                    Save
                  </button>
                </form>
              ) : (
                <button onClick={() => setShowCloseForm(true)} className="btn-outline text-xs py-1.5 mt-2">
                  Record Final Outcome
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  bold,
  success,
}: {
  label: string;
  value: string;
  bold?: boolean;
  success?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`${bold ? "font-semibold" : ""} ${success ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card-elev p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
