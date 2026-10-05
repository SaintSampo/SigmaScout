/**
 * Unit tests for `epaCarryScale.ts` — the season-boundary scale anchor's pure
 * arithmetic.
 *
 * MOVED HERE, not copied (quick task 260911-3kc). These blocks were written
 * against `scripts/measureEpaDeviations.ts` (deleted in 260913-nvn) when the
 * rescale existed only as a measurement arm. The functions now SHIP, inside
 * `epa.ts`, so their tests move
 * with them — leaving a second copy behind in the harness is exactly the drift
 * `carryover.ts`'s own `populationMeanSd` comment warns about.
 *
 * Each of these guards a failure that produces a plausible number and a false
 * conclusion rather than an error:
 *
 *   - a clean-season-mean unwinding that forgets to subtract the
 *     `EPA_SCORE_SD_SEED_COUNT` pseudo-observations `reseedFromPrior` leaves
 *     behind, which would drag every ratio toward 1 and shrink the very
 *     correction this module exists to apply;
 *   - a rescale ratio that returns `NaN` on a degenerate seed mean instead of
 *     1 — `NaN` would propagate through every component of every carried team
 *     and then format as a dash, which reads identically to "no data";
 *   - a materializer that rescales a team NOT in `pending` (double-scaling a
 *     team already corrected) or that turns EPA's pinned-zero `adjust`
 *     component into a nonzero value.
 */
import { describe, expect, it } from "vitest";
import {
  carryRescaleRatio,
  cleanSeasonMean,
  EPA_CARRY_RESCALE_MIN_OBS,
  EPA_SCORE_SD_SEED_COUNT,
  materializePendingTeams,
  materializePendingTeamsScoped,
  rescaleComponents,
} from "./epaCarryScale.js";

describe("cleanSeasonMean — unwinding reseedFromPrior's pseudo-observations", () => {
  it("recovers the arithmetic mean of the real folds", () => {
    // A boundary leaves the accumulator at exactly EPA_SCORE_SD_SEED_COUNT
    // observations sitting at the prior season's mean. Fold 200 real
    // observations averaging 60 on top and the blended mean is the
    // count-weighted average of the two — unwinding must return 60 exactly.
    const seedMean = 290;
    // DERIVED from the threshold, not hardcoded: this block tests the
    // ARITHMETIC, and a literal count here silently became "below the
    // threshold" the moment quick task 260911-3kc raised it from 100 to 250.
    // The threshold itself has its own test at the bottom of this file.
    const realCount = EPA_CARRY_RESCALE_MIN_OBS + 150;
    const realMean = 60;
    const count = EPA_SCORE_SD_SEED_COUNT + realCount;
    const mean = (seedMean * EPA_SCORE_SD_SEED_COUNT + realMean * realCount) / count;
    expect(cleanSeasonMean({ count, mean }, seedMean)).toBeCloseTo(realMean, 9);
  });

  it("returns null below EPA_CARRY_RESCALE_MIN_OBS real observations — the walk-forward-legality floor", () => {
    const seedMean = 290;
    const justUnder = EPA_SCORE_SD_SEED_COUNT + EPA_CARRY_RESCALE_MIN_OBS - 1;
    expect(cleanSeasonMean({ count: justUnder, mean: 100 }, seedMean)).toBeNull();
    const exactly = EPA_SCORE_SD_SEED_COUNT + EPA_CARRY_RESCALE_MIN_OBS;
    expect(cleanSeasonMean({ count: exactly, mean: 100 }, seedMean)).not.toBeNull();
  });

  it("returns null when the accumulator never carried a seed at all", () => {
    // `reseedFromPrior` returns its input untouched below 2 observations, so a
    // count at or below the seed size means there is no seed to unwind and the
    // formula's denominator would be zero or negative.
    expect(cleanSeasonMean({ count: EPA_SCORE_SD_SEED_COUNT, mean: 100 }, 290)).toBeNull();
    expect(cleanSeasonMean({ count: 0, mean: 0 }, 290)).toBeNull();
  });

  it("returns null for a non-finite seed mean rather than propagating NaN", () => {
    expect(cleanSeasonMean({ count: 1000, mean: 60 }, Number.NaN)).toBeNull();
  });
});

