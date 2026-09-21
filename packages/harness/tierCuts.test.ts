/**
 * The exactness proof for the tier-cuts design (quick task 260920-qzf): for
 * every metric name a season ranking pool covers, and for every value on
 * the 2-decimal display grid, `tierFromCuts(entry, v)` must equal
 * `publishedTierForPercentile(goodnessPercentileAgainstPools(pool, name,
 * v))` EXACTLY — the published `undefined` (Common) and the client's
 * `"common"` are the same outcome. If this fails for any swept case, the
 * design is wrong for that case; this test never weakens the sweep to make
 * a failure disappear.
 */
import { describe, expect, it } from "vitest";
import type { TeamMetrics } from "../core/algorithms/types.js";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, publishedTierForPercentile, type EventTierCutEntry } from "./pageArtifacts.js";
import { buildTierCutsFromPools, goodnessPercentileAgainstPools, sortedPoolsByMetric } from "./percentiles.js";
import { buildEventArtifact } from "./publish.js";
import { roundMetric } from "./rounding.js";
import { SIGMA_METRIC_KEY } from "./sigmaScore.js";
import { tierFromCuts } from "./tierCuts.js";

// ---------------------------------------------------------------------------
// Fixture pools
// ---------------------------------------------------------------------------

/**
 * A 20-value higher-is-better pool with negatives, three duplicate pairs,
 * and a tie sitting EXACTLY on each of the three tier boundaries (50/75/95),
 * by construction. Positions 9-10 (value 20) land on the Rare cut, 14-15
 * (value 40) on the Epic cut, 18-19 (value 60, the pool max) on the
 * Legendary cut. Worked by hand against `percentileRanks`'s own mid-rank
 * formula: n=20, `(countStrictlyBelow + 0.5*countEqual)/n*100`.
 */
const HIGHER_POOL = [-50, -40, -30, -20, -10, -5, 0, 5, 10, 20, 20, 30, 35, 38, 40, 40, 45, 50, 60, 60];

/**
 * A 20-value pool for the LOWER-is-better sweep (evaluated through
 * `SIGMA_METRIC_KEY`, this file's one declared lower-is-better direction
 * fixture). Ties at the bottom (positions 0-1, value -100) land on raw
 * percentile 5% -> goodness 95% (Legendary); positions 4-5 (value -30) land
 * on raw 25% -> goodness 75% (Epic); positions 9-10 (value 10) land on raw
 * 50% -> goodness 50% (Rare) — goodness percentile is symmetric at exactly
 * 50, so this one also re-covers the Rare boundary under inversion.
 */
const LOWER_POOL = [-100, -100, -50, -40, -30, -30, -20, -10, 0, 10, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** A deterministic seeded PRNG (mulberry32) — reproducible, no external dependency. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A several-hundred-team-shaped synthetic pool: deterministic, realistic range, 2-decimal grid. */
function syntheticPool(size: number, seed: number): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: size }, () => roundMetric(rand() * 150 - 20));
}

// ---------------------------------------------------------------------------
// Exactness sweep helper
// ---------------------------------------------------------------------------

