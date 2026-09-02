import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_BOOTSTRAP_RESAMPLES,
  eventBlockedBootstrap,
  type EventBlockedUnit,
} from "./eventBootstrap.js";

/**
 * The fixtures below must be reproducible run to run: a fixture built from
 * `Math.random` would make every assertion here a coin flip that passes on
 * the author's machine and fails in CI at some unknowable rate. This is the
 * same Mulberry32 construction `identifiability.ts` cites, kept local to the
 * test so the fixture's randomness is visibly independent of the helper's
 * own resampling PRNG.
 */
function seededRng(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: a standard normal from two uniforms, so the fixtures have a known analytic SD. */
function standardNormal(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface ValuedUnit extends EventBlockedUnit {
  readonly value: number;
}

const EVENTS = 100;
const MATCHES_PER_EVENT = 20;

const meanValue = (sample: readonly ValuedUnit[]): number =>
  sample.length === 0 ? 0 : sample.reduce((sum, u) => sum + u.value, 0) / sample.length;

/** Population SD — the analytic `SD(b)` for the block-effect fixture, computed over the realized draws rather than assumed to be exactly 1. */
function populationSd(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length);
}

/**
 * PERFECT within-event dependence: every match in event `i` carries the same
 * value `b_i`, and the `b_i` are i.i.d. across events. The mean of the whole
 * pool is exactly the mean of the 100 `b_i`, so the TRUE standard error of
 * that mean is `SD(b) / sqrt(100)` — analytically known, which is what makes
 * this the headline test rather than a plausibility check.
 */
function dependentFixture(): { units: ValuedUnit[]; blockValues: number[] } {
  const rng = seededRng(20260901);
  const blockValues: number[] = [];
  const units: ValuedUnit[] = [];
  for (let e = 0; e < EVENTS; e++) {
    const b = standardNormal(rng);
    blockValues.push(b);
    for (let m = 0; m < MATCHES_PER_EVENT; m++) {
      units.push({ eventKey: `2024ev${String(e).padStart(3, "0")}`, value: b });
    }
  }
  return { units, blockValues };
}

/** Same shape, no block structure: every match's value is an independent draw. */
function independentFixture(): ValuedUnit[] {
  const rng = seededRng(777);
  const units: ValuedUnit[] = [];
  for (let e = 0; e < EVENTS; e++) {
    for (let m = 0; m < MATCHES_PER_EVENT; m++) {
      units.push({ eventKey: `2024ev${String(e).padStart(3, "0")}`, value: standardNormal(rng) });
    }
  }
  return units;
}

/**
 * The NEGATIVE CONTROL's resampler: draws individual MATCHES with
 * replacement, ignoring event structure entirely. Written out here rather
 * than exposed as an option on the helper — the helper's whole purpose is
 * that match-level resampling is not something a call site can reach for by
 * accident.
 */
function matchLevelBootstrapSe(units: readonly ValuedUnit[], resamples: number, seed: number): number {
  const rng = seededRng(seed);
  const stats: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const pool: ValuedUnit[] = [];
    for (let i = 0; i < units.length; i++) pool.push(units[Math.floor(rng() * units.length)]!);
    stats.push(meanValue(pool));
  }
  const mean = stats.reduce((sum, v) => sum + v, 0) / stats.length;
  return Math.sqrt(stats.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / (stats.length - 1));
}