describe("carryRescaleRatio", () => {
  it("halving the season scale yields a ratio near 0.5", () => {
    const { ratio, deferred } = carryRescaleRatio(50, 100);
    expect(ratio).toBeCloseTo(0.5, 12);
    expect(deferred).toBe(false);
  });

  it("an unchanged scale yields exactly 1", () => {
    expect(carryRescaleRatio(100, 100)).toEqual({ ratio: 1, deferred: false });
  });

  it("a not-yet-measurable clean mean defers rather than guessing", () => {
    expect(carryRescaleRatio(null, 100)).toEqual({ ratio: 1, deferred: true });
  });

  it("a zero or non-finite seed mean yields 1 and counts a deferral", () => {
    expect(carryRescaleRatio(60, 0)).toEqual({ ratio: 1, deferred: true });
    expect(carryRescaleRatio(60, Number.NaN)).toEqual({ ratio: 1, deferred: true });
    expect(carryRescaleRatio(Number.NaN, 100)).toEqual({ ratio: 1, deferred: true });
    // A negative clean mean cannot be a point scale; refuse rather than flip
    // every carried rating's sign.
    expect(carryRescaleRatio(-10, 100)).toEqual({ ratio: 1, deferred: true });
  });
});

describe("rescaleComponents / materializePendingTeams", () => {
  it("multiplies every component by the ratio and leaves a pinned zero at zero", () => {
    const out = rescaleComponents({ autoPoints: 30, teleopPoints: 60, adjust: 0 }, 0.5);
    expect(out).toEqual({ autoPoints: 15, teleopPoints: 30, adjust: 0 });
  });

  it("rescales a pending team, leaves a non-pending team untouched, and reports who it touched", () => {
    const before = new Map<string, Readonly<Record<string, number>>>([
      ["frc111", { autoPoints: 10, adjust: 0 }],
      ["frc222", { autoPoints: 20, adjust: 0 }],
    ]);
    const { teamComponents, touched } = materializePendingTeams(
      before,
      ["frc111", "frc222"],
      new Set(["frc111"]),
      0.25
    );
    expect(touched).toEqual(["frc111"]);
    expect(teamComponents.get("frc111")).toEqual({ autoPoints: 2.5, adjust: 0 });
    // Untouched by reference, not merely by value — a copied-but-equal record
    // would mean the materializer rebuilt state it had no business rebuilding.
    expect(teamComponents.get("frc222")).toBe(before.get("frc222"));
    // The input map is never mutated.
    expect(before.get("frc111")).toEqual({ autoPoints: 10, adjust: 0 });
  });

  it("ignores a team with no state and a pending team not in this match", () => {
    const before = new Map<string, Readonly<Record<string, number>>>([["frc111", { autoPoints: 10 }]]);
    const { teamComponents, touched } = materializePendingTeams(
      before,
      ["frc999"],
      new Set(["frc111", "frc999"]),
      0.5
    );
    expect(touched).toEqual([]);
    expect(teamComponents.get("frc111")).toEqual({ autoPoints: 10 });
  });
});

/**
 * `materializePendingTeamsScoped` is what `epa.predict` reads through. It must
 * answer every lookup of a listed team exactly as the full-map function does,
 * while holding nothing else: the full-map copy cost a pass over every team in
 * the state per predicted match (debug session `epa-presim-pricing-slow`).
 */
