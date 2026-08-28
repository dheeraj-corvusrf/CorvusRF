import { supabase } from "./supabase";
import { getModuleAnalysis, type ModuleAnalysisInput } from "./ai-report-modules";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord, ArbDecision } from "./protests";
import { getEffectiveTaxRate } from "./texas-tax-rates";

// AI case prep for a real protest — persists the same strategy recommendation and
// evidence checklist the paywalled AI Report page already generates on demand
// (see ai-report-modules.ts) onto the actual case, so "Request Protest Filing"
// produces something real instead of just a status row. See the
// protest_evidence_items table and the new protests.strategy_* columns in
// supabase/schema.sql.
export type EvidenceDocument = { id: string; fileName: string };

export type EvidenceItemRecord = {
  id: string;
  protestId: string;
  label: string;
  documents: EvidenceDocument[];
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
    // Module 2 now returns a ranked list of strategies rather than one single
    // recommendation — the saved case still only has room for one, so this
    // persists the top-ranked strategy (see StrategyEntry in ai-report-modules.ts).
    const top = strategy.strategies[0] ?? null;
    const { error } = await supabase
      .from("protests")
      .update({
        strategy_recommendation: top?.name ?? null,
        strategy_confidence_pct: top?.confidencePct ?? null,
        strategy_rationale: top?.whySelected ?? null,
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
      if (evidence.items.length > 0) {
        const { error } = await supabase.from("protest_evidence_items").insert(
          evidence.items.map(({ item }) => ({
            protest_id: protestId,
            user_id: userId,
            label: item,
          })),
        );
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
    .select(
      "strategy_recommendation, strategy_confidence_pct, strategy_rationale, case_prep_generated_at",
    )
    .eq("id", protestId)
    .single();
  if (protestErr) throw protestErr;

  const { data: itemRows, error: itemsErr } = await supabase
    .from("protest_evidence_items")
    .select("id, protest_id, label, created_at")
    .eq("protest_id", protestId)
    .order("created_at", { ascending: true });
  if (itemsErr) throw itemsErr;

  const rows = (itemRows as EvidenceItemRow[]) ?? [];
  const itemIds = rows.map((r) => r.id);
  const documentsByItemId = new Map<string, EvidenceDocument[]>();
  if (itemIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_name, evidence_item_id")
      .in("evidence_item_id", itemIds)
      .order("uploaded_at", { ascending: true });
    for (const d of (docs as Array<{ id: string; file_name: string; evidence_item_id: string }>) ??
      []) {
      const list = documentsByItemId.get(d.evidence_item_id) ?? [];
      list.push({ id: d.id, fileName: d.file_name });
      documentsByItemId.set(d.evidence_item_id, list);
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
      documents: documentsByItemId.get(r.id) ?? [],
      createdAt: r.created_at,
    })),
  };
}

// A checklist item can hold several documents — call once per uploaded file
// (see CaseDetailModal's handleUpload, which loops a multi-file <input>).
export async function linkEvidenceDocument(itemId: string, documentId: string): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({ evidence_item_id: itemId })
    .eq("id", documentId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Case progress — settlement offer, hearing, ARB decision, and escalation. All
// self-reported (see the comment on these columns in schema.sql): there's no
// live county API, so someone has to enter what actually happened, same
// precedent as tax_bills.
// ---------------------------------------------------------------------------

// Called when the owner signs the Notice of Protest in-app (see
// CaseDetailModal's Sign & Submit). Only advances a case that's still at its
// starting status — if staff or the owner already moved it further along
// (offer received, hearing scheduled, etc.) by other means, this leaves that
// alone rather than regressing it back to "filed".
export async function markFiled(protestId: string): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ status: "filed" })
    .eq("id", protestId)
    .eq("status", "requested");
  if (error) throw error;
}

export async function recordSettlementOffer(
  protestId: string,
  offer: { value: number; receivedAt: string },
): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({
      settlement_offer_value: offer.value,
      settlement_offer_received_at: offer.receivedAt,
      status: "offer_received",
    })
    .eq("id", protestId);
  if (error) throw error;
}

export async function acceptSettlement(protestId: string, offerValue: number): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({
      final_value: offerValue,
      escalation_path: "accept",
      closed_at: new Date().toISOString(),
      status: "resolved",
    })
    .eq("id", protestId);
  if (error) throw error;
}

export async function scheduleHearing(protestId: string, date: string): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ hearing_date: date, status: "hearing_scheduled" })
    .eq("id", protestId);
  if (error) throw error;
}

// Not an AI call — assembled from the case's own already-generated strategy and
// evidence checklist (see generateCasePrep above), the same real content the user
// already has, just formatted as hearing talking points.
export function getHearingPrep(caseData: ProtestCase, propertyAddress: string): string {
  const lines: string[] = [`Hearing summary — ${propertyAddress}`, ""];

  if (caseData.strategyRecommendation) {
    lines.push(`Strategy: ${caseData.strategyRecommendation}`);
    if (caseData.strategyRationale) lines.push(caseData.strategyRationale);
    lines.push("");
  }

  if (caseData.evidenceItems.length > 0) {
    const ready = caseData.evidenceItems.filter((i) => i.documents.length > 0);
    const missing = caseData.evidenceItems.filter((i) => i.documents.length === 0);
    lines.push("Evidence ready to present:");
    lines.push(
      ...(ready.length > 0
        ? ready.map((i) => `  - ${i.label} (${i.documents.map((d) => d.fileName).join(", ")})`)
        : ["  (none uploaded yet)"]),
    );
    if (missing.length > 0) {
      lines.push("");
      lines.push("Not yet gathered:");
      lines.push(...missing.map((i) => `  - ${i.label}`));
    }
  } else {
    lines.push("No evidence checklist generated for this case yet.");
  }

  return lines.join("\n");
}

export async function recordArbDecision(
  protestId: string,
  decision: { type: ArbDecision; date: string; finalValue: number },
): Promise<void> {
  const resolved = decision.type === "approved";
  const { error } = await supabase
    .from("protests")
    .update({
      arb_decision: decision.type,
      arb_decision_date: decision.date,
      final_value: decision.finalValue,
      status: resolved ? "resolved" : "decision_received",
      ...(resolved ? { closed_at: new Date().toISOString(), escalation_path: "accept" } : {}),
    })
    .eq("id", protestId);
  if (error) throw error;
}

export async function recordEscalation(
  protestId: string,
  path: "appeal" | "arbitration",
): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ escalation_path: path, status: path === "appeal" ? "appealing" : "arbitrating" })
    .eq("id", protestId);
  if (error) throw error;
}

// Closes out an appeal or arbitration once *that* resolves — doesn't model the
// appeal/arbitration's own sub-process, just captures that it happened and what
// the case ultimately settled at.
export async function closeCase(protestId: string, finalValue: number): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ final_value: finalValue, closed_at: new Date().toISOString(), status: "resolved" })
    .eq("id", protestId);
  if (error) throw error;
}

export type CaseResults = { valueReduction: number; actualSavings: number };

// Real, decision-backed numbers — not the intake-time estimate. Only meaningful
// once a case has both an original snapshot and a final determined value on file.
export function getCaseResults(
  protest: Pick<ProtestRecord, "originalValue" | "finalValue">,
  property: Pick<PropertyRecord, "cad">,
): CaseResults | null {
  if (protest.originalValue == null || protest.finalValue == null) return null;
  const valueReduction = Math.max(0, protest.originalValue - protest.finalValue);
  const rate = getEffectiveTaxRate(property.cad);
  return {
    valueReduction: Math.round(valueReduction),
    actualSavings: Math.round(valueReduction * rate),
  };
}
