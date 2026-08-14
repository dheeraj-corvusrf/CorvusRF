import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, LabelList } from "recharts";
import { readIntake, currency, UPLOAD_LIMITS, fileToDataUrl, type IntakeState } from "@/lib/intake-store";
import { MODULES, type Module } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyBilling } from "@/lib/billing";
import { getHealthScore, type HealthScoreResult } from "@/lib/ai-health-score";
import { getModuleAnalysis, type BatchModuleId, type ModuleResultMap } from "@/lib/ai-report-modules";
import { getComps, type CompsResult } from "@/lib/cad-comps";
import { estimateSavings } from "@/lib/savings-estimate";
import { CompsMap } from "@/components/CompsMap";
import { findExistingProperty, addProperty, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { generateCasePrep } from "@/lib/protest-case";
import { uploadDocument, listDocuments, getDocumentUrl, EVIDENCE_DOCUMENT_TYPE, type DocumentRecord } from "@/lib/documents";
import { ProtestAuthorizationFlow } from "@/components/ProtestAuthorizationFlow";
import { CaseDetailModal } from "@/components/CaseDetailModal";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ValueHistorySection } from "@/components/ValueHistorySection";

type ModuleAsyncState = {
  data: unknown;
  loading: boolean;
  error: string | null;
};

export const Route = createFileRoute("/ai-report")({
  head: () => ({
    meta: [
      { title: "AI Property Review — CorvusRF.ai" },
      { name: "description", content: "AI-generated property tax review with 10 premium modules." },
      { property: "og:title", content: "AI Property Review" },
      { property: "og:description", content: "AI analysis of your Texas commercial or residential property." },
    ],
  }),
  component: Report,
});

// Modules 1-3 are free for everyone, signed in or not. Modules 4-10 require a
// paid subscription — there is no sign-in-only tier and no per-user "pick any
// 3" quota; which modules are free is fixed by module number, not user choice.
const FREE_MODULE_COUNT = 3;

