import { invokeEdgeFunction } from "./edge-functions";
import type { CadRecord } from "./cad-lookup";

export async function searchPropertiesByOwner(ownerName: string): Promise<CadRecord[]> {
  const res = await invokeEdgeFunction<{ matches: CadRecord[] }>("cad-owner-search", { ownerName });
  return res.matches;
}
