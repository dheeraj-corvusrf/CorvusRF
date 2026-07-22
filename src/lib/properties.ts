import { supabase } from "./supabase";

export type PropertyRecord = {
  id: string;
  address: string;
  cad: string | null;
  accountNumber: string | null;
  ownerName: string | null;
  propertyType: string | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  taxYear: number | null;
  createdAt: string;
};

type PropertyRow = {
  id: string;
  address: string;
  cad: string | null;
  account_number: string | null;
  owner_name: string | null;
  property_type: string | null;
  land_value: number | null;
  improvement_value: number | null;
  total_value: number | null;
  tax_year: number | null;
  created_at: string;
};

function fromRow(row: PropertyRow): PropertyRecord {
  return {
    id: row.id,
    address: row.address,
    cad: row.cad,
    accountNumber: row.account_number,
    ownerName: row.owner_name,
    propertyType: row.property_type,
    landValue: row.land_value,
    improvementValue: row.improvement_value,
    totalValue: row.total_value,
    taxYear: row.tax_year,
    createdAt: row.created_at,
  };
}

export async function listProperties(): Promise<PropertyRecord[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, address, cad, account_number, owner_name, property_type, land_value, improvement_value, total_value, tax_year, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as PropertyRow[]).map(fromRow);
}

export async function addProperty(
  userId: string,
  property: {
    address: string;
    cad?: string;
    accountNumber?: string;
    ownerName?: string;
    propertyType?: string;
    landValue?: number;
    improvementValue?: number;
    totalValue?: number;
    taxYear?: number;
  },
): Promise<PropertyRecord> {
  const { data, error } = await supabase
    .from("properties")
    .insert({
      user_id: userId,
      address: property.address,
      cad: property.cad ?? null,
      account_number: property.accountNumber ?? null,
      owner_name: property.ownerName ?? null,
      property_type: property.propertyType ?? null,
      land_value: property.landValue ?? null,
      improvement_value: property.improvementValue ?? null,
      total_value: property.totalValue ?? null,
      tax_year: property.taxYear ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as PropertyRow);
}

export async function deleteProperty(id: string): Promise<void> {
  const { error } = await supabase.from("properties").delete().eq("id", id);
  if (error) throw error;
}
