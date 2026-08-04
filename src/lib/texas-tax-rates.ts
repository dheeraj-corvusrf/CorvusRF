// Approximate combined effective property tax rates (county + school district +
// city/MUD + special districts, as a fraction of assessed value) for the counties
// CorvusRF has real CAD data for, keyed by the exact `cad` string cad-lookup
// returns for that county. Sourced from multiple independent 2025 public rate
// surveys (SmartAsset, Ballard Property Tax Protest, tax-rates.org, Texas
// Comptroller county data) rather than any single source, since no two publish
// identical numbers — actual combined rate varies further by the specific
// city/school district/MUD within a county, so treat these as county-level
// approximations, not a specific property's exact bill.
export const COUNTY_EFFECTIVE_TAX_RATE: Record<string, number> = {
  "Collin Central Appraisal District": 0.014,
  "Denton Central Appraisal District": 0.018,
  "Tarrant Appraisal District": 0.018,
  "Harris Central Appraisal District": 0.02,
  "Fort Bend Central Appraisal District": 0.0185,
  "Williamson Central Appraisal District": 0.017,
  "Grayson Central Appraisal District": 0.02,
  "Travis Central Appraisal District": 0.021,
  "Bexar Appraisal District": 0.0225,
  "Montgomery Central Appraisal District": 0.02,
};

// Texas statewide average effective property tax rate — used for any county
// without a specific entry above (e.g. Dallas, which has no CAD data source at
// all; see texas_cad_data_sources memory).
export const STATEWIDE_AVERAGE_EFFECTIVE_TAX_RATE = 0.018;

export function getEffectiveTaxRate(cad?: string | null): number {
  if (cad && cad in COUNTY_EFFECTIVE_TAX_RATE) return COUNTY_EFFECTIVE_TAX_RATE[cad];
  return STATEWIDE_AVERAGE_EFFECTIVE_TAX_RATE;
}

// Real 2025 protest outcomes differ sharply by property category — applying the
// residential figure to a commercial parcel (or vice versa) was the single
// biggest source of overestimation before this was split out.
//
// Residential: a 2025 analysis of actual protest outcomes across 17 TX counties
// (Ownwell, https://www.ownwell.com/results/texas-protest-vs-non-protest) found
// homeowners who protested averaged a 7.9% assessed-value reduction, 84% win rate.
//
// Commercial: real 2025 Denton CAD appeal RESULTS — not theoretical opportunity,
// what was actually granted (O'Connor,
// https://www.poconnor.com/denton-appeals-chip-away-at-massive-value-gains/) —
// show commercial protests realized only a 1.9% average reduction overall that
// year (apartments 2.0%, offices 1.9%, retail 0.9%, warehouses 3.1%, parcels over
// $5M 1.7%). This is despite commercial districts often having MORE theoretical
// equal-and-uniform opportunity per Comptroller ratio studies — what ARBs and
// informal settlements actually granted in practice was smaller than the
// residential figure, likely because 2025 was a year Denton commercial values
// jumped 26.4% and appraisal districts held firm. Single-county evidence, but the
// only real property-type-specific REALIZED-outcome data found; used as the
// commercial anchor rather than applying the residential number to commercial
// properties, which is what produced an inflated estimate earlier.
export const TYPICAL_PROTEST_REDUCTION_PCT_RESIDENTIAL = 0.079;
export const TYPICAL_PROTEST_REDUCTION_PCT_COMMERCIAL = 0.02;
// Used when the CAD record's property-type text doesn't clearly indicate either
// category — the midpoint between the two real figures above, rather than
// defaulting to the higher residential number without evidence, since that
// default is exactly what caused the earlier overestimate.
export const TYPICAL_PROTEST_REDUCTION_PCT_UNKNOWN = 0.05;

const RESIDENTIAL_TYPE_KEYWORDS = [
  "residential",
  "single family",
  "single-family",
  "sfr",
  "homestead",
  "condo",
  "townhome",
  "townhouse",
  "duplex",
  "manufactured",
  "mobile home",
];
const COMMERCIAL_TYPE_KEYWORDS = [
  "commercial",
  "office",
  "retail",
  "warehouse",
  "industrial",
  "apartment",
  "multi-family",
  "multifamily",
  "hotel",
  "motel",
  "restaurant",
  "shopping",
  "business",
];

// CAD-provided property-type text is free-form county-specific wording (e.g.
// "Real, Commercial" vs "SFR" vs a raw building-class code), not a standardized
// enum, so this is keyword matching rather than an exact lookup — good enough to
// pick the right real-data anchor above, not precise property classification.
export function getTypicalReductionPct(propertyType?: string | null): number {
  const t = propertyType?.toLowerCase() ?? "";
  if (RESIDENTIAL_TYPE_KEYWORDS.some((k) => t.includes(k))) return TYPICAL_PROTEST_REDUCTION_PCT_RESIDENTIAL;
  if (COMMERCIAL_TYPE_KEYWORDS.some((k) => t.includes(k))) return TYPICAL_PROTEST_REDUCTION_PCT_COMMERCIAL;
  return TYPICAL_PROTEST_REDUCTION_PCT_UNKNOWN;
}
