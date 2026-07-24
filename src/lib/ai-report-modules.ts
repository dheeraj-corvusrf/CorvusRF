import { invokeEdgeFunction } from "./edge-functions";

export type ModuleAnalysisInput = {
  address?: string;
  cad?: string;
  propertyType?: string;
  landValue?: number;
  improvementValue?: number;
  totalValue?: number;
  taxYear?: number;
};

export type BatchModuleId =
  | "strategy"
  | "comps"
  | "site"
  | "improvement"
  | "zoning"
  | "evidence"
  | "savings"
  | "executive";

export type ModuleResultMap = {
  strategy: { recommendation: string; rationale: string };
  comps: { guidance: string; checklist: string[] };
  site: { guidance: string; checklist: string[] };
  improvement: { guidance: string; checklist: string[] };
  zoning: { assessment: string };
  evidence: { checklist: string[] };
  savings: { reductionPct: number; effectiveTaxRatePct: number; rationale: string };
  executive: { recommendation: string; basis: string; nextStep: string };
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
