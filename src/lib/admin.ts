import { supabase } from "./supabase";

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

async function invokeAdminFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    // supabase-js's default error.message is a generic "non-2xx status" string —
    // the function's actual { error: "..." } reason is in the response body.
    const context = (error as { context?: Response }).context;
    let extractedMessage: string | undefined;
    if (context) {
      try {
        const payload = (await context.clone().json()) as { error?: string };
        extractedMessage = payload?.error;
      } catch {
        // response body wasn't JSON — fall through to the generic error below
      }
    }
    throw extractedMessage ? new Error(extractedMessage) : error;
  }
  return data as T;
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await invokeAdminFunction("admin-delete-user", { userId });
}

export async function createUserAccount(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<void> {
  await invokeAdminFunction("admin-create-user", input);
}
