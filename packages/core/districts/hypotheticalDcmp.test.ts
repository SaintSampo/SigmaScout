/**
 * `hypotheticalDcmp.ts`' coverage (quick task 260927-6bf): the walk-forward
 * DCMP estimate by field rank, the award count anchors, and the tuning grid.
 *
 * THE PROPERTY THAT MATTERS MOST is walk-forward: a table for season S reads
 * only seasons strictly before S, and so does every count and every tuning
 * entry. Each is pinned against a constructed history where a leak would
 * change the answer, not only against the shipped one.
 */
import { describe, expect, it } from "vitest";
import {
  CHAMP_CUTOFF_DEFAULT_SETTING,
  CHAMP_CUTOFF_TUNING_GRID,
  HYPOTHETICAL_DCMP_BUCKETS,
  HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS,
  champCutoffTuning,
  dcmpAwardCountDistribution,
  dcmpAwardCountCeilings,
  dcmpAwardCounts,
  hypotheticalDcmpBucketIndex,
  hypotheticalDcmpPart,
  hypotheticalDcmpTable,
  normalizedFieldRanks,
  type ChampCutoffTuningEntry,
  type DcmpDistrictAwardCounts,
  type DcmpHistory,
  type DcmpHistorySeason,
} from "./hypotheticalDcmp.js";
import { CHAMP_CUTOFF_TUNING } from "./champCutoffTuning.generated.js";
import { DCMP_HISTORY } from "./dcmpHistory.generated.js";
import { pointPercentiles } from "./pointSummary.js";

/** A season whose every bucket holds `per` copies of `value`, with `wins` wins apiece. */
function flatSeason(value: number, per = HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS, wins = 1, districts: Record<string, DcmpDistrictAwardCounts> = {}): DcmpHistorySeason {
  return {
    buckets: Array.from({ length: HYPOTHETICAL_DCMP_BUCKETS }, () => ({ totals: new Array<number>(per).fill(value), wins })),
    districts,
  };
}

function counts(cmpSlots: number, impact: number, engineeringInspiration: number, rookieAllStar: number): DcmpDistrictAwardCounts {
  return { cmpSlots, impact, engineeringInspiration, rookieAllStar };
}

describe("normalizedFieldRanks", () => {
  it("gives (rank - 0.5) / N at field chance 1", () => {
    const ranks = normalizedFieldRanks([
      { teamKey: "a", projection: 100, fieldChance: 1 },
      { teamKey: "b", projection: 90, fieldChance: 1 },
      { teamKey: "c", projection: 80, fieldChance: 1 },
      { teamKey: "d", projection: 70, fieldChance: 1 },
    ]);
    expect(ranks.get("a")).toBeCloseTo(0.5 / 4, 12);
    expect(ranks.get("b")).toBeCloseTo(1.5 / 4, 12);
    expect(ranks.get("d")).toBeCloseTo(3.5 / 4, 12);
  });

  it("halves ties", () => {
    const ranks = normalizedFieldRanks([
      { teamKey: "a", projection: 100, fieldChance: 1 },
      { teamKey: "b", projection: 90, fieldChance: 1 },
      { teamKey: "c", projection: 90, fieldChance: 1 },
      { teamKey: "d", projection: 70, fieldChance: 1 },
    ]);
    // b: one above, one tied (half) -> (1 + 0.5 + 0.5) / 4.
    expect(ranks.get("b")).toBeCloseTo(2 / 4, 12);
    expect(ranks.get("c")).toBeCloseTo(2 / 4, 12);
  });

  it("weights rivals by their field chance and clamps into (0, 1)", () => {
    const ranks = normalizedFieldRanks([
      { teamKey: "a", projection: 100, fieldChance: 0.5 },
      { teamKey: "b", projection: 90, fieldChance: 1 },
      { teamKey: "z", projection: 0, fieldChance: 0 },
    ]);
    expect(ranks.get("b")).toBeCloseTo((0.5 + 0.5) / 1.5, 12);
    const z = ranks.get("z")!;
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(1);
    expect(hypotheticalDcmpBucketIndex(z)).toBe(HYPOTHETICAL_DCMP_BUCKETS - 1);
  });
});

