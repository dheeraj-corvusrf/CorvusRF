import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import type { ProtestStatus } from "./protests";
import { PLAN_OPTIONS, type PlanValue } from "./billing";

// Reads/writes here rely on the admin-only RLS policies in supabase/schema.sql
// (public.is_admin()) — never import this module from customer-facing routes,
// only from the /admin panel, which independently re-checks checkIsAdmin() itself.
// PlanValue/PLAN_OPTIONS live in ./billing (customer-facing) and are just re-exported
// here for admin-panel convenience, since plan values aren't admin-specific data.
export { PLAN_OPTIONS, type PlanValue };

export type AdminUserRecord = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  plan: PlanValue;
  isAdmin: boolean;
  createdAt: string;
};

type ProfileRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  plan: PlanValue;
  is_admin: boolean;
  created_at: string;
};

function fromRow(row: ProfileRow): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    plan: row.plan,
    isAdmin: row.is_admin,
    createdAt: row.created_at,
  };
}

export async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.is_admin ?? false;
}

export async function listAllUsers(): Promise<AdminUserRecord[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name, phone, plan, is_admin, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProfileRow[]).map(fromRow);
}

export async function updateUserPlan(userId: string, plan: PlanValue): Promise<void> {
  const { error } = await supabase.from("profiles").update({ plan }).eq("id", userId);
  if (error) throw error;
}

export async function updateUserAdminStatus(userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.from("profiles").update({ is_admin: isAdmin }).eq("id", userId);
  if (error) throw error;
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await invokeEdgeFunction("admin-delete-user", { userId });
}

export async function createUserAccount(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<void> {
  await invokeEdgeFunction("admin-create-user", input);
}

export const PROTEST_STATUS_OPTIONS: { value: ProtestStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "filed", label: "Filed" },
  { value: "under_review", label: "Under Review" },
  { value: "hearing_scheduled", label: "Hearing Scheduled" },
  { value: "resolved", label: "Resolved" },
];

export type AdminProtestRecord = {
  id: string;
  propertyId: string;
  userId: string;
  status: ProtestStatus;
  notes: string | null;
  requestedAt: string;
  updatedAt: string;
  propertyAddress: string | null;
  propertyCad: string | null;
  protestDeadline: string | null;
  totalValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  taxYear: number | null;
  accountNumber: string | null;
};

type AdminProtestRow = {
  id: string;
  property_id: string;
  user_id: string;
  status: ProtestStatus;
  notes: string | null;
  requested_at: string;
  updated_at: string;
  properties: {
    address: string;
    cad: string | null;
    protest_deadline: string | null;
    total_value: number | null;
    land_value: number | null;
    improvement_value: number | null;
    tax_year: number | null;
    account_number: string | null;
  } | null;
};

// Real, staff-actioned queue: every row here came from a user clicking "Request
// Protest Filing" on the dashboard (src/lib/protests.ts) — status only ever moves
// forward from here, by an admin, since filing/hearings happen off-platform.
export async function listAllProtests(): Promise<AdminProtestRecord[]> {
  const { data, error } = await supabase
    .from("protests")
    .select(
      "id, property_id, user_id, status, notes, requested_at, updated_at, properties(address, cad, protest_deadline, total_value, land_value, improvement_value, tax_year, account_number)",
    )
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as AdminProtestRow[]).map((row) => ({
    id: row.id,
    propertyId: row.property_id,
    userId: row.user_id,
    status: row.status,
    notes: row.notes,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    propertyAddress: row.properties?.address ?? null,
    propertyCad: row.properties?.cad ?? null,
    protestDeadline: row.properties?.protest_deadline ?? null,
    totalValue: row.properties?.total_value ?? null,
    landValue: row.properties?.land_value ?? null,
    improvementValue: row.properties?.improvement_value ?? null,
    taxYear: row.properties?.tax_year ?? null,
    accountNumber: row.properties?.account_number ?? null,
  }));
}

export async function updateProtestStatus(protestId: string, status: ProtestStatus): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", protestId);
  if (error) throw error;
}

export async function updateProtestNotes(protestId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from("protests")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", protestId);
  if (error) throw error;
}

export type AdminDocumentRecord = {
  id: string;
  fileName: string;
  documentType: string | null;
  uploadedAt: string;
};

// Relies on the "Admins can view all documents" RLS policy (schema.sql) — metadata
// only (name/type/date), used as an evidence signal for the AI case summary below.
// Viewing/downloading the actual file isn't supported here: the storage bucket's
// own policies only permit the owning user, not admins.
export async function listDocumentsForProperty(propertyId: string): Promise<AdminDocumentRecord[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, document_type, uploaded_at")
    .eq("property_id", propertyId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data as { id: string; file_name: string; document_type: string | null; uploaded_at: string }[]).map(
    (row) => ({
      id: row.id,
      fileName: row.file_name,
      documentType: row.document_type,
      uploadedAt: row.uploaded_at,
    }),
  );
}

export type CaseSummaryResult = {
  summary: string;
  nextAction: string;
  evidenceGaps: string[];
};

export async function getCaseSummary(payload: {
  propertyContext: string;
  protestContext: string;
  documentsContext: string;
}): Promise<CaseSummaryResult> {
  return invokeEdgeFunction<CaseSummaryResult>("admin-case-summary", payload);
}
