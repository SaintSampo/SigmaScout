/**
 * The rung-1 acceptance criterion's OWN unit tests (plan 09-09 Task 3),
 * against SYNTHETIC per-team quantile tables whose verdict is known by
 * construction.
 *
 * The point is that the pass/fail logic is proven on inputs whose answer is
 * known before it is ever pointed at a real event: a criterion evaluated for
 * the first time on the data it will decide is a criterion nobody can check.
 *
 * Boundary values are asserted as PASSING, not failing — `<=` and `>=` are
 * inclusive, and an off-by-one here would silently tighten a criterion that
 * was fixed in advance.
 */
import { describe, expect, it } from "vitest";
import {
  CLAUSE_1_MEDIAN_HARD,
  CLAUSE_1_MEDIAN_TIGHT,
  CLAUSE_1_TIGHT_RATE,
  CLAUSE_2_EDGE_TOLERANCE,
  CLAUSE_2_RATE,
  CLAUSE_3_MEAN_SHIFT,
  InsufficientSampleError,
  MINIMUM_EVENT_COUNT,
  evaluateRungOneCriterion,
  DEFAULT_SCHEDULE_COUNT,
  resolveScheduleSplit,
  type TeamQuantileRow,
} from "./measureFieldAveragedRanks.js";

/** Six synthetic event keys — the criterion's own minimum, so every table below is evaluable. */
const EVENT_KEYS = ["evA", "evB", "evC", "evD", "evE", "evF"] as const;

interface RowSpec {
  readonly medianDiff: number;
  readonly p10Diff?: number;
  readonly p90Diff?: number;
}

/**
 * Builds `specs.length` rows, spread round-robin across the six synthetic
 * events. Baked quantiles are held at a fixed, plausible triple and the
 * field-averaged side is the baked side plus the requested signed difference —
 * so each row's contribution to every clause is exactly what its spec says.
 */
function table(specs: readonly RowSpec[]): TeamQuantileRow[] {
  return specs.map((spec, i) => ({
    eventKey: EVENT_KEYS[i % EVENT_KEYS.length]!,
    teamKey: `frc${1000 + i}`,
    bakedP10: 3,
    bakedMedian: 10,
    bakedP90: 17,
    fieldP10: 3 + (spec.p10Diff ?? 0),
    fieldMedian: 10 + spec.medianDiff,
    fieldP90: 17 + (spec.p90Diff ?? 0),
  }));
}

/** `count` rows at `medianDiff`, with both edges exactly equal (so clause 2 always passes unless a test says otherwise). */
function rows(count: number, medianDiff: number, p10Diff = 0, p90Diff = 0): RowSpec[] {
  return Array.from({ length: count }, () => ({ medianDiff, p10Diff, p90Diff }));
}

describe("evaluateRungOneCriterion — sample size", () => {
  it("throws BY NAME on an empty sample rather than returning a verdict", () => {
    expect(() => evaluateRungOneCriterion([])).toThrow(InsufficientSampleError);
  });

  it("throws BY NAME on a single-event sample — a quiet `pass` on one event is how a bar gets lowered without anybody deciding to lower it", () => {
    const single = table(rows(30, 0)).map((r) => ({ ...r, eventKey: "evA" }));
    expect(() => evaluateRungOneCriterion(single)).toThrow(InsufficientSampleError);
    expect(() => evaluateRungOneCriterion(single)).toThrow(new RegExp(`${MINIMUM_EVENT_COUNT}`));
  });

  it("accepts exactly the minimum event count", () => {
    expect(() => evaluateRungOneCriterion(table(rows(60, 0)))).not.toThrow();
  });
});

