import { supabase } from "./supabase";
import { submitWeb3Form } from "./web3forms";

export type ProtestStatus = "requested" | "filed" | "under_review" | "hearing_scheduled" | "resolved";

export type ProtestRecord = {
  id: string;
  propertyId: string;
  status: ProtestStatus;
  notes: string | null;
  requestedAt: string;
  updatedAt: string;
};

type ProtestRow = {
  id: string;
  property_id: string;
  status: ProtestStatus;
  notes: string | null;
  requested_at: string;
  updated_at: string;
};

function fromRow(row: ProtestRow): ProtestRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    status: row.status,
    notes: row.notes,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

// Filing and hearing representation happen off-platform by CorvusRF staff (per the
// /property-protest page's own description) — this creates the real request record
// staff act on; there is no automated filing today, so status only ever advances via
// the admin panel. `details` is used only for the staff notification below — the
// request itself is fully recorded in the DB regardless of whether that send works.
export async function requestProtest(
  userId: string,
  propertyId: string,
  details?: { address?: string; userEmail?: string },
): Promise<ProtestRecord> {
  const { data, error } = await supabase
    .from("protests")
    .insert({ property_id: propertyId, user_id: userId })
    .select()
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
    .select("id, property_id, status, notes, requested_at, updated_at")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data as ProtestRow[]).map(fromRow);
}
