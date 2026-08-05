// Deploy via CLI: `supabase functions deploy cad-lookup`.
// No secrets required — both ArcGIS FeatureServer endpoints queried below are public,
// unauthenticated county open-data services.
//
// Collin, Montgomery, Denton, Harris, Tarrant, Fort Bend, Williamson, Grayson,
// Travis, Bexar, and Dallas counties are wired up for real (Phase 2A/2B/2C/2D). All
// eleven publish live-queryable parcel data on public ArcGIS FeatureServer/MapServer
// REST APIs — turns out every one of the originally-assumed "bulk file only"
// counties (Harris/Tarrant/Williamson/Grayson) actually has a live API too, just not
// discoverable via plain web search (found via ArcGIS's own item-search API
// instead). Travis's and Dallas's public sources have no value fields at all (only
// address + legal description for Travis; owner + address + account for Dallas) —
// included anyway per product decision, with those fields honestly null rather than
// faked. Bexar is served directly from BCAD's own domain (maps.bcad.org) — current
// values, but requires fully-qualified `table.column` names in the query (see
// queryBexar) and has no land/improvement split, only a combined total. Addresses
// outside these eleven counties correctly fall through to "not matched" rather than
// returning fabricated data.
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
  // Enrichment fields — only populated for the counties whose public site runs on
  // a vendor with a real JSON API (TrueProdigy: Denton/Montgomery/Tarrant/Travis;
  // BIS Consultants: Fort Bend/Grayson). See texas_cad_vendor_landscape memory for
  // why the other 5 counties can't offer this (bot-blocked or scraping-only).
  legalDescription?: string | null;
  subdivision?: string | null;
  geoId?: string | null;
  mailingAddress?: string | null;
  ownershipPct?: number | null;
  protestStatus?: string | null;
  valueHistory?: Array<{
    year: number;
    landValue: number | null;
    improvementValue: number | null;
    marketValue: number | null;
    appraisedValue: number | null;
  }>;
  deeds?: Array<{
    date: string | null;
    type: string | null;
    description: string | null;
    seller: string | null;
    buyer: string | null;
    instrumentNum: string | null;
  }>;
};

// Every county below used to be gated behind a city-name regex (e.g. only try
// Collin if the address said "Plano" or "McKinney"), on the theory that a city name
// reliably indicates a county. It doesn't: three separate real-address bug reports
// on 2026-07-24 each turned out to be this same assumption failing a different way
// — Frisco/Prosper/Celina/Little Elm/The Colony are real parcels in *either*
// Collin or Denton depending on the specific address, and USPS assigns "Dallas" as
// the mailing city for large swaths of ZIP codes that are legally in Collin or
// Denton County, not Dallas County. Enumerating every small town and unincorporated
// area in ten counties (plus every USPS mailing-city quirk) is an unbounded,
// unwinnable list. So this now just queries every supported county in parallel for
// every address and takes the first one that returns a real record, in the fixed
// priority order below — no city-name filtering at all. The per-county ArcGIS/GIS
// queries are cheap, public, and independent, so this costs a few concurrent HTTP
// calls (bounded by the slowest single county, not the sum) rather than any real
// correctness risk, and permanently closes off this entire class of bug.

// Expanded 2026-07-26 after large-scale real-address sampling: "cv" (cove
// abbreviated), "run", and "fwy" (freeway) were missing and caused real
// unstripped-core false negatives (e.g. "10603 Queensbury Cv" — the split-field
// counties store the suffix separately, so an unstripped "Cv" stuck to the core
// meant it could never match the bare street-name field).
const STREET_SUFFIX_ALT =
  "st|street|rd|road|dr|drive|ln|lane|ave|avenue|blvd|boulevard|ct|court|pl|place|plz|plaza|pkwy|parkway|hwy|highway|fwy|freeway|cir|circle|way|trl|trail|trce|trace|loop|cv|cove|bend|xing|crossing|walk|row|run|mnr|manor|holw|hollow|pt|point|rdg|ridge|grn|green|knl|knoll|pass|path|vlg|village";

function parseHouseAndStreet(
  address: string,
): { house: string; street: string; cityStateZip: string } | null {
  const withComma = address.match(/^\s*(\d+)\s+([^,]+?)\s*,(.*)$/);
  if (withComma) {
    return { house: withComma[1], street: withComma[2].trim(), cityStateZip: withComma[3].trim() };
  }

  // No comma (e.g. "900 Willowwood St Denton") — capture the house number and street
  // name through the street-suffix word instead, treating everything after it (the
  // city, and optionally state/zip) as the tail. Without this fallback, any address
  // typed without a comma failed to parse at all and silently returned "not matched"
  // before ever reaching the county API.
  const noComma = address.match(
    new RegExp(`^\\s*(\\d+)\\s+(.+?\\b(?:${STREET_SUFFIX_ALT})\\.?)\\b\\s*(.*)$`, "i"),
  );
  if (!noComma) return null;
  return { house: noComma[1], street: noComma[2].trim(), cityStateZip: noComma[3].trim() };
}