describe("hypotheticalDcmpTable — walk-forward", () => {
  it("reads only seasons strictly before the one priced", () => {
    const history: DcmpHistory = { 2016: flatSeason(10), 2017: flatSeason(20), 2018: flatSeason(30), 2019: flatSeason(999) };
    const table = hypotheticalDcmpTable(2019, history)!;
    expect(table.fitSeasons).toEqual([2016, 2017, 2018]);
    for (const bucket of table.buckets) expect(bucket.totals.every((total) => total !== 999)).toBe(true);
  });

  it("is undefined with no earlier season, and for 2016 on the shipped history", () => {
    expect(hypotheticalDcmpTable(2016, { 2016: flatSeason(10) })).toBeUndefined();
    expect(hypotheticalDcmpTable(2016)).toBeUndefined();
  });

  it("is undefined when any bucket holds fewer than the minimum observations", () => {
    expect(hypotheticalDcmpTable(2017, { 2016: flatSeason(10, HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS - 1) })).toBeUndefined();
    expect(hypotheticalDcmpTable(2017, { 2016: flatSeason(10, HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS) })).toBeDefined();
  });

  it("uses 2016 to 2018 for 2019 on the shipped history", () => {
    expect(hypotheticalDcmpTable(2019)!.fitSeasons).toEqual([2016, 2017, 2018]);
  });
});

describe("hypotheticalDcmpPart — the K3 spread", () => {
  const table = hypotheticalDcmpTable(2026)!;

  it("at spread 1 is the bucket itself, with its win share", () => {
    const part = hypotheticalDcmpPart(table, 0.05, 1);
    const bucket = table.buckets[0]!;
    expect(part.denominator).toBe(bucket.totals.length);
    // The one change at spread 1 is the ceiling clamp: a Michigan championship
    // summed across a division and the finals can pass one event's ceiling.
    const clamped = bucket.totals.map((value) => Math.min(value, table.ceiling));
    for (const total of new Set(clamped)) expect(part.counts[total]).toBe(clamped.filter((value) => value === total).length);
    expect(bucket.totals.filter((value) => value > table.ceiling).length).toBeLessThan(bucket.totals.length / 20);
    expect(part.winChance).toBeCloseTo(bucket.wins / bucket.totals.length, 12);
  });

  it("at 1.5 keeps the median, widens the 10 to 90 range, and stays inside the ceiling", () => {
    for (const q of [0.05, 0.45, 0.95]) {
      const narrow = hypotheticalDcmpPart(table, q, 1);
      const wide = hypotheticalDcmpPart(table, q, 1.5);
      const a = pointPercentiles(narrow.counts, narrow.denominator);
      const b = pointPercentiles(wide.counts, wide.denominator);
      expect(Math.abs(b.p50 - a.p50)).toBeLessThanOrEqual(1);
      expect(b.p90 - b.p10).toBeGreaterThan(a.p90 - a.p10);
      expect(wide.counts.length - 1).toBeLessThanOrEqual(table.ceiling);
      expect(wide.winChance).toBe(narrow.winChance);
    }
  });
});

describe("dcmpAwardCounts — anchored on the district's previous season", () => {
  it("reads 2026 FNC from 2025: Impact 1, EI 2, RAS 2", () => {
    const anchor = dcmpAwardCounts(2026, "2026fnc", 15);
    expect(anchor.source).toBe("previousSeason");
    expect(anchor.fromSeason).toBe(2025);
    expect(anchor.counts).toEqual({ 0: 1, 9: 2, 10: 2 });
  });

  it("never reads the season shown", () => {
    const history: DcmpHistory = { 2024: flatSeason(1, 30, 1, { abc: counts(10, 1, 1, 1) }), 2025: flatSeason(1, 30, 1, { abc: counts(10, 9, 9, 9) }) };
    expect(dcmpAwardCounts(2025, "2025abc", 10, history).counts).toEqual({ 0: 1, 9: 1, 10: 1 });
  });

  it("falls back to the median of the five nearest by cmpSlots, ties to the more recent season, rounded half up", () => {
    const history: DcmpHistory = {
      2024: flatSeason(1, 30, 1, { a: counts(10, 1, 1, 0), b: counts(12, 2, 2, 1), c: counts(40, 9, 9, 9) }),
      2025: flatSeason(1, 30, 1, { d: counts(11, 3, 1, 1), e: counts(9, 2, 2, 2), f: counts(13, 4, 2, 1) }),
    };
    const anchor = dcmpAwardCounts(2026, "2026new", 11, history);
    expect(anchor.source).toBe("sizeBand");
    // The five nearest to 11: d(0), a(1), b(1), e(2), f(2); c is far.
    expect(anchor.counts).toEqual({ 0: 2, 9: 2, 10: 1 });
    // Four entries: the median of {1, 2, 3, 2} is 2 (half up of 2); of {0,1,1,2} is 1.
    const four: DcmpHistory = { 2025: flatSeason(1, 30, 1, { a: counts(10, 1, 1, 0), b: counts(10, 2, 2, 1), c: counts(10, 3, 1, 1), d: counts(10, 2, 2, 2) }) };
    expect(dcmpAwardCounts(2026, "2026new", 10, four).counts).toEqual({ 0: 2, 9: 2, 10: 1 });
  });
});

