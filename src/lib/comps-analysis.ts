// Deterministic, no-AI comparable-property analysis for the Market Value
// module (see ai-report.tsx's "comps" case). Every input here is a real field
// already returned by cad-comps (see supabase/functions/cad-comps/index.ts) —
// nothing here is fabricated, and nothing claims a sale price or building
// square footage, since neither is available from any free Texas source
// (Texas is a non-disclosure state; confirmed by inspecting the CAD's own
// public deed records, which carry a date/type/buyer/seller but no price).
import type { CompProperty } from "./cad-comps";

const EARTH_RADIUS_MILES = 3958.8;

// Real great-circle distance between two lat/lng points — plain math, not a
// second API call.
export function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(Math.min(1, h)));
}

// 100 at diff=0, decays to ~50 at diff=halfScale, approaches 0 for large
// diff — an exponential half-life curve rather than a hard cutoff, so a comp
// just past a threshold doesn't fall off a cliff relative to one just before it.
function decayScore(diff: number, halfScale: number): number {
  if (!Number.isFinite(diff) || halfScale <= 0) return 50;
  return 100 * Math.exp((-Math.LN2 * Math.abs(diff)) / halfScale);
}

export type RankedComp = CompProperty & { distanceMi: number; similarity: number };

// Blends 4 real signals into one 0-100 similarity score: value proximity
// (the strongest signal for an equal-and-uniform argument), distance,
// land-size proximity, and a same/different property-type-code bonus. Any
// signal missing on either side (e.g. no legalAcreage) scores as a neutral
// 50 rather than being treated as a mismatch or fabricated.
export function similarityScore(subject: CompProperty, comp: CompProperty): number {
  const distanceMi = haversineMiles(subject, comp);
  const distanceScore = decayScore(distanceMi, 0.4);

  const valueScore =
    subject.marketValue && comp.marketValue
      ? decayScore(Math.abs(comp.marketValue - subject.marketValue) / subject.marketValue, 0.15)
      : 50;

  const landScore =
    subject.legalAcreage && comp.legalAcreage
      ? decayScore(Math.abs(comp.legalAcreage - subject.legalAcreage) / subject.legalAcreage, 0.4)
      : 50;

  const typeScore =
    subject.propType && comp.propType ? (subject.propType === comp.propType ? 100 : 30) : 50;

  const score = valueScore * 0.4 + distanceScore * 0.3 + landScore * 0.2 + typeScore * 0.1;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export type ComparableStats = {
  indicated: { min: number; median: number; max: number } | null;
  subjectValue: number | null;
  // (subjectValue - indicated.median) / indicated.median, as a whole-number
  // percent — positive means the subject's assessed value sits above what
  // the comps indicate (a potential overvaluation).
  valuationGapPct: number | null;
  confidencePct: number | null;
  // True when there are fewer than MIN_USABLE_COMPS comps with a real
  // market value — the UI should show "Limited Comparable Data" and fall
  // back to other valuation methods rather than trust a number this thin.
  limitedData: boolean;
  ranked: RankedComp[];
};

const MIN_USABLE_COMPS = 3;
const TOP_N_FOR_INDICATED_VALUE = 5;

// Same honest 35-95 bounding success-probability.ts uses for its own
// derived (not AI-guessed) confidence score — never claims near-certainty
// or near-impossibility regardless of how count/spread stack up.
const MIN_CONFIDENCE_PCT = 35;
const MAX_CONFIDENCE_PCT = 95;

export function computeComparableStats(
  subject: CompProperty | null,
  comps: CompProperty[],
  subjectTotalValue: number | null | undefined,
): ComparableStats {
  const ranked: RankedComp[] = subject
    ? [...comps]
        .map((c) => ({
          ...c,
          distanceMi: haversineMiles(subject, c),
          similarity: similarityScore(subject, c),
        }))
        .sort((a, b) => b.similarity - a.similarity)
    : [];

  const usable = ranked.filter((c) => c.marketValue != null);
  const limitedData = usable.length < MIN_USABLE_COMPS;
  const subjectValue = subjectTotalValue ?? subject?.marketValue ?? null;

  if (usable.length === 0) {
    return {
      indicated: null,
      subjectValue,
      valuationGapPct: null,
      confidencePct: null,
      limitedData: true,
      ranked,
    };
  }

  const top = usable.slice(0, TOP_N_FOR_INDICATED_VALUE);
  const values = top.map((c) => c.marketValue as number).sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const median = values[Math.floor(values.length / 2)];

  const valuationGapPct =
    subjectValue != null && median > 0
      ? Math.round(((subjectValue - median) / median) * 100)
      : null;

  // More comps + a tighter value spread -> higher confidence; both halves
  // are real, derived signals, not an AI guess.
  const spreadRatio = median > 0 ? (max - min) / median : 1;
  const countScore = Math.min(1, usable.length / 8);
  const tightnessScore = Math.max(0, 1 - spreadRatio);
  const confidencePct = limitedData
    ? null
    : Math.round(
        MIN_CONFIDENCE_PCT +
          (MAX_CONFIDENCE_PCT - MIN_CONFIDENCE_PCT) * (countScore * 0.5 + tightnessScore * 0.5),
      );

  return {
    indicated: { min, median, max },
    subjectValue,
    valuationGapPct,
    confidencePct,
    limitedData,
    ranked,
  };
}
