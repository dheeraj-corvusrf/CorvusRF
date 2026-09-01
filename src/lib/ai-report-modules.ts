import { invokeEdgeFunction } from "./edge-functions";

export type ModuleAnalysisInput = {
  address?: string;
  cad?: string;
  propertyType?: string;
  landValue?: number;
  improvementValue?: number;
  totalValue?: number;
  taxYear?: number;
  // Only read by the "improvement" module — property photos/documents (as base64
  // data URLs) that ground its guidance in what's actually visible/stated instead of
  // only general guidance. See src/routes/ai-report.tsx.
  evidenceImages?: { mimeType: string; dataUrl: string }[];
  // Real signals threaded into the Strategy module's prompt (never fabricated —
  // each is the same real value another part of the app already computes). See
  // buildRecord() in supabase/functions/ai-report-modules/index.ts.
  compsSummary?: { median: number; min: number; max: number; count: number } | null;
  assessmentRatio?: { medianPct: number; cod: number; codOverCeiling: number } | null;
  valueTrend?: { jumpTriggered: boolean; jumpPct: number | null } | null;
  evidenceFileNames?: string[];
  // Module 2's own per-strategy scores, sent when loading comps/site/improvement/
  // zoning so their guidance stays consistent with — and prioritized by — the
  // Strategy module's ranking. See loadModule()'s sequencing in ai-report.tsx.
  priorityContext?: { strategy: string; score: number }[];
  // Only for "comps" — the real top-5-by-similarity comps
  // computeComparableStats() already ranked client-side (see
  // comps-analysis.ts), so the module's recommendedUse field can name
  // specific real properties. See loadModule()'s comps branch.
  topComps?: {
    address: string;
    distanceMi: number;
    marketValue: number | null;
    similarity: number;
  }[];
  // Everything below is only for "executive" — real outputs Modules 2/3/8/9
  // already computed (never regenerated), so Module 10 can actually
  // reconcile them instead of writing a recommendation blind to the rest of
  // the report. See loadModule()'s executive branch in ai-report.tsx and the
  // sequencing effect that waits for strategy + evidence to resolve first.
  topStrategies?: {
    name: string;
    primaryReason: string;
    strengthScore: number;
    whySelected: string;
    existingEvidence: string[];
    missingEvidence: string[];
  }[];
  evidenceReadiness?: {
    criticalMissing: string[];
    importantMissing: string[];
    uploadedCount: number;
  };
  compsIndicated?: {
    min: number;
    median: number;
    max: number;
    gapPct: number | null;
    confidencePct: number | null;
  } | null;
  financialSummary?: {
    savings: number;
    basis: "comps" | "formula";
    reductionPct: number | null;
  } | null;
  // Only present once a real protest case exists for this property (see
  // getPreFilingCheck() in pre-filing-check.ts) — omitted, not fabricated,
  // when no case has been started yet.
  preFilingStatus?: { missingBlocking: string[] } | null;
};

export type BatchModuleId =
  "strategy" | "comps" | "site" | "improvement" | "zoning" | "evidence" | "executive";

// One ranked valuation strategy from Module 2 — see StrategyList/StrategyDetail in
// src/routes/ai-report.tsx and the "strategy" MODULE_SPEC in the edge function.
export type StrategyEntry = {
  name: string;
  strengthScore: number;
  primaryReason: string;
  whySelected: string;
  supportingFindings: string;
  valuationRelevance: string;
  existingEvidence: string[];
  missingEvidence: string[];
  confidencePct: number;
  recommendedInvestigation: string;
  // The batch-module id (comps/site/improvement/income/zoning) this strategy maps
  // to, when it's one of the 5 fixed named strategies — empty for an "Other: ..."
  // entry, which doesn't correspond to any of Modules 3-7.
  relatedModules: string[];
  dataSufficient: boolean;
};

export type ModuleResultMap = {
  strategy: {
    strategies: StrategyEntry[];
    topStrategySummary: string;
  };
  comps: { guidance: string; checklist: string[]; recommendedUse: string };
  site: { guidance: string; checklist: string[]; priorityScore: number };
  improvement: { guidance: string; checklist: string[]; priorityScore: number };
  zoning: {
    matches: "consistent" | "inconsistent" | "uncertain";
    assessment: string;
    typicalClassification: string;
  };
  evidence: {
    items: { item: string; importance: "High" | "Low"; availability: "High" | "Low" }[];
  };
  // Recommendation/basis/nextStep kept for backward compatibility with any
  // stale cached shape — the real UI (ai-report.tsx's "executive" cases)
  // reads the richer fields below now. See MODULE_SPECS.executive in
  // supabase/functions/ai-report-modules/index.ts for the full schema this
  // mirrors.
  executive: {
    recommendedAction:
      | "Proceed with Protest"
      | "Proceed with Protest After Completing Recommended Evidence"
      | "Additional Information Needed Before Proceeding"
      | "Limited Protest Opportunity Based on Available Information";
    recommendationExplanation: string;
    primaryStrategyExplanation: string | null;
    secondaryStrategyExplanation: string | null;
    majorFindings: { finding: string; whyItMatters: string; relatedModule: string | null }[];
    missingInformation: { item: string; severity: "Critical" | "Important" | "Supporting" }[];
    recommendedProtestValue: number | null;
    recommendedProtestValueBasis: string;
    nextAction: string;
    // Only populated when the AI genuinely notices the fed-in signals
    // disagree (e.g. a strong strategy score against missing critical
    // evidence) — per the instruction to flag conflicts, not silently pick
    // a side. Absent, never fabricated, when nothing actually conflicts.
    conflictNote: string | null;
    defenseQA: {
      question: string;
      suggestedAnswer: string;
      status: "Supported" | "Partially Supported" | "Evidence Needed" | "User Input Needed";
      relatedModule: string | null;
    }[];
  };
};

// Fetches exactly one module's analysis per call — the caller only invokes this when
// the user unlocks that specific module, so a Gemini call only happens for modules
// the user actually opens, not all eight up front.
export async function getModuleAnalysis<K extends BatchModuleId>(
  moduleId: K,
  input: ModuleAnalysisInput,
): Promise<ModuleResultMap[K]> {
  return invokeEdgeFunction<ModuleResultMap[K]>("ai-report-modules", { moduleId, ...input });
}

// Powers each module's "Ask AI" box — a single grounded follow-up question, answered
// from the same record plus whatever that module has already generated (priorData).
// Ephemeral by design: the answer is only ever held in the calling component's own
// state, never persisted, so it resets when the modal closes.
export async function askModuleQuestion(
  moduleId: string,
  question: string,
  input: ModuleAnalysisInput,
  priorModuleData?: unknown,
): Promise<string> {
  const result = await invokeEdgeFunction<{ answer: string }>("ai-report-modules", {
    moduleId,
    question,
    priorModuleData,
    ...input,
  });
  return result.answer;
}