// Best-effort extraction of just the city name from the "city, state, zip" tail —
// used only as a tiebreaker (see the comment in Deno.serve below), so approximate
// is fine. Takes everything before the first comma (if any), then strips a
// trailing "TX"/"Texas" and whatever follows it (covers the no-comma case, where
// cityStateZip is still "city TX zip" space-separated).
function guessCity(cityStateZip: string): string {
  return cityStateZip
    .split(",")[0]
    .replace(/\btx\b.*$/i, "")
    .replace(/\btexas\b.*$/i, "")
    .trim();
}

// Strips a leading directional (N/S/E/W) and a trailing street-type word, leaving just
// the "core" street name — used for counties whose schema splits house number and
// street type into separate fields, so we can't match the full phrase in one LIKE.
//
// Every single-field county query below builds its LIKE pattern as
// `${house} %${coreStreetName(street)}%` — house number anchored to the very START
// of the field (NO leading `%`), followed by a required literal space, THEN a
// wildcard before the core street name. Two bugs, found in sequence on 2026-07-26:
//
// 1) The original pattern was `%${house} ${core}%` (leading wildcard, house+core
//    exactly one space apart). Denton's situs field stores "3500 N BONNIE BRAE ST"
//    — the directional sits BETWEEN the house number and the core name — so
//    house+core being forced adjacent-with-one-space silently failed on any
//    address whose county data embeds a directional right after the house number.
// 2) The first fix for that — `%${house}%${core}%`, a wildcard in place of the
//    space — went too far: with a LEADING wildcard too, "%2021%" matches the
//    DIGITS "2021" occurring ANYWHERE in the field, including as a prefix of an
//    unrelated house number like "20217" or a suffix like "1103" (which contains
//    "103"). Sampling ~100 real addresses across all 11 counties on 2026-07-26
//    turned up over a dozen cases of this returning a completely different real
//    property — sometimes in a different county entirely — as a false positive
//    "match" (e.g. "103 Berkshire St, Bellaire" incorrectly resolved to a Denton
//    County record at "1103 Berkshire Ct, Trophy Club"). Silently wrong data is
//    worse than "not found," so this needed a real fix, not another loosening.
//
// The current pattern fixes both: no leading `%` anchors the house number to the
// true start of the field (so "103" can never match inside "1103"), and the
// required literal space right after it anchors the house number's own end (so
// "2021" can't match as a prefix of "20217"). The wildcard AFTER that space is what
// still tolerates a directional or anything else sitting between the house number
// and the core street name.
const STREET_SUFFIX_WORDS = new RegExp(`\\b(?:${STREET_SUFFIX_ALT})\\.?$`, "i");
function coreStreetName(street: string): string {
  return street
    .replace(/^(n|s|e|w|north|south|east|west)\s+/i, "")
    .replace(STREET_SUFFIX_WORDS, "")
    .trim();
}

// Highway-named streets are stored under wildly different conventions per county —
// found 2026-07-26 chasing a real address ("5800 North Interstate 35, Denton"):
// Denton stores it as "I35" (no space, no word at all), Travis stores US highways
// as "U S HY 183" (literally spaced out), Montgomery spells interstates out in
// full ("INTERSTATE 45"), and Bexar abbreviates to "IH 10" — four different real
// conventions for the same concept, confirmed across four counties. No single
// rewrite of the user's input can match all of them, so this generates every
// plausible variant instead and tries them all (OR'd) in the same query.
function coreVariants(core: string): string[] {
  const variants = new Set<string>([core]);
  const m = core.match(/^(interstate|ih|i|u\.?s\.?|us)\s*-?\s*(?:hy|hwy|highway)?\s*-?\s*(\d+)$/i);
  if (m) {
    const n = m[2];
    const isInterstate = /^(interstate|ih|i)$/i.test(m[1]);
    if (isInterstate) {
      for (const v of [`I${n}`, `I ${n}`, `I-${n}`, `IH ${n}`, `IH-${n}`, `INTERSTATE ${n}`, `INTERSTATE HY ${n}`]) {
        variants.add(v);
      }
    } else {
      for (const v of [`US ${n}`, `U S HY ${n}`, `US HWY ${n}`, `US HIGHWAY ${n}`, `HWY ${n}`]) {
        variants.add(v);
      }
    }
  }
  return [...variants];
}