function Report() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  const [analyzing, setAnalyzing] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showWall, setShowWall] = useState(false);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  // AI content for every module (health + the 8 batch modules) is fetched lazily —
  // only when the user clicks "Unlock preview" on that specific module, via
  // loadModule() below — rather than all up front, so tokens are only spent on
  // modules the user actually opens.
  const [moduleData, setModuleData] = useState<Record<string, ModuleAsyncState>>({});
  // Separate from moduleData since it's not an AI call and has its own real/empty
  // result shape (CompsResult, not the free-text ModuleResultMap) — only fetched
  // when the Comps module (module 3) is opened.
  const [compsMap, setCompsMap] = useState<{ data: CompsResult | null; loading: boolean }>({
    data: null,
    loading: false,
  });
  // Lets "Request Protest Filing" work from the report page too, not just the
  // Properties dashboard — resolves (or, on first click, creates) the real saved
  // PropertyRecord this report is for, reusing the exact same dedup lookup
  // properties.ts already uses elsewhere so this never creates a duplicate row for
  // a property the user already has on file.
  const [resolvedProperty, setResolvedProperty] = useState<PropertyRecord | null>(null);
  const [existingProtest, setExistingProtest] = useState<ProtestRecord | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [showCase, setShowCase] = useState(false);
  // Evidence (photos/repair estimates/appraisals) the user has uploaded for this
  // property, fed into the Improvement Condition module's analysis — see
  // handleUploadEvidence() and loadModule() below.
  const [evidenceDocs, setEvidenceDocs] = useState<DocumentRecord[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  useEffect(() => {
    const s = readIntake();
    setState(s);
    if (!s.confirmed) {
      nav({ to: "/intake" });
      return;
    }
    const t = setTimeout(() => setAnalyzing(false), 1800);
    return () => clearTimeout(t);
  }, [nav]);

  useEffect(() => {
    if (!user || !state.address) return;
    findExistingProperty(user.id, {
      address: state.address,
      cad: state.cad,
      accountNumber: state.accountNumber,
    })
      .then((property) => {
        setResolvedProperty(property);
        if (!property) return;
        return listProtests(user.id).then((protests) => {
          setExistingProtest(protests.find((p) => p.propertyId === property.id) ?? null);
        });
      })
      .catch((err) => console.error("Could not resolve this property for protest filing:", err));
  }, [user, state.address, state.cad, state.accountNumber]);

  useEffect(() => {
    if (!user || !resolvedProperty) return;
    listDocuments(user.id)
      .then((docs) =>
        setEvidenceDocs(
          docs.filter(
            (d) => d.propertyId === resolvedProperty.id && d.documentType === EVIDENCE_DOCUMENT_TYPE,
          ),
        ),
      )
      .catch((err) => console.error("Could not load uploaded evidence for this property:", err));
  }, [user, resolvedProperty]);

  // Shared by startProtest (below) and handleUploadEvidence — resolves the real
  // saved PropertyRecord this report is for, creating it on first use if the user
  // hasn't saved it yet. Both actions need a real property_id to attach to.
  async function ensureProperty(): Promise<PropertyRecord | null> {
    if (!user) return null;
    if (resolvedProperty) return resolvedProperty;
    try {
      const property = await addProperty(user.id, {
        address: state.address ?? "",
        cad: state.cad,
        accountNumber: state.accountNumber,
        ownerName: state.ownerName,
        propertyType: state.propertyType,
        landValue: state.landValue,
        improvementValue: state.improvementValue,
        totalValue: state.totalValue,
        taxYear: state.taxYear,
        valueHistory: state.valueHistory,
      });
      setResolvedProperty(property);
      return property;
    } catch (err) {
      console.error("Could not save this property:", err);
      return null;
    }
  }

  async function startProtest() {
    const property = await ensureProperty();
    if (!property) return;
    setAuthorizing(true);
  }

  const MAX_EVIDENCE_FILES = 4;

  // Takes a plain File[] rather than the FileList straight off an <input> — FileList
  // is a live view of the input, so if the caller clears input.value right after
  // selecting (to allow re-picking the same file later), the FileList empties out
  // before this async function gets around to reading it. Converting to an array in
  // the onChange handler itself, before the input is cleared, avoids that.
  async function handleUploadEvidence(files: File[]) {
    if (!user) return;
    const property = await ensureProperty();
    if (!property) {
      toast.error("Could not save this property. Please try again.");
      return;
    }
    const room = MAX_EVIDENCE_FILES - evidenceDocs.length;
    if (room <= 0) {
      toast.error(`You can upload up to ${MAX_EVIDENCE_FILES} evidence files per property.`);
      return;
    }
    const toUpload = files.slice(0, room);
    setUploadingEvidence(true);
    try {
      const uploaded: DocumentRecord[] = [];
      for (const file of toUpload) {
        if (file.size > UPLOAD_LIMITS.maxFileBytes) {
          toast.error(`${file.name} exceeds ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB.`);
          continue;
        }
        uploaded.push(await uploadDocument(user.id, property.id, file, EVIDENCE_DOCUMENT_TYPE));
      }
      if (uploaded.length > 0) {
        setEvidenceDocs((prev) => [...prev, ...uploaded]);
        toast.success(`Added ${uploaded.length} evidence file${uploaded.length === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload evidence.");
    } finally {
      setUploadingEvidence(false);
    }
  }

  function loadModule(id: string, opts?: { force?: boolean }) {
    // No AI call backs this module anymore — it renders straight from the
    // deterministic `estimated` value (see estimateSavings() above).
    if (id === "savings") return;
    const existing = moduleData[id];
    if ((existing && (existing.loading || (existing.data && !opts?.force))) || !state.totalValue) return;
    setModuleData((prev) => ({ ...prev, [id]: { data: null, loading: true, error: null } }));
    const input = {
      address: state.address,
      cad: state.cad,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
    };

    async function run() {
      if (id === "health") return getHealthScore(input);
      // Improvement Condition reads uploaded evidence (photos/repair estimates/
      // appraisals) back from storage and attaches it so the AI grounds its
      // guidance in what's actually shown rather than only general advice — see
      // handleUploadEvidence() above and ai-report-modules/index.ts's evidence
      // handling. Capped to the 4 most recent, mirroring the server-side cap.
      if (id === "improvement" && evidenceDocs.length > 0) {
        const recent = evidenceDocs.slice(-4);
        const evidenceImages = await Promise.all(
          recent.map(async (doc) => {
            const url = await getDocumentUrl(doc.storagePath);
            const blob = await fetch(url).then((r) => r.blob());
            const dataUrl = await fileToDataUrl(blob);
            return { mimeType: blob.type || "image/jpeg", dataUrl };
          }),
        );
        return getModuleAnalysis("improvement", { ...input, evidenceImages });
      }
      return getModuleAnalysis(id as BatchModuleId, input);
    }

    run()
      .then((data) => setModuleData((prev) => ({ ...prev, [id]: { data, loading: false, error: null } })))
      .catch((err) =>
        setModuleData((prev) => ({
          ...prev,
          [id]: {
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "Could not generate this analysis.",
          },
        })),
      );
  }

  function loadCompsMap() {
    if (compsMap.data || compsMap.loading) return;
    setCompsMap({ data: null, loading: true });
    getComps({ cad: state.cad, accountNumber: state.accountNumber })
      .then((data) => setCompsMap({ data, loading: false }))
      .catch(() => setCompsMap({ data: null, loading: false }));
  }

  useEffect(() => {
    if (!user) return;
    getMyBilling(user.id)
      .then(({ plan }) =>
        setHasFullAccess(
          plan === "owner_managed" ||
            plan === "corvusrf_managed" ||
            plan === "ai_report" ||
            plan === "managed_protest",
        ),
      )
      .catch(() => setHasFullAccess(false));
  }, [user]);

  // The exact same estimateSavings() call the intake savings screen uses (see
  // savings-estimate.ts) — comps tier first, then the formula tier (base rate +
  // real assessment-ratio + real 10-year value-trend adjustments). Previously
  // this page reimplemented a simplified version (base rate only, no
  // adjustments) and could additionally have this number overridden by a
  // Gemini-guessed percentage once the Savings module was opened — the same
  // property could show two different, and non-deterministic, savings figures
  // depending on which page you were on. Calling the one real function here
  // instead means this page and the intake flow always agree for the same
  // property, and the number never depends on an AI call.
  const [savingsEstimate, setSavingsEstimate] = useState<Awaited<ReturnType<typeof estimateSavings>>>(null);
  useEffect(() => {
    if (!state.totalValue) return;
    estimateSavings({
      cad: state.cad,
      accountNumber: state.accountNumber,
      address: state.address,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
      valueHistory: state.valueHistory,
    })
      .then(setSavingsEstimate)
      .catch((err) => console.error("Savings estimate failed:", err));
  }, [
    state.totalValue,
    state.cad,
    state.accountNumber,
    state.address,
    state.propertyType,
    state.landValue,
    state.improvementValue,
    state.taxYear,
    state.valueHistory,
  ]);

  const estimated = useMemo(() => {
    if (!savingsEstimate || !state.totalValue) return { reduction: 0, savings: 0, rationale: null as string | null };
    if (savingsEstimate.basis === "comps") {
      return {
        reduction: Math.max(0, state.totalValue - savingsEstimate.compsMedian),
        savings: savingsEstimate.amount,
        rationale: `Estimated from ${savingsEstimate.compsCount} real comparable properties, at your county's ~${savingsEstimate.effectiveTaxRatePct}% effective tax rate.`,
      };
    }
    return {
      reduction: Math.round(state.totalValue * (savingsEstimate.reductionPct / 100)),
      savings: savingsEstimate.amount,
      rationale: savingsEstimate.rationale,
    };
  }, [savingsEstimate, state.totalValue]);

  function openModule(m: Module) {
    if (hasFullAccess || m.n <= FREE_MODULE_COUNT) {
      setOpenId(m.id);
      if (!m.requiresUserData) loadModule(m.id);
      if (m.id === "comps") loadCompsMap();
      return;
    }
    setShowWall(true);
  }

  const openModel = MODULES.find((m) => m.id === openId) ?? null;

  return (
    <div className="container-page py-10">
      {/* Summary */}
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card-elev p-6">
          <div className="flex items-center gap-2">
            <span className="badge-soft">Property Summary</span>
            <span className="text-xs text-muted-foreground">Source: Official CAD Record</span>
          </div>
          <h1 className="mt-3 font-serif text-3xl font-semibold">{state.address}</h1>
          <p className="text-muted-foreground text-sm">{state.cad}</p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3 text-sm">
            <Field label="Owner" value={state.ownerName} />
            <Field label="Account #" value={state.accountNumber} />
            <Field label="Type" value={state.propertyType} />
            <Field label="Land" value={currency(state.landValue)} />
            <Field label="Improvement" value={currency(state.improvementValue)} />
            <Field label="Total" value={currency(state.totalValue)} bold />
          </dl>
          <ValueHistorySection history={state.valueHistory ?? []} />
        </div>
        <div className="card-elev overflow-hidden">
          <iframe
            title="Property Map"
            className="w-full h-64 lg:h-full min-h-[240px]"
            src={`https://www.google.com/maps?q=${encodeURIComponent(state.address ?? "Texas")}&output=embed`}
            loading="lazy"
          />
        </div>
      </section>

      {/* Analysis banner */}
      <section className="mt-6 card-elev p-5 flex flex-wrap items-center justify-between gap-3 bg-primary text-primary-foreground">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-primary-foreground/80">
            {analyzing ? "AI is analyzing your property..." : "AI analysis completed."}
          </p>
          <p className="font-serif text-xl">
            {analyzing
              ? "Preparing your property valuation review..."
              : `Estimated tax savings this year: ${currency(estimated.savings)}`}
          </p>
        </div>
        <div className="print:hidden text-right text-sm shrink-0">
          {hasFullAccess ? (
            <div className="text-primary-foreground/70 text-xs">AI Report subscription active</div>
          ) : (
            <>
              <div>{FREE_MODULE_COUNT} of {MODULES.length} modules free</div>
              <div className="text-primary-foreground/70 text-xs">
                Subscribe to unlock the rest
              </div>
            </>
          )}
        </div>
        {user && (
          <div className="w-full pt-3 border-t border-primary-foreground/20 print:hidden">
            {existingProtest ? (
              <div className="flex items-center gap-3">
                <span className="badge-soft">Protest {existingProtest.status.replace("_", " ")}</span>
                <button
                  onClick={() => setShowCase(true)}
                  className="btn-outline border-white/30 text-primary-foreground hover:bg-background/10 text-sm py-1.5"
                >
                  View Case
                </button>
              </div>
            ) : (
              <button onClick={startProtest} className="btn-accent text-sm py-1.5">
                Request Protest Filing
              </button>
            )}
          </div>
        )}
      </section>

      {/* Modules */}
      <section className="mt-8 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-2xl font-semibold">10 Premium AI Modules</h2>
          <button onClick={() => window.print()} className="btn-outline text-sm py-2">
            Export Report
          </button>
        </div>
        <p className="text-muted-foreground text-sm">
          {hasFullAccess
            ? "All modules unlocked with your AI Report subscription."
            : `Modules 1-${FREE_MODULE_COUNT} are free for everyone. Subscribe to unlock modules ${FREE_MODULE_COUNT + 1}-${MODULES.length}.`}
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <ModuleCard
              key={m.id}
              m={m}
              analyzing={analyzing}
              unlocked={hasFullAccess || m.n <= FREE_MODULE_COUNT}
              hasFullAccess={hasFullAccess}
              onOpen={() => openModule(m)}
            />
          ))}
        </div>
      </section>

      {/* Print-only linear report — reuses the exact same module-rendering logic as
          the modal above (ModulePreviewBody), stacking every module the user has
          already unlocked and viewed into one printable document. Deliberately
          does NOT trigger new AI calls at export time (no re-fetch here) — export
          captures "your report so far," the same content already shown on screen,
          rather than firing up to 9 fresh AI calls the moment someone clicks print. */}
      <section className="hidden print:block mt-8">
        <h2 className="font-serif text-2xl font-semibold">AI Property Tax Report</h2>
        <p className="text-sm text-muted-foreground">
          {state.address} · {state.cad} · Generated {new Date().toLocaleDateString()}
        </p>
        {(() => {
          const printable = MODULES.filter(
            (m) => moduleData[m.id]?.data != null || (m.id === "comps" && compsMap.data),
          );
          if (printable.length === 0) {
            return (
              <p className="mt-4 text-sm text-muted-foreground">
                Open a module above, then use Export Report again to include it here.
              </p>
            );
          }
          return printable.map((m) => (
            <div key={m.id} className="mt-6" style={{ breakInside: "avoid" }}>
              <h3 className="font-serif text-lg font-semibold">
                {m.n}. {m.title}
              </h3>
              <p className="text-sm text-muted-foreground">{m.question}</p>
              <ModulePreviewBody
                m={m}
                estimated={estimated}
                state={state}
                moduleState={moduleData[m.id]}
                compsMap={compsMap}
                onRetry={() => {}}
                allowEvidenceUpload={false}
                evidenceDocs={evidenceDocs}
                uploadingEvidence={false}
                onUploadEvidence={() => {}}
                onForceReload={() => {}}
              />
            </div>
          ));
        })()}
      </section>

      {/* Preview modal */}
      {openModel && (
        <Modal onClose={() => setOpenId(null)}>
          <div className="flex items-center justify-between">
            <span className="badge-soft">{hasFullAccess ? "Unlocked" : "Free Preview"}</span>
            <button
              onClick={() => setOpenId(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <h3 className="mt-2 font-serif text-2xl font-semibold">{openModel.title}</h3>
          <p className="text-muted-foreground">{openModel.question}</p>
          <ModulePreviewBody
            m={openModel}
            estimated={estimated}
            state={state}
            moduleState={moduleData[openModel.id]}
            compsMap={compsMap}
            onRetry={() => loadModule(openModel.id)}
            allowEvidenceUpload
            evidenceDocs={evidenceDocs}
            uploadingEvidence={uploadingEvidence}
            onUploadEvidence={handleUploadEvidence}
            onForceReload={() => loadModule(openModel.id, { force: true })}
          />
          <div className="mt-6 flex gap-2 justify-end">
            <button onClick={() => setOpenId(null)} className="btn-outline">
              Return to Property Summary
            </button>
            {!hasFullAccess && (
              <Link to="/pricing" className="btn-accent">
                Subscribe & Unlock Full Report
              </Link>
            )}
          </div>
        </Modal>
      )}

      {/* Subscription wall */}
      {showWall && (
        <Modal onClose={() => setShowWall(false)}>
          <h3 className="font-serif text-2xl font-semibold">
            Unlock Your Complete AI Property Analysis
          </h3>
          <p className="text-muted-foreground mt-2">
            Modules 1-{FREE_MODULE_COUNT} are free to preview. Subscribe to unlock modules{" "}
            {FREE_MODULE_COUNT + 1}-{MODULES.length} and the complete property analysis.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link to="/pricing" className="btn-accent">
              Subscribe & Unlock Full Report
            </Link>
            <Link to="/pricing" className="btn-outline">
              Compare Plans
            </Link>
            <button onClick={() => setShowWall(false)} className="btn-outline sm:col-span-2">
              Return to Property Summary
            </button>
          </div>
        </Modal>
      )}

      {authorizing && user && resolvedProperty && (
        <ProtestAuthorizationFlow
          userId={user.id}
          property={resolvedProperty}
          userEmail={user.email}
          open={authorizing}
          onOpenChange={(open) => setAuthorizing(open)}
          onDone={(created) => {
            setExistingProtest(created);
            generateCasePrep(created.id, user.id, resolvedProperty).catch((err) =>
              console.error("Case prep generation failed:", err),
            );
          }}
        />
      )}

      {showCase && user && resolvedProperty && existingProtest && (
        <CaseDetailModal
          userId={user.id}
          property={resolvedProperty}
          protest={existingProtest}
          onClose={() => setShowCase(false)}
        />
      )}
    </div>
  );
}