/** Every point where the published step function could possibly change value, plus far-below/far-above extremes — see `buildTierCutsFromPools`'s own "candidate-set completeness" doc comment for the argument this mirrors. */
function sweepValues(pool: readonly number[]): number[] {
  const distinct = Array.from(new Set(pool)).sort((a, b) => a - b);
  const values = new Set<number>();
  for (const v of distinct) {
    values.add(v);
    values.add(roundMetric(v - 0.01));
    values.add(roundMetric(v + 0.01));
  }
  values.add(distinct[0]! - 1000);
  values.add(distinct[distinct.length - 1]! + 1000);
  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Builds cuts for `metricName` from `pool` via `buildTierCutsFromPools`, then
 * sweeps every candidate `sweepValues` produces (which subsumes the
 * out-of-pool-range case: the far-below/far-above extremes are always
 * included) and asserts `tierFromCuts` agrees with the reference
 * EXACTLY at every one. Returns the built entry for callers that need to
 * inspect it further (e.g. the `lower: true` assertion).
 */
function assertExactAgreement(metricName: string, pool: readonly number[]): EventTierCutEntry {
  const sortedPools = new Map([[metricName, [...pool].sort((a, b) => a - b)]]);
  const cuts = buildTierCutsFromPools(sortedPools);
  const entry = cuts[metricName];
  expect(entry, `no cuts built for "${metricName}"`).toBeDefined();
  for (const v of sweepValues(pool)) {
    const referencePercentile = goodnessPercentileAgainstPools(sortedPools, metricName, v);
    const reference = publishedTierForPercentile(referencePercentile) ?? "common";
    const actual = tierFromCuts(entry, v);
    expect(actual, `metric=${metricName} value=${v} referencePercentile=${referencePercentile}`).toBe(reference);
  }
  return entry!;
}

// ---------------------------------------------------------------------------
// Task 1 behavior
// ---------------------------------------------------------------------------

describe("tierFromCuts / buildTierCutsFromPools — exactness sweep", () => {
  it("higher-is-better: a pool with ties, duplicates, negatives and a tie on every band boundary reproduces the reference exactly", () => {
    assertExactAgreement("total", HIGHER_POOL);
  });

  it("lower-is-better: the built entry carries lower: true, and the <= comparison reproduces the reference exactly", () => {
    const entry = assertExactAgreement(SIGMA_METRIC_KEY, LOWER_POOL);
    expect(entry.lower).toBe(true);
    // Descending, per the lower-is-better wire contract: cuts[rare] > cuts[epic] > cuts[legendary].
    expect(entry.cuts[0]).toBeGreaterThan(entry.cuts[1]);
    expect(entry.cuts[1]).toBeGreaterThan(entry.cuts[2]);
  });

  it("out-of-pool range: far below the minimum and far above the maximum agree with the reference, both directions", () => {
    // sweepValues (used by assertExactAgreement above) always includes
    // pool-min - 1000 and pool-max + 1000; this test names the property
    // explicitly rather than leaving it implicit in the two sweeps above.
    const higherEntry = assertExactAgreement("phaseAuto", HIGHER_POOL);
    expect(tierFromCuts(higherEntry, Math.min(...HIGHER_POOL) - 1000)).toBe("common");
    expect(tierFromCuts(higherEntry, Math.max(...HIGHER_POOL) + 1000)).toBe("legendary");

    const lowerEntry = assertExactAgreement(SIGMA_METRIC_KEY, LOWER_POOL);
    expect(tierFromCuts(lowerEntry, Math.max(...LOWER_POOL) + 1000)).toBe("common");
    expect(tierFromCuts(lowerEntry, Math.min(...LOWER_POOL) - 1000)).toBe("legendary");
  });

  it("a pool of one value builds and agrees with the reference", () => {
    assertExactAgreement("phaseTeleop", [42]);
  });

  it("a pool where every value is identical builds and agrees with the reference", () => {
    assertExactAgreement("phaseEndgame", [7, 7, 7, 7, 7]);
  });

  it("a several-hundred-team real-shaped pool builds and agrees with the reference across the whole sweep", () => {
    assertExactAgreement("total", syntheticPool(400, 12345));
  });
});

describe("buildTierCutsFromPools — sigma exclusion", () => {
  it("the map built from a real rankingPools (sortedPoolsByMetric over officialMetricsByTeam-shaped input) carries no sigma entry", () => {
    const metricsByTeam: TeamMetrics = {
      frc1: { total: { value: 40 }, phaseAuto: { value: 10 } },
      frc2: { total: { value: 55 }, phaseAuto: { value: 15 } },
      frc3: { total: { value: 30 }, phaseAuto: { value: 8 } },
    };
    const teamKeys = ["frc1", "frc2", "frc3"];
    const rankingPools = sortedPoolsByMetric(metricsByTeam, teamKeys);
    // Non-vacuity: this fixture never carried a sigma value in the first
    // place, matching production's officialMetricsByTeam exactly — proving
    // the exclusion is structural (the pool never has the key), not a
    // name-list check inside buildTierCutsFromPools itself.
    expect(rankingPools.has(SIGMA_METRIC_KEY)).toBe(false);
    const cuts = buildTierCutsFromPools(rankingPools);
    expect(SIGMA_METRIC_KEY in cuts).toBe(false);
    expect(Object.keys(cuts).sort()).toEqual(["phaseAuto", "total"]);
  });
});

describe("buildEventArtifact — tierCuts wiring", () => {
  it("emits tierCuts when cuts are supplied", () => {
    const cuts = buildTierCutsFromPools(sortedPoolsByMetric({ frc1: { total: { value: 40 } }, frc2: { total: { value: 60 } } }, ["frc1", "frc2"]));
    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "1.0.0+test",
      predictions: [],
      generation: "gen-1",
      computedAt: "2026-01-01T00:00:00.000Z",
      tierCuts: cuts,
    });
    expect(artifact.tierCuts).toEqual(cuts);
  });

  it("emits no tierCuts key at all when none is supplied", () => {
    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "1.0.0+test",
      predictions: [],
      generation: "gen-1",
      computedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(artifact).not.toHaveProperty("tierCuts");
  });
});

// ---------------------------------------------------------------------------
// Schema round-trip
// ---------------------------------------------------------------------------

/** A minimal valid `EventArtifactSchema` candidate — this file's own, so it never depends on `pageArtifacts.test.ts`'s module-private fixture helpers. */
function minimalEventCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-01-01T00:00:00.000Z",
    algorithmId: "opr",
    algorithmVersion: "1.0.0+test",
    eventKey: "2026casj",
    season: 2026,
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  };
}

describe("EventArtifactSchema.tierCuts", () => {
  it("a malformed tierCuts block degrades to absent rather than failing the whole artifact parse", () => {
    const candidate = minimalEventCandidate({ tierCuts: { total: { cuts: ["not", "a", "number"] } } });
    const parsed = EventArtifactSchema.parse(candidate);
    expect(parsed.tierCuts).toBeUndefined();
  });

  it("an old artifact with no tierCuts key still parses, with tierCuts undefined", () => {
    const candidate = minimalEventCandidate();
    expect(() => EventArtifactSchema.parse(candidate)).not.toThrow();
    expect(EventArtifactSchema.parse(candidate).tierCuts).toBeUndefined();
  });

  it("a well-formed tierCuts block round-trips unchanged, including a lower: true entry for the schema's own sake (never sigma in production — see buildTierCutsFromPools's own sigma-exclusion test)", () => {
    const tierCuts = { total: { cuts: [31.17, 52.4, 88.05] }, someLowerIsBetterMetric: { cuts: [10, 5, 1], lower: true as const } };
    const candidate = minimalEventCandidate({ tierCuts });
    expect(EventArtifactSchema.parse(candidate).tierCuts).toEqual(tierCuts);
  });
});
