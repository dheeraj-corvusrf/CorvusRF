import { supabase } from "./supabase";
import { getModuleAnalysis, type ModuleAnalysisInput } from "./ai-report-modules";
import type { PropertyRecord } from "./properties";

// AI case prep for a real protest — persists the same strategy recommendation and
// evidence checklist the paywalled AI Report page already generates on demand
// (see ai-report-modules.ts) onto the actual case, so "Request Protest Filing"
// produces something real instead of just a status row. See the
// protest_evidence_items table and the new protests.strategy_* columns in
// supabase/schema.sql.
export type EvidenceItemRecord = {
  id: string;
  protestId: string;
  label: string;
  documentId: string | null;
  documentFileName: string | null;
  createdAt: string;
};

export type ProtestCase = {
  strategyRecommendation: string | null;
  strategyConfidencePct: number | null;
  strategyRationale: string | null;
  casePrepGeneratedAt: string | null;
  evidenceItems: EvidenceItemRecord[];
};

type ProtestCaseRow = {
  strategy_recommendation: string | null;
  strategy_confidence_pct: number | null;
  strategy_rationale: string | null;
  case_prep_generated_at: string | null;
};

type EvidenceItemRow = {
  id: string;
  protest_id: string;
  label: string;
  document_id: string | null;
  created_at: string;
};

function toModuleInput(property: PropertyRecord): ModuleAnalysisInput {
  return {
    address: property.address,
    cad: property.cad ?? undefined,
    propertyType: property.propertyType ?? undefined,
    landValue: property.landValue ?? undefined,
    improvementValue: property.improvementValue ?? undefined,
    totalValue: property.totalValue ?? undefined,
    taxYear: property.taxYear ?? undefined,
  };
}

// Generates the strategy recommendation and evidence checklist and persists them.
// The two halves run independently (one failing — rate limit, network — doesn't
// block the other), and the evidence checklist is only generated once per protest
// (skipped if items already exist) so calling this again as a manual retry doesn't
// pile up duplicate checklist items or wipe out evidence the user already uploaded
// against existing items.
export async function generateCasePrep(
  protestId: string,
  userId: string,
  property: PropertyRecord,
): Promise<void> {
  const input = toModuleInput(property);

  try {
    const strategy = await getModuleAnalysis("strategy", input);
    const { error } = await supabase
      .from("protests")
      .update({
        strategy_recommendation: strategy.recommendation,
        strategy_confidence_pct: strategy.confidencePct,
        strategy_rationale: strategy.rationale,
      })
      .eq("id", protestId);
    if (error) throw error;
  } catch (err) {
    console.error("Case strategy generation failed:", err);
  }

  try {
    const { count } = await supabase
      .from("protest_evidence_items")
      .select("id", { count: "exact", head: true })
      .eq("protest_id", protestId);
    if (!count) {
      const evidence = await getModuleAnalysis("evidence", input);
      if (evidence.checklist.length > 0) {
        const { error } = await supabase
          .from("protest_evidence_items")
          .insert(evidence.checklist.map((label) => ({ protest_id: protestId, user_id: userId, label })));
        if (error) throw error;
      }
    }
  } catch (err) {
    console.error("Case evidence checklist generation failed:", err);
  }

  await supabase
    .from("protests")
    .update({ case_prep_generated_at: new Date().toISOString() })
    .eq("id", protestId);
}

export async function getCase(protestId: string): Promise<ProtestCase> {
  const { data: protestRow, error: protestErr } = await supabase
    .from("protests")
    .select("strategy_recommendation, strategy_confidence_pct, strategy_rationale, case_prep_generated_at")
    .eq("id", protestId)
    .single();
  if (protestErr) throw protestErr;

  const { data: itemRows, error: itemsErr } = await supabase
    .from("protest_evidence_items")
    .select("id, protest_id, label, document_id, created_at")
    .eq("protest_id", protestId)
    .order("created_at", { ascending: true });
  if (itemsErr) throw itemsErr;

  const rows = (itemRows as EvidenceItemRow[]) ?? [];
  const documentIds = rows.map((r) => r.document_id).filter((id): id is string => !!id);
  const fileNameById = new Map<string, string>();
  if (documentIds.length > 0) {
    const { data: docs } = await supabase.from("documents").select("id, file_name").in("id", documentIds);
    for (const d of (docs as Array<{ id: string; file_name: string }>) ?? []) {
      fileNameById.set(d.id, d.file_name);
    }
  }

  const protest = protestRow as ProtestCaseRow;
  return {
    strategyRecommendation: protest.strategy_recommendation,
    strategyConfidencePct: protest.strategy_confidence_pct,
    strategyRationale: protest.strategy_rationale,
    casePrepGeneratedAt: protest.case_prep_generated_at,
    evidenceItems: rows.map((r) => ({
      id: r.id,
      protestId: r.protest_id,
      label: r.label,
      documentId: r.document_id,
      documentFileName: r.document_id ? (fileNameById.get(r.document_id) ?? null) : null,
      createdAt: r.created_at,
    })),
  };
}

export async function linkEvidenceDocument(itemId: string, documentId: string): Promise<void> {
  const { error } = await supabase
    .from("protest_evidence_items")
    .update({ document_id: documentId })
    .eq("id", itemId);
  if (error) throw error;
}