describe("evaluateRungOneCriterion — clause 1 (median rank), both halves, at the boundary", () => {
  it("PASSES when exactly 95% of teams are at 0.5 and the rest at 1.0 — the boundary values are INSIDE", () => {
    // 120 teams: 114 at exactly 0.5 (114/120 = 0.95 exactly), 6 at exactly
    // 1.0. The signs alternate so clause 3's mean signed difference is 0 and
    // the overall verdict is decided by clause 1 alone, which is what this
    // case is for. (All-positive would fail clause 3 at a mean shift of
    // 0.525, correctly but for an unrelated reason.)
    const specs = [
      ...rows(57, CLAUSE_1_MEDIAN_TIGHT),
      ...rows(57, -CLAUSE_1_MEDIAN_TIGHT),
      ...rows(3, CLAUSE_1_MEDIAN_HARD),
      ...rows(3, -CLAUSE_1_MEDIAN_HARD),
    ];
    const verdict = evaluateRungOneCriterion(table(specs));
    expect(verdict.clause1.tightRate).toBeCloseTo(CLAUSE_1_TIGHT_RATE, 12);
    expect(verdict.clause1.everyTeamWithinHard).toBe(true);
    expect(verdict.clause1.pass).toBe(true);
    expect(verdict.clause3.meanSignedMedianDiff).toBeCloseTo(0, 12);
    expect(verdict.pass).toBe(true);
  });

  it("FAILS clause 1's EVERY-TEAM half when one team moves to 1.01, and names that team and its event", () => {
    const specs = [
      ...rows(57, CLAUSE_1_MEDIAN_TIGHT),
      ...rows(57, -CLAUSE_1_MEDIAN_TIGHT),
      ...rows(3, CLAUSE_1_MEDIAN_HARD),
      ...rows(2, -CLAUSE_1_MEDIAN_HARD),
      { medianDiff: -1.01 },
    ];
    const verdict = evaluateRungOneCriterion(table(specs));
    expect(verdict.clause1.everyTeamWithinHard).toBe(false);
    expect(verdict.clause1.pass).toBe(false);
    expect(verdict.pass).toBe(false);
    expect(verdict.clause1.worstAbsMedianDiff).toBeCloseTo(1.01, 12);
    expect(verdict.clause1.worstTeamKey).toBe("frc1119");
    expect(verdict.clause1.worstEventKey).toBe(EVENT_KEYS[119 % EVENT_KEYS.length]);
  });

  it("FAILS clause 1's 95% half at 94%, even with every team inside the 1.0 hard bound", () => {
    // 120 teams: 113 at 0.5 (94.17%), 7 at 1.0 — every team within the hard
    // bound, so this can only fail on the tight-rate half. Signs alternate so
    // clause 3 is not what fails.
    const verdict = evaluateRungOneCriterion(
      table([
        ...rows(57, CLAUSE_1_MEDIAN_TIGHT),
        ...rows(56, -CLAUSE_1_MEDIAN_TIGHT),
        ...rows(3, CLAUSE_1_MEDIAN_HARD),
        ...rows(4, -CLAUSE_1_MEDIAN_HARD),
      ])
    );
    expect(verdict.clause1.everyTeamWithinHard).toBe(true);
    expect(verdict.clause1.tightRate).toBeLessThan(CLAUSE_1_TIGHT_RATE);
    expect(verdict.clause1.pass).toBe(false);
  });
});

