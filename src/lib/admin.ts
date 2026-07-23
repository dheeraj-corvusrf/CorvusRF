import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Reads/writes here rely on the admin-only RLS policies in supabase/schema.sql
// (public.is_admin()) — never import this module from customer-facing routes,
// only from the /admin panel, which independently re-checks checkIsAdmin() itself.

export type PlanValue = "free_ai_review" | "ai_report" | "managed_protest";

export const PLAN_OPTIONS: { value: PlanValue; label: string }[] = [
  { value: "free_ai_review", label: "Free AI Review" },
  { value: "ai_report", label: "AI Report" },
  { value: "managed_protest", label: "Managed Protest" },
];

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