// Builds the WHERE clause shared by every county whose situs data is one
// concatenated field (house number + street all in a single column). Two
// anchoring requirements, both found chasing real false-positive matches on
// 2026-07-26:
// 1) House number: anchored to the START of the field with a required literal
//    space right after it (see the long comment above coreStreetName) — without
//    this, "103" matches inside "1103", "2021" matches as a prefix of "20217".
// 2) Core street name: must be followed by a space or a comma, not just anything
//    — without this, a short/suffix-stripped core like "Oak" or "Broad" matches as
//    a mere PREFIX of an unrelated, longer single-word street ("Oakbluff",
//    "Broadway"), and "Day"/"Knight"/"Buckner" similarly matched inside
//    "Daytona"/"Knights"/"Buckners". The OR of two literal suffixes (space vs.
//    comma) covers both "core is followed by its own suffix word" and "core is the
//    last word before the city, with no suffix" — SQL LIKE has no word-boundary
//    metacharacter, so this is the closest safe equivalent. `core` itself may be
//    several OR'd highway-naming variants (see coreVariants) rather than one string.
function singleFieldWhere(field: string, house: string, core: string): string {
  // Three boundary cases, not two: core can be followed by its own suffix word
  // (space), directly precede the city (comma), OR be the very last thing in the
  // whole field with nothing after it at all (found 2026-07-26 on Tarrant, whose
  // Situs_Addr has no city appended — "107 OAK DR E" ends the string right after
  // the trailing directional, so neither "core " nor "core," ever matched).
  const coreClause = coreVariants(core)
    .map(
      (c) =>
        `(UPPER(${field}) LIKE UPPER('%${c} %') OR UPPER(${field}) LIKE UPPER('%${c},%') OR UPPER(${field}) LIKE UPPER('%${c}'))`,
    )
    .join(" OR ");
  return `UPPER(${field}) LIKE UPPER('${house} %') AND (${coreClause})`;
}

// Same highway-variant OR'ing as singleFieldWhere, for the counties whose schema
// already splits house number (matched exactly, no anchoring tricks needed) from a
// street-name-only field.
// Fetches several candidate rows per county instead of just one — found 2026-07-26
// that a single county can genuinely have MULTIPLE real matches for the same house
// number + generic street name across different small towns within that same
// county (e.g. Montgomery has both "111 Park Way, Montgomery" AND "111 N Acacia
// Park Cir, Spring" for a "111"+"Park" search; the ArcGIS service has no inherent
// ordering that favors either). With only ever fetching row 1, the city-tiebreak in
// Deno.serve had nothing useful to compare against whenever the arbitrary top row
// wasn't the one whose city matched the user's input. Fetching several rows and
// letting the tiebreak search across all of them (not just each county's row 1)
// fixes this at the source.
const MULTI_CANDIDATE_LIMIT = 8;

function coreClauseOr(field: string, core: string): string {
  // Same word-boundary reasoning as singleFieldWhere — these fields hold ONLY the
  // street name (no suffix, no city), so "ends with core" is actually the common
  // case here, not the exception.
  return coreVariants(core)
    .map(
      (c) =>
        `(UPPER(${field}) LIKE UPPER('%${c} %') OR UPPER(${field}) LIKE UPPER('%${c},%') OR UPPER(${field}) LIKE UPPER('%${c}'))`,
    )
    .join(" OR ");
}

async function queryCollin(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const where = singleFieldWhere("situsConcat", parsed.house, coreStreetName(parsed.street));
  const url =
    "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=ownerName,situsConcat,currValLand,currValImprv,currValAppraised,PROP_ID,propType,propSubType,propCategoryCode,propYear" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Collin CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => ({
    ownerName: (attrs.ownerName as string) ?? null,
    propertyAddress: (attrs.situsConcat as string) ?? address,
    cad: "Collin Central Appraisal District",
    accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
    // `propType` is always null on this service despite the name — the real
    // classification lives in propSubType (plain text, e.g. "Commercial") and
    // propCategoryCode (the Comptroller's standard state code, e.g. "F1").
    // Discovered 2026-08-04 chasing a real Frisco house that fell through to
    // the generic "unknown category" fallback.
    propertyType:
      (attrs.propSubType as string)?.trim() || (attrs.propCategoryCode as string)?.trim() || (attrs.propType as string)?.trim() || null,
    landValue: (attrs.currValLand as number) ?? null,
    improvementValue: (attrs.currValImprv as number) ?? null,
    totalValue: (attrs.currValAppraised as number) ?? null,
    taxYear: (attrs.propYear as number) ?? null,
  }));
}

async function queryMontgomery(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const where = singleFieldWhere("situs", parsed.house, coreStreetName(parsed.street));
  const url =
    "https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=ownerName,situs,legalDescription,PIN" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Montgomery CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => ({
    ownerName: (attrs.ownerName as string) ?? null,
    propertyAddress: (attrs.situs as string) ?? address,
    cad: "Montgomery Central Appraisal District",
    accountNumber: attrs.PIN != null ? String(attrs.PIN) : null,
    propertyType: "Not published by county",
    landValue: null,
    improvementValue: null,
    totalValue: null,
    taxYear: null,
  }));
}

