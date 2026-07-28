import { invokeEdgeFunction } from "./edge-functions";

export type CompProperty = {
  pid: number;
  address: string;
  latitude: number;
  longitude: number;
  marketValue: number | null;
  ownerName: string | null;
};

export type CompsResult = {
  subject: (CompProperty & { asCode: string }) | null;
  comps: CompProperty[];
};

// Only returns real data for the 4 counties on the TrueProdigy platform (Denton,
// Montgomery, Tarrant, Travis) — every other county gets { subject: null, comps: [] }
// rather than a fabricated map. See texas_cad_vendor_landscape memory.
export async function getComps(input: {
  cad?: string;
  accountNumber?: string;
}): Promise<CompsResult> {
  return invokeEdgeFunction<CompsResult>("cad-comps", input);
}
