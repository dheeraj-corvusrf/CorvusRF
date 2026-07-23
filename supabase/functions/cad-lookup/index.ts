// Deploy via CLI: `supabase functions deploy cad-lookup`.
// No secrets required — both ArcGIS FeatureServer endpoints queried below are public,
// unauthenticated county open-data services.
//
// Collin, Montgomery, Denton, Harris, Tarrant, Fort Bend, Williamson, Grayson, and
// Travis counties are wired up for real (Phase 2A/2B). All nine publish live-queryable
// parcel data on public ArcGIS FeatureServer/MapServer REST APIs — turns out every one
// of the originally-assumed "bulk file only" counties (Harris/Tarrant/Williamson/
// Grayson) actually has a live API too, just not discoverable via plain web search
// (found via ArcGIS's own item-search API instead). Travis's public source has no
// owner name or value fields at all (only address + legal description) — included
// anyway per product decision, with those fields honestly null rather than faked.
// Only Dallas has no public live API or bulk download found. Addresses outside these
// nine counties correctly fall through to "not matched" rather than returning
// fabricated data.
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
const HARRIS_CITIES =
  /\b(houston|pasadena|humble|spring|cypress|channelview|tomball|baytown|bellaire|jacinto city|harris county)\b/i;
const TARRANT_CITIES =
  /\b(fort worth|arlington|hurst|euless|bedford|mansfield|north richland hills|keller|southlake|tarrant county)\b/i;
const FORT_BEND_CITIES =
  /\b(sugar land|missouri city|richmond|rosenberg|stafford|fulshear|needville|fort bend county)\b/i;
const WILLIAMSON_CITIES =
  /\b(georgetown|round rock|cedar park|leander|hutto|taylor|liberty hill|coupland|jarrell|thrall|granger|florence|williamson county)\b/i;
const GRAYSON_CITIES = /\b(sherman|denison|pottsboro|van alstyne|howe|grayson county)\b/i;
const TRAVIS_CITIES = /\b(austin|pflugerville|del valle|manor|lakeway|bee cave|travis county)\b/i;

function parseHouseAndStreet(
  address: string,
): { house: string; street: string; cityStateZip: string } | null {
  const m = address.match(/^\s*(\d+)\s+([^,]+?)\s*,(.*)$/);
  if (!m) return null;
  return { house: m[1], street: m[2].trim(), cityStateZip: m[3].trim() };
}

// Strips a leading directional (N/S/E/W) and a trailing street-type word, leaving just
// the "core" street name — used for counties whose schema splits house number and
// street type into separate fields, so we can't match the full phrase in one LIKE.
const STREET_SUFFIX_WORDS =
  /\b(st|street|rd|road|dr|drive|ln|lane|ave|avenue|blvd|boulevard|ct|court|pl|place|pkwy|parkway|hwy|highway|cir|circle|way|trl|trail)\.?$/i;
