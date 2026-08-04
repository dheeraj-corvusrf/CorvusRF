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

// ---------------------------------------------------------------------------
// Deterministic reduction-percentage model. No AI is involved anywhere below —
// every number here is either a real published statistic or an arithmetic
// combination of two real published statistics, so the same property record
// always produces the same result, and every input can be traced to a source.
// ---------------------------------------------------------------------------

export type PropertyCategory = "residential" | "commercial" | "unknown";

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
// pick the right real-data anchor below, not precise property classification.
export function classifyPropertyCategory(propertyType?: string | null): PropertyCategory {
  const t = propertyType?.toLowerCase() ?? "";
  if (RESIDENTIAL_TYPE_KEYWORDS.some((k) => t.includes(k))) return "residential";
  if (COMMERCIAL_TYPE_KEYWORDS.some((k) => t.includes(k))) return "commercial";
  return "unknown";
}

// Real per-county, per-category average protest reduction. No AI or fitted
// "trend model" is used to produce these — a real year-by-year time series
// with consistent methodology isn't published anywhere findable (sources
// publish either one single-year snapshot or one already-blended multi-year
// average, never both broken out by year), and fitting any model — ML
// included — to the 1-2 aggregate data points actually available per county
// wouldn't be a real trend fit, just noise dressed up as sophistication.
// Instead, residential figures below are the plain average of the two most
// credible REAL figures found for that county, from two independently-run
// studies covering different, non-fabricated time windows:
//
// (a) Single most-recent-year (2025) snapshot — Ownwell's county-level
//     analyses of actual 2025 tax records
//     (https://www.ownwell.com/results/texas-protest-vs-non-protest and
//     per-county pages, e.g. ownwell.com/insight/*-property-tax-protest-results-*).
// (b) Three-year (2022-2024) blended average — Ownwell's separate three-year
//     study (https://www.ownwell.com/insight/three-year-impact-protesting-property-taxes-texas),
//     "average reduction in property valuation when won" per county.
//
// Averaging (a) and (b) makes the figure less sensitive to any single unusual
// year without inventing a year-by-year breakdown that was never published.
// Only available for counties where BOTH real figures were found (Bexar,
// Collin, Fort Bend, Harris, Tarrant, Travis); the rest use only the single
// 2025 figure, since no comparable multi-year figure exists for them.
//
// Commercial: O'Connor's real 2025 per-CAD appeal-result analyses (each
// county has its own published article, e.g.
// poconnor.com/denton-appeals-chip-away-at-massive-value-gains,
// poconnor.com/collin-county-property-tax-appeals-cut-7-89-billion-...,
// poconnor.com/initial-appeals-lower-bexar-county-commercial-value-by-6-7,
// poconnor.com/fort-bend-reduces-commercial-property-taxable-value-by-6-1,
// poconnor.com/early-property-tax-protests-prove-their-worth-in-travis-county,
// poconnor.com/2025-appeals-help-reduce-montgomery-county-property-value-by-4-2-billion,
// poconnor.com/williamson-county-stems-the-tide-of-record-taxable-value-with-appeals).
// Harris commercial is a blend of that county's own published office (7.9%),
// retail (2.8%), and warehouse (2.0%) figures, since no single overall Harris
// commercial number was published. No multi-year commercial study was found
// for any county — commercial figures below are single-year (2025) only. No
// commercial figure was found for Tarrant or Grayson despite multiple
// searches — real 2025 Tarrant commercial VALUE GROWTH numbers exist, but not
// a comparable market-wide appeal-reduction percentage (the one figure found
// was a single firm's own client average, not directly comparable to the
// CAD-wide analyses used for every other county here, so it's deliberately
// not used) — those two fall back to COMMERCIAL_FALLBACK_PCT below.
const COUNTY_REDUCTION_PCT: Partial<Record<string, Partial<Record<PropertyCategory, number>>>> = {
  "Collin Central Appraisal District": { residential: 0.0475, commercial: 0.087 }, // (4.4% 2025 + 5.1% 3-yr) / 2
  "Denton Central Appraisal District": { residential: 0.098, commercial: 0.019 }, // real Denton-specific 2025 figure (86% win rate, 9.8% avg reduction) — no 3-yr study covers Denton, so single-year only
  "Tarrant Appraisal District": { residential: 0.089 }, // (7.7% DFW-area proxy + 10.1% 3-yr Tarrant-specific) / 2
  "Harris Central Appraisal District": { residential: 0.073, commercial: 0.042 }, // (7.4% 2025 + 7.2% 3-yr) / 2
  "Fort Bend Central Appraisal District": { residential: 0.047, commercial: 0.061 }, // (4.5% 2025 + 4.9% 3-yr) / 2
  "Williamson Central Appraisal District": { residential: 0.028, commercial: 0.028 },
  "Travis Central Appraisal District": { residential: 0.09, commercial: 0.058 }, // (9.0% 2025 + 9.0% 3-yr) / 2 — no change, the two studies agree
  "Bexar Appraisal District": { residential: 0.0635, commercial: 0.067 }, // (6.0% 2025 + 6.7% 3-yr) / 2
  "Montgomery Central Appraisal District": { commercial: 0.059 },
};

