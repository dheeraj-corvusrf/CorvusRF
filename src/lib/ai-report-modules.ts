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
};

export type BatchModuleId =
  | "strategy"
  | "comps"
  | "site"
  | "improvement"
  | "zoning"
  | "evidence"
  | "executive";

export type ModuleResultMap = {
  strategy: { recommendation: string; confidencePct: number; rationale: string };
  comps: { guidance: string; checklist: string[] };
  site: { guidance: string; checklist: string[] };
  improvement: { guidance: string; checklist: string[] };
  zoning: { matches: "consistent" | "inconsistent" | "uncertain"; assessment: string };
  evidence: { checklist: string[] };
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
