// Deploy via CLI: `supabase functions deploy cad-lookup`.
// No secrets required — both ArcGIS FeatureServer endpoints queried below are public,
// unauthenticated county open-data services.
//
// Collin, Montgomery, and Denton counties are wired up for real (Phase 2A). All three
// publish live-queryable parcel data on public ArcGIS FeatureServer REST APIs. Every
// other Texas county either has no public API (Travis explicitly disallows bulk
// queries; Dallas/Fort Bend require formal records requests) or only publishes bulk
// file exports that need a separate ingestion pipeline (Harris/Tarrant/Williamson/
// Grayson — Phase 2B, not yet built). Addresses outside these three counties correctly
// fall through to "not matched" rather than returning fabricated data.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Without this, supabase-js's functions.invoke() parses the body as plain text
  // (a JSON string) instead of a parsed object, based on the response Content-Type.
  "Content-Type": "application/json",
};

type CadRecord = {
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

const COLLIN_CITIES =
  /\b(plano|mckinney|frisco|allen|wylie|prosper|celina|princeton|anna|melissa|farmersville|collin county)\b/i;
const MONTGOMERY_CITIES =
  /\b(conroe|the woodlands|magnolia|willis|montgomery|splendora|montgomery county)\b/i;
const DENTON_CITIES =
  /\b(denton|lewisville|flower mound|corinth|little elm|the colony|highland village|argyle|aubrey|sanger|pilot point|krum|ponder|denton county)\b/i;

function parseHouseAndStreet(
  address: string,
): { house: string; street: string; cityStateZip: string } | null {
  const m = address.match(/^\s*(\d+)\s+([^,]+?)\s*,(.*)$/);
  if (!m) return null;
  return { house: m[1], street: m[2].trim(), cityStateZip: m[3].trim() };
}

async function queryCollin(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const where = `UPPER(situsConcat) LIKE UPPER('%${parsed.house} ${parsed.street}%')`;
  const url =
    "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=ownerName,situsConcat,currValLand,currValImprv,currValAppraised,PROP_ID,propType,propYear" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Collin CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  return {
    ownerName: (attrs.ownerName as string) ?? null,
    propertyAddress: (attrs.situsConcat as string) ?? address,
    cad: "Collin Central Appraisal District",
    accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
    propertyType: (attrs.propType as string) ?? null,
    landValue: (attrs.currValLand as number) ?? null,
    improvementValue: (attrs.currValImprv as number) ?? null,
    totalValue: (attrs.currValAppraised as number) ?? null,
    taxYear: (attrs.propYear as number) ?? null,
  };
}

async function queryMontgomery(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const where = `UPPER(situs) LIKE UPPER('%${parsed.house} ${parsed.street}%')`;
  const url =
    "https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=ownerName,situs,legalDescription,PIN" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Montgomery CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  return {
    ownerName: (attrs.ownerName as string) ?? null,
    propertyAddress: (attrs.situs as string) ?? address,
    cad: "Montgomery Central Appraisal District",
    accountNumber: attrs.PIN != null ? String(attrs.PIN) : null,
    propertyType: "Not published by county",
    landValue: null,
    improvementValue: null,
    totalValue: null,
    taxYear: null,
  };
}

function parseMoneyField(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function queryDenton(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const where = `UPPER(Situs_Addr) LIKE UPPER('%${parsed.house} ${parsed.street}%')`;
  const url =
    "https://services.arcgis.com/oTsZYNubyv7xK5yP/arcgis/rest/services/TAD_Parcels/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=Owner_Name,Situs_Addr,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Denton CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  const situsAddr = (attrs.Situs_Addr as string | null)?.trim();
  return {
    ownerName: (attrs.Owner_Name as string) ?? null,
    propertyAddress: situsAddr ? `${situsAddr}, ${parsed.cityStateZip}` : address,
    cad: "Denton Central Appraisal District",
    accountNumber: (attrs.Account_Nu as string)?.trim() || null,
    propertyType: (attrs.Property_C as string)?.trim() || null,
    landValue: parseMoneyField(attrs.Land_Value),
    improvementValue: parseMoneyField(attrs.Improvemen),
    totalValue: parseMoneyField(attrs.Appraised_ ?? attrs.Total_Valu),
    taxYear: null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { address } = await req.json();
    if (!address || typeof address !== "string") {
      return new Response(JSON.stringify({ error: "address is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    let record: CadRecord | null = null;
    if (COLLIN_CITIES.test(address)) {
      record = await queryCollin(address);
    } else if (MONTGOMERY_CITIES.test(address)) {
      record = await queryMontgomery(address);
    } else if (DENTON_CITIES.test(address)) {
      record = await queryDenton(address);
    }

    if (!record) {
      return new Response(JSON.stringify({ matched: false }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ matched: true, record }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 502, headers: corsHeaders },
    );
  }
});
