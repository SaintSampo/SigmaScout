/**
 * Unit tests for `epaCarryScale.ts` — the season-boundary scale anchor's pure
 * arithmetic.
 *
 * MOVED HERE, not copied (quick task 260911-3kc). These blocks were written
 * against `scripts/measureEpaDeviations.ts` when the rescale existed only as a
 * measurement arm. The functions now SHIP, inside `epa.ts`, so their tests move
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
  rescaleComponents,
} from "./epaCarryScale.js";

describe("cleanSeasonMean — unwinding reseedFromPrior's pseudo-observations", () => {
  it("recovers the arithmetic mean of the real folds", () => {
    // A boundary leaves the accumulator at exactly EPA_SCORE_SD_SEED_COUNT
    // observations sitting at the prior season's mean. Fold 200 real
    // observations averaging 60 on top and the blended mean is the
    // count-weighted average of the two — unwinding must return 60 exactly.
    const seedMean = 290;
    const realCount = 200;
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

describe("EPA_CARRY_RESCALE_MIN_OBS — a MEASURED default, not an assumed one", () => {
  it("is the threshold quick task 260911-3kc selected from its pre-declared candidate set", () => {
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