function parseMoneyField(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function queryDenton(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  // Denton County's own GIS (gis.dentoncounty.gov) — full ~382k-parcel countywide
  // dataset, not the earlier "TAD_Parcels" service this used to point at, which
  // turned out (discovered 2026-07-24, chasing a "not found" report for a real
  // Denton address) to be a single ~234-parcel subdivision extract, not county-wide
  // coverage. See texas-cad-data-sources memory for the full story.
  const where = singleFieldWhere("situs_full_address", parsed.house, coreStreetName(parsed.street));
  const url =
    "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=name,situs_full_address,landHSValue,landNHSValue,improvementValue,ownerMarketValue,pid,pYear,propType,stateCodes" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Denton CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => {
    const situsAddr = (attrs.situs_full_address as string | null)?.trim();
    return {
      ownerName: (attrs.name as string)?.trim() || null,
      propertyAddress: situsAddr || address,
      cad: "Denton Central Appraisal District",
      accountNumber: attrs.pid != null ? String(attrs.pid) : null,
      // `propType` here is always the generic "R" (real property) vs personal
      // property — it doesn't distinguish residential from commercial at all.
      // `stateCodes` carries the actual Texas Comptroller state property-type
      // code (e.g. "A1" single-family, "B1" multifamily, "F1" commercial —
      // the same codes the Comptroller's own ratio-study reports use), which
      // classifyPropertyCategory() knows how to read. Discovered 2026-08-04
      // chasing a real Frisco house that fell through to the generic
      // "unknown category" fallback.
      propertyType: (attrs.stateCodes as string)?.trim() || (attrs.propType as string)?.trim() || null,
      landValue:
        (parseMoneyField(attrs.landHSValue) ?? 0) + (parseMoneyField(attrs.landNHSValue) ?? 0),
      improvementValue: parseMoneyField(attrs.improvementValue),
      totalValue: parseMoneyField(attrs.ownerMarketValue),
      taxYear: attrs.pYear != null ? parseInt(String(attrs.pYear), 10) : null,
    };
  });
}

async function queryHarris(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const core = coreStreetName(parsed.street);
  const where = `site_str_num = ${parsed.house} AND (${coreClauseOr("site_str_name", core)})`;
  const url =
    "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=owner_name_1,site_str_num,site_str_pfx,site_str_name,site_str_sfx,site_city,land_value,bld_value,total_appraised_val,acct_num,tax_year" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Harris CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  // site_str_pfx (the directional — "S ", "N ", etc.) was silently missing from the
  // returned address entirely until 2026-07-26 — found sampling real Harris
  // addresses (4036 S Braeswood Blvd came back as "4036 Braeswood Blvd", dropping
  // the "S"). The match itself was never broken (the WHERE clause never filtered on
  // prefix), only the displayed address was wrong.
  return (json.features ?? []).map(({ attributes: attrs }) => {
    const streetParts = [attrs.site_str_num, attrs.site_str_pfx, attrs.site_str_name, attrs.site_str_sfx]
      .map((v) => (typeof v === "string" ? v.trim() : v))
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
  });
}

// Tarrant's parcel layer DOES have a `City` field — it just doesn't look like one:
// it's a 3-digit jurisdiction code ("026"), not a name, so it was missed entirely
// in the earlier fix (which assumed "no city field at all" and just left
// propertyAddress bare). Large-scale sampling on 2026-07-26 showed Tarrant losing
// a disproportionate share of city-based tiebreaks against common street names
// (Main/Oak/Elm) purely because it looked cityless. Codes resolved via TAD's own
// `OD_City` reference layer (CITY_TDC -> CITY_NAME), fetched once and hardcoded
// here since it's a small, stable ~40-row government reference table, not worth a
// second network round-trip per lookup. "000" (unincorporated county land) and any
// unrecognized code map to null — no fake city rather than guessing.
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

async function queryTarrant(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const where = singleFieldWhere("Situs_Addr", parsed.house, coreStreetName(parsed.street));
  const url =
    "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_ParcelView/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=Owner_Name,Situs_Addr,City,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C" +
    "&f=json"; // this endpoint doesn't support resultRecordCount ("Pagination is not supported") —
    // already returns every matching row unbounded, so no MULTI_CANDIDATE_LIMIT needed here.

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tarrant CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).slice(0, MULTI_CANDIDATE_LIMIT).map(({ attributes: attrs }) => {
    const situsAddr = (attrs.Situs_Addr as string | null)?.trim();
    const cityName = TARRANT_CITY_CODES[(attrs.City as string)?.trim()] ?? null;
    return {
      ownerName: (attrs.Owner_Name as string) ?? null,
      propertyAddress: situsAddr ? (cityName ? `${situsAddr}, ${cityName}` : situsAddr) : address,
      cad: "Tarrant Appraisal District",
      accountNumber: (attrs.Account_Nu as string)?.trim() || null,
      propertyType: (attrs.Property_C as string)?.trim() || null,
      landValue: parseMoneyField(attrs.Land_Value),
      improvementValue: parseMoneyField(attrs.Improvemen),
      totalValue: parseMoneyField(attrs.Appraised_ ?? attrs.Total_Valu),
      taxYear: null,
    };
  });
}

async function queryFortBend(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const where = singleFieldWhere("SITUS", parsed.house, coreStreetName(parsed.street));
  const url =
    "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNERNAME,SITUS,LANDVALUE,IMPVALUE,TOTALVALUE,PROPNUMBER,Building_Class" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fort Bend CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => ({
    ownerName: (attrs.OWNERNAME as string) ?? null,
    propertyAddress: (attrs.SITUS as string)?.trim() || address,
    cad: "Fort Bend Central Appraisal District",
    accountNumber: (attrs.PROPNUMBER as string) ?? null,
    propertyType: (attrs.Building_Class as string) ?? null,
    landValue: parseMoneyField(attrs.LANDVALUE),
    improvementValue: parseMoneyField(attrs.IMPVALUE),
    totalValue: parseMoneyField(attrs.TOTALVALUE),
    taxYear: null,
  }));
}

