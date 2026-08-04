import { getComps } from "./cad-comps";
import { getModuleAnalysis } from "./ai-report-modules";
import { getEffectiveTaxRate, getTypicalReductionPct } from "./texas-tax-rates";

const EARTH_RADIUS_MILES = 3958.8;

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

export type SavingsEstimate =
  | { basis: "comps"; amount: number; compsCount: number; compsMedian: number; effectiveTaxRatePct: number }
  | { basis: "ai"; amount: number; reductionPct: number; effectiveTaxRatePct: number; rationale: string }
  | { basis: "baseline"; amount: number; reductionPct: number; effectiveTaxRatePct: number }
  | null;

export type SavingsEstimateInput = {
  cad?: string | null;
  accountNumber?: string | null;
  address?: string | null;
  propertyType?: string | null;
  landValue?: number | null;
  improvementValue?: number | null;
  totalValue?: number | null;
  taxYear?: number | null;
};

// Three-tier cascade, each tier only reached when the one before it couldn't
// produce a real number. All three compute dollars the same way — (value
// reduction) x (effective tax rate) — the only thing that differs is where the
// reduction and the rate come from:
//
// 1. "comps" — real comparable-property data (TrueProdigy, currently Denton/
//    Montgomery/Tarrant/Travis only — see getComps), filtered by BOTH value
//    magnitude and real geographic distance before a median is trusted. Value:
//    0.5x-2x the subject's value, so a wildly different-scale property sharing
//    the same subdivision code doesn't produce a nonsense estimate. Distance:
//    within 1 mile of the subject (using the lat/lng both the subject and
//    comps already carry), then only the 3-5 closest qualifying comps are
//    used — mirrors published industry best practice for comp selection
//    (proximity + recency are the standard quality bar for "genuinely
//    comparable," not just sharing a subdivision code) and Texas Tax Code
//    41.43(b)(3), which recognizes appraised value vs. the median appraised
//    value of a reasonable number of comparable properties as valid grounds
//    for an equal-and-uniform protest. At least 3 must qualify within 1 mile
//    or this tier is skipped — no relaxing the distance bar just to force a
//    number.
// 2. "ai" — Gemini judges a plausible reductionPct from this property's own
//    real CAD record (value, type, land/improvement split) when no qualifying
//    comp exists. Gemini is only asked for the reduction judgment, never the
//    tax rate — the rate is real county data we already have (see below), not
//    something an LLM should be guessing.
// 3. "baseline" — getTypicalReductionPct(propertyType) (the real observed 2025
//    reduction for this property's category — residential and commercial differ
//    sharply, see texas-tax-rates.ts), reached only when comps don't apply AND
//    the AI module either errored or itself concluded no reduction. This
//    guarantees a property with a known assessed value is never shown with no
//    savings estimate at all — but it's never presented as this-property-
//    specific analysis, only as a general outcome estimate, so callers must
//    label it as such.
//
// The effective tax rate is never guessed per-property: all three tiers use
// getEffectiveTaxRate(cad), a real county-level rate (or the statewide average
// for counties without a specific entry) — see texas-tax-rates.ts for sourcing.
//
// Returns null only when there's no assessed value to estimate from at all.
export async function estimateSavings(property: SavingsEstimateInput): Promise<SavingsEstimate> {
  if (property.totalValue == null) return null;
  const totalValue = property.totalValue;
  const rate = getEffectiveTaxRate(property.cad);

  if (property.cad && property.accountNumber) {
    try {
      const compsResult = await getComps({ cad: property.cad, accountNumber: property.accountNumber });
      const subject = compsResult.subject;
      // Without the subject's own coordinates there's no way to judge "nearby" —
      // fall through to the AI tier rather than trusting an undated, unlocated
      // median.
      if (subject) {
        const qualifying = compsResult.comps
          .filter((c): c is typeof c & { marketValue: number } => c.marketValue != null)
          .filter((c) => c.marketValue >= totalValue * 0.5 && c.marketValue <= totalValue * 2)
          .map((c) => ({ ...c, distanceMiles: distanceMiles(subject.latitude, subject.longitude, c.latitude, c.longitude) }))
          .filter((c) => c.distanceMiles <= 1)
          .sort((a, b) => a.distanceMiles - b.distanceMiles)
          .slice(0, 5);
        if (qualifying.length >= 3) {
          const values = qualifying.map((c) => c.marketValue).sort((a, b) => a - b);
          const median = values[Math.floor(values.length / 2)];
          const overvaluation = totalValue - median;
          if (overvaluation > 0) {
            return {
              basis: "comps",
              amount: Math.round(overvaluation * rate),
              compsCount: qualifying.length,
              compsMedian: median,
              effectiveTaxRatePct: Math.round(rate * 1000) / 10,
            };
          }
        }
      }
    } catch (err) {
      console.error("Comps lookup for savings estimate failed:", err);
    }
  }

  try {
    const result = await getModuleAnalysis("savings", {
      address: property.address ?? undefined,
      cad: property.cad ?? undefined,
      propertyType: property.propertyType ?? undefined,
      landValue: property.landValue ?? undefined,
      improvementValue: property.improvementValue ?? undefined,
      totalValue,
      taxYear: property.taxYear ?? undefined,
    });
    if (result.reductionPct > 0) {
      return {
        basis: "ai",
        amount: Math.round(totalValue * (result.reductionPct / 100) * rate),
        reductionPct: result.reductionPct,
        effectiveTaxRatePct: Math.round(rate * 1000) / 10,
        rationale: result.rationale,
      };
    }
  } catch (err) {
    console.error("AI savings estimate failed:", err);
  }

  const typicalReductionPct = getTypicalReductionPct(property.propertyType);
  return {
    basis: "baseline",
    amount: Math.round(totalValue * typicalReductionPct * rate),
    reductionPct: Math.round(typicalReductionPct * 1000) / 10,
    effectiveTaxRatePct: Math.round(rate * 1000) / 10,
  };
}
