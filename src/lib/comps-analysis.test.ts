import { describe, it, expect } from "vitest";
import { haversineMiles, similarityScore, computeComparableStats } from "./comps-analysis";
import type { CompProperty } from "./cad-comps";

function comp(overrides: Partial<CompProperty>): CompProperty {
  return {
    pid: 1,
    address: "123 Main St",
    latitude: 33.05,
    longitude: -96.75,
    marketValue: 400000,
    ownerName: null,
    ...overrides,
  };
}

describe("haversineMiles", () => {
  it("returns ~0 for the same point", () => {
    const p = { latitude: 33.05, longitude: -96.75 };
    expect(haversineMiles(p, p)).toBeCloseTo(0, 5);
  });

  it("returns a real distance for two known points (~69 miles per degree of latitude)", () => {
    const a = { latitude: 33.0, longitude: -96.75 };
    const b = { latitude: 34.0, longitude: -96.75 };
    expect(haversineMiles(a, b)).toBeCloseTo(69, -1); // within ~10 miles
  });
});

describe("similarityScore", () => {
  const subject = comp({ pid: 1, marketValue: 400000, legalAcreage: 0.25, propType: "C" });

  it("scores an identical comp near 100", () => {
    const identical = comp({ pid: 2, marketValue: 400000, legalAcreage: 0.25, propType: "C" });
    expect(similarityScore(subject, identical)).toBeGreaterThanOrEqual(95);
  });

  it("scores a comp with a very different value and far away much lower", () => {
    const different = comp({
      pid: 3,
      marketValue: 900000,
      latitude: 34.5,
      longitude: -98.5,
      legalAcreage: 5,
      propType: "R",
    });
    expect(similarityScore(subject, different)).toBeLessThan(40);
  });

  it("treats a missing field as neutral rather than a penalty", () => {
    const noAcreage = comp({ pid: 4, marketValue: 400000, legalAcreage: null, propType: "C" });
    const score = similarityScore(subject, noAcreage);
    // Value/distance/type all match; only land size is missing (neutral 50) —
    // should still score reasonably high, not collapse toward 0.
    expect(score).toBeGreaterThan(70);
  });
});

describe("computeComparableStats", () => {
  const subject = comp({ pid: 1, marketValue: 500000, legalAcreage: 0.3 });

  it("flags limitedData when fewer than 3 comps have a usable market value", () => {
    const stats = computeComparableStats(subject, [comp({ pid: 2, marketValue: 480000 })], 500000);
    expect(stats.limitedData).toBe(true);
    expect(stats.confidencePct).toBeNull();
  });

  it("ranks comps by similarity, strongest first", () => {
    const closeMatch = comp({ pid: 2, marketValue: 495000, legalAcreage: 0.3 });
    const farValue = comp({ pid: 3, marketValue: 950000, latitude: 34.5, longitude: -98.5 });
    const midMatch = comp({ pid: 4, marketValue: 520000, legalAcreage: 0.32 });
    const stats = computeComparableStats(subject, [farValue, closeMatch, midMatch], 500000);
    expect(stats.ranked.map((r) => r.pid)).toEqual([2, 4, 3]);
  });

  it("computes a real indicated range and valuation gap from real comp values", () => {
    const comps = [
      comp({ pid: 2, marketValue: 480000, legalAcreage: 0.3 }),
      comp({ pid: 3, marketValue: 470000, legalAcreage: 0.3 }),
      comp({ pid: 4, marketValue: 460000, legalAcreage: 0.3 }),
    ];
    const stats = computeComparableStats(subject, comps, 500000);
    expect(stats.limitedData).toBe(false);
    expect(stats.indicated).toEqual({ min: 460000, median: 470000, max: 480000 });
    // Subject (500000) is above the comps' median (470000) -> positive gap.
    expect(stats.valuationGapPct).toBeGreaterThan(0);
    expect(stats.confidencePct).not.toBeNull();
  });

  it("returns nulls with no subject", () => {
    const stats = computeComparableStats(null, [comp({ pid: 2 })], 500000);
    expect(stats.ranked).toEqual([]);
    expect(stats.indicated).toBeNull();
  });
});