async function queryWilliamson(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const where = singleFieldWhere("SITEADDRESS", parsed.house, coreStreetName(parsed.street));
  const url =
    "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNERNME1,SITEADDRESS,LNDVALUE,CNTASSDVAL,PARCELID,CLASSDSCRP" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Williamson CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => ({
    ownerName: (attrs.OWNERNME1 as string) ?? null,
    propertyAddress: (attrs.SITEADDRESS as string)?.trim() || address,
    cad: "Williamson Central Appraisal District",
    accountNumber: (attrs.PARCELID as string) ?? null,
    propertyType: (attrs.CLASSDSCRP as string) ?? null,
    landValue: parseMoneyField(attrs.LNDVALUE),
    improvementValue: null,
    totalValue: parseMoneyField(attrs.CNTASSDVAL),
    taxYear: null,
  }));
}

async function queryGrayson(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const core = coreStreetName(parsed.street);
  const where = `SitusNumber = '${parsed.house}' AND (${coreClauseOr("SitusStreet", core)})`;
  const url =
    "https://services1.arcgis.com/EVxyUkKpll765a5X/arcgis/rest/services/Grayson_Appraisal_Parcel_Map_WFL1/FeatureServer/13/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OwnerName,SitusNumber,SitusStreetPrefix,SitusStreet,SitusStreetSufix,SitusCity,LandValue,ImprovementValue,MarketValue,PropertyNumber,Year" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Grayson CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  // SitusStreetPrefix (the directional) was missing from outFields the same way
  // Harris's site_str_pfx was — see the comment in queryHarris.
  return (json.features ?? []).map(({ attributes: attrs }) => {
    const streetParts = [attrs.SitusNumber, attrs.SitusStreetPrefix, attrs.SitusStreet, attrs.SitusStreetSufix]
      .map((v) => (typeof v === "string" ? v.trim() : v))
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
  });
}

async function queryTravis(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const core = coreStreetName(parsed.street);
  const where = `situs_num = '${parsed.house}' AND (${coreClauseOr("situs_street", core)})`;
  const url =
    "https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=situs_num,situs_street_prefx,situs_street,situs_street_suffix,situs_city,PROP_ID" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Travis CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => {
    const streetParts = [
      attrs.situs_num,
      attrs.situs_street_prefx,
      attrs.situs_street,
      attrs.situs_street_suffix,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      // Travis's public source has no owner name or value fields at all — real
      // address, honestly null everything else, rather than fabricating a match.
      // situs_city is often actually null in this dataset too — when it is,
      // propertyAddress is left without a city rather than echoing the user's own
      // typed city back (same tiebreak-corruption reasoning as queryTarrant, above).
      ownerName: null,
      propertyAddress: streetParts
        ? attrs.situs_city
          ? `${streetParts}, ${attrs.situs_city}`
          : streetParts
        : address,
      cad: "Travis Central Appraisal District",
      accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
      propertyType: "Not published by county",
      landValue: null,
      improvementValue: null,
      totalValue: null,
      taxYear: null,
    };
  });
}

// BCAD's own domain (maps.bcad.org) DOES work for targeted queries — the earlier
// "Failed to execute query" error (see comment below) was caused by using bare
// column names against this service's underlying SQL join, which requires the
// fully-qualified `table.column` form. Discovered 2026-07-24 chasing a real address
// (19730 Bulverde Rd) that the third-party mirror below simply didn't have —
// BCAD's own system has it, with current (2026) values, so it's the primary source
// now. No land/improvement split is published on this view (only a combined
// `appraised_val`), so those two fields are honestly null here rather than
// backfilled from the (stale, incomplete) mirror.
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

async function queryBexar(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const where = singleFieldWhere(BCAD_FIELDS.situs, parsed.house, coreStreetName(parsed.street));
  const url =
    "https://maps.bcad.org/arcgis/rest/services/PAMapSearch/MapServer/6/query" +
    `?where=${encodeURIComponent(where)}` +
    `&outFields=${Object.values(BCAD_FIELDS).join(",")}` +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bexar CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => ({
    ownerName: (attrs[BCAD_FIELDS.owner] as string)?.trim() || null,
    propertyAddress: (attrs[BCAD_FIELDS.situs] as string)?.trim() || address,
    cad: "Bexar Appraisal District",
    accountNumber: attrs[BCAD_FIELDS.propId] != null ? String(attrs[BCAD_FIELDS.propId]) : null,
    propertyType: (attrs[BCAD_FIELDS.propType] as string)?.trim() || null,
    landValue: null,
    improvementValue: null,
    totalValue: parseDollarString(attrs[BCAD_FIELDS.appraisedVal]),
    taxYear: attrs[BCAD_FIELDS.taxYear] != null ? Number(attrs[BCAD_FIELDS.taxYear]) : null,
  }));
}

