import { invokeEdgeFunction } from "./edge-functions";

export type CadDeed = {
  date: string | null;
  type: string | null;
  description: string | null;
  seller: string | null;
  buyer: string | null;
  instrumentNum: string | null;
};

export type CadValueHistoryEntry = {
  year: number;
  landValue: number | null;
  improvementValue: number | null;
  marketValue: number | null;
  appraisedValue: number | null;
};

export type CadRecord = {
  ownerName: string | null;
  propertyAddress: string;
  cad: string;
  accountNumber: string | null;
  propertyType: string | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  taxYear: number | null;
  // Only populated for the counties whose public site exposes a real JSON API
  // (Denton, Montgomery, Tarrant, Travis, Fort Bend, Grayson) — see
  // texas_cad_vendor_landscape memory for why the other 5 counties can't offer this.
  legalDescription?: string | null;
  subdivision?: string | null;
  geoId?: string | null;
  mailingAddress?: string | null;
  ownershipPct?: number | null;
  protestStatus?: string | null;
  valueHistory?: CadValueHistoryEntry[];
  deeds?: CadDeed[];
};

export type CadLookupResult = { matched: false } | { matched: true; record: CadRecord };

export async function cadLookup(address: string): Promise<CadLookupResult> {
  return invokeEdgeFunction<CadLookupResult>("cad-lookup", { address });
}
