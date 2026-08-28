import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Lock,
  FileWarning,
  Target,
  FileText,
  BarChart3,
  ArrowRight,
  MapPin,
  Building2,
  Home,
  Percent,
  DollarSign,
  Award,
  Activity,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  LabelList,
  ScatterChart,
  Scatter,
} from "recharts";
import {
  readIntake,
  updateIntake,
  currency,
  UPLOAD_LIMITS,
  fileToDataUrl,
  type IntakeState,
} from "@/lib/intake-store";
import { MODULES, type Module } from "@/lib/modules";
import type { IconColor } from "@/lib/icon-colors";
import { useAuth } from "@/lib/auth";
import { getMyBilling } from "@/lib/billing";
import {
  getHealthScore,
  type HealthScoreResult,
  type HealthScoreBreakdownEntry,
} from "@/lib/ai-health-score";
import {
  getModuleAnalysis,
  askModuleQuestion,
  type BatchModuleId,
  type ModuleAnalysisInput,
  type ModuleResultMap,
  type StrategyEntry,
} from "@/lib/ai-report-modules";
import { getComps, type CompsResult, type CompProperty } from "@/lib/cad-comps";
import { computeComparableStats, type RankedComp } from "@/lib/comps-analysis";
import { estimateSavings } from "@/lib/savings-estimate";
import {
  classifyPropertyCategory,
  getAssessmentRatioInfo,
  applyValueTrendAdjustment,
} from "@/lib/texas-tax-rates";
import { CompsMap, useLeaflet } from "@/components/CompsMap";
import { findExistingProperty, addProperty, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { generateCasePrep } from "@/lib/protest-case";
import {
  uploadDocument,
  listDocuments,
  getDocumentUrl,
  EVIDENCE_DOCUMENT_TYPE,
  type DocumentRecord,
} from "@/lib/documents";
import { ProtestAuthorizationFlow } from "@/components/ProtestAuthorizationFlow";
import { CaseDetailModal } from "@/components/CaseDetailModal";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ValueHistorySection } from "@/components/ValueHistorySection";
import { Modal } from "@/components/Modal";

type ModuleAsyncState = {
  data: unknown;
  loading: boolean;
  error: string | null;
};

export const Route = createFileRoute("/ai-report")({
  head: () => ({
    meta: [
      { title: "AI Property Review — CorvusPT.ai" },
      { name: "description", content: "AI-generated property tax review with 10 premium modules." },
      { property: "og:title", content: "AI Property Review" },
      {
        property: "og:description",
        content: "AI analysis of your Texas commercial or residential property.",
      },
    ],
  }),
  component: Report,
});

// Modules 1-3 are free for everyone, signed in or not. Modules 4-10 require a
// paid subscription — there is no sign-in-only tier and no per-user "pick any
// 3" quota; which modules are free is fixed by module number, not user choice.
const FREE_MODULE_COUNT = 3;

// Real comps-derived signal fed into Module 2's prompt (see loadModule() below) —
// median/min/max of the same real comparable market values CompsMap/CompsScatter
// already render, not a new fetch or an invented figure.
function buildCompsSummary(compsData: CompsResult | null) {
  const values = (compsData?.comps ?? [])
    .map((c) => c.marketValue)
    .filter((v): v is number => v != null);
  if (values.length === 0 || !compsData) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: compsData.comps.length,
  };
}