// Dallas County — found 2026-07-26 chasing a real address (1800 Market Place Blvd,
// Irving) that had no source at all until now. `DCAD_PARCELS`, hosted by an org
// literally named `dallascountygis` — county-official, not a third-party mirror.
// Unlike every other county here, house number and street name are already split
// into their own fields (STREET_NUM/FULL_STREET_NAME), so this query is immune to
// the whole class of directional-prefix AND false-positive-substring bugs described
// above coreStreetName — an exact `=` on STREET_NUM needs no anchoring trick at
// all. No land/improvement/market value fields exist on
// this layer at all (checked — no companion table either), so those are honestly
// null here, same pattern as Montgomery/Travis.
async function queryDallas(address: string): Promise<CadRecord[]> {
  const parsed = parseHouseAndStreet(address);
  if (!parsed) return [];
  const core = coreStreetName(parsed.street);
  const where = `STREET_NUM=${parsed.house} AND (${coreClauseOr("FULL_STREET_NAME", core)})`;
  const url =
    "https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/DCAD_PARCELS/FeatureServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=OWNER_NAME1,SiteAddress,PROPERTY_CITY,PROPERTY_ZIPCODE,ACCOUNT_NUM,APPRAISAL_YR" +
    `&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dallas CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => {
    const site = (attrs.SiteAddress as string)?.trim();
    // Dallas disambiguates same-named cities in neighboring counties right in the
    // data — "GARLAND (DALLAS CO)", "MESQUITE (DALLAS CO)", etc. — useful for the
    // WHERE clause's own disambiguation but redundant/odd-looking in a displayed
    // address (the "Dallas Central Appraisal District" cad field already says which
    // county this is), so it's stripped here for display only.
    const city = (attrs.PROPERTY_CITY as string)?.trim().replace(/\s*\([^)]*\)\s*$/, "");
    const zip9 = attrs.PROPERTY_ZIPCODE != null ? String(attrs.PROPERTY_ZIPCODE) : null;
    const zip = zip9 && zip9.length >= 5 ? `${zip9.slice(0, 5)}-${zip9.slice(5)}` : zip9;
    const propertyAddress =
      site && city ? `${site}, ${city}, TX${zip ? ` ${zip}` : ""}` : site || address;

    return {
      ownerName: (attrs.OWNER_NAME1 as string)?.trim() || null,
      propertyAddress,
      cad: "Dallas Central Appraisal District",
      accountNumber: (attrs.ACCOUNT_NUM as string)?.trim() || null,
      propertyType: null,
      landValue: null,
      improvementValue: null,
      totalValue: null,
      taxYear: attrs.APPRAISAL_YR != null ? Number(attrs.APPRAISAL_YR) : null,
    };
  });
}

// --- Enrichment (Phase 5, 2026-07-27) ---------------------------------------
// Best-effort second call, made ONLY after a county's own primary query above has
// already matched a record by address. Never used to find or select a property —
// only to attach extra detail (legal description, deed history, value history,
// mailing address, protest status) that the ArcGIS parcel layers don't carry, by
// looking up the SAME property on that county's own richer public website via its
// vendor's JSON API. Enrichment failures (network error, vendor API shape change,
// no match) are swallowed and simply leave the extra fields absent — a lookup
// must never fail, and a confirm screen must never show stale/wrong enrichment,
// just because a second, non-essential vendor call didn't work this time.
//
// Two vendor platforms cover 6 of the 11 counties (see texas_cad_vendor_landscape
// memory for the other 5, which are either bot-protected or scraping-only):
//   - TrueProdigy (Denton, Montgomery, Tarrant, Travis): confirmed live 2026-07-27
//     that each county's own ArcGIS accountNumber IS that county's TrueProdigy
//     "pid" (Tarrant's needs its leading zeros stripped first).
//   - BIS Consultants (Fort Bend, Grayson): Fort Bend's ArcGIS accountNumber
//     (PROPNUMBER) matches BIS's own "geoId" field; Grayson's ArcGIS accountNumber
//     (PropertyNumber) matches BIS's own "propertyId" field instead — different
//     cross-reference key per county, both confirmed live.
//
// In both cases, the enrichment lookup is keyed off the property ID already
// trusted from the primary match — never re-derived from the user's typed
// address — and is cross-checked against the primary match's own house number
// before merging, so a wrong cross-county ID coincidence can never silently
// attach one property's deed/value history onto a different property's screen.

const TRUEPRODIGY_OFFICE_BY_CAD: Record<string, string> = {
  "Denton Central Appraisal District": "Denton",
  "Montgomery Central Appraisal District": "Montgomery",
  "Tarrant Appraisal District": "Tarrant",
  "Travis Central Appraisal District": "Travis",
};

async function getTrueProdigyToken(office: string): Promise<string> {
  const res = await fetch(
    "https://prod-container.trueprodigyapi.com/trueprodigy/cadpublic/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ office }),
    },
  );
  if (!res.ok) throw new Error(`TrueProdigy auth failed for ${office}: ${res.status}`);
  const json = (await res.json()) as { user?: { token?: string } };
  const token = json.user?.token;
  if (!token) throw new Error(`TrueProdigy auth returned no token for ${office}`);
  return token;
}

function houseNumberOf(address: string): string {
  return address.trim().match(/^\d+/)?.[0] ?? "";
}

async function enrichTrueProdigy(
  cadName: string,
  accountNumber: string,
  expectedHouseNumber: string,
): Promise<Partial<CadRecord> | null> {
  const office = TRUEPRODIGY_OFFICE_BY_CAD[cadName];
  if (!office) return null;
  const pid = parseInt(accountNumber, 10);
  if (!Number.isFinite(pid)) return null;

  try {
    const token = await getTrueProdigyToken(office);
    const headers = { "Content-Type": "application/json", Authorization: token };

    // Deeds only needs the pid + token, not the search result, so it's fetched
    // concurrently with the search call rather than after it — cuts a whole
    // network round-trip off the enrichment latency.
    const [searchRes, deedsRes] = await Promise.all([
      fetch("https://prod-container.trueprodigyapi.com/public/property/search", {
        method: "POST",
        headers,
        // The API 500s with a Python TypeError ("object of type 'int' has no
        // len()") if value isn't a string — confirmed live 2026-07-27.
        body: JSON.stringify({ pid: { operator: "=", value: String(pid) } }),
      }),
      fetch(`https://prod-container.trueprodigyapi.com/public/property/${pid}/deeds`, {
        headers: { Authorization: token },
      }),
    ]);
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as { results?: Array<Record<string, unknown>> };
    const rows = searchJson.results ?? [];
    if (rows.length === 0) return null;

    const latest = rows.reduce((a, b) => (Number(a.pYear) > Number(b.pYear) ? a : b));
    const streetNum = String(latest.streetNum ?? "").trim();
    if (streetNum && expectedHouseNumber && streetNum !== expectedHouseNumber) return null;

    const valueHistory = rows
      .map((r) => ({
        year: Number(r.pYear),
        landValue: typeof r.landValue === "number" ? r.landValue : null,
        improvementValue: typeof r.improvementValue === "number" ? r.improvementValue : null,
        marketValue: typeof r.marketValue === "number" ? r.marketValue : null,
        appraisedValue: typeof r.appraisedValue === "number" ? r.appraisedValue : null,
      }))
      .sort((a, b) => b.year - a.year);

    const deedsJson = deedsRes.ok
      ? ((await deedsRes.json()) as { results?: Array<Record<string, unknown>> })
      : {};
    const deeds = (deedsJson.results ?? []).map((d) => ({
      date: (d.deedDt as string) ?? null,
      type: (d.deedType as string) ?? null,
      description: (d.deedDescription as string) ?? null,
      seller: (d.seller as string) ?? null,
      buyer: (d.buyer as string) ?? null,
      instrumentNum: (d.instrumentNum as string) ?? null,
    }));

    const mailingLine = [latest.addrDeliveryLine, latest.addrCity, latest.addrState]
      .filter(Boolean)
      .join(", ");
    const mailingAddress = mailingLine
      ? `${mailingLine}${latest.addrZip ? " " + latest.addrZip : ""}`
      : null;

    return {
      legalDescription: (latest.legalDescription as string) || null,
      geoId: (latest.geoID as string) || null,
      mailingAddress,
      ownershipPct: latest.ownerPct != null ? parseFloat(String(latest.ownerPct)) : null,
      valueHistory,
      deeds,
    };
  } catch {
    return null;
  }
}

