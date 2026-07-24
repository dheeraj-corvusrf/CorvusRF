import { supabase } from "./supabase";

export type MyProfile = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  companyName: string | null;
};

type ProfileRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company_name: string | null;
};

export async function getMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, first_name, last_name, phone, company_name")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const row = data as ProfileRow;
  return {
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    companyName: row.company_name,
  };
}

export async function updateMyProfile(
  userId: string,
  patch: { firstName?: string; lastName?: string; phone?: string; companyName?: string | null },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.firstName !== undefined) update.first_name = patch.firstName;
  if (patch.lastName !== undefined) update.last_name = patch.lastName;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.companyName !== undefined) update.company_name = patch.companyName;
  const { error } = await supabase.from("profiles").update(update).eq("id", userId);
  if (error) throw error;
}
