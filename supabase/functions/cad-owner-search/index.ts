// Deploy via CLI: `supabase functions deploy cad-owner-search`.
// No secrets required — same public ArcGIS FeatureServer endpoints as cad-lookup,
// just queried by owner name instead of address, across all eleven counties at once.
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
  // Denton County's own GIS (gis.dentoncounty.gov) — see cad-lookup/index.ts for why
  // this replaced the earlier "TAD_Parcels" service (a ~234-parcel subdivision
  // extract, not countywide coverage).
  const where = `UPPER(name) LIKE UPPER('%${owner}%')`;
  const url =
    "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=name,situs_full_address,landHSValue,landNHSValue,improvementValue,ownerMarketValue,pid,pYear,propType" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a.name as string)?.trim() || null,
    propertyAddress: (a.situs_full_address as string)?.trim() ?? "",
    cad: "Denton Central Appraisal District",
    accountNumber: a.pid != null ? String(a.pid) : null,
    propertyType: (a.propType as string)?.trim() || null,
    landValue: (parseMoneyField(a.landHSValue) ?? 0) + (parseMoneyField(a.landNHSValue) ?? 0),
    improvementValue: parseMoneyField(a.improvementValue),
    totalValue: parseMoneyField(a.ownerMarketValue),
    taxYear: a.pYear != null ? parseInt(String(a.pYear), 10) : null,
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

// Tarrant's City field is a 3-digit jurisdiction code, not a name — see
// cad-lookup/index.ts's TARRANT_CITY_CODES comment for the full story.
const TARRANT_CITY_CODES: Record<string, string> = {
  "001": "Azle",
  "002": "Bedford",
  "003": "Benbrook",
  "004": "Blue Mound",
  "005": "Colleyville",
  "006": "Crowley",
  "007": "Dalworthington Gardens",
  "008": "Edgecliff Village",
  "009": "Everman",
  "010": "Forest Hill",
  "011": "Grapevine",
  "013": "Keller",
  "014": "Kennedale",
  "015": "Lakeside",
  "016": "Lake Worth",
  "017": "Mansfield",
  "018": "North Richland Hills",
  "019": "Pantego",
  "020": "Richland Hills",
  "021": "Saginaw",
  "022": "Southlake",
  "023": "Westover Hills",
  "024": "Arlington",
  "025": "Euless",
  "026": "Fort Worth",
  "027": "Haltom City",
  "028": "Hurst",
  "029": "River Oaks",
  "030": "White Settlement",
  "031": "Watauga",
  "032": "Westworth Village",
  "033": "Burleson",
  "034": "Haslet",
  "036": "Pelican Bay",
  "037": "Westlake",
  "038": "Grand Prairie",
  "039": "Sansom Park",
  "041": "Reno",
  "042": "Flower Mound",
  "043": "Roanoke",
  "044": "Trophy Club",
};