describe("dcmpAwardCountCeilings — the most ever seen, for the champ-tier reservation", () => {
  it("reads 2026 FNC as at least its own past: Impact 1, EI 2, RAS 2", () => {
    const ceiling = dcmpAwardCountCeilings(2026, "2026fnc", 15);
    expect(ceiling.ownSeasons[0]).toBe(2025);
    expect(ceiling.counts[0]).toBeGreaterThanOrEqual(1);
    expect(ceiling.counts[9]).toBeGreaterThanOrEqual(2);
    expect(ceiling.counts[10]).toBeGreaterThanOrEqual(2);
    expect(ceiling.sizeBandEntries).toBe(5);
  });

  it("is a maximum over the district's own seasons, never the anchor's most recent one", () => {
    const history: DcmpHistory = {
      2023: flatSeason(1, 30, 1, { abc: counts(10, 1, 2, 2) }),
      2024: flatSeason(1, 30, 1, { abc: counts(10, 1, 1, 1) }),
    };
    expect(dcmpAwardCounts(2025, "2025abc", 10, history).counts).toEqual({ 0: 1, 9: 1, 10: 1 });
    expect(dcmpAwardCountCeilings(2025, "2025abc", 10, history).counts).toEqual({ 0: 1, 9: 2, 10: 2 });
  });

  it("folds the size band's maximum in beside the district's own, and never reads the season shown", () => {
    const history: DcmpHistory = {
      2024: flatSeason(1, 30, 1, { abc: counts(10, 1, 1, 1), far: counts(40, 9, 9, 9), near: counts(11, 1, 2, 1) }),
      2025: flatSeason(1, 30, 1, { abc: counts(10, 7, 7, 7) }),
    };
    // Own: abc 2024 only. Band of five nearest to 10 among the 2024 entries: abc, near, far (three in all).
    const ceiling = dcmpAwardCountCeilings(2025, "2025abc", 10, history);
    expect(ceiling.ownSeasons).toEqual([2024]);
    expect(ceiling.sizeBandEntries).toBe(3);
    expect(ceiling.counts).toEqual({ 0: 9, 9: 9, 10: 9 });
  });

  it("is all zero with no earlier season at all", () => {
    expect(dcmpAwardCountCeilings(2016, "2016fim", 90)).toEqual({ counts: { 0: 0, 9: 0, 10: 0 }, ownSeasons: [], sizeBandEntries: 0 });
  });
});

