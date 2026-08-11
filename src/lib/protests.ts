import { supabase } from "./supabase";
import { submitWeb3Form } from "./web3forms";

export type ProtestStatus =
  | "requested"
  | "filed"
  | "under_review"
  | "offer_received"
  | "hearing_scheduled"
  | "decision_received"
  | "appealing"
  | "arbitrating"
  | "resolved";

export type ArbDecision = "approved" | "partial" | "denied";
export type EscalationPath = "accept" | "appeal" | "arbitration";

export type ProtestRecord = {
  id: string;
  propertyId: string;
  status: ProtestStatus;
  notes: string | null;
  requestedAt: string;
  updatedAt: string;
  originalValue: number | null;
  settlementOfferValue: number | null;
  settlementOfferReceivedAt: string | null;
  hearingDate: string | null;
  arbDecision: ArbDecision | null;
  arbDecisionDate: string | null;
  finalValue: number | null;
  escalationPath: EscalationPath | null;
  closedAt: string | null;
};

type ProtestRow = {
  id: string;
  property_id: string;
  status: ProtestStatus;
  notes: string | null;
  requested_at: string;
  updated_at: string;
  original_value: number | null;
  settlement_offer_value: number | null;
  settlement_offer_received_at: string | null;
  hearing_date: string | null;
  arb_decision: ArbDecision | null;
  arb_decision_date: string | null;
  final_value: number | null;
  escalation_path: EscalationPath | null;
  closed_at: string | null;
};

const SELECT_COLUMNS =
  "id, property_id, status, notes, requested_at, updated_at, original_value, settlement_offer_value, settlement_offer_received_at, hearing_date, arb_decision, arb_decision_date, final_value, escalation_path, closed_at";

function fromRow(row: ProtestRow): ProtestRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    status: row.status,
    notes: row.notes,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    originalValue: row.original_value,
    settlementOfferValue: row.settlement_offer_value,
    settlementOfferReceivedAt: row.settlement_offer_received_at,
    hearingDate: row.hearing_date,
    arbDecision: row.arb_decision,
    arbDecisionDate: row.arb_decision_date,
    finalValue: row.final_value,
    escalationPath: row.escalation_path,
    closedAt: row.closed_at,
  };
}

// Filing and hearing representation happen off-platform by CorvusRF staff (per the
// /property-protest page's own description) — this creates the real request record
// staff act on; there is no automated filing today, so status only ever advances via
// the admin panel or the case-progress actions in protest-case.ts. `details` is used
// only for the staff notification below and the original-value snapshot — the
// request itself is fully recorded in the DB regardless of whether that send works.
export async function requestProtest(
  userId: string,
  propertyId: string,
  details?: { address?: string; userEmail?: string; originalValue?: number | null },
): Promise<ProtestRecord> {
  const { data, error } = await supabase
    .from("protests")
    .insert({ property_id: propertyId, user_id: userId, original_value: details?.originalValue ?? null })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  const created = fromRow(data as ProtestRow);

  // Best-effort staff notification — previously a request only surfaced if staff
  // happened to check the admin panel's "Protest Requests" list themselves.
  const address = details?.address ?? `property ${propertyId}`;
  submitWeb3Form({
    subject: "New protest filing request — CorvusRF.ai",
    from_name: "CorvusRF.ai",
    property_address: address,
    property_id: propertyId,
    user_email: details?.userEmail ?? "(unknown)",
    message: `A protest filing was requested for ${address} by ${details?.userEmail ?? `user ${userId}`}. Update its status in the admin panel.`,
  }).catch((err) => console.error("Protest request staff notification failed:", err));

  return created;
}

export async function listProtests(userId: string): Promise<ProtestRecord[]> {
  const { data, error } = await supabase
    .from("protests")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data as ProtestRow[]).map(fromRow);
}
