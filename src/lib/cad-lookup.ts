import { invokeEdgeFunction } from "./edge-functions";

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
};

export type CadLookupResult = { matched: false } | { matched: true; record: CadRecord };

export async function cadLookup(address: string): Promise<CadLookupResult> {
  return invokeEdgeFunction<CadLookupResult>("cad-lookup", { address });
}