async function searchTarrant(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(Owner_Name) LIKE UPPER('%${owner}%')`;
  const url =
    "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_ParcelView/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=Owner_Name,Situs_Addr,City,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C" +
    "&f=json"; // this endpoint doesn't support resultRecordCount
  const features = await fetchFeatures(url);
  return features.slice(0, PER_COUNTY_LIMIT).map(({ attributes: a }) => {
    const situsAddr = (a.Situs_Addr as string)?.trim() ?? "";
    const cityName = TARRANT_CITY_CODES[(a.City as string)?.trim()] ?? null;
    return {
      ownerName: (a.Owner_Name as string) ?? null,
      propertyAddress: situsAddr && cityName ? `${situsAddr}, ${cityName}` : situsAddr,
      cad: "Tarrant Appraisal District",
      accountNumber: (a.Account_Nu as string)?.trim() || null,
      propertyType: (a.Property_C as string)?.trim() || null,
      landValue: parseMoneyField(a.Land_Value),
      improvementValue: parseMoneyField(a.Improvemen),
      totalValue: parseMoneyField(a.Appraised_ ?? a.Total_Valu),
      taxYear: null,
    };
  });
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

// BCAD's own domain — see cad-lookup/index.ts's queryBexar for why this needs
// fully-qualified `table.column` names (this service is a SQL join underneath) and
// why there's no land/improvement split, only a combined appraised value.
function parseDollarString(v: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const BCAD_FIELDS = {
  owner: "PAMaps.dbo.web_map_property.owner_name",
  situs: "PAMaps.dbo.web_map_property.situs",
  appraisedVal: "PAMaps.dbo.web_map_property.appraised_val",
  taxYear: "PAMaps.dbo.web_map_property.prop_val_yr",
  propType: "PAMaps.dbo.web_map_property.prop_type_desc",
  propId: "PAMaps.DBO.ParcelFabric_Parcels.PROP_ID",
};

async function searchBexar(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(${BCAD_FIELDS.owner}) LIKE UPPER('%${owner}%')`;
  const url =
    "https://maps.bcad.org/arcgis/rest/services/PAMapSearch/MapServer/6/query" +
    `?where=${encodeURIComponent(where)}` +
    `&outFields=${Object.values(BCAD_FIELDS).join(",")}` +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => ({
    ownerName: (a[BCAD_FIELDS.owner] as string)?.trim() || null,
    propertyAddress: (a[BCAD_FIELDS.situs] as string)?.trim() || "",
    cad: "Bexar Appraisal District",
    accountNumber: a[BCAD_FIELDS.propId] != null ? String(a[BCAD_FIELDS.propId]) : null,
    propertyType: (a[BCAD_FIELDS.propType] as string)?.trim() || null,
    landValue: null,
    improvementValue: null,
    totalValue: parseDollarString(a[BCAD_FIELDS.appraisedVal]),
    taxYear: a[BCAD_FIELDS.taxYear] != null ? Number(a[BCAD_FIELDS.taxYear]) : null,
  }));
}

// Dallas County — see cad-lookup/index.ts's queryDallas for the source. No value
// fields exist on this layer at all, so those are honestly null here too.
async function searchDallas(owner: string): Promise<CadRecord[]> {
  const where = `UPPER(OWNER_NAME1) LIKE UPPER('%${owner}%')`;
  const url =
    "https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/DCAD_PARCELS/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNER_NAME1,SiteAddress,PROPERTY_CITY,PROPERTY_ZIPCODE,ACCOUNT_NUM,APPRAISAL_YR" +
    `&resultRecordCount=${PER_COUNTY_LIMIT}&f=json`;
  const features = await fetchFeatures(url);
  return features.map(({ attributes: a }) => {
    const site = (a.SiteAddress as string)?.trim();
    const city = (a.PROPERTY_CITY as string)?.trim().replace(/\s*\([^)]*\)\s*$/, "");
    const zip9 = a.PROPERTY_ZIPCODE != null ? String(a.PROPERTY_ZIPCODE) : null;
    const zip = zip9 && zip9.length >= 5 ? `${zip9.slice(0, 5)}-${zip9.slice(5)}` : zip9;
    return {
      ownerName: (a.OWNER_NAME1 as string)?.trim() || null,
      propertyAddress: site && city ? `${site}, ${city}, TX${zip ? ` ${zip}` : ""}` : site || "",
      cad: "Dallas Central Appraisal District",
      accountNumber: (a.ACCOUNT_NUM as string)?.trim() || null,
      propertyType: null,
      landValue: null,
      improvementValue: null,
      totalValue: null,
      taxYear: a.APPRAISAL_YR != null ? Number(a.APPRAISAL_YR) : null,
    };
  });
}

const SEARCHERS = [
  searchCollin,
  searchMontgomery,
  searchDenton,
  searchHarris,
  searchTarrant,
  searchFortBend,
  searchWilliamson,
  searchGrayson,
  searchBexar,
  searchDallas,
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