// Statewide fallbacks, used for any county/category combination not in the
// table above (e.g. Grayson residential, or Tarrant/Grayson commercial).
const RESIDENTIAL_FALLBACK_PCT = 0.079; // 17-county 2025 statewide average (Ownwell)
// Average of the 8 real per-county commercial figures in the table above
// (8.7 + 1.9 + 4.2 + 6.1 + 2.8 + 5.8 + 6.7 + 5.9) / 8 = 5.26%, rounded — a
// broader, more representative anchor than relying on Denton's figure alone
// (which turns out to be the lowest of the 8, not typical).
const COMMERCIAL_FALLBACK_PCT = 0.0526;
// Used only when the CAD record's property-type text doesn't clearly indicate
// either category — the midpoint between the two real figures above, rather
// than silently defaulting to the higher residential number without evidence.
const UNKNOWN_CATEGORY_PCT = (RESIDENTIAL_FALLBACK_PCT + COMMERCIAL_FALLBACK_PCT) / 2;

export function getBaseReductionPct(cad: string | null | undefined, category: PropertyCategory): number {
  const countySpecific = cad ? COUNTY_REDUCTION_PCT[cad]?.[category] : undefined;
  if (countySpecific != null) return countySpecific;
  if (category === "residential") return RESIDENTIAL_FALLBACK_PCT;
  if (category === "commercial") return COMMERCIAL_FALLBACK_PCT;
  return UNKNOWN_CATEGORY_PCT;
}

// A year-over-year assessed-value jump well above typical appraisal-cycle
// growth is real, commonly-cited evidence of likely over-assessment: multiple
// protest-industry sources report successful protests averaging 10-15%
// reduction specifically in years values jumped more than ~10% YoY, vs the
// ~3-9% typical range in COUNTY_REDUCTION_PCT above for a routine year (Texas
// Real Estate Research Center / industry protest-outcome commentary). Applied
// as a floor/boost within that real 10-15% range rather than an arbitrary
// additive bonus.
const VALUE_JUMP_THRESHOLD_PCT = 0.1;
const VALUE_JUMP_BOOST_PCT = 0.03;
const VALUE_JUMP_FLOOR_PCT = 0.1;
const VALUE_JUMP_CEILING_PCT = 0.15;

export type ValueJumpResult = { reductionPct: number; jumpTriggered: boolean; jumpPct: number | null };

export function applyValueJumpAdjustment(
  baseReductionPct: number,
  valueHistory?: Array<{ year: number; value: number | null }> | null,
): ValueJumpResult {
  if (!valueHistory || valueHistory.length < 2) {
    return { reductionPct: baseReductionPct, jumpTriggered: false, jumpPct: null };
  }
  const sorted = [...valueHistory]
    .filter((h): h is { year: number; value: number } => h.value != null)
    .sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return { reductionPct: baseReductionPct, jumpTriggered: false, jumpPct: null };
  const latest = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2];
  if (prior.value <= 0) return { reductionPct: baseReductionPct, jumpTriggered: false, jumpPct: null };
  const jumpPct = (latest.value - prior.value) / prior.value;
  if (jumpPct <= VALUE_JUMP_THRESHOLD_PCT) {
    return { reductionPct: baseReductionPct, jumpTriggered: false, jumpPct };
  }
  const boosted = Math.min(VALUE_JUMP_CEILING_PCT, Math.max(VALUE_JUMP_FLOOR_PCT, baseReductionPct + VALUE_JUMP_BOOST_PCT));
  return { reductionPct: boosted, jumpTriggered: true, jumpPct };
}