// Real value-history-jump signal fed into Module 2's prompt — same
// applyValueTrendAdjustment() real trend-vs-own-history check success-
// probability.ts already reuses; baseReductionPct is passed as 0 since only the
// jump detection is needed here, not a reduction percentage.
function buildValueTrend(valueHistory: IntakeState["valueHistory"]) {
  const history = (valueHistory ?? [])
    .map((h) => ({ year: h.year, value: h.appraisedValue ?? h.marketValue ?? null }))
    .filter((h): h is { year: number; value: number } => h.value != null);
  const trend = applyValueTrendAdjustment(0, history);
  return { jumpTriggered: trend.jumpTriggered, jumpPct: trend.jumpPct };
}

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
            (d) =>
              d.propertyId === resolvedProperty.id &&
              (d.documentType === EVIDENCE_DOCUMENT_TYPE ||
                d.documentType?.startsWith("Strategy Evidence: ")),
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

  // Shared pool across Improvement Condition's evidence upload and Module 2's
  // per-strategy evidence gate (up to 5-6 strategies) — raised from the original
  // 4 (Improvement-only) to give each a realistic amount of headroom.
  const MAX_EVIDENCE_FILES = 8;

  // Takes a plain File[] rather than the FileList straight off an <input> — FileList
  // is a live view of the input, so if the caller clears input.value right after
  // selecting (to allow re-picking the same file later), the FileList empties out
  // before this async function gets around to reading it. Converting to an array in
  // the onChange handler itself, before the input is cleared, avoids that.
  //
  // `strategyId` tags uploads coming from Module 2's per-strategy evidence gate
  // (see StrategyDetail in ModulePreviewBody) with which strategy they satisfy;
  // omitted, it falls back to the original Improvement Condition document type so
  // that module's existing upload flow is unchanged.
  async function handleUploadEvidence(files: File[], strategyId?: string) {
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
    const documentType = strategyId ? `Strategy Evidence: ${strategyId}` : EVIDENCE_DOCUMENT_TYPE;
    setUploadingEvidence(true);
    try {
      const uploaded: DocumentRecord[] = [];
      for (const file of toUpload) {
        if (file.size > UPLOAD_LIMITS.maxFileBytes) {
          toast.error(
            `${file.name} exceeds ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
          );
          continue;
        }
        uploaded.push(await uploadDocument(user.id, property.id, file, documentType));
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

  // Free-text fallback for Module 2's per-strategy evidence gate (see
  // StrategyDetail) — persisted the same way the rest of intake state is, via
  // sessionStorage, so it survives a refresh but never leaves the browser.
  function answerStrategy(strategyId: string, answer: string) {
    const next = updateIntake({
      strategyAnswers: { ...(state.strategyAnswers ?? {}), [strategyId]: answer },
    });
    setState(next);
    toast.success("Answer saved.");
  }

  // Powers every module's "Ask AI" box (see ModuleQABox) — grounded in the
  // same record loadModule() sends plus whatever that module has already
  // generated, so an answer never comes from a blank slate.
  async function askQuestion(moduleId: string, question: string): Promise<string> {
    const input: ModuleAnalysisInput = {
      address: state.address,
      cad: state.cad,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
    };
    return askModuleQuestion(moduleId, question, input, moduleData[moduleId]?.data ?? null);
  }

  function loadModule(id: string, opts?: { force?: boolean }) {
    // No AI call backs this module anymore — it renders straight from the
    // deterministic `estimated` value (see estimateSavings() above).
    if (id === "savings") return;
    const existing = moduleData[id];
    if ((existing && (existing.loading || (existing.data && !opts?.force))) || !state.totalValue)
      return;
    setModuleData((prev) => ({ ...prev, [id]: { data: null, loading: true, error: null } }));
    const input: ModuleAnalysisInput = {
      address: state.address,
      cad: state.cad,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
    };

    // Module 2 ("strategy") ranks the same 5 arguments modules 3/4/5/7/6
    // investigate — scoped to just this module's own entry (not the whole
    // ranking) so its prompt gets one clear priority signal, not noise from
    // strategies it has nothing to do with. Only present once Module 2 has
    // resolved — see the eager-load effect's sequencing below.
    const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
    if (strategyData) {
      const relevant = strategyData.strategies
        .filter((s) => s.relatedModules.includes(id))
        .map((s) => ({ strategy: s.name, score: s.strengthScore }));
      if (relevant.length > 0) input.priorityContext = relevant;
    }

    // Real signals (never fabricated) shared by Module 1 (health) and Module
    // 2 (strategy) — same helpers, same real sources, for both.
    if (id === "health" || id === "strategy") {
      input.compsSummary = buildCompsSummary(compsMap.data);
      input.assessmentRatio = getAssessmentRatioInfo(
        state.cad,
        classifyPropertyCategory(state.propertyType),
      );
      input.valueTrend = buildValueTrend(state.valueHistory);
      input.evidenceFileNames = evidenceDocs.map((d) => d.fileName);
    }

    async function run() {
      if (id === "health") return getHealthScore(input);

      // Grounds the Market Value module's guidance in the real comps already
      // fetched for this property (median/range/count) instead of generic
      // advice — same real signal, same helper, as the Strategy module above.
      if (id === "comps") {
        input.compsSummary = buildCompsSummary(compsMap.data);
      }

      // Improvement Condition reads uploaded evidence (photos/repair estimates/
      // appraisals) back from storage and attaches it so the AI grounds its
      // guidance in what's actually shown rather than only general advice — see
      // handleUploadEvidence() above and ai-report-modules/index.ts's evidence
      // handling. Capped to the 4 most recent, mirroring the server-side cap.
      const improvementDocs = evidenceDocs.filter((d) => d.documentType === EVIDENCE_DOCUMENT_TYPE);
      if (id === "improvement" && improvementDocs.length > 0) {
        const recent = improvementDocs.slice(-4);
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
      .then((data) =>
        setModuleData((prev) => ({ ...prev, [id]: { data, loading: false, error: null } })),
      )
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
            plan === "managed_protest" ||
            plan === "beta",
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
  const [savingsEstimate, setSavingsEstimate] =
    useState<Awaited<ReturnType<typeof estimateSavings>>>(null);
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
    if (!savingsEstimate || !state.totalValue)
      return { reduction: 0, savings: 0, rationale: null as string | null, effectiveTaxRatePct: 0 };
    if (savingsEstimate.basis === "comps") {
      return {
        reduction: Math.max(0, state.totalValue - savingsEstimate.compsMedian),
        savings: savingsEstimate.amount,
        rationale: `Estimated from ${savingsEstimate.compsCount} real comparable properties, at your county's ~${savingsEstimate.effectiveTaxRatePct}% effective tax rate.`,
        effectiveTaxRatePct: savingsEstimate.effectiveTaxRatePct,
      };
    }
    return {
      reduction: Math.round(state.totalValue * (savingsEstimate.reductionPct / 100)),
      savings: savingsEstimate.amount,
      rationale: savingsEstimate.rationale,
      effectiveTaxRatePct: savingsEstimate.effectiveTaxRatePct,
    };
  }, [savingsEstimate, state.totalValue]);

  // Eager-loads real data for the module overview grid below (real scores,
  // checklists, etc. instead of generic teaser text) as soon as the property
  // is known. Free-preview modules (1-3) load for everyone; the rest only
  // once hasFullAccess resolves true, so a signed-out visitor or an
  // unsubscribed user never burns an AI call analyzing a module they can't
  // see yet — they still get the same "Subscribe to unlock" card either way.
  // "savings" needs no call (estimateSavings() above already runs
  // unconditionally) and "income" needs user-uploaded data that doesn't
  // exist yet, so both are skipped here exactly like loadModule() itself
  // already skips "savings".
  // comps/site/improvement/zoning investigate the exact 5 strategies Module 2
  // ranks, so they're sequenced to fire after it (see the effect below) rather
  // than in this immediate batch, which is why they're excluded here.
  const SEQUENCED_AFTER_STRATEGY = new Set(["comps", "site", "improvement", "zoning"]);

  useEffect(() => {
    if (!state.totalValue) return;
    for (const m of MODULES) {
      if (m.id === "savings" || m.id === "income" || SEQUENCED_AFTER_STRATEGY.has(m.id)) continue;
      if (m.n <= FREE_MODULE_COUNT || hasFullAccess) loadModule(m.id);
    }
    // loadModule closes over moduleData for its own-fetch guard, which is
    // exactly why it's left out of this dependency list — including it would
    // re-fire this effect (and, via the loading-state update inside
    // loadModule, immediately re-fire itself again) on every single module's
    // own load, an infinite loop just like the hub doors' entrance-animation
    // bug earlier. Property identity and access level are the only real
    // triggers for "should we start loading modules."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.totalValue, hasFullAccess]);

  // comps/site/improvement/zoning wait for Module 2 (Strategy) to resolve —
  // or a capped 6s timeout, so a slow/failed Strategy call never stalls the
  // rest of the page indefinitely — before firing, so loadModule() above can
  // attach Module 2's per-strategy score as priorityContext to each. Also
  // kicks off the comps map fetch immediately (unsequenced): it's not an AI
  // call, and Module 2 itself wants compsSummary as an input when available.
  useEffect(() => {
    if (!state.totalValue) return;
    loadCompsMap();
    const strategyState = moduleData.strategy;
    const fire = () => {
      for (const id of SEQUENCED_AFTER_STRATEGY) {
        const m = MODULES.find((mm) => mm.id === id);
        if (m && (m.n <= FREE_MODULE_COUNT || hasFullAccess)) loadModule(m.id);
      }
    };
    if (strategyState?.data || strategyState?.error) {
      fire();
      return;
    }
    const t = setTimeout(fire, 6000);
    return () => clearTimeout(t);
    // Same rationale as the effect above for omitting loadModule/loadCompsMap;
    // moduleData.strategy's data/error are read explicitly instead of the
    // whole moduleData map so this only re-fires on Module 2's own state
    // transitions, not every other module's load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.totalValue, hasFullAccess, moduleData.strategy?.data, moduleData.strategy?.error]);

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
              <div>
                {FREE_MODULE_COUNT} of {MODULES.length} modules free
              </div>
              <div className="text-primary-foreground/70 text-xs">Subscribe to unlock the rest</div>
            </>
          )}
        </div>
        {user && (
          <div className="w-full pt-3 border-t border-primary-foreground/20 print:hidden">
            {existingProtest ? (
              <div className="flex items-center gap-3">
                <span className="badge-soft">
                  Protest {existingProtest.status.replace("_", " ")}
                </span>
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
              unlocked={hasFullAccess || m.n <= FREE_MODULE_COUNT}
              hasFullAccess={hasFullAccess}
              moduleState={moduleData[m.id]}
              moduleData={moduleData}
              compsMap={compsMap}
              estimated={estimated}
              propertyType={state.propertyType}
              totalValue={state.totalValue}
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
              <h3 className="font-serif text-lg font-semibold">{m.shortName}</h3>
              <div className="text-xs font-medium text-muted-foreground">{m.title}</div>
              <p className="text-sm text-muted-foreground">{m.question}</p>
              <ModulePreviewBody
                m={m}
                estimated={estimated}
                state={state}
                moduleState={moduleData[m.id]}
                moduleData={moduleData}
                compsMap={compsMap}
                onRetry={() => {}}
                allowEvidenceUpload={false}
                evidenceDocs={evidenceDocs}
                uploadingEvidence={false}
                onUploadEvidence={() => {}}
                onForceReload={() => {}}
                onAnswerStrategy={() => {}}
                onAskQuestion={() => Promise.resolve("")}
              />
            </div>
          ));
        })()}
      </section>

      {/* Preview modal */}
      {openModel && (
        <Modal onClose={() => setOpenId(null)}>
          <span className="badge-soft">{hasFullAccess ? "Unlocked" : "Free Preview"}</span>
          <div className="mt-2 flex items-center gap-2">
            <NumberBadge n={openModel.n} color={openModel.color} size="lg" />
            <h3 className="font-serif text-2xl font-semibold">{openModel.shortName}</h3>
          </div>
          <div className="text-sm font-medium text-muted-foreground">{openModel.title}</div>
          <p className="text-muted-foreground">{openModel.question}</p>
          <ModulePreviewBody
            m={openModel}
            estimated={estimated}
            state={state}
            moduleState={moduleData[openModel.id]}
            moduleData={moduleData}
            compsMap={compsMap}
            onRetry={() => loadModule(openModel.id)}
            allowEvidenceUpload
            evidenceDocs={evidenceDocs}
            uploadingEvidence={uploadingEvidence}
            onUploadEvidence={handleUploadEvidence}
            onForceReload={() => loadModule(openModel.id, { force: true })}
            onAnswerStrategy={answerStrategy}
            onAskQuestion={askQuestion}
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
  unlocked,
  hasFullAccess,
  moduleState,
  moduleData,
  compsMap,
  estimated,
  propertyType,
  totalValue,
  onOpen,
}: {
  m: Module;
  unlocked: boolean;
  hasFullAccess: boolean;
  moduleState: ModuleAsyncState | undefined;
  moduleData: Record<string, ModuleAsyncState>;
  compsMap: { data: CompsResult | null; loading: boolean };
  estimated: {
    reduction: number;
    savings: number;
    rationale: string | null;
    effectiveTaxRatePct: number;
  };
  propertyType?: string;
  totalValue?: number | null;
  onOpen: () => void;
}) {
  // Reflects what's actually happening now that the grid eager-loads real
  // data (see the effect above Report()), not the old static per-module
  // metadata — "Completed" used to show even for a module nobody had opened
  // yet, before it had actually run.
  const status: CardStatus = !unlocked
    ? "Locked"
    : m.id === "income"
      ? "Needs Data"
      : m.id === "savings"
        ? "Completed"
        : !moduleState || moduleState.loading
          ? "Analyzing"
          : moduleState.error
            ? "Error"
            : "Completed";
  const insight = unlocked ? moduleInsight(m, moduleState, compsMap, estimated, totalValue) : null;
  // Module 2's own score for this module's strategy, once it's resolved — see
  // the priorityContext sequencing in loadModule()/the eager-load effects
  // above. Only comps/site/improvement/income/zoning map to one of Module 2's
  // 5 fixed strategies; other modules never show this badge.
  const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
  const priorityScore = strategyData?.strategies.find((s) =>
    s.relatedModules.includes(m.id),
  )?.strengthScore;
  return (
    <div className="card-elev overflow-hidden flex flex-col">
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <NumberBadge n={m.n} color={m.color} size="lg" />
            <h3 className="min-w-0 truncate font-serif text-sm font-bold uppercase tracking-wide">
              {m.shortName}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {priorityScore != null && (
              <span
                className="whitespace-nowrap text-[10px] font-semibold"
                style={{ color: scoreColor(priorityScore) }}
                title="Strategy module's priority ranking for this argument"
              >
                Priority {priorityScore}
              </span>
            )}
            <StatusChip status={status} />
          </div>
        </div>
        <div className="mt-4 flex-1 flex flex-col justify-center">
          <ModuleVisual
            m={m}
            unlocked={unlocked}
            moduleState={moduleState}
            moduleData={moduleData}
            compsMap={compsMap}
            estimated={estimated}
            propertyType={propertyType}
            totalValue={totalValue}
            onOpen={onOpen}
          />
        </div>
      </div>
      {insight && <InsightBanner text={insight} color={m.color} />}
      <div className="px-5 pb-5 pt-3 flex items-center justify-between gap-2">
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

type CardStatus = "Locked" | "Analyzing" | "Completed" | "Needs Data" | "Error";

function StatusChip({ status }: { status: CardStatus }) {
  const map: Record<CardStatus, string> = {
    Locked: "bg-secondary text-muted-foreground",
    Analyzing: "bg-secondary text-muted-foreground",
    Completed: "bg-success/15 text-success",
    "Needs Data": "bg-warning/20 text-warning-foreground",
    Error: "bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${map[status]}`}
    >
      {status}
    </span>
  );
}

// The small, glanceable visual each overview card shows in place of the old
// paragraph of teaser text — real data once loaded (see the eager-load
// effect above Report()), a skeleton while it's in flight, and a lock
// (never a fetch attempt) for gated modules nobody has subscribed to yet.
function ModuleVisual({
  m,
  unlocked,
  moduleState,
  moduleData,
  compsMap,
  estimated,
  propertyType,
  totalValue,
  onOpen,
}: {
  m: Module;
  unlocked: boolean;
  moduleState: ModuleAsyncState | undefined;
  moduleData: Record<string, ModuleAsyncState>;
  compsMap: { data: CompsResult | null; loading: boolean };
  estimated: {
    reduction: number;
    savings: number;
    rationale: string | null;
    effectiveTaxRatePct: number;
  };
  propertyType?: string;
  totalValue?: number | null;
  onOpen: () => void;
}) {
  if (!unlocked) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" />
        <span className="text-xs">Subscribe to see this analysis</span>
      </div>
    );
  }

  if (m.id === "savings") {
    return (
      <div className="grid gap-1.5">
        <FormulaChain
          reduction={estimated.reduction}
          ratePct={estimated.effectiveTaxRatePct}
          savings={estimated.savings}
        />
        {estimated.savings > 0 && <CostBenefitRow savings={estimated.savings} />}
      </div>
    );
  }

  if (m.id === "income") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileWarning className="h-4 w-4 shrink-0" />
        <span className="text-xs">Upload financials to run this analysis</span>
      </div>
    );
  }

  if (m.id === "comps" && compsMap.data?.comps.length) {
    const stats = computeComparableStats(compsMap.data.subject, compsMap.data.comps, totalValue);
    return (
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif text-xl font-bold">{compsMap.data.comps.length}</span>
          <span className="text-xs text-muted-foreground">comparable properties found nearby</span>
        </div>
        <div className="mt-1.5">
          <CompsScatter
            comps={compsMap.data.comps}
            subjectValue={compsMap.data.subject?.marketValue ?? null}
          />
        </div>
        {stats.limitedData ? (
          <div className="mt-1.5 rounded-md bg-warning/15 px-2 py-1 text-[11px] text-warning-foreground">
            Limited Comparable Data
          </div>
        ) : (
          stats.indicated && (
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <div className="rounded-md bg-success/10 px-2 py-1">
                <div className="text-[8px] uppercase tracking-wide text-success">
                  Indicated Range
                </div>
                <div className="truncate text-[11px] font-semibold text-success">
                  {compactCurrency(stats.indicated.min)}–{compactCurrency(stats.indicated.max)}
                </div>
              </div>
              {stats.subjectValue != null && (
                <div className="rounded-md bg-destructive/10 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-wide text-destructive">
                    CAD Value
                  </div>
                  <div className="truncate text-[11px] font-semibold text-destructive">
                    {compactCurrency(stats.subjectValue)}
                  </div>
                </div>
              )}
              {stats.valuationGapPct != null && (
                <div className="rounded-md bg-secondary/60 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-wide text-muted-foreground">
                    Valuation Gap
                  </div>
                  <div
                    className="truncate text-[11px] font-semibold"
                    style={{
                      color: scoreColor(100 - Math.min(100, Math.abs(stats.valuationGapPct))),
                    }}
                  >
                    {stats.valuationGapPct > 0 ? "+" : ""}
                    {stats.valuationGapPct}%
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    );
  }

  const loading = !moduleState || moduleState.loading || (m.id === "comps" && compsMap.loading);
  if (loading) return <SkeletonVisual />;
  if (moduleState?.error) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-left text-xs text-destructive underline underline-offset-2 hover:text-destructive/80"
      >
        Couldn't load — click to view &amp; retry
      </button>
    );
  }
  if (!moduleState?.data) return null;

  switch (m.id) {
    case "health": {
      const d = moduleState.data as HealthScoreResult;
      const label =
        d.score >= 70
          ? "Strong Opportunity"
          : d.score >= 40
            ? "Moderate Opportunity"
            : "Limited Opportunity";
      const top3 = d.scoreBreakdown.slice(0, 3);
      return (
        <div>
          <SpeedometerGauge value={d.score} size="sm" />
          <div className="text-center text-sm font-semibold" style={{ color: scoreColor(d.score) }}>
            {label}
          </div>
          {!d.dataSufficient && (
            <div className="mt-1.5 text-center text-[10px] font-semibold text-warning-foreground">
              Additional Data Needed
            </div>
          )}
          {top3.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
              {top3.map((b) => {
                const Icon = breakdownIcon(b.label);
                return (
                  <div key={b.label} className="flex flex-col items-center gap-1">
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full ${m.color.bg} ${m.color.text}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[9px] leading-tight text-muted-foreground">
                      {b.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {estimated.savings > 0 && (
            <div className="mt-3 text-center">
              <div className="font-serif text-lg font-bold text-success">
                {currency(estimated.savings)}
              </div>
              <div className="text-[10px] text-muted-foreground">potential tax savings</div>
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Confidence: {d.confidencePct}%
          </div>
        </div>
      );
    }
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      if (d.strategies.length === 0) return null;
      return <StrategyRankList strategies={d.strategies} color={m.color} max={5} />;
    }
    case "comps": {
      const d = moduleState.data as ModuleResultMap["comps"];
      return (
        <div className="text-xs text-muted-foreground">
          {d.checklist.length} evidence item{d.checklist.length === 1 ? "" : "s"} to gather
        </div>
      );
    }
    case "site": {
      const d = moduleState.data as ModuleResultMap["site"];
      const subject = compsMap.data?.subject;
      return (
        <div>
          {subject ? (
            <SiteMapThumb lat={subject.latitude} lng={subject.longitude} height={128} />
          ) : (
            <div className="grid h-32 place-items-center rounded-lg bg-secondary/40">
              <MapPin className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="mt-2.5">
            <MiniMeter value={d.priorityScore} label="documentation priority" />
            {d.checklist.length > 0 && (
              <div className="mt-1.5">
                <ChecklistIconRows items={d.checklist.slice(0, 2)} color={m.color} />
              </div>
            )}
          </div>
        </div>
      );
    }
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["improvement"];
      return (
        <div>
          <ImprovementIconRing items={d.checklist} color={m.color} />
          <div className="mt-1.5">
            <MiniMeter value={d.priorityScore} label="condition priority" />
          </div>
        </div>
      );
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      return (
        <ZoningFlow
          matches={d.matches}
          stated={propertyType}
          typical={d.typicalClassification || undefined}
        />
      );
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      return <EvidenceQuadrant items={d.items} />;
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
      const evidenceData = moduleData.evidence?.data as ModuleResultMap["evidence"] | undefined;
      const keyEvidence =
        evidenceData?.items.find((i) => i.importance === "High")?.item ??
        evidenceData?.items[0]?.item ??
        null;
      const comps =
        compsMap.data?.comps.filter(
          (c): c is typeof c & { marketValue: number } => c.marketValue != null,
        ) ?? [];
      const valueRange =
        comps.length > 0
          ? `${compactCurrency(Math.min(...comps.map((c) => c.marketValue)))}–${compactCurrency(Math.max(...comps.map((c) => c.marketValue)))}`
          : null;
      return (
        <div>
          <div className="mb-1.5 flex justify-center">
            <span
              className={`grid h-10 w-10 place-items-center rounded-full ${m.color.bg} ${m.color.text}`}
            >
              <Award className="h-5 w-5" />
            </span>
          </div>
          <ExecutiveBadges
            strategy={strategyData?.strategies[0]?.name ?? null}
            keyEvidence={keyEvidence}
            valueRange={valueRange}
            nextStep={d.nextStep}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

// Compact "$4.8M"/"$120K" formatting for tight badge/axis labels where the
// full currency() output (e.g. "$4,800,000") would overflow.
function compactCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`;
  return currency(n);
}

function CompsScatter({
  comps,
  subjectValue,
}: {
  comps: { marketValue: number | null }[];
  subjectValue: number | null;
}) {
  const points = comps
    .filter((c): c is { marketValue: number } => c.marketValue != null)
    .map((c) => ({ x: c.marketValue, y: 0 }));
  if (points.length === 0) return null;
  const values = points.map((p) => p.x).concat(subjectValue != null ? [subjectValue] : []);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.2 || max * 0.1 || 1000;
  return (
    <div>
      <ResponsiveContainer width="100%" height={44}>
        <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <XAxis type="number" dataKey="x" domain={[min - pad, max + pad]} hide />
          <YAxis type="number" dataKey="y" domain={[-1, 1]} hide />
          <Scatter data={points} fill="var(--muted-foreground)" />
          {subjectValue != null && (
            <Scatter data={[{ x: subjectValue, y: 0 }]} fill="var(--accent)" shape="diamond" />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{compactCurrency(min)}</span>
        <span>◆ subject vs comps</span>
        <span>{compactCurrency(max)}</span>
      </div>
    </div>
  );
}

// A real deed date (see CompProperty.lastTransferDt), never a sale price —
// formatted plainly so it can't be mistaken for one.
function formatTransferDate(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatAcres(v?: number | null): string | null {
  if (v == null) return null;
  return `${v.toFixed(v < 1 ? 2 : 1)} ac`;
}

// $-per-acre, the real per-unit metric this data actually supports — not a
// $/SF substitute, since no building-size field exists (see comps-analysis.ts).
function valuePerAcre(marketValue?: number | null, acreage?: number | null): number | null {
  if (marketValue == null || !acreage || acreage < 0.05) return null;
  return marketValue / acreage;
}

// Real per-comp comparison table — Property / Last Transfer / Land Size /
// Assessed Value / $ per Acre / Distance / Similarity, all real fields (see
// comps-analysis.ts). Each row expands on click (not hover, so it works on
// touch too) rather than a tooltip, same pattern as Module 2's StrategyDetail.
function ComparableTable({ ranked }: { ranked: RankedComp[] }) {
  const [expandedPid, setExpandedPid] = useState<number | null>(null);
  if (ranked.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-secondary/60 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Property</th>
            <th className="px-3 py-2 font-semibold">Last Transfer</th>
            <th className="px-3 py-2 font-semibold">Land Size</th>
            <th className="px-3 py-2 font-semibold">Assessed Value</th>
            <th className="px-3 py-2 font-semibold">$ / Acre</th>
            <th className="px-3 py-2 font-semibold">Distance</th>
            <th className="px-3 py-2 font-semibold">Similarity</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((c) => {
            const expanded = expandedPid === c.pid;
            const perAcre = valuePerAcre(c.marketValue, c.legalAcreage);
            return (
              <Fragment key={c.pid}>
                <tr
                  onClick={() => setExpandedPid(expanded ? null : c.pid)}
                  className="cursor-pointer border-t border-border/60 hover:bg-secondary/40"
                >
                  <td className="max-w-[10rem] truncate px-3 py-2">
                    {c.address || `Property #${c.pid}`}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatTransferDate(c.lastTransferDt) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatAcres(c.legalAcreage) ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {c.marketValue != null ? compactCurrency(c.marketValue) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {perAcre != null ? compactCurrency(perAcre) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.distanceMi.toFixed(2)} mi</td>
                  <td
                    className="px-3 py-2 font-semibold"
                    style={{ color: scoreColor(c.similarity) }}
                  >
                    {c.similarity}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-t border-border/60 bg-secondary/30">
                    <td colSpan={7} className="px-3 py-3">
                      <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>Owner: {c.ownerName ?? "Not on file"}</div>
                        <div>Land value: {c.landValue != null ? currency(c.landValue) : "—"}</div>
                        <div>
                          Improvement value:{" "}
                          {c.improvementValue != null ? currency(c.improvementValue) : "—"}
                        </div>
                        <div>
                          Appraised value:{" "}
                          {c.appraisedValue != null ? currency(c.appraisedValue) : "—"}
                        </div>
                        {c.zoning && <div>Zoning: {c.zoning}</div>}
                        <div>Source: {c.pid ? `CAD record #${c.pid}` : "CAD public record"}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniMeter({ value, label }: { value: number; label: string }) {
  const color = scoreColor(value);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-secondary/60">
        <div className="h-2 rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function EvidenceQuadrant({ items }: { items: ModuleResultMap["evidence"]["items"] }) {
  if (items.length === 0) return <div className="text-xs text-muted-foreground">No gaps found</div>;
  const cell = (importance: "High" | "Low", availability: "High" | "Low") =>
    items.filter((i) => i.importance === importance && i.availability === availability);
  const focus = cell("High", "Low");
  const quadrants: { label: string; count: number; tone: string }[] = [
    {
      label: "High Importance · Missing",
      count: focus.length,
      tone: "bg-destructive/10 text-destructive",
    },
    {
      label: "High Importance · Available",
      count: cell("High", "High").length,
      tone: "bg-success/10 text-success",
    },
    {
      label: "Low Importance · Missing",
      count: cell("Low", "Low").length,
      tone: "bg-warning/15 text-warning-foreground",
    },
    {
      label: "Low Importance · Available",
      count: cell("Low", "High").length,
      tone: "bg-secondary/60 text-muted-foreground",
    },
  ];
  return (
    <div>
      <div className="flex gap-1">
        <div className="flex w-3 shrink-0 items-center justify-center">
          <span
            className="whitespace-nowrap text-[7px] uppercase tracking-wide text-muted-foreground"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Importance
          </span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-1.5">
            {quadrants.map((q) => (
              <div key={q.label} className={`rounded-md px-2 py-1.5 ${q.tone}`}>
                <div className="text-[8px] font-semibold uppercase tracking-wide">{q.label}</div>
                <div className="text-lg font-bold leading-tight">{q.count}</div>
              </div>
            ))}
          </div>
          <div className="mt-0.5 text-center text-[7px] uppercase tracking-wide text-muted-foreground">
            Availability
          </div>
        </div>
      </div>
      {focus.length > 0 && (
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive">
          <span className="truncate">Focus Here First: {focus.map((i) => i.item).join(", ")}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </div>
      )}
    </div>
  );
}

function FormulaIcon({
  Icon,
  value,
  label,
  tone,
}: {
  Icon: LucideIcon;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-center leading-tight">
        <div className="text-sm font-bold">{value}</div>
        <div className="text-[9px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FormulaChain({
  reduction,
  ratePct,
  savings,
}: {
  reduction: number;
  ratePct: number;
  savings: number;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <FormulaIcon
        Icon={Home}
        value={compactCurrency(reduction)}
        label="value reduction"
        tone="bg-sky-500/15 text-sky-600"
      />
      <span className="text-sm text-muted-foreground">×</span>
      <FormulaIcon
        Icon={Percent}
        value={`${ratePct}%`}
        label="tax rate"
        tone="bg-warning/20 text-warning-foreground"
      />
      <span className="text-sm text-muted-foreground">=</span>
      <FormulaIcon
        Icon={DollarSign}
        value={compactCurrency(savings)}
        label="savings"
        tone="bg-success/15 text-success"
      />
    </div>
  );
}

function ExecutiveBadges({
  strategy,
  keyEvidence,
  valueRange,
  nextStep,
}: {
  strategy: string | null;
  keyEvidence: string | null;
  valueRange: string | null;
  nextStep: string;
}) {
  const badges = [
    { icon: Target, label: "Primary Strategy", value: strategy },
    { icon: FileText, label: "Key Evidence", value: keyEvidence },
    { icon: BarChart3, label: "Value Range", value: valueRange },
    { icon: ArrowRight, label: "Next Step", value: nextStep },
  ];
  return (
    <div className="grid grid-cols-4 gap-1">
      {badges.map((b) => (
        <div
          key={b.label}
          className="flex flex-col items-center gap-0.5 rounded-md bg-secondary/40 px-1 py-1.5 text-center"
        >
          <b.icon className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="w-full truncate text-[7px] uppercase tracking-wide text-muted-foreground">
            {b.label}
          </div>
          <div className="w-full truncate text-[9px] font-semibold">{b.value || "—"}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Reference-infographic chrome shared by every module: a
// numbered badge (ModuleCard header + modal header) and a one-line colored
// insight banner on each card, derived from data already loaded elsewhere
// in this file — no new AI calls, just a deterministic read of state that's
// already here (score thresholds, sorted factors, etc.).
function NumberBadge({
  n,
  color,
  size = "sm",
}: {
  n: number;
  color: IconColor;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "h-8 w-8 text-sm" : "h-5 w-5 text-[10px]";
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${dim}`}
      style={{ backgroundColor: color.solid }}
    >
      {n}
    </span>
  );
}

function moduleInsight(
  m: Module,
  moduleState: ModuleAsyncState | undefined,
  compsMap: { data: CompsResult | null; loading: boolean },
  estimated: { savings: number },
  totalValue: number | null | undefined,
): string | null {
  if (m.id === "income") return "Upload financials to unlock";
  if (m.id === "savings") return estimated.savings > 0 ? "Strong Potential Savings" : null;
  if (!moduleState?.data) return null;
  switch (m.id) {
    case "health": {
      const d = moduleState.data as HealthScoreResult;
      return d.score >= 70
        ? "Strong Opportunity"
        : d.score >= 40
          ? "Moderate Opportunity"
          : "Limited Opportunity";
    }
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      if (d.strategies.length === 0) return null;
      if (d.topStrategySummary) return d.topStrategySummary;
      const top = d.strategies.slice(0, 2).map((s) => s.name);
      return `AI recommends focus on ${top.join(" & ")}`;
    }
    case "comps": {
      const stats = computeComparableStats(
        compsMap.data?.subject ?? null,
        compsMap.data?.comps ?? [],
        totalValue,
      );
      if (stats.limitedData || stats.valuationGapPct == null) return null;
      return stats.valuationGapPct > 0 ? "Potential Overvaluation" : "Fairly Valued";
    }
    case "site":
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["site"] | ModuleResultMap["improvement"];
      return d.priorityScore >= 70
        ? "High Documentation Priority"
        : d.priorityScore >= 40
          ? "Moderate Documentation Priority"
          : "Low Documentation Priority";
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      return ZONING_STATUS[d.matches].label;
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      const gaps = d.items.filter((i) => i.importance === "High" && i.availability === "Low");
      return gaps.length > 0 ? "Focus Here First" : "Evidence Well Covered";
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      return d.recommendation;
    }
    default:
      return null;
  }
}

// Full-bleed band flush with the card's own edges (the card is
// overflow-hidden so this never pokes past its rounded corners) — matches
// the reference infographic's solid colored footer bars, rather than an
// inset rounded pill floating inside the card's padding.
function InsightBanner({ text, color }: { text: string; color: IconColor }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-5 py-2.5 text-sm font-semibold ${color.bg} ${color.text}`}
    >
      <span className="truncate">{text}</span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </div>
  );
}

// Generic icon+text row for free-text AI checklist items (Site/Improvement
// Condition) — deliberately the SAME icon for every row rather than
// guessing a specific category (floodplain vs. easement vs. drainage) from
// unstructured text the AI never actually categorized.
// Real satellite thumbnail for Site Condition, reusing the subject
// property's own coordinates — already loaded for every visitor via the
// comps fetch (see loadCompsMap() in Report()), not a second API call.
// Only renders when that data exists (TrueProdigy-backed counties only,
// same real-data gate CompsMap/CompsScatter already use); Site Condition
// falls back to just the checklist rows everywhere else. Esri World
// Imagery is a free, no-API-key satellite tile source, attributed per its
// terms the same way CompsMap already attributes OpenStreetMap.
function SiteMapThumb({ lat, lng, height = 140 }: { lat: number; lng: number; height?: number }) {
  const mods = useLeaflet();
  if (!mods) {
    return (
      <div
        className="animate-pulse rounded-lg border border-border bg-secondary/40"
        style={{ height }}
      />
    );
  }
  const { L, MapContainer, TileLayer, Marker } = mods;
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:9999px;background:var(--accent);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  // Leaflet's default attribution control (including its "Leaflet" link and
  // built-in donation flag icon) is sized for a full map, not an 80px card
  // thumbnail — at that size it visually swallows most of the tile image.
  // Below that threshold we drop the control and show a minimal text credit
  // instead, which still satisfies Esri's attribution requirement; the
  // larger 220px modal map keeps Leaflet's normal control.
  const compact = height < 150;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border" style={{ height }}>
      <MapContainer
        center={[lat, lng]}
        zoom={17}
        zoomControl={false}
        attributionControl={!compact}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        <Marker position={[lat, lng]} icon={icon} />
      </MapContainer>
      {compact && (
        <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-black/45 px-1 text-[8px] leading-tight text-white">
          Tiles © Esri
        </span>
      )}
    </div>
  );
}

// Central building icon with up to 4 checklist items as small icon badges
// at its corners — same generic-icon principle as ChecklistIconRows (the
// checklist is free AI text, not typed defect categories, so every badge
// uses the same icon rather than guessing "this one is roof damage").
// Full item text is always available via each badge's title tooltip and,
// in full, via ChecklistIconRows in the modal.
function ImprovementIconRing({ items, color }: { items: string[]; color: IconColor }) {
  const corners = items.slice(0, 4);
  const positions = [
    "-top-1 -left-1",
    "-top-1 -right-1",
    "-bottom-1 -left-1",
    "-bottom-1 -right-1",
  ];
  return (
    <div className="mx-auto flex flex-col items-center gap-1">
      <div className="relative grid h-20 w-20 place-items-center">
        <Building2 className="h-9 w-9 text-muted-foreground" />
        {corners.map((item, i) => (
          <span
            key={i}
            title={item}
            className={`absolute grid h-6 w-6 place-items-center rounded-full border-2 border-card ${color.bg} ${color.text} ${positions[i]}`}
          >
            <AlertTriangle className="h-3 w-3" />
          </span>
        ))}
      </div>
      {items.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {items.length} factor{items.length === 1 ? "" : "s"} worth documenting
        </div>
      )}
    </div>
  );
}

function ChecklistIconRows({ items, color }: { items: string[]; color: IconColor }) {
  return (
    <div className="grid gap-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5">
          <span
            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${color.bg} ${color.text}`}
          >
            <AlertTriangle className="h-3 w-3" />
          </span>
          <span className="min-w-0 flex-1 line-clamp-2 text-xs">{item}</span>
        </div>
      ))}
    </div>
  );
}

// Icon for a ranked strategy — reuses the Module's own icon for the 5 fixed
// strategies (so "Comparable Sales" shows the same icon as the Market Value
// module card, etc.) via relatedModules; falls back to a generic icon for an
// AI-added "Other: ..." strategy, which doesn't map to any of Modules 3-7.
function strategyIcon(s: StrategyEntry): LucideIcon {
  const relatedId = s.relatedModules[0];
  const mod = relatedId ? MODULES.find((mm) => mm.id === relatedId) : undefined;
  return mod?.icon ?? Target;
}

// Stable per-strategy key for tagging uploaded evidence (documents.document_type,
// see handleUploadEvidence in Report()) and storing the free-text evidence-gate
// answer (IntakeState.strategyAnswers) — derived from the AI's own strategy name
// so no separate id/lookup table is needed.
function strategySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Compact ranked row for the card preview — used by both ModuleVisual's
// "strategy" case and StrategyDetail's header below.
function StrategyBar({ s, rank, color }: { s: StrategyEntry; rank: number; color: IconColor }) {
  const Icon = strategyIcon(s);
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: color.solid }}
      >
        {rank}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-muted-foreground">{s.name}</div>
        <div className="h-1.5 rounded-full bg-secondary/60">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${s.strengthScore}%`, backgroundColor: scoreColor(s.strengthScore) }}
          />
        </div>
      </div>
      {s.dataSufficient ? (
        <span
          className="w-7 shrink-0 text-right text-xs font-semibold"
          style={{ color: scoreColor(s.strengthScore) }}
        >
          {s.strengthScore}
        </span>
      ) : (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">
          Data Needed
        </span>
      )}
    </div>
  );
}

function StrategyRankList({
  strategies,
  color,
  max,
}: {
  strategies: StrategyEntry[];
  color: IconColor;
  max?: number;
}) {
  const shown = max ? strategies.slice(0, max) : strategies;
  return (
    <div className="grid gap-2">
      {shown.map((s, i) => (
        <StrategyBar key={s.name} s={s} rank={i + 1} color={color} />
      ))}
    </div>
  );
}

// Full per-strategy breakdown for the modal — why AI selected it, supporting
// findings, valuation relevance, existing/missing evidence, confidence, and
// recommended investigation, all real fields from the "strategy" MODULE_SPEC
// (see supabase/functions/ai-report-modules/index.ts). When the AI flagged
// dataSufficient false, this also renders the evidence gate: an upload button
// (tagging the file with this strategy via handleUploadEvidence's strategyId
// param) and a free-text answer fallback — if the user supplies neither, the
// score still shows but is marked as an unguaranteed estimate, per the
// non-blocking evidence-gate design (Module 2 never renders an empty state).
function StrategyDetail({
  s,
  rank,
  color,
  evidenceDocs,
  uploadingEvidence,
  onUploadEvidence,
  answer,
  onAnswerStrategy,
}: {
  s: StrategyEntry;
  rank: number;
  color: IconColor;
  evidenceDocs: DocumentRecord[];
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId: string) => void;
  answer: string | undefined;
  onAnswerStrategy: (strategyId: string, answer: string) => void;
}) {
  const Icon = strategyIcon(s);
  const slug = strategySlug(s.name);
  const uploaded = evidenceDocs.filter((d) => d.documentType === `Strategy Evidence: ${slug}`);
  const [draft, setDraft] = useState(answer ?? "");
  const hasAnyEvidence = uploaded.length > 0 || !!answer?.trim();

  return (
    <div className="card-elev p-4">
      <div className="flex items-center gap-2.5">
        <NumberBadge n={rank} color={color} size="sm" />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{s.name}</div>
          {s.primaryReason && (
            <div className="truncate text-xs text-muted-foreground">{s.primaryReason}</div>
          )}
        </div>
        {s.dataSufficient ? (
          <span
            className="shrink-0 font-serif text-lg font-bold"
            style={{ color: scoreColor(s.strengthScore) }}
          >
            {s.strengthScore}
          </span>
        ) : (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-warning/20 px-2 py-1 text-[10px] font-semibold text-warning-foreground">
            Additional Data Needed
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2.5 text-xs sm:grid-cols-2">
        {s.whySelected && (
          <div>
            <div className="font-semibold text-foreground">Why AI selected it</div>
            <p className="text-muted-foreground">{s.whySelected}</p>
          </div>
        )}
        {s.supportingFindings && (
          <div>
            <div className="font-semibold text-foreground">Supporting findings</div>
            <p className="text-muted-foreground">{s.supportingFindings}</p>
          </div>
        )}
        {s.valuationRelevance && (
          <div>
            <div className="font-semibold text-foreground">Potential valuation relevance</div>
            <p className="text-muted-foreground">{s.valuationRelevance}</p>
          </div>
        )}
        {s.recommendedInvestigation && (
          <div>
            <div className="font-semibold text-foreground">Recommended investigation</div>
            <p className="text-muted-foreground">{s.recommendedInvestigation}</p>
          </div>
        )}
      </div>

      {(s.existingEvidence.length > 0 || s.missingEvidence.length > 0) && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {s.existingEvidence.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-success">
                Existing Evidence
              </div>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {s.existingEvidence.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
          {s.missingEvidence.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-warning-foreground">
                Missing Evidence
              </div>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {s.missingEvidence.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <MiniMeter value={s.confidencePct} label="Confidence" />
      </div>

      {s.relatedModules.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.relatedModules.map((id) => {
            const relatedModule = MODULES.find((mm) => mm.id === id);
            return relatedModule ? <Chip key={id}>Related: {relatedModule.shortName}</Chip> : null;
          })}
        </div>
      )}

      {!s.dataSufficient && (
        <div className="mt-3 border-t border-border/60 pt-3 print:hidden">
          <div className="text-xs font-semibold text-warning-foreground">
            Additional Data Needed
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload supporting documents or answer below so AI can complete this strategy with real
            evidence.
          </p>
          {uploaded.length > 0 && (
            <ul className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
              {uploaded.map((d) => (
                <li key={d.id}>{d.fileName}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label
              className={`btn-outline text-xs cursor-pointer ${uploadingEvidence ? "pointer-events-none opacity-60" : ""}`}
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
                  if (selected.length > 0) onUploadEvidence(selected, slug);
                }}
              />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Or type an answer instead…"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => onAnswerStrategy(slug, draft.trim())}
              className="btn-outline text-xs disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {!hasAnyEvidence && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              Estimate — not guaranteed, missing evidence.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Two-node "stated vs. typical" flow for Zoning & Classification — only 2
// real data points exist (the property's stated type and the AI's typical-
// classification guess), so this stays 2 boxes + a match/mismatch badge on
// the connecting arrow, not a fabricated 4-box CAD/Actual/Zoning/Permitted
// tree the underlying data doesn't actually have.
function ZoningFlow({
  matches,
  stated,
  typical,
}: {
  matches: keyof typeof ZONING_STATUS;
  stated?: string;
  typical?: string;
}) {
  const { Icon, color } = ZONING_STATUS[matches];
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1 rounded-lg bg-secondary/50 p-2.5 text-center">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Stated</div>
        <div className="truncate text-xs font-semibold">{stated || "—"}</div>
      </div>
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1 rounded-lg bg-secondary/50 p-2.5 text-center">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Typical</div>
        <div className="truncate text-xs font-semibold">{typical || "—"}</div>
      </div>
    </div>
  );
}

// Second formula row for Tax Savings & ROI — Protest Cost / Net Benefit
// derived from the real 25% contingency fee already stated as CorvusPT's
// actual terms in ProtestAuthorizationFlow's AGREEMENT (src/components/
// ProtestAuthorizationFlow.tsx), not an invented number.
const CONTINGENCY_FEE_PCT = 0.25;

function CostBenefitRow({ savings }: { savings: number }) {
  const cost = Math.round(savings * CONTINGENCY_FEE_PCT);
  const netBenefit = savings - cost;
  return (
    <div className="flex items-center justify-center gap-1.5">
      <FormulaIcon
        Icon={DollarSign}
        value={compactCurrency(cost)}
        label="protest cost (25%)"
        tone="bg-violet-500/15 text-violet-600"
      />
      <span className="text-sm text-muted-foreground">−</span>
      <FormulaIcon
        Icon={BarChart3}
        value={compactCurrency(netBenefit)}
        label="net benefit"
        tone="bg-success/15 text-success"
      />
    </div>
  );
}

function SkeletonVisual() {
  return (
    <div className="grid gap-2">
      <div className="h-6 w-16 animate-pulse rounded bg-secondary/60" />
      <div className="h-3 w-28 animate-pulse rounded bg-secondary/40" />
    </div>
  );
}

// Icon per Module 1 score-breakdown label — the fixed label set the edge
// function validates against (BREAKDOWN_LABELS in ai-health-score/index.ts),
// so this mapping is safe/exhaustive rather than guessing at free AI text.
function breakdownIcon(label: string): LucideIcon {
  switch (label) {
    case "CAD Valuation":
      return FileText;
    case "Comparable Properties":
      return BarChart3;
    case "Market Data":
      return Percent;
    case "Property Condition":
      return Wrench;
    case "Historical Valuation":
      return Activity;
    default:
      return Target;
  }
}

// Half-circle "speedometer" gauge — a full red→amber→green gradient scale
// (the property's whole possible-score range, always shown) with a bold
// scoreColor()-toned progress arc on top marking the actual score, plus the
// number centered underneath. Combines the two reference looks: reference 1's
// bold filled progress against a duller full scale, reference 2's full-width
// half-circle gradient presentation. Used for Module 1 at both a compact
// (card) and large (modal) size — replaces the old MiniGauge/RadialGauge,
// which only this module used.
function SpeedometerGauge({ value, size = "md" }: { value: number; size?: "sm" | "md" | "lg" }) {
  const color = gradualScoreColor(value);
  const dims =
    size === "lg"
      ? { w: 240, h: 132, bar: 16, font: "text-4xl" }
      : size === "sm"
        ? { w: 140, h: 80, bar: 10, font: "text-xl" }
        : { w: 180, h: 100, bar: 12, font: "text-2xl" };
  // Single RadialBar with chart-level `data` + the `background` prop for the
  // auto-drawn full-arc track — the same proven pattern the old MiniGauge/
  // RadialGauge used, just at a half-circle angle. An earlier version tried
  // two <RadialBar>s each with their own per-bar `data` override (one for a
  // full gradient scale, one for the value) to combine both reference looks
  // more closely, but that silently rendered zero bars in this Recharts
  // version (confirmed via a live console error and an empty sectors group)
  // — reverted in favor of this reliable single-bar approach.
  return (
    <div className="relative mx-auto" style={{ width: dims.w, height: dims.h }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="100%"
          startAngle={180}
          endAngle={0}
          innerRadius={dims.w / 2 - dims.bar - 4}
          outerRadius={dims.w / 2 - 4}
          barSize={dims.bar}
          data={[{ value, fill: color }]}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={999} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <div className={`${dims.font} font-bold leading-none`} style={{ color }}>
          <AnimatedNumber value={value} />
        </div>
        <div className="text-[10px] text-muted-foreground">/100</div>
      </div>
    </div>
  );
}

function ScoreBreakdownList({ breakdown }: { breakdown: HealthScoreBreakdownEntry[] }) {
  if (breakdown.length === 0) return null;
  return (
    <div className="grid gap-2.5">
      {breakdown.map((b) => {
        const Icon = breakdownIcon(b.label);
        return (
          <div key={b.label} className="flex items-center gap-2.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{b.label}</span>
                <span className="text-xs font-semibold" style={{ color: scoreColor(b.score) }}>
                  {b.score}/100
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-secondary/60">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${b.score}%`, backgroundColor: scoreColor(b.score) }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Deterministic, real, client-side-computed numbers — never AI-written —
// straight from the same state/compsMap already loaded for this property, so
// "the data behind the score" can never be an AI paraphrase or a
// hallucinated figure. Same real fields already used to ground the AI's own
// prompt (see loadModule()'s health/strategy branch above).
function SupportingDataGrid({
  state,
  compsMap,
}: {
  state: IntakeState;
  compsMap: { data: CompsResult | null; loading: boolean };
}) {
  const category = classifyPropertyCategory(state.propertyType);
  const ratio = getAssessmentRatioInfo(state.cad, category);
  const compsSummary = buildCompsSummary(compsMap.data);
  const sortedHistory = [...(state.valueHistory ?? [])].sort((a, b) => b.year - a.year);
  const latestPrior = sortedHistory.find(
    (h) => h.year < (state.taxYear ?? Infinity) && (h.appraisedValue ?? h.marketValue) != null,
  );
  const priorValue = latestPrior?.appraisedValue ?? latestPrior?.marketValue ?? null;
  const pctChange =
    priorValue && state.totalValue
      ? Math.round(((state.totalValue - priorValue) / priorValue) * 100)
      : null;

  const rows: { label: string; value: string }[] = [
    { label: "Current Assessed Value", value: currency(state.totalValue) },
  ];
  if (state.landValue != null || state.improvementValue != null) {
    rows.push({
      label: "Land / Improvement Split",
      value: `${currency(state.landValue)} / ${currency(state.improvementValue)}`,
    });
  }
  if (priorValue != null) {
    rows.push({
      label: `Prior Year Value (${latestPrior?.year})`,
      value: `${currency(priorValue)}${pctChange != null ? ` (${pctChange > 0 ? "+" : ""}${pctChange}%)` : ""}`,
    });
  }
  if (compsSummary) {
    rows.push({
      label: `Comparable Median (${compsSummary.count} comps)`,
      value: `${currency(compsSummary.median)} (range ${currency(compsSummary.min)}–${currency(compsSummary.max)})`,
    });
  }
  if (ratio) {
    rows.push({
      label: "County Assessment Ratio COD",
      value: `${ratio.cod.toFixed(1)} (median ${ratio.medianPct}%)`,
    });
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="rounded-md bg-secondary/40 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.label}</div>
          <div className="text-xs font-semibold">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

// Same deterministic-not-AI principle as SupportingDataGrid — where each
// number actually came from, with a date where one is meaningful.
function SourcesList({
  state,
  compsMap,
  evidenceDocs,
}: {
  state: IntakeState;
  compsMap: { data: CompsResult | null; loading: boolean };
  evidenceDocs: DocumentRecord[];
}) {
  const category = classifyPropertyCategory(state.propertyType);
  const items: string[] = [];
  if (state.cad) {
    items.push(`${state.cad} public records${state.taxYear ? ` (tax year ${state.taxYear})` : ""}`);
  }
  if (compsMap.data?.comps.length) {
    items.push(
      `${compsMap.data.comps.length} real comparable properties, same CAD subdivision (as of today)`,
    );
  }
  if (getAssessmentRatioInfo(state.cad, category)) {
    items.push("Texas Comptroller property value study (assessment ratio/COD data)");
  }
  if (evidenceDocs.length > 0) {
    items.push(
      `User-uploaded evidence (${evidenceDocs.length} file${evidenceDocs.length === 1 ? "" : "s"})`,
    );
  }
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-1 text-xs text-muted-foreground">
      {items.map((s, i) => (
        <li key={i}>• {s}</li>
      ))}
    </ul>
  );
}

// Static reference table for "AI Analysis — Data Required & Sources" — not
// per-property (SourcesList above is the per-property version); this is the
// general methodology reference: what the AI would ideally use for each
// analysis category, where it would come from, and — honestly — whether this
// app actually has that source integrated today. Several rows the user asked
// for (recent sale price/date, building SF, GIS/FEMA flood data, zoning
// records, MLS) are marked "Not integrated" rather than silently implied as
// live: Texas doesn't publicly disclose sale prices at all (see Module 3's
// comps-analysis.ts), and this app has no GIS/FEMA/MLS/zoning-record
// integration today. Status reflects only what's really wired up.
type DataRequirementRow = {
  category: string;
  required: string;
  source: string;
  usedFor: string;
  status: "Available" | "Partial" | "Not integrated";
};

const DATA_REQUIREMENTS: DataRequirementRow[] = [
  {
    category: "Current CAD Appraised Value",
    required: "Total appraised value, land value, improvement value, market value",
    source: "County Appraisal District (CAD)",
    usedFor: "Establishes the current tax valuation baseline",
    status: "Available",
  },
  {
    category: "Historical Assessment",
    required: "Prior years' land/improvement/total values; year-over-year change",
    source: "CAD historical records",
    usedFor: "Identifies unusual increases or valuation trends",
    status: "Available",
  },
  {
    category: "Comparable Valuation",
    required: "Comparable addresses, CAD value, distance, land size, similarity",
    source: "CAD (same-subdivision public records)",
    usedFor: "Compares this property's valuation against similar nearby ones",
    status: "Partial",
  },
  {
    category: "Market Information",
    required: "Recent sale price, sale date, listing price, cap rate",
    source: "County deed records + MLS",
    usedFor: "Would show whether CAD value looks disconnected from the market",
    status: "Not integrated",
  },
  {
    category: "Property Characteristics",
    required: "Building SF, year built, stories, construction type",
    source: "CAD improvement records + GIS",
    usedFor: "Would ensure comparisons use the right physical characteristics",
    status: "Not integrated",
  },
  {
    category: "Site Conditions",
    required: "Lot shape, access, flood zone, topography, easements",
    source: "CAD GIS + FEMA/public GIS",
    usedFor: "Would identify site issues that could support a lower value",
    status: "Not integrated",
  },
  {
    category: "Improvement Condition",
    required: "Condition rating, deferred maintenance, renovation history",
    source: "User-uploaded photos/documents",
    usedFor: "Whether the building's condition supports a lower valuation",
    status: "Partial",
  },
  {
    category: "Zoning / Classification",
    required: "Current zoning, CAD property class, legal description",
    source: "CAD record (zoning field, where populated) + stated property type",
    usedFor: "Checks whether the CAD classification looks consistent",
    status: "Partial",
  },
  {
    category: "Income Indicators",
    required: "Rent, occupancy, NOI, expenses, cap rate",
    source: "User-provided P&L / rent roll",
    usedFor: "Income-based valuation indicator for applicable properties",
    status: "Partial",
  },
  {
    category: "Existing Evidence",
    required: "Prior protest results, notices, photos, leases, surveys",
    source: "User uploads",
    usedFor: "Strengthens or weakens the identified opportunity",
    status: "Available",
  },
  {
    category: "Data Confidence",
    required: "Source reliability, completeness, comp count, missing fields",
    source: "Calculated by AI from all collected data",
    usedFor: "Determines how reliable this analysis and score are",
    status: "Available",
  },
  {
    category: "Potential Valuation Gaps",
    required: "CAD value vs. comparable/market/income indicators",
    source: "Calculated from the CAD + comparable data above",
    usedFor: "Identifies the size of a potential overvaluation",
    status: "Partial",
  },
];

const DATA_STATUS_STYLE: Record<DataRequirementRow["status"], string> = {
  Available: "bg-success/15 text-success",
  Partial: "bg-warning/20 text-warning-foreground",
  "Not integrated": "bg-secondary text-muted-foreground",
};

// A full-width vertical list, not a wide table — no horizontal scrolling at
// all. Each category is collapsed to just its name + Status badge (the two
// things worth scanning at a glance); tap a row to expand it in place and
// reveal the three detail fields stacked below, same click-to-expand
// convention as ComparableTable's rows above.
function DataRequirementsTable() {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="grid gap-1.5">
      {DATA_REQUIREMENTS.map((r) => {
        const isOpen = expanded === r.category;
        return (
          <div key={r.category} className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : r.category)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="text-xs font-medium">{r.category}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${DATA_STATUS_STYLE[r.status]}`}
                >
                  {r.status}
                </span>
                <ArrowRight
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </span>
            </button>
            {isOpen && (
              <div className="grid gap-2 border-t border-border/60 px-3 py-2 text-xs">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Exact Data Required
                  </div>
                  <p className="text-muted-foreground">{r.required}</p>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Primary Data Source
                  </div>
                  <p className="text-muted-foreground">{r.source}</p>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    What AI Uses It For
                  </div>
                  <p className="text-muted-foreground">{r.usedFor}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Renders the actual per-module body — split from ModulePreviewBody below so
// the "Ask AI" Q&A box (see ModuleQABox) can be appended once, after whichever
// early-return branch below fires, instead of being duplicated into each one.
function ModulePreviewContent({
  m,
  estimated,
  state,
  moduleState,
  moduleData,
  compsMap,
  onRetry,
  allowEvidenceUpload,
  evidenceDocs,
  uploadingEvidence,
  onUploadEvidence,
  onForceReload,
  onAnswerStrategy,
}: {
  m: Module;
  estimated: {
    reduction: number;
    savings: number;
    rationale: string | null;
    effectiveTaxRatePct: number;
  };
  state: IntakeState;
  moduleState: ModuleAsyncState | undefined;
  moduleData: Record<string, ModuleAsyncState>;
  compsMap: { data: CompsResult | null; loading: boolean };
  onRetry: () => void;
  allowEvidenceUpload: boolean;
  evidenceDocs: DocumentRecord[];
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId?: string) => void;
  onForceReload: () => void;
  onAnswerStrategy: (strategyId: string, answer: string) => void;
  onAskQuestion: (moduleId: string, question: string) => Promise<string>;
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
        {estimated.savings > 0 && (
          <div className="flex justify-center">
            <CostBenefitRow savings={estimated.savings} />
          </div>
        )}
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
    const stats = computeComparableStats(map?.subject ?? null, map?.comps ?? [], state.totalValue);
    return (
      <div className="mt-4">
        {stats.limitedData ? (
          <div className="mb-3 rounded-lg bg-warning/15 p-3 text-sm text-warning-foreground">
            <span className="font-semibold">Limited Comparable Data.</span> Fewer than 3 comparable
            properties with a usable assessed value were found in this subdivision — the system may
            continue using other appraisal methods (see Protest Strategy) rather than relying on
            this alone.
          </div>
        ) : (
          stats.indicated && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-success/10 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-success">
                  Indicated Value Range
                </div>
                <div className="mt-0.5 text-lg font-bold text-success">
                  {compactCurrency(stats.indicated.min)}–{compactCurrency(stats.indicated.max)}
                </div>
              </div>
              {stats.subjectValue != null && (
                <div className="rounded-lg bg-destructive/10 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                    CAD Value
                  </div>
                  <div className="mt-0.5 text-lg font-bold text-destructive">
                    {compactCurrency(stats.subjectValue)}
                  </div>
                </div>
              )}
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Valuation Gap
                </div>
                <div className="mt-0.5 text-lg font-bold">
                  {stats.valuationGapPct != null
                    ? `${stats.valuationGapPct > 0 ? "+" : ""}${stats.valuationGapPct}%`
                    : "—"}
                </div>
                {stats.confidencePct != null && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Comparable confidence: {stats.confidencePct}%
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {compsMap.loading && (
          <div className="h-[280px] animate-pulse rounded-lg border border-border bg-secondary/40" />
        )}
        {map?.subject && map.comps.length > 0 && (
          <>
            <div className="text-sm font-medium">
              {map.comps.length} nearby properties in the same subdivision
            </div>
            <CompsMap subject={map.subject} comps={map.comps} />
            <ComparableTable ranked={stats.ranked} />
            <div className="mt-3 grid gap-2 rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <div className="font-semibold text-foreground">Methodology</div>
                <p className="mt-0.5">
                  Comps are properties sharing this property's own CAD subdivision code — a real
                  grouping the county itself uses. Similarity blends assessed-value proximity,
                  distance, land-size proximity, and property-type match into one 0-100 score; the
                  indicated range uses the top 5 by similarity.
                </p>
              </div>
              <div>
                <div className="font-semibold text-foreground">Sources</div>
                <p className="mt-0.5">
                  {state.cad ?? "County appraisal district"} public property records. Texas does not
                  require sale prices to be publicly disclosed, so "Last Transfer" reflects a real
                  deed date only — never a sale price.
                </p>
              </div>
            </div>
            {state.deeds && state.deeds.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  This Property's Deed History
                </div>
                <div className="mt-1.5 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="bg-secondary/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Seller</th>
                        <th className="px-3 py-2 font-semibold">Buyer</th>
                        <th className="px-3 py-2 font-semibold">Instrument #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.deeds.map((deed, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-3 py-2 text-muted-foreground">
                            {deed.date?.slice(0, 10) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {deed.description ?? deed.type ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{deed.seller ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{deed.buyer ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {deed.instrumentNum ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  No sale price is shown because none is publicly recorded under Texas law.
                </p>
              </div>
            )}
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
    const label =
      data.score >= 70
        ? "Strong Opportunity"
        : data.score >= 40
          ? "Moderate Opportunity"
          : "Limited Opportunity";
    const answerKey = "health";
    return (
      <div className="mt-4 grid gap-4">
        {data.executiveConclusion && <p className="text-sm">{data.executiveConclusion}</p>}

        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI Analysis — Data Required &amp; Sources
          </div>
          <DataRequirementsTable />
        </div>

        <div className="grid gap-4 sm:grid-cols-[13rem_1fr] items-center">
          <div className="text-center">
            <SpeedometerGauge value={data.score} size="lg" />
            <div className="mt-1 text-sm font-semibold" style={{ color: scoreColor(data.score) }}>
              {label}
            </div>
            {!data.dataSufficient && (
              <div className="mt-1 text-xs font-semibold text-warning-foreground">
                Additional Data Needed
              </div>
            )}
          </div>
          {estimated.savings > 0 && (
            <div className="rounded-lg bg-success/10 p-4 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-success">
                Potential Tax Savings
              </div>
              <div className="mt-1 font-serif text-3xl font-bold text-success">
                {currency(estimated.savings)}
              </div>
              {state.totalValue ? (
                <div className="mt-0.5 text-xs text-success/80">
                  {Math.round((estimated.reduction / state.totalValue) * 100)}% of assessed value
                </div>
              ) : null}
            </div>
          )}
        </div>

        {data.scoreBreakdown.length > 0 && (
          <div className="card-elev p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Score Breakdown
            </div>
            <ScoreBreakdownList breakdown={data.scoreBreakdown} />
          </div>
        )}

        {(data.factorsIncreasing.length > 0 || data.factorsReducing.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.factorsIncreasing.length > 0 && (
              <div className="rounded-lg bg-success/10 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-success">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Factors Increasing Opportunity
                </div>
                <ul className="grid gap-1 text-xs text-foreground/90">
                  {data.factorsIncreasing.map((f, i) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              </div>
            )}
            {data.factorsReducing.length > 0 && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Factors Reducing Opportunity
                </div>
                <ul className="grid gap-1 text-xs text-foreground/90">
                  {data.factorsReducing.map((f, i) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Supporting Data
          </div>
          <SupportingDataGrid state={state} compsMap={compsMap} />
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sources
          </div>
          <SourcesList state={state} compsMap={compsMap} evidenceDocs={evidenceDocs} />
        </div>

        <div className="card-elev p-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Confidence
          </div>
          <MiniMeter value={data.confidencePct} label="Analysis confidence" />
          {data.confidenceReasoning && (
            <p className="mt-2 text-xs text-muted-foreground">{data.confidenceReasoning}</p>
          )}
        </div>

        {data.methodology && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              AI Methodology
            </div>
            <p className="text-xs text-muted-foreground">{data.methodology}</p>
          </div>
        )}

        {data.nextStep && (
          <div className={`rounded-lg p-4 ${m.color.bg}`}>
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${m.color.text}`}>
              Recommended Next Step
            </div>
            <div className="mt-1 text-sm font-semibold">{data.nextStep}</div>
          </div>
        )}

        {!data.dataSufficient && (
          <div className="border-t border-border/60 pt-4 print:hidden">
            <div className="text-xs font-semibold text-warning-foreground">
              Additional Data Needed
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload supporting documents or answer below so AI can complete this analysis with real
              evidence.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label
                className={`btn-outline text-xs cursor-pointer ${uploadingEvidence ? "pointer-events-none opacity-60" : ""}`}
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
                    if (selected.length > 0) onUploadEvidence(selected, answerKey);
                  }}
                />
              </label>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                defaultValue={state.strategyAnswers?.[answerKey] ?? ""}
                onBlur={(e) => {
                  if (e.target.value.trim()) onAnswerStrategy(answerKey, e.target.value.trim());
                }}
                placeholder="Or type an answer instead…"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
            {!state.strategyAnswers?.[answerKey] && evidenceDocs.length === 0 && (
              <p className="mt-2 text-[11px] italic text-muted-foreground">
                Estimate — not guaranteed, missing evidence.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  switch (m.id) {
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      if (d.strategies.length === 0) {
        return (
          <p className="mt-4 text-sm text-muted-foreground">
            AI cannot proceed without enough property data to evaluate any strategy yet.
          </p>
        );
      }
      return (
        <div className="mt-4 grid gap-4">
          {d.topStrategySummary && <p className="text-sm font-medium">{d.topStrategySummary}</p>}
          <div className="card-elev p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ranked Strategies
            </div>
            <StrategyRankList strategies={d.strategies} color={m.color} />
          </div>
          <div className="grid gap-3">
            {d.strategies.map((s, i) => (
              <StrategyDetail
                key={s.name}
                s={s}
                rank={i + 1}
                color={m.color}
                evidenceDocs={evidenceDocs}
                uploadingEvidence={uploadingEvidence}
                onUploadEvidence={onUploadEvidence}
                answer={state.strategyAnswers?.[strategySlug(s.name)]}
                onAnswerStrategy={onAnswerStrategy}
              />
            ))}
          </div>
        </div>
      );
    }
    case "site": {
      const d = moduleState.data as ModuleResultMap["site"];
      const subject = compsMap.data?.subject;
      return (
        <div className="mt-4">
          {subject && <SiteMapThumb lat={subject.latitude} lng={subject.longitude} height={220} />}
          <div className="mt-3">
            <MiniMeter value={d.priorityScore} label="Documentation priority" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{d.guidance}</p>
          <div className="mt-3">
            <ChecklistIconRows items={d.checklist} color={m.color} />
          </div>
        </div>
      );
    }
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["improvement"];
      const improvementDocs = evidenceDocs.filter(
        (doc) => doc.documentType === EVIDENCE_DOCUMENT_TYPE,
      );
      return (
        <div className="mt-4">
          <ImprovementIconRing items={d.checklist} color={m.color} />
          <div className="mt-3">
            <MiniMeter value={d.priorityScore} label="Condition priority" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{d.guidance}</p>
          <div className="mt-3">
            <ChecklistIconRows items={d.checklist} color={m.color} />
          </div>
          {allowEvidenceUpload && (
            <div className="mt-4 border-t border-border/60 pt-4 print:hidden">
              <div className="text-sm font-medium">Add Evidence</div>
              <p className="text-xs text-muted-foreground">
                Property photos, repair estimates, or appraisals — AI will cite specific details
                from what you upload instead of only general guidance.
              </p>
              {improvementDocs.length > 0 && (
                <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  {improvementDocs.map((doc) => (
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
                {improvementDocs.length > 0 && (
                  <button
                    disabled={loading}
                    onClick={onForceReload}
                    className="btn-outline text-sm disabled:opacity-60"
                  >
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
          <ZoningFlow
            matches={d.matches}
            stated={state.propertyType}
            typical={d.typicalClassification || undefined}
          />
          <p className="text-sm text-muted-foreground">{d.assessment}</p>
        </div>
      );
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      const focus = d.items.filter((i) => i.importance === "High" && i.availability === "Low");
      return (
        <div className="mt-4 grid gap-3">
          {focus.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              <span className="truncate">
                Focus Here First: {focus.map((i) => i.item).join(", ")}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </div>
          )}
          <div className="grid gap-2">
            {d.items.map((it, i) => (
              <PriorityRow
                key={i}
                item={it.item}
                importance={it.importance}
                availability={it.availability}
              />
            ))}
          </div>
        </div>
      );
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
      const evidenceData = moduleData.evidence?.data as ModuleResultMap["evidence"] | undefined;
      const keyEvidence =
        evidenceData?.items.find((i) => i.importance === "High")?.item ??
        evidenceData?.items[0]?.item ??
        null;
      const comps =
        compsMap.data?.comps.filter(
          (c): c is typeof c & { marketValue: number } => c.marketValue != null,
        ) ?? [];
      const valueRange =
        comps.length > 0
          ? `${compactCurrency(Math.min(...comps.map((c) => c.marketValue)))}–${compactCurrency(Math.max(...comps.map((c) => c.marketValue)))}`
          : null;
      return (
        <div className="mt-4 grid gap-3">
          <div className="flex justify-center">
            <span
              className={`grid h-14 w-14 place-items-center rounded-full ${m.color.bg} ${m.color.text}`}
            >
              <Award className="h-7 w-7" />
            </span>
          </div>
          <ExecutiveBadges
            strategy={strategyData?.strategies[0]?.name ?? null}
            keyEvidence={keyEvidence}
            valueRange={valueRange}
            nextStep={d.nextStep}
          />
          <div className={`rounded-lg p-4 text-center ${m.color.bg}`}>
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${m.color.text}`}>
              Recommended Action
            </div>
            <div className="mt-1 font-serif text-xl font-bold">{d.recommendation}</div>
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

// Thin wrapper around ModulePreviewContent that appends the "Ask AI" Q&A box
// once, regardless of which of ModulePreviewContent's several early-return
// branches rendered — see the comment on ModulePreviewContent above. Skipped
// for "income" (no analysis exists yet to ground an answer in) and "savings"
// (a deterministic formula, not an AI call) — every other module gets one.
function ModulePreviewBody(props: Parameters<typeof ModulePreviewContent>[0]) {
  const showQA = !props.m.requiresUserData && props.m.id !== "savings" && !!props.moduleState?.data;
  return (
    <>
      <ModulePreviewContent {...props} />
      {showQA && <ModuleQABox moduleId={props.m.id} onAskQuestion={props.onAskQuestion} />}
    </>
  );
}

// Per-module "Ask AI" follow-up box — ephemeral by design (plain component
// state, not persisted anywhere), so it resets whenever the modal closes and
// reopens. Answers are grounded server-side in this module's own already-
// generated data — see askModuleQuestion() in ai-report-modules.ts.
function ModuleQABox({
  moduleId,
  onAskQuestion,
}: {
  moduleId: string;
  onAskQuestion: (moduleId: string, question: string) => Promise<string>;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState<{ question: string; answer: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    try {
      const answer = await onAskQuestion(moduleId, q);
      setThread((prev) => [...prev, { question: q, answer }]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get an answer. Please retry.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-4 print:hidden">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Ask AI About This Module
      </div>
      {thread.length > 0 && (
        <div className="mt-2 grid gap-2.5">
          {thread.map((t, i) => (
            <div key={i} className="text-sm">
              <div className="font-medium">{t.question}</div>
              <div className="mt-0.5 text-muted-foreground">{t.answer}</div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Ask a follow-up question…"
          disabled={asking}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={asking || !question.trim()}
          className="btn-outline text-sm disabled:opacity-50"
        >
          {asking ? "Asking…" : "Ask"}
        </button>
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning)";
  return "var(--destructive)";
}

// A continuous version of scoreColor — smoothly interpolated (red at 0,
// amber at 50, green at 100, everything in between blended) rather than
// jumping abruptly at fixed 40/70 cutoffs, for the one place that read as
// "graph-like" enough to want a real gradient: SpeedometerGauge. Uses CSS
// color-mix() (same technique already used for the hub doors' glow tint)
// so it blends the app's real theme tokens directly — correct in both light
// and dark mode — rather than a hardcoded hex gradient.
function gradualScoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  // Eased, not linear: a plain 0-50 linear blend put 25 at a 50/50 red/amber
  // mix, which reads as orange, not red — the same problem a direct 2-stop
  // red-green mix had at the other extreme (a muddy midpoint, no real
  // yellow). Easing each half toward its own anchor (ease-in low, ease-out
  // high) keeps 25 mostly red and 90 mostly green, while 50 still lands on
  // pure amber — still one continuous curve, just not a straight line.
  if (s <= 50) {
    const t = s / 50;
    const pct = t * t * t * 100;
    return `color-mix(in oklch, var(--warning) ${pct}%, var(--destructive) ${100 - pct}%)`;
  }
  const t = (s - 50) / 50;
  const pct = (1 - (1 - t) * (1 - t) * (1 - t)) * 100;
  return `color-mix(in oklch, var(--success) ${pct}%, var(--warning) ${100 - pct}%)`;
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

function PriorityRow({
  item,
  importance,
  availability,
}: {
  item: string;
  importance: "High" | "Low";
  availability: "High" | "Low";
}) {
  const tone =
    importance === "High" && availability === "Low"
      ? { bg: "bg-destructive/10", text: "text-destructive", label: "Top Priority" }
      : importance === "High"
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