function coreStreetName(street: string): string {
  return street
    .replace(/^(n|s|e|w|north|south|east|west)\s+/i, "")
    .replace(STREET_SUFFIX_WORDS, "")
    .trim();
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

async function queryHarris(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const core = coreStreetName(parsed.street);
  const where = `site_str_num = ${parsed.house} AND UPPER(site_str_name) LIKE UPPER('%${core}%')`;
  const url =
    "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=owner_name_1,site_str_num,site_str_name,site_str_sfx,site_city,land_value,bld_value,total_appraised_val,acct_num,tax_year" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Harris CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  const streetParts = [attrs.site_str_num, attrs.site_str_name, attrs.site_str_sfx]
    .filter(Boolean)
    .join(" ");
  return {
    ownerName: (attrs.owner_name_1 as string) ?? null,
    propertyAddress: streetParts
      ? `${streetParts}, ${attrs.site_city ?? parsed.cityStateZip}`
      : address,
    cad: "Harris Central Appraisal District",
    accountNumber: (attrs.acct_num as string) ?? null,
    propertyType: null,
    landValue: parseMoneyField(attrs.land_value),
    improvementValue: parseMoneyField(attrs.bld_value),
    totalValue: parseMoneyField(attrs.total_appraised_val),
    taxYear: attrs.tax_year != null ? parseInt(String(attrs.tax_year), 10) : null,
  };
}

async function queryTarrant(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const where = `UPPER(Situs_Addr) LIKE UPPER('%${parsed.house} ${parsed.street}%')`;
  const url =
    "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_ParcelView/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=Owner_Name,Situs_Addr,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C" +
    "&f=json"; // this endpoint doesn't support resultRecordCount ("Pagination is not supported")

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tarrant CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  const situsAddr = (attrs.Situs_Addr as string | null)?.trim();
  return {
    ownerName: (attrs.Owner_Name as string) ?? null,
    propertyAddress: situsAddr ? `${situsAddr}, ${parsed.cityStateZip}` : address,
    cad: "Tarrant Appraisal District",
    accountNumber: (attrs.Account_Nu as string)?.trim() || null,
    propertyType: (attrs.Property_C as string)?.trim() || null,
    landValue: parseMoneyField(attrs.Land_Value),
    improvementValue: parseMoneyField(attrs.Improvemen),
    totalValue: parseMoneyField(attrs.Appraised_ ?? attrs.Total_Valu),
    taxYear: null,
  };
}

async function queryFortBend(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const where = `UPPER(SITUS) LIKE UPPER('%${parsed.house} ${parsed.street}%')`;
  const url =
    "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNERNAME,SITUS,LANDVALUE,IMPVALUE,TOTALVALUE,PROPNUMBER,Building_Class" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fort Bend CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  return {
    ownerName: (attrs.OWNERNAME as string) ?? null,
    propertyAddress: (attrs.SITUS as string)?.trim() || address,
    cad: "Fort Bend Central Appraisal District",
    accountNumber: (attrs.PROPNUMBER as string) ?? null,
    propertyType: (attrs.Building_Class as string) ?? null,
    landValue: parseMoneyField(attrs.LANDVALUE),
    improvementValue: parseMoneyField(attrs.IMPVALUE),
    totalValue: parseMoneyField(attrs.TOTALVALUE),
    taxYear: null,
  };
}

async function queryWilliamson(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const where = `UPPER(SITEADDRESS) LIKE UPPER('%${parsed.house} ${parsed.street}%')`;
  const url =
    "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNERNME1,SITEADDRESS,LNDVALUE,CNTASSDVAL,PARCELID,CLASSDSCRP" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Williamson CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  return {
    ownerName: (attrs.OWNERNME1 as string) ?? null,
    propertyAddress: (attrs.SITEADDRESS as string)?.trim() || address,
    cad: "Williamson Central Appraisal District",
    accountNumber: (attrs.PARCELID as string) ?? null,
    propertyType: (attrs.CLASSDSCRP as string) ?? null,
    landValue: parseMoneyField(attrs.LNDVALUE),
    improvementValue: null,
    totalValue: parseMoneyField(attrs.CNTASSDVAL),
    taxYear: null,
  };
}

async function queryGrayson(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const core = coreStreetName(parsed.street);
  const where = `SitusNumber = '${parsed.house}' AND UPPER(SitusStreet) LIKE UPPER('%${core}%')`;
  const url =
    "https://services1.arcgis.com/EVxyUkKpll765a5X/arcgis/rest/services/Grayson_Appraisal_Parcel_Map_WFL1/FeatureServer/13/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OwnerName,SitusNumber,SitusStreet,SitusStreetSufix,SitusCity,LandValue,ImprovementValue,MarketValue,PropertyNumber,Year" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Grayson CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  const streetParts = [attrs.SitusNumber, attrs.SitusStreet, attrs.SitusStreetSufix]
    .filter(Boolean)
    .join(" ");
  return {
    ownerName: (attrs.OwnerName as string) ?? null,
    propertyAddress: streetParts
      ? `${streetParts}, ${attrs.SitusCity ?? parsed.cityStateZip}`
      : address,
    cad: "Grayson Central Appraisal District",
    accountNumber: attrs.PropertyNumber != null ? String(attrs.PropertyNumber) : null,
    propertyType: null,
    landValue: parseMoneyField(attrs.LandValue),
    improvementValue: parseMoneyField(attrs.ImprovementValue),
    totalValue: parseMoneyField(attrs.MarketValue),
    taxYear: attrs.Year != null ? parseInt(String(attrs.Year), 10) : null,
  };
}

async function queryTravis(address: string): Promise<CadRecord | null> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return null;
  const core = coreStreetName(parsed.street);
  const where = `situs_num = '${parsed.house}' AND UPPER(situs_street) LIKE UPPER('%${core}%')`;
  const url =
    "https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=situs_num,situs_street_prefx,situs_street,situs_street_suffix,situs_city,PROP_ID" +
    "&resultRecordCount=1&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Travis CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return null;

  const streetParts = [
    attrs.situs_num,
    attrs.situs_street_prefx,
    attrs.situs_street,
    attrs.situs_street_suffix,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    // Travis's public source has no owner name or value fields at all — real address,
    // honestly null everything else, rather than fabricating a match.
    ownerName: null,
    propertyAddress: streetParts
      ? `${streetParts}, ${attrs.situs_city ?? parsed.cityStateZip}`
      : address,
    cad: "Travis Central Appraisal District",
    accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
    propertyType: "Not published by county",
    landValue: null,
    improvementValue: null,
    totalValue: null,
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
    } else if (HARRIS_CITIES.test(address)) {
      record = await queryHarris(address);
    } else if (TARRANT_CITIES.test(address)) {
      record = await queryTarrant(address);
    } else if (FORT_BEND_CITIES.test(address)) {
      record = await queryFortBend(address);
    } else if (WILLIAMSON_CITIES.test(address)) {
      record = await queryWilliamson(address);
    } else if (GRAYSON_CITIES.test(address)) {
      record = await queryGrayson(address);
    } else if (TRAVIS_CITIES.test(address)) {
      record = await queryTravis(address);
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
