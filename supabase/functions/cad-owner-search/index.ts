// Deploy via CLI: `supabase functions deploy cad-owner-search`.
// No secrets required — same public ArcGIS FeatureServer endpoints as cad-lookup,
// just queried by owner name instead of address, across all nine counties at once.
//
// Used right after signup to find properties an LLC/business name may already own,
// so the user doesn't have to manually enter every address. Real matches only — a
// county with no results simply contributes nothing, never a fabricated match.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const PER_COUNTY_LIMIT = 10;

function parseMoneyField(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchFeatures(
  url: string,
): Promise<Array<{ attributes: Record<string, string | number | null> }>> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return json.features ?? [];
}

async function searchCollin(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(ownerName) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=ownerName,situsConcat,currValLand,currValImprv,currValAppraised,PROP_ID,propType,propYear" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a.ownerName as string) ?? null,
    propertyAddress: (a.situsConcat as string) ?? "",
    cad: "Collin Central Appraisal District",
    accountNumber: a.PROP_ID != null ? String(a.PROP_ID) : null,
    propertyType: (a.propType as string) ?? null,
    landValue: (a.currValLand as number) ?? null,
    improvementValue: (a.currValImprv as number) ?? null,
    totalValue: (a.currValAppraised as number) ?? null,
    taxYear: (a.propYear as number) ?? null,
  }));
}

async function searchMontgomery(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(ownerName) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=ownerName,situs,legalDescription,PIN" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a.ownerName as string) ?? null,
    propertyAddress: (a.situs as string) ?? "",
    cad: "Montgomery Central Appraisal District",
    accountNumber: a.PIN != null ? String(a.PIN) : null,
    propertyType: "Not published by county",
    landValue: null,
    improvementValue: null,
    totalValue: null,
    taxYear: null,
  }));
}

async function searchDenton(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(Owner_Name) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services.arcgis.com/oTsZYNubyv7xK5yP/arcgis/rest/services/TAD_Parcels/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=Owner_Name,Situs_Addr,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a.Owner_Name as string) ?? null,
    propertyAddress: (a.Situs_Addr as string)?.trim() ?? "",
    cad: "Denton Central Appraisal District",
    accountNumber: (a.Account_Nu as string)?.trim() || null,
    propertyType: (a.Property_C as string)?.trim() || null,
    landValue: parseMoneyField(a.Land_Value),
    improvementValue: parseMoneyField(a.Improvemen),
    totalValue: parseMoneyField(a.Appraised_ ?? a.Total_Valu),
    taxYear: null,
  }));
}

async function searchHarris(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(owner_name_1) LIKE UPPER('%${owner}%')`;
  const url =
    "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=owner_name_1,site_str_num,site_str_name,site_str_sfx,site_city,land_value,bld_value,total_appraised_val,acct_num,tax_year" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => {
    const streetParts = [a.site_str_num, a.site_str_name, a.site_str_sfx].filter(Boolean).join(" ");
    return {
      ownerName: (a.owner_name_1 as string) ?? null,
      propertyAddress: streetParts ? `${streetParts}, ${a.site_city ?? ""}` : "",
      cad: "Harris Central Appraisal District",
      accountNumber: (a.acct_num as string) ?? null,
      propertyType: null,
      landValue: parseMoneyField(a.land_value),
      improvementValue: parseMoneyField(a.bld_value),
      totalValue: parseMoneyField(a.total_appraised_val),
      taxYear: a.tax_year != null ? parseInt(String(a.tax_year), 10) : null,
    };
  });
}

async function searchTarrant(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(Owner_Name) LIKE UPPER('%${owner}%')`;
  const url =
    "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_ParcelView/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=Owner_Name,Situs_Addr,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C" +
    "&f=json"; // this endpoint doesn't support resultRecordCount
  const features = await fetchFeatures(url);
  return features.slice(0, PER_COUNTY_LIMIT).map(({ attributes: a }) => ({
    ownerName: (a.Owner_Name as string) ?? null,
    propertyAddress: (a.Situs_Addr as string)?.trim() ?? "",
    cad: "Tarrant Appraisal District",
    accountNumber: (a.Account_Nu as string)?.trim() || null,
    propertyType: (a.Property_C as string)?.trim() || null,
    landValue: parseMoneyField(a.Land_Value),
    improvementValue: parseMoneyField(a.Improvemen),
    totalValue: parseMoneyField(a.Appraised_ ?? a.Total_Valu),
    taxYear: null,
  }));
}