describe("evaluateRungOneCriterion — clause 2 (band edges) is an AND over both edges, not an OR", () => {
  it("FAILS when 95% of teams are within 1.0 on p10 but only 85% on p90", () => {
    // 100 teams. p10: 95 inside, 5 outside. p90: 85 inside, 15 outside.
    const specs: RowSpec[] = [];
    for (let i = 0; i < 100; i++) {
      specs.push({
        medianDiff: 0,
        p10Diff: i < 95 ? 0 : 2,
        p90Diff: i < 85 ? 0 : 2,
      });
    }
    const verdict = evaluateRungOneCriterion(table(specs));
    expect(verdict.clause2.p10Rate).toBeCloseTo(0.95, 12);
    expect(verdict.clause2.p90Rate).toBeCloseTo(0.85, 12);
    expect(verdict.clause2.pass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("PASSES at exactly 90% on both edges, with the boundary value 1.0 counted as inside", () => {
    const specs: RowSpec[] = [];
    for (let i = 0; i < 100; i++) {
      specs.push({
        medianDiff: 0,
        p10Diff: i < 90 ? CLAUSE_2_EDGE_TOLERANCE : 2,
        p90Diff: i < 90 ? -CLAUSE_2_EDGE_TOLERANCE : -2,
      });
    }
    const verdict = evaluateRungOneCriterion(table(specs));
    expect(verdict.clause2.p10Rate).toBeCloseTo(CLAUSE_2_RATE, 12);
    expect(verdict.clause2.p90Rate).toBeCloseTo(CLAUSE_2_RATE, 12);
    expect(verdict.clause2.pass).toBe(true);
  });
});

describe("evaluateRungOneCriterion — clause 3 is SIGNED, not absolute", () => {
  it("PASSES clause 3 when half the teams are +1.0 and half are -1.0 (mean signed difference 0), while clause 1 fails", () => {
    // This is the case that proves the evaluator does not silently average
    // ABSOLUTE values — which would make clause 3 a fourth copy of clause 1
    // and stop it detecting the systematic shift it exists to detect.
    const verdict = evaluateRungOneCriterion(table([...rows(60, 1.0), ...rows(60, -1.0)]));
    expect(verdict.clause3.meanSignedMedianDiff).toBeCloseTo(0, 12);
    expect(verdict.clause3.pass).toBe(true);
    expect(verdict.clause1.pass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("FAILS clause 3 when every team is at +0.26", () => {
    const verdict = evaluateRungOneCriterion(table(rows(60, 0.26)));
    expect(verdict.clause3.meanSignedMedianDiff).toBeCloseTo(0.26, 12);
    expect(verdict.clause3.pass).toBe(false);
    // Clause 1 is untouched by this: 0.26 is well inside 0.5.
    expect(verdict.clause1.pass).toBe(true);
  });

  it("PASSES clause 3 at exactly +0.25 — the boundary is inclusive", () => {
    const verdict = evaluateRungOneCriterion(table(rows(60, CLAUSE_3_MEAN_SHIFT)));
    expect(verdict.clause3.meanSignedMedianDiff).toBeCloseTo(CLAUSE_3_MEAN_SHIFT, 12);
    expect(verdict.clause3.pass).toBe(true);
    expect(verdict.pass).toBe(true);
  });

  it("PASSES clause 3 at exactly -0.25 — the bound is two-sided", () => {
    const verdict = evaluateRungOneCriterion(table(rows(60, -CLAUSE_3_MEAN_SHIFT)));
    expect(verdict.clause3.pass).toBe(true);
  });
});

describe("evaluateRungOneCriterion — pooling is across the SAMPLE, not the mean of per-event rates", () => {
  it("pools over the combined team count on unequal roster sizes, where the pooled figure and the mean of the rates differ", () => {
    // evA: 25 teams, ALL within 0.5              -> per-event rate 100%
    // evB: 25 teams, 23 within 0.5, 2 at 0.8     -> per-event rate  92%
    // evC..evF: 5 teams each, all within 0.5     -> per-event rate 100%
    const rowsOut: TeamQuantileRow[] = [];
    const push = (eventKey: string, count: number, medianDiff: number): void => {
      for (let i = 0; i < count; i++) {
        rowsOut.push({
          eventKey,
          teamKey: `frc${eventKey}${i}`,
          bakedP10: 3,
          bakedMedian: 10,
          bakedP90: 17,
          fieldP10: 3,
          fieldMedian: 10 + medianDiff,
          fieldP90: 17,
        });
      }
    };
    push("evA", 25, 0.1);
    push("evB", 23, 0.1);
    push("evB", 2, 0.8);
    for (const key of ["evC", "evD", "evE", "evF"]) push(key, 5, 0.1);

    const verdict = evaluateRungOneCriterion(rowsOut);
    // POOLED: 68 of 70 teams are within 0.5.
    expect(verdict.teamCount).toBe(70);
    expect(verdict.clause1.tightCount).toBe(68);
    expect(verdict.clause1.tightRate).toBeCloseTo(68 / 70, 12);

    // The MEAN OF THE SIX PER-EVENT RATES is (1 + 0.92 + 1 + 1 + 1 + 1)/6 =
    // 0.98666..., which is NOT the pooled figure. Asserting the two differ is
    // what makes "pooled, not the mean of rates" a tested property rather
    // than a convention nobody checks.
    const meanOfRates = verdict.perEvent.reduce((t, e) => t + e.tightRate, 0) / verdict.perEvent.length;
    expect(meanOfRates).toBeCloseTo(5.92 / 6, 12);
    expect(verdict.clause1.tightRate).not.toBeCloseTo(meanOfRates, 6);

    // The per-event breakdown is still returned, so a single bad event cannot
    // hide inside the pool.
    expect(verdict.perEvent.find((e) => e.eventKey === "evB")!.tightRate).toBeCloseTo(0.92, 12);
    expect(verdict.perEvent.find((e) => e.eventKey === "evA")!.tightRate).toBe(1);
  });
});

describe("evaluateRungOneCriterion — the verdict carries every input to every clause", () => {
  it("a verdict that said only `false` could not be argued with at a checkpoint, so it carries all of it", () => {
    const verdict = evaluateRungOneCriterion(table([...rows(59, 0.1), { medianDiff: 1.4, p10Diff: 1.6, p90Diff: 0 }]));
    expect(verdict.teamCount).toBe(60);
    expect(verdict.eventCount).toBe(MINIMUM_EVENT_COUNT);
    expect(typeof verdict.clause1.pass).toBe("boolean");
    expect(typeof verdict.clause2.pass).toBe("boolean");
    expect(typeof verdict.clause3.pass).toBe("boolean");
    expect(verdict.clause1.tightRate).toBeCloseTo(59 / 60, 12);
    expect(verdict.clause1.worstAbsMedianDiff).toBeCloseTo(1.4, 12);
    expect(verdict.clause1.worstTeamKey).toBe("frc1059");
    expect(verdict.clause1.worstEventKey).toBe(EVENT_KEYS[59 % EVENT_KEYS.length]);
    expect(verdict.clause2.p10Rate).toBeCloseTo(59 / 60, 12);
    expect(verdict.clause2.p90Rate).toBe(1);
    expect(verdict.clause3.meanSignedMedianDiff).toBeCloseTo((59 * 0.1 + 1.4) / 60, 12);
    expect(verdict.perEvent).toHaveLength(MINIMUM_EVENT_COUNT);
    for (const e of verdict.perEvent) expect(e.teamCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// The schedule-count split (`--schedules`)
// ---------------------------------------------------------------------------

describe("resolveScheduleSplit — the DEFAULT path, pinned as a regression on unchanged behaviour", () => {
  /**
   * THIS TABLE IS A REGRESSION PIN, NOT A NEW SPECIFICATION. Every expectation
   * below is the expression that was inline in `measureEvent` before
   * `--schedules` existed — `20` schedules and
   * `Math.max(1, Math.round(draws / 20))` draws each. If one of these moves,
   * the default path changed, and every figure in the committed n=20 record
   * stops being reproducible.
   */
  const DEFAULT_TABLE: readonly number[] = [1, 19, 20, 21, 999, 1000, 200000];

  it.each(DEFAULT_TABLE)(
    "with no schedule count and draws=%i, returns 20 schedules and exactly Math.max(1, Math.round(draws / 20)) draws each — a pin on today's behaviour",
    (draws) => {
      const split = resolveScheduleSplit(draws);
      expect(split.scheduleCount).toBe(DEFAULT_SCHEDULE_COUNT);
      expect(split.scheduleCount).toBe(20);
      expect(split.drawsPerSchedule).toBe(Math.max(1, Math.round(draws / 20)));
    }
  );

  it("pins the shipped pairing by its literal values: draws=1000 is 20 schedules of 50 draws", () => {
    expect(resolveScheduleSplit(1000)).toEqual({ scheduleCount: 20, drawsPerSchedule: 50 });
  });

  it("clamps to at least ONE draw per schedule at draws=1, rather than 0 — the max(1, ...) half of the pinned expression", () => {
    expect(resolveScheduleSplit(1).drawsPerSchedule).toBe(1);
  });

  it("rounds rather than truncates on either side of the shipped count: draws=19 and draws=21 both give 1", () => {
    expect(resolveScheduleSplit(19).drawsPerSchedule).toBe(1);
    expect(resolveScheduleSplit(21).drawsPerSchedule).toBe(1);
  });

  it("an explicit count equal to the default is indistinguishable from omitting it", () => {
    expect(resolveScheduleSplit(1000, DEFAULT_SCHEDULE_COUNT)).toEqual(resolveScheduleSplit(1000));
  });
});

describe("resolveScheduleSplit — the re-measurement count", () => {
  it("at --schedules 4000 --draws 200000, holds draws-per-schedule at the shipped 50", () => {
    expect(resolveScheduleSplit(200000, 4000)).toEqual({ scheduleCount: 4000, drawsPerSchedule: 50 });
  });
});

describe("resolveScheduleSplit — an invalid count THROWS, naming the script and the value; none of them silently clamps", () => {
  const INVALID: readonly (readonly [string, number])[] = [
    ["zero", 0],
    ["negative", -20],
    ["fractional", 19.5],
    ["a non-numeric string, already through Number()", Number("twenty")],
  ];

  it.each(INVALID)("throws on %s", (_label, value) => {
    expect(() => resolveScheduleSplit(1000, value)).toThrow(/measureFieldAveragedRanks/);
    expect(() => resolveScheduleSplit(1000, value)).toThrow(String(value));
  });

  it("throws on a raw string that never went through Number() — a string must not slip through as a count", () => {
    expect(() => resolveScheduleSplit(1000, "20" as unknown as number)).toThrow(/measureFieldAveragedRanks/);
  });

  it("throws on Infinity", () => {
    expect(() => resolveScheduleSplit(1000, Number.POSITIVE_INFINITY)).toThrow(/measureFieldAveragedRanks/);
  });
});
