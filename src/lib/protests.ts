import { supabase } from "./supabase";

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
// the admin panel.
export async function requestProtest(userId: string, propertyId: string): Promise<ProtestRecord> {
  const { data, error } = await supabase
    .from("protests")
    .insert({ property_id: propertyId, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as ProtestRow);
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
