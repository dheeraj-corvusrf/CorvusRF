import { supabase } from "./supabase";

// Business Personal Property tax accounts — distinct from public.properties (real
// estate): a business can render BPP for a location without owning the real estate
// itself, so this needs its own entity rather than being a filtered property view.
export type BppAccountRecord = {
  id: string;
  businessName: string;
  accountNumber: string | null;
  cad: string | null;
  locationAddress: string | null;
  createdAt: string;
};

type BppAccountRow = {
  id: string;
  business_name: string;
  account_number: string | null;
  cad: string | null;
  location_address: string | null;
  created_at: string;
};

function fromRow(row: BppAccountRow): BppAccountRecord {
  return {
    id: row.id,
    businessName: row.business_name,
    accountNumber: row.account_number,
    cad: row.cad,
    locationAddress: row.location_address,
    createdAt: row.created_at,
  };
}

export async function listBppAccounts(userId: string): Promise<BppAccountRecord[]> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .select("id, business_name, account_number, cad, location_address, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as BppAccountRow[]).map(fromRow);
}

export async function addBppAccount(
  userId: string,
  account: {
    businessName: string;
    accountNumber?: string;
    cad?: string;
    locationAddress?: string;
  },
): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .insert({
      user_id: userId,
      business_name: account.businessName,
      account_number: account.accountNumber ?? null,
      cad: account.cad ?? null,
      location_address: account.locationAddress ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

export async function deleteBppAccount(id: string): Promise<void> {
  const { error } = await supabase.from("bpp_accounts").delete().eq("id", id);
  if (error) throw error;
}
