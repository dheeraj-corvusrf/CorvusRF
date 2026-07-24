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
  protestDeadline: string | null;
  paymentDueDate: string | null;
  taxAmountDue: number | null;
  paidAt: string | null;
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
  protest_deadline: string | null;
  payment_due_date: string | null;
  tax_amount_due: number | null;
  paid_at: string | null;
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
    protestDeadline: row.protest_deadline,
    paymentDueDate: row.payment_due_date,
    taxAmountDue: row.tax_amount_due,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id, address, cad, account_number, owner_name, property_type, land_value, improvement_value, total_value, tax_year, protest_deadline, payment_due_date, tax_amount_due, paid_at, created_at";

export async function listProperties(userId: string): Promise<PropertyRecord[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
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
    protestDeadline?: string;
    paymentDueDate?: string;
    taxAmountDue?: number;
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
      protest_deadline: property.protestDeadline ?? null,
      payment_due_date: property.paymentDueDate ?? null,
      tax_amount_due: property.taxAmountDue ?? null,
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

// CorvusRF has no live payment integration — there's no bank/county feed to confirm a
// bill was actually paid, so this records the user's own "I paid this" action rather
// than a verified payment event.
export async function markPropertyPaid(id: string): Promise<PropertyRecord> {
  const { data, error } = await supabase
    .from("properties")
    .update({ paid_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as PropertyRow);
}