// Both counties run the same "BIS Consultants" vendor software, but Fort Bend's
// deployment answers a plain GET while Grayson's requires a short-lived session
// token (minted via its own endpoint, then echoed back in both the POST body and
// the Referer header) — a lightweight CSRF-style guard confirmed live 2026-07-27
// (a bare GET or a token-less POST both 404/500 on Grayson specifically). Also,
// each county's own ArcGIS accountNumber matches a DIFFERENT BIS field: Fort
// Bend's matches BIS's "geoId", Grayson's matches BIS's "propertyId" — so
// Grayson's search keywords need a "PropertyId:" prefix to hit the right field.
const BIS_CONFIG_BY_CAD: Record<string, { host: string; sessionAuth: boolean }> = {
  "Fort Bend Central Appraisal District": { host: "esearch.fbcad.org", sessionAuth: false },
  "Grayson Central Appraisal District": { host: "esearch.graysonappraisal.org", sessionAuth: true },
};

async function fetchBisResults(
  host: string,
  sessionAuth: boolean,
  keywords: string,
): Promise<Array<Record<string, unknown>>> {
  if (!sessionAuth) {
    const res = await fetch(
      `https://${host}/search/SearchResults?keywords=${encodeURIComponent(keywords)}&isArb=false`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { resultsList?: Array<Record<string, unknown>> };
    return json.resultsList ?? [];
  }

  const tokenRes = await fetch(`https://${host}/search/requestSessionToken`);
  if (!tokenRes.ok) return [];
  const { searchSessionToken } = (await tokenRes.json()) as { searchSessionToken?: string };
  if (!searchSessionToken) return [];

  const encodedKeywords = encodeURIComponent(keywords);
  const res = await fetch(`https://${host}/search/SearchResults?keywords=${encodedKeywords}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://${host}/search/result?keywords=${encodedKeywords}&searchSessionToken=${encodeURIComponent(searchSessionToken)}`,
    },
    body: JSON.stringify({
      page: 1,
      pageSize: 25,
      isArb: false,
      recaptchaToken: "",
      searchToken: searchSessionToken,
    }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { resultsList?: Array<Record<string, unknown>> };
  return json.resultsList ?? [];
}

async function enrichBIS(
  cadName: string,
  accountNumber: string,
  expectedHouseNumber: string,
): Promise<Partial<CadRecord> | null> {
  const config = BIS_CONFIG_BY_CAD[cadName];
  if (!config) return null;

  try {
    const keywords = config.sessionAuth ? `PropertyId:${accountNumber}` : accountNumber;
    const rows = await fetchBisResults(config.host, config.sessionAuth, keywords);
    if (rows.length === 0) return null;

    // Fort Bend's accountNumber matches BIS's own "geoId"; Grayson's matches BIS's
    // "propertyId" instead — both confirmed live, so check either field.
    const match =
      rows.find((r) => r.geoId === accountNumber || r.propertyId === accountNumber) ?? rows[0];
    const streetNum = String(match.streetNumber ?? "").trim();
    if (streetNum && expectedHouseNumber && streetNum !== expectedHouseNumber) return null;

    return {
      legalDescription: (match.legalDescription as string) || null,
      subdivision: (match.subdivision as string) || null,
      geoId: (match.geoId as string) || null,
      ownershipPct:
        match.percentOwnership != null ? parseFloat(String(match.percentOwnership)) : null,
      protestStatus: (match.status as string) || (match.arbStatus as string) || null,
    };
  } catch {
    return null;
  }
}

async function enrichRecord(record: CadRecord): Promise<CadRecord> {
  if (!record.accountNumber) return record;
  const expectedHouseNumber = houseNumberOf(record.propertyAddress);

  const enrichment =
    record.cad in TRUEPRODIGY_OFFICE_BY_CAD
      ? await enrichTrueProdigy(record.cad, record.accountNumber, expectedHouseNumber)
      : record.cad in BIS_CONFIG_BY_CAD
        ? await enrichBIS(record.cad, record.accountNumber, expectedHouseNumber)
        : null;

  return enrichment ? { ...record, ...enrichment } : record;
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

    // Queries every supported county concurrently (see the comment above) — no
    // city-name filtering on WHICH counties to try. A single county's transient
    // failure (network error, endpoint down) no longer fails the whole lookup;
    // it's just skipped, same as a plain no-match.
    const countyQueriesInOrder = [
      queryCollin,
      queryMontgomery,
      queryDenton,
      queryHarris,
      queryTarrant,
      queryFortBend,
      queryWilliamson,
      queryGrayson,
      queryTravis,
      queryBexar,
      queryDallas,
    ];

    const results = await Promise.allSettled(countyQueriesInOrder.map((query) => query(address)));
    // Flattened in county-priority order, then row order within each county — each
    // county now returns up to MULTI_CANDIDATE_LIMIT real rows instead of just one
    // (see the comment above that constant), so the tiebreak below has every real
    // candidate to search, not just each county's arbitrary first row.
    const candidates = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    // It's possible (found sampling real addresses on 2026-07-26) for the SAME
    // house number + a generic street word ("Commerce", "Marshall", "Maple", ...)
    // to be a genuine, correctly-formatted real record in TWO different counties —
    // not a query bug, just an honest coincidence. Picking the first in priority
    // order alone would silently return the wrong one whenever that happens. Since
    // the user's own input names a city, prefer whichever candidate's own returned
    // address actually mentions that city over one that doesn't, before falling
    // back to priority order (still needed for Tarrant, whose source has no city
    // field at all, and any other candidate where this can't be determined).
    const parsedForCity = parseHouseAndStreet(address);
    const cityGuess = parsedForCity ? guessCity(parsedForCity.cityStateZip) : "";
    let record: CadRecord | null = null;
    if (cityGuess) {
      record =
        candidates.find((c) => c.propertyAddress.toUpperCase().includes(cityGuess.toUpperCase())) ??
        null;
    }
    if (!record) {
      record = candidates[0] ?? null;
    }

    // Tarrant (always) and Travis (often) have no city in their own data, so their
    // propertyAddress comes back as just the street with no comma at all — that's
    // also exactly why they can never win the tiebreak above (nothing to match
    // cityGuess against). Now that a record has actually been chosen, append the
    // user's own typed city/state/zip for a normal-looking display address. Only
    // fires when there's truly no city already present (every other county always
    // has a real comma-separated city baked in from its own source).
    if (record && parsedForCity && !record.propertyAddress.includes(",")) {
      record = { ...record, propertyAddress: `${record.propertyAddress}, ${parsedForCity.cityStateZip}` };
    }

    if (!record) {
      return new Response(JSON.stringify({ matched: false }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    record = await enrichRecord(record);

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