function ModuleCard({
  m,
  analyzing,
  unlocked,
  hasFullAccess,
  onOpen,
}: {
  m: Module;
  analyzing: boolean;
  unlocked: boolean;
  hasFullAccess: boolean;
  onOpen: () => void;
}) {
  const status = analyzing ? "Analyzing" : m.status;
  return (
    <div className="card-elev p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">Module {m.n}</div>
          <h3 className="font-semibold">{m.title}</h3>
        </div>
        <StatusChip status={status} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{m.question}</p>
      <div className={`mt-3 text-sm ${!unlocked ? "locked-blur" : ""}`}>{m.teaser}</div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {hasFullAccess ? (
          <span className="text-xs font-medium text-success">Included</span>
        ) : unlocked ? (
          <span className="text-xs font-medium text-success">Free preview</span>
        ) : (
          <span className="text-xs text-muted-foreground">Requires subscription</span>
        )}
        <button onClick={onOpen} className="btn-outline text-sm py-2">
          {hasFullAccess ? "View report" : unlocked ? "View preview" : "Subscribe to unlock"}
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Module["status"] }) {
  const map: Record<Module["status"], string> = {
    Analyzing: "bg-secondary text-muted-foreground",
    Completed: "bg-success/15 text-success",
    "Additional Data Needed": "bg-warning/20 text-warning-foreground",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${map[status]}`}>
      {status}
    </span>
  );
}

function ModulePreviewBody({
  m,
  estimated,
  state,
  moduleState,
  compsMap,
  onRetry,
  allowEvidenceUpload,
  evidenceDocs,
  uploadingEvidence,
  onUploadEvidence,
  onForceReload,
}: {
  m: Module;
  estimated: { reduction: number; savings: number; rationale: string | null };
  state: IntakeState;
  moduleState: ModuleAsyncState | undefined;
  compsMap: { data: CompsResult | null; loading: boolean };
  onRetry: () => void;
  allowEvidenceUpload: boolean;
  evidenceDocs: DocumentRecord[];
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[]) => void;
  onForceReload: () => void;
}) {
  if (m.requiresUserData) {
    return (
      <div className="mt-4 card-elev p-4 bg-secondary/60">
        <p className="text-sm">
          This module requires private financial data (P&L, rent roll, or operating statement) to
          complete. Upload once you subscribe — AI will run the income approach and compare to your
          assessed value.
        </p>
      </div>
    );
  }

  const loading = !moduleState || moduleState.loading;
  const error = moduleState?.error;

  // Deterministic, not AI-generated — `estimated` (computed by the caller) is
  // the exact same estimateSavings() call the intake savings screen uses, so
  // this always matches that screen for the same property. No loading/error
  // state here since there's no AI call backing this module anymore.
  if (m.id === "savings") {
    const current = state.totalValue ?? 0;
    const reduced = Math.max(0, current - estimated.reduction);
    return (
      <div className="mt-4 grid gap-3">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Estimated Tax Savings
          </div>
          <div className="font-serif text-4xl font-bold text-success">
            <AnimatedNumber value={estimated.savings} format={currency} duration={900} />
          </div>
        </div>
        <ValueComparisonChart current={current} reduced={reduced} />
        <p className="text-center text-xs text-muted-foreground">
          {estimated.rationale ?? "Based on your county's real effective tax rate."}
        </p>
      </div>
    );
  }

  // The comps map is fetched independently of the AI guidance text (a different
  // Edge Function, its own loading/error state) — rendered here, before the
  // generic loading/error gate below, so a rate-limited or slow AI call never
  // hides a map that already loaded successfully.
  if (m.id === "comps") {
    const d = moduleState?.data as ModuleResultMap["comps"] | undefined;
    const map = compsMap.data;
    return (
      <div className="mt-4">
        {compsMap.loading && (
          <div className="h-[280px] animate-pulse rounded-lg border border-border bg-secondary/40" />
        )}
        {map?.subject && map.comps.length > 0 && (
          <>
            <div className="text-sm font-medium">
              {map.comps.length} nearby properties in the same subdivision
            </div>
            <CompsMap subject={map.subject} comps={map.comps} />
          </>
        )}
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">AI is generating this analysis…</p>
        ) : error ? (
          <div className="mt-3">
            <ErrorWithRetry message={error} onRetry={onRetry} />
          </div>
        ) : d ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">{d.guidance}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.checklist.map((c, i) => (
                <Chip key={i} icon>
                  {c}
                </Chip>
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {m.id === "health" ? "AI is scoring this property…" : "AI is generating this analysis…"}
      </p>
    );
  }
  if (error) {
    return <ErrorWithRetry message={error} onRetry={onRetry} />;
  }
  if (!moduleState?.data) return null;

  if (m.id === "health") {
    const data = moduleState.data as HealthScoreResult;
    return (
      <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_1fr] items-center">
        <RadialGauge value={data.score} sublabel="Protest Opportunity" />
        <div>
          <p className="text-sm">{data.summary}</p>
          {data.factors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.factors.map((f, i) => (
                <Chip key={i}>{f}</Chip>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  switch (m.id) {
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      return (
        <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_1fr] items-center">
          <RadialGauge value={d.confidencePct} sublabel="AI Confidence" />
          <div>
            <div className="font-serif text-xl font-semibold">{d.recommendation}</div>
            <p className="mt-1 text-sm text-muted-foreground">{d.rationale}</p>
          </div>
        </div>
      );
    }
    case "site": {
      const d = moduleState.data as ModuleResultMap["site"];
      return (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">{d.guidance}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.checklist.map((c, i) => (
              <Chip key={i} icon>
                {c}
              </Chip>
            ))}
          </div>
        </div>
      );
    }
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["improvement"];
      return (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">{d.guidance}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.checklist.map((c, i) => (
              <Chip key={i} icon>
                {c}
              </Chip>
            ))}
          </div>
          {allowEvidenceUpload && (
            <div className="mt-4 border-t border-border/60 pt-4 print:hidden">
              <div className="text-sm font-medium">Add Evidence</div>
              <p className="text-xs text-muted-foreground">
                Property photos, repair estimates, or appraisals — AI will cite specific details
                from what you upload instead of only general guidance.
              </p>
              {evidenceDocs.length > 0 && (
                <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  {evidenceDocs.map((doc) => (
                    <li key={doc.id}>{doc.fileName}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label
                  className={`btn-outline text-sm cursor-pointer ${uploadingEvidence ? "pointer-events-none opacity-60" : ""}`}
                >
                  {uploadingEvidence ? "Uploading…" : "Upload Evidence"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    className="hidden"
                    disabled={uploadingEvidence}
                    onChange={(e) => {
                      const selected = e.target.files ? Array.from(e.target.files) : [];
                      e.target.value = "";
                      if (selected.length > 0) onUploadEvidence(selected);
                    }}
                  />
                </label>
                {evidenceDocs.length > 0 && (
                  <button disabled={loading} onClick={onForceReload} className="btn-outline text-sm disabled:opacity-60">
                    Regenerate with Evidence
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      return (
        <div className="mt-4 grid gap-3">
          <ZoningBadge matches={d.matches} />
          <p className="text-sm text-muted-foreground">{d.assessment}</p>
        </div>
      );
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      return (
        <div className="mt-4 grid gap-2">
          {d.checklist.map((c, i) => (
            <PriorityRow key={i} item={c} rank={i} />
          ))}
        </div>
      );
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      return (
        <div className="mt-4 grid gap-3">
          <div className="rounded-lg bg-accent/10 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-accent">
              AI Recommendation
            </div>
            <div className="mt-1 font-serif text-lg font-semibold">{d.recommendation}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <FactBox label="Basis" value={d.basis} />
            <FactBox label="Next Step" value={d.nextStep} />
          </div>
        </div>
      );
    }
  }

  return <p className="mt-4 text-sm">{m.teaser}</p>;
}

function scoreColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning)";
  return "var(--destructive)";
}

function RadialGauge({ value, sublabel }: { value: number; sublabel?: string }) {
  const color = scoreColor(value);
  const data = [{ value, fill: color }];
  return (
    <div className="relative mx-auto h-40 w-40">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="72%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
          barSize={14}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold" style={{ color }}>
          <AnimatedNumber value={value} />
        </div>
        {sublabel && (
          <div className="px-3 text-center text-[10px] text-muted-foreground">{sublabel}</div>
        )}
      </div>
    </div>
  );
}

function ValueComparisonChart({ current, reduced }: { current: number; reduced: number }) {
  const data = [
    { name: "Current", value: current, fill: "var(--muted-foreground)" },
    { name: "Estimated", value: reduced, fill: "var(--success)" },
  ];
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
        <XAxis type="number" hide domain={[0, (max: number) => max * 1.15]} />
        <YAxis
          type="category"
          dataKey="name"
          width={70}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
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

function Chip({ children, icon }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-3 py-1.5 text-xs font-medium">
      {icon && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
      {children}
    </span>
  );
}

function PriorityRow({ item, rank }: { item: string; rank: number }) {
  const tone =
    rank === 0
      ? { bg: "bg-destructive/10", text: "text-destructive", label: "Top Priority" }
      : rank === 1
        ? { bg: "bg-warning/15", text: "text-warning-foreground", label: "High Priority" }
        : { bg: "bg-secondary/60", text: "text-muted-foreground", label: null };
  return (
    <div className={`flex items-center gap-3 rounded-lg p-3 ${tone.bg}`}>
      {tone.label && (
        <span className={`shrink-0 text-[10px] font-bold uppercase ${tone.text}`}>
          {tone.label}
        </span>
      )}
      <span className="text-sm">{item}</span>
    </div>
  );
}

const ZONING_STATUS = {
  consistent: {
    Icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/10",
    label: "Classification Consistent",
  },
  inconsistent: {
    Icon: AlertTriangle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    label: "Possible Mismatch",
  },
  uncertain: {
    Icon: HelpCircle,
    color: "text-warning-foreground",
    bg: "bg-warning/15",
    label: "Uncertain — Needs Review",
  },
} as const;

function ZoningBadge({ matches }: { matches: keyof typeof ZONING_STATUS }) {
  const { Icon, color, bg, label } = ZONING_STATUS[matches];
  return (
    <div className={`flex items-center gap-3 rounded-lg p-4 ${bg}`}>
      <Icon className={`h-8 w-8 shrink-0 ${color}`} />
      <div className={`font-serif text-lg font-semibold ${color}`}>{label}</div>
    </div>
  );
}

function FactBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function ErrorWithRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 grid gap-2">
      <p className="text-sm text-destructive">{message}</p>
      <button onClick={onRetry} className="btn-outline w-fit text-sm py-1.5">
        Retry
      </button>
    </div>
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

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Local duplicate of @/components/Modal (kept separate here since this one's
  // content already renders its own inline "Close" button, unlike the shared
  // component's icon-button header) — still needs the same scroll lock, since
  // nothing else stops the page behind it from scrolling too.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm print:hidden"
      onClick={onClose}
    >
      <div className="card-elev p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