async function searchFortBend(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(OWNERNAME) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNERNAME,SITUS,LANDVALUE,IMPVALUE,TOTALVALUE,PROPNUMBER,Building_Class" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a.OWNERNAME as string) ?? null,
    propertyAddress: (a.SITUS as string)?.trim() || "",
    cad: "Fort Bend Central Appraisal District",
    accountNumber: (a.PROPNUMBER as string) ?? null,
    propertyType: (a.Building_Class as string) ?? null,
    landValue: parseMoneyField(a.LANDVALUE),
    improvementValue: parseMoneyField(a.IMPVALUE),
    totalValue: parseMoneyField(a.TOTALVALUE),
    taxYear: null,
  }));
}

async function searchWilliamson(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(OWNERNME1) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNERNME1,SITEADDRESS,LNDVALUE,CNTASSDVAL,PARCELID,CLASSDSCRP" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a.OWNERNME1 as string) ?? null,
    propertyAddress: (a.SITEADDRESS as string)?.trim() || "",
    cad: "Williamson Central Appraisal District",
    accountNumber: (a.PARCELID as string) ?? null,
    propertyType: (a.CLASSDSCRP as string) ?? null,
    landValue: parseMoneyField(a.LNDVALUE),
    improvementValue: null,
    totalValue: parseMoneyField(a.CNTASSDVAL),
    taxYear: null,
  }));
}

async function searchGrayson(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(OwnerName) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services1.arcgis.com/EVxyUkKpll765a5X/arcgis/rest/services/Grayson_Appraisal_Parcel_Map_WFL1/FeatureServer/13/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OwnerName,SitusNumber,SitusStreet,SitusStreetSufix,SitusCity,LandValue,ImprovementValue,MarketValue,PropertyNumber,Year" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => {
    const streetParts = [a.SitusNumber, a.SitusStreet, a.SitusStreetSufix].filter(Boolean).join(" ");
    return {
      ownerName: (a.OwnerName as string) ?? null,
      propertyAddress: streetParts ? `${streetParts}, ${a.SitusCity ?? ""}` : "",
      cad: "Grayson Central Appraisal District",
      accountNumber: a.PropertyNumber != null ? String(a.PropertyNumber) : null,
      propertyType: null,
      landValue: parseMoneyField(a.LandValue),
      improvementValue: parseMoneyField(a.ImprovementValue),
      totalValue: parseMoneyField(a.MarketValue),
      taxYear: a.Year != null ? parseInt(String(a.Year), 10) : null,
    };
  });
}

// Travis's public source has no owner name field at all — cannot be searched by
// owner, so it's correctly omitted here (same honesty constraint as cad-lookup.ts).

const SEARCHERS = [
  searchCollin,
  searchMontgomery,
  searchDenton,
  searchHarris,
  searchTarrant,
  searchFortBend,
  searchWilliamson,
  searchGrayson,
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { ownerName } = await req.json();
    if (!ownerName || typeof ownerName !== "string" || ownerName.trim().length < 3) {
      return new Response(JSON.stringify({ error: "ownerName (3+ characters) is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const results = await Promise.allSettled(SEARCHERS.map((fn) => fn(ownerName.trim())));
    const matches: CadRecord[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") matches.push(...r.value);
    }

    return new Response(JSON.stringify({ matches }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 502, headers: corsHeaders },
    );
  }
});