describe("materializePendingTeamsScoped — the match-scoped form predict reads", () => {
  /** Ten teams with distinct, non-round component values, so a wrong ratio or a wrong team cannot hide behind a round number. */
  function tenTeams(): Map<string, Readonly<Record<string, number>>> {
    return new Map(
      Array.from({ length: 10 }, (_, i) => [`frc${i + 1}`, { autoPoints: 3.7 * (i + 1), teleopPoints: 11.3 * (i + 2), adjust: 0 }])
    );
  }

  const RATIO = 55 / 292;
  const SHAPES: ReadonlyArray<{ readonly name: string; readonly teams: readonly string[]; readonly pending: readonly string[] }> = [
    { name: "no listed team pending", teams: ["frc1", "frc2", "frc3"], pending: ["frc9"] },
    { name: "one of three pending", teams: ["frc1", "frc2", "frc3"], pending: ["frc2", "frc9"] },
    { name: "all listed teams pending", teams: ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"], pending: ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc9"] },
    { name: "a single listed team", teams: ["frc4"], pending: ["frc4"] },
    { name: "an empty team list", teams: [], pending: ["frc1"] },
    { name: "a pending team with no state", teams: ["frc1", "frc404"], pending: ["frc1", "frc404"] },
    { name: "one key listed twice (two demo robots share one pseudo key)", teams: ["frc1", "frc2", "frc2"], pending: ["frc2"] },
  ];

  it("returns the same touched list and the same record for every listed team as the full-map function", () => {
    for (const { name, teams, pending } of SHAPES) {
      const before = tenTeams();
      const full = materializePendingTeams(before, teams, new Set(pending), RATIO);
      const scoped = materializePendingTeamsScoped(before, teams, new Set(pending), RATIO);
      expect(scoped.touched, name).toEqual(full.touched);
      for (const team of teams) {
        // Exact, not close: predictions built from the two must be bit for bit equal.
        expect(scoped.teamComponents.get(team), `${name}: ${team}`).toStrictEqual(full.teamComponents.get(team));
      }
    }
  });

  it("holds the listed teams only when it materializes, and leaves untouched records as the same object", () => {
    const before = tenTeams();
    const { teamComponents, touched } = materializePendingTeamsScoped(before, ["frc1", "frc2", "frc3"], new Set(["frc2", "frc9"]), RATIO);
    expect(touched).toEqual(["frc2"]);
    expect([...teamComponents.keys()].sort()).toEqual(["frc1", "frc2", "frc3"]);
    // A bystander is absent, pending or not: this map is never a state's team map.
    expect(teamComponents.has("frc9")).toBe(false);
    expect(teamComponents.has("frc10")).toBe(false);
    expect(teamComponents.get("frc1")).toBe(before.get("frc1"));
    // `frc2` is index 1 of the fixture: 3.7 * 2 and 11.3 * 3, written as the fixture computes them.
    expect(teamComponents.get("frc2")).toEqual({ autoPoints: 3.7 * 2 * RATIO, teleopPoints: 11.3 * 3 * RATIO, adjust: 0 });
    // The un-rescaled value, asserted wrong explicitly.
    expect(teamComponents.get("frc2")).not.toEqual(before.get("frc2"));
  });

  it("returns the input map itself when nothing is touched, and never mutates it", () => {
    const before = tenTeams();
    const snapshot = JSON.stringify([...before]);
    const untouched = materializePendingTeamsScoped(before, ["frc1", "frc2"], new Set(["frc9"]), RATIO);
    expect(untouched.touched).toEqual([]);
    expect(untouched.teamComponents).toBe(before);

    materializePendingTeamsScoped(before, ["frc1", "frc2"], new Set(["frc1", "frc2"]), RATIO);
    expect(JSON.stringify([...before])).toBe(snapshot);
  });
});

describe("EPA_CARRY_RESCALE_MIN_OBS — a MEASURED default, not an assumed one", () => {
  it("is the threshold selected from its pre-declared candidate set", () => {
    // The value itself is pinned so a future edit cannot quietly retune a
    // number that was chosen by a rule written down before any threshold
    // existed. See data/diagnostics/epa-deviation-ablation.json's
    // notes.thresholdSelection for the candidates, the rule, and the clause.
    expect(EPA_CARRY_RESCALE_MIN_OBS).toBe(250);
  });

  it("is above the seed it unwinds, so a boundary alone can never make a ratio readable", () => {
    expect(EPA_CARRY_RESCALE_MIN_OBS).toBeGreaterThan(EPA_SCORE_SD_SEED_COUNT);
    // Exactly at the boundary the accumulator holds only the seed: no real
    // folds at all, therefore no readable ratio.
    expect(cleanSeasonMean({ count: EPA_SCORE_SD_SEED_COUNT, mean: 100 }, 290)).toBeNull();
  });
});