describe("dcmpAwardCountDistribution — K2", () => {
  it("is one hot at the anchor in fixed mode", () => {
    const fixed = dcmpAwardCountDistribution(2026, "2026fnc", 15, "fixed");
    expect(fixed[0]).toEqual([0, 1]);
    expect(fixed[9]).toEqual([0, 0, 1]);
    expect(fixed[10]).toEqual([0, 0, 1]);
  });

  it("draws changes only from season pairs before the season, sums to 1, and folds negatives into zero", () => {
    const history: DcmpHistory = {
      2023: flatSeason(1, 30, 1, { abc: counts(10, 2, 1, 1) }),
      2024: flatSeason(1, 30, 1, { abc: counts(10, 1, 1, 1) }),
      2025: flatSeason(1, 30, 1, { abc: counts(10, 0, 1, 1) }),
      // A change from 2025 to 2026 must never be read for 2026.
      2026: flatSeason(1, 30, 1, { abc: counts(10, 5, 1, 1) }),
    };
    const drawn = dcmpAwardCountDistribution(2026, "2026abc", 10, "drawn", history);
    // Anchor 0 (2025); changes -1, -1 -> both fold into zero.
    expect(drawn[0]).toEqual([1]);
    for (const type of [0, 9, 10] as const) expect(drawn[type].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    const shipped = dcmpAwardCountDistribution(2026, "2026fnc", 15, "drawn");
    for (const type of [0, 9, 10] as const) expect(shipped[type].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
  });

  it("falls back to fixed with no season pair before the season", () => {
    const history: DcmpHistory = { 2025: flatSeason(1, 30, 1, { abc: counts(10, 2, 1, 1) }) };
    expect(dcmpAwardCountDistribution(2026, "2026abc", 10, "drawn", history)[0]).toEqual([0, 0, 1]);
  });
});

describe("the tuning grid and the walk-forward tuning", () => {
  it("is the pre-registered 20 settings in K1, K2, K3 order, the default first", () => {
    expect(CHAMP_CUTOFF_TUNING_GRID).toHaveLength(20);
    expect(CHAMP_CUTOFF_TUNING_GRID[0]).toEqual({ weighting: "uniform", countMode: "fixed", spreadScale: 1 });
    expect(CHAMP_CUTOFF_DEFAULT_SETTING).toBe(CHAMP_CUTOFF_TUNING_GRID[0]);
    expect(CHAMP_CUTOFF_TUNING_GRID.slice(0, 5).map((setting) => setting.spreadScale)).toEqual([1, 1.15, 1.3, 1.5, 1.75]);
    expect(CHAMP_CUTOFF_TUNING_GRID[5]).toEqual({ weighting: "uniform", countMode: "drawn", spreadScale: 1 });
    expect(CHAMP_CUTOFF_TUNING_GRID[10]).toEqual({ weighting: "decoration", countMode: "fixed", spreadScale: 1 });
    expect(CHAMP_CUTOFF_TUNING_GRID[19]).toEqual({ weighting: "decoration", countMode: "drawn", spreadScale: 1.75 });
  });

  it("selected 2019 on fit seasons before 2019 only, and every entry on seasons before it", () => {
    expect(champCutoffTuning(2019).fitSeasons.every((season) => season < 2019)).toBe(true);
    for (const entry of CHAMP_CUTOFF_TUNING) expect(entry.fitSeasons.every((season) => season < entry.season)).toBe(true);
  });

  it("returns the 2027 entry for a later season and the default for an earlier one", () => {
    expect(champCutoffTuning(2030)).toEqual(CHAMP_CUTOFF_TUNING.find((entry) => entry.season === 2027));
    expect(champCutoffTuning(2016).setting).toEqual(CHAMP_CUTOFF_DEFAULT_SETTING);
    const constructed: ChampCutoffTuningEntry[] = [
      { season: 2020, setting: CHAMP_CUTOFF_TUNING_GRID[3]!, fitSeasons: [2019], fitCount: 1, fitCoverage: 1, fitMae: 1 },
    ];
    expect(champCutoffTuning(2025, constructed).setting).toEqual(CHAMP_CUTOFF_TUNING_GRID[3]);
    expect(champCutoffTuning(2019, constructed).setting).toEqual(CHAMP_CUTOFF_DEFAULT_SETTING);
  });

  it("maps every season from 2017 to 2027, each setting a grid member", () => {
    expect(CHAMP_CUTOFF_TUNING.map((entry) => entry.season)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
    for (const entry of CHAMP_CUTOFF_TUNING) expect(CHAMP_CUTOFF_TUNING_GRID).toContainEqual(entry.setting);
  });

  it("ships a history with no 2020 (no DCMP was played) and ten buckets per season", () => {
    expect(Object.keys(DCMP_HISTORY)).not.toContain("2020");
    for (const season of Object.values(DCMP_HISTORY)) expect(season.buckets).toHaveLength(HYPOTHETICAL_DCMP_BUCKETS);
  });
});