describe("eventBlockedBootstrap", () => {
  it("recovers the analytic block standard error on a known-dependence fixture", () => {
    const { units, blockValues } = dependentFixture();
    const analyticSe = populationSd(blockValues) / Math.sqrt(EVENTS);

    const result = eventBlockedBootstrap(units, meanValue);

    // 5%: at 2000 resamples the Monte Carlo error on the SE itself is about
    // 1/sqrt(2*2000) ~ 1.6% (eventBootstrap.ts's own DEFAULT_..._RESAMPLES
    // justification), and the bootstrap's finite-sample bias at 100 blocks
    // adds roughly another sqrt(99/100) - 1 ~ 0.5%. 5% is comfortably above
    // both and still far below the sqrt(20) = 4.47x effect the next test
    // measures, so this tolerance cannot accidentally admit a helper that
    // blocks on nothing.
    expect(result.standardError).toBeGreaterThan(analyticSe * 0.95);
    expect(result.standardError).toBeLessThan(analyticSe * 1.05);
    expect(result.eventCount).toBe(EVENTS);
    expect(result.matchCount).toBe(EVENTS * MATCHES_PER_EVENT);
    expect(result.resamples).toBe(DEFAULT_EVENT_BOOTSTRAP_RESAMPLES);
    expect(result.pointEstimate).toBeCloseTo(meanValue(units), 12);
  });

  it("negative control: a match-level resample of the SAME data understates the SE by about sqrt(20)", () => {
    const { units } = dependentFixture();

    const blocked = eventBlockedBootstrap(units, meanValue).standardError;
    const naive = matchLevelBootstrapSe(units, DEFAULT_EVENT_BOOTSTRAP_RESAMPLES, 99);

    // With 20 identical matches per event, a match-level resample sees 2000
    // "independent" observations where there are really 100 — so its SE runs
    // about sqrt(20) = 4.47x too small. [3.5, 5.5] brackets that with room
    // for resampling noise on both figures. Without this test the headline
    // assertion above could pass against a helper that silently blocks on
    // nothing and simply reports a larger number for another reason.
    const ratio = blocked / naive;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(5.5);
  });

  it("independence control: with no within-event dependence the two agree", () => {
    const units = independentFixture();

    const blocked = eventBlockedBootstrap(units, meanValue).standardError;
    const naive = matchLevelBootstrapSe(units, DEFAULT_EVENT_BOOTSTRAP_RESAMPLES, 1234);

    // The helper must inflate ONLY where dependence exists. If it were simply
    // always larger, the headline test would be measuring the helper's bias
    // rather than the data's block structure. 15% covers the Monte Carlo
    // error of two independent 2000-resample bootstraps.
    const ratio = blocked / naive;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it("is deterministic: the same seed gives a bitwise identical standard error", () => {
    const { units } = dependentFixture();
    const a = eventBlockedBootstrap(units, meanValue, { seed: 7 });
    const b = eventBlockedBootstrap(units, meanValue, { seed: 7 });
    expect(a.standardError).toBe(b.standardError);
    expect(a.percentile.lower).toBe(b.percentile.lower);
    expect(a.percentile.upper).toBe(b.percentile.upper);
  });

  it("different seeds draw differently but agree on the standard error", () => {
    const { units } = dependentFixture();
    const a = eventBlockedBootstrap(units, meanValue, { seed: 7 });
    const b = eventBlockedBootstrap(units, meanValue, { seed: 8 });
    expect(a.standardError).not.toBe(b.standardError);
    expect(Math.abs(a.standardError - b.standardError) / a.standardError).toBeLessThan(0.1);
  });

  it("refuses to report a standard error over fewer than 2 event blocks", () => {
    const units: ValuedUnit[] = Array.from({ length: 50 }, (_, i) => ({ eventKey: "2024only", value: i }));
    expect(() => eventBlockedBootstrap(units, meanValue)).toThrow(/at least 2 distinct event blocks.*got 1/s);
  });

  it("reports a percentile interval that brackets the point estimate", () => {
    const { units } = dependentFixture();
    const result = eventBlockedBootstrap(units, meanValue);
    expect(result.percentile.lower).toBeLessThan(result.pointEstimate);
    expect(result.percentile.upper).toBeGreaterThan(result.pointEstimate);
  });

  it("blocks by eventKey in first-appearance order regardless of interleaving", () => {
    // Two events, interleaved in the stream — grouping must follow the key,
    // not contiguity, or a chronological cross-event stream (which is exactly
    // what `buildSeasonStream` produces) would be blocked wrongly.
    const units: ValuedUnit[] = [];
    for (let i = 0; i < 40; i++) {
      units.push({ eventKey: i % 2 === 0 ? "2024a" : "2024b", value: i % 2 === 0 ? 1 : 3 });
    }
    const result = eventBlockedBootstrap(units, meanValue, { resamples: 200, seed: 5 });
    expect(result.eventCount).toBe(2);
    expect(result.pointEstimate).toBe(2);
    // Every resample draws 2 blocks from {all-1s, all-3s}, so the resampled
    // mean can only be 1, 2 or 3 — a property that holds only if the blocks
    // really are the two event groups.
    expect(result.percentile.lower).toBeGreaterThanOrEqual(1);
    expect(result.percentile.upper).toBeLessThanOrEqual(3);
  });
});
