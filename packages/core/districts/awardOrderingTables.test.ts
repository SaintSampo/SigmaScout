/**
 * The ordering tables' own unit tests — pure, synthetic, no corpus, so CI runs
 * every one. The corpus-guarded RE-MEASUREMENT of the committed literals lives
 * in `scripts/measureAwardOrderingTables.test.ts` and skips where the corpus is
 * absent, which is what makes this file the one that always runs.
 *
 * What is asserted here is the SHAPE and the CONTRACT: the ordering rule, the
 * stated fallback, the refusal for an unregistered season, and the two
 * structural properties of every committed table (a pmf that sums to one, a
 * residual that is genuinely lighter than the base rate it was carved out of).
 */
import { describe, expect, it } from "vitest";
import {
  AWARD_POINT_SUPPORT,
  awardBaseRate,
  cellKey,
  DECORATION_BUCKETS,
  DISTRICT_AWARD_BASE_RATE_SEASONS,
  ROOKIE_STATES,
  type DecorationBucket,
  type RookieState,
} from "./awardBaseRates.js";
import {
  AWARD_ORDERING_SEASONS,
  awardOrderingTables,
  awardResidualRate,
  hasAwardOrderingTables,
  IMPACT_AWARD_POINTS,
  IMPACT_AWARD_TYPE,
  impactOrderingProbability,
  MAX_IMPACT_POSITION,
  MAX_ROOKIE_ALL_STAR_POSITION,
  MIN_ORDERED_FIELD_SIZE,
  meanSupportPoints,
  orderFieldByDecoration,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  ROOKIE_ALL_STAR_AWARD_TYPE,
  rookieAllStarOrderingProbability,
  teamNumberFromKey,
  UnknownAwardOrderingSeasonError,
} from "./awardOrderingTables.js";

describe("the ordering rule", () => {
  it("sorts by prior judged awards DESCENDING", () => {
    expect(
      orderFieldByDecoration([
        { teamKey: "frc1", priorJudgedAwards: 0 },
        { teamKey: "frc2", priorJudgedAwards: 7 },
        { teamKey: "frc3", priorJudgedAwards: 3 },
      ])
    ).toEqual(["frc2", "frc3", "frc1"]);
  });

  it("breaks a tie by ASCENDING TEAM NUMBER, not by string order and not by input order", () => {
    // String order would put frc1000 before frc99; the numeric rule does not.
    expect(
      orderFieldByDecoration([
        { teamKey: "frc1000", priorJudgedAwards: 2 },
        { teamKey: "frc99", priorJudgedAwards: 2 },
      ])
    ).toEqual(["frc99", "frc1000"]);
  });

  it("does not depend on the incoming array order — the comparator is a TOTAL order", () => {
    const entries = [
      { teamKey: "frc5", priorJudgedAwards: 1 },
      { teamKey: "frc6", priorJudgedAwards: 1 },
      { teamKey: "frc7", priorJudgedAwards: 1 },
    ];
    expect(orderFieldByDecoration(entries)).toEqual(orderFieldByDecoration([...entries].reverse()));
  });

  it("never mutates its argument", () => {
    const entries = [
      { teamKey: "frc9", priorJudgedAwards: 0 },
      { teamKey: "frc1", priorJudgedAwards: 5 },
    ];
    orderFieldByDecoration(entries);
    expect(entries.map((e) => e.teamKey)).toEqual(["frc9", "frc1"]);
  });

  it("sorts an unparseable key LAST rather than letting it win a tie it has no claim to", () => {
    expect(teamNumberFromKey("frc254")).toBe(254);
    expect(teamNumberFromKey("sigmascout-demo")).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      orderFieldByDecoration([
        { teamKey: "sigmascout-demo", priorJudgedAwards: 0 },
        { teamKey: "frc9999", priorJudgedAwards: 0 },
      ])
    ).toEqual(["frc9999", "sigmascout-demo"]);
  });
});

describe("the registered seasons", () => {
  it("registers exactly the seasons the base-rate table registers — a hole on either side is a season priced two ways", () => {
    expect([...AWARD_ORDERING_SEASONS]).toEqual([...DISTRICT_AWARD_BASE_RATE_SEASONS]);
  });

  it("reports whether it can price a season, and REFUSES the ones it cannot rather than guessing", () => {
    for (const season of AWARD_ORDERING_SEASONS) expect(hasAwardOrderingTables(season)).toBe(true);
    expect(hasAwardOrderingTables(2018)).toBe(false);
    expect(() => impactOrderingProbability(2018, 1)).toThrow(UnknownAwardOrderingSeasonError);
    expect(() => rookieAllStarOrderingProbability(2018, 1)).toThrow(UnknownAwardOrderingSeasonError);
    expect(() => awardResidualRate(2018, "none", "veteran")).toThrow(UnknownAwardOrderingSeasonError);
  });

  it("names the award types it is about, and they are not each other", () => {
    expect(IMPACT_AWARD_TYPE).toBe(0);
    expect(ROOKIE_ALL_STAR_AWARD_TYPE).toBe(10);
    expect(IMPACT_AWARD_POINTS).toBe(10);
    expect(ROOKIE_ALL_STAR_AWARD_POINTS).toBe(8);
    expect(MIN_ORDERED_FIELD_SIZE).toBe(MAX_IMPACT_POSITION + 1);
  });
});

describe("the stated fallback", () => {
  it("a position inside the table reports source position; one beyond it reports tail and returns the tail's own numbers", () => {
    for (const season of AWARD_ORDERING_SEASONS) {
      const tables = awardOrderingTables(season);
      const inside = impactOrderingProbability(season, 1);
      expect(inside.source, `${season}`).toBe("position");

      const beyond = impactOrderingProbability(season, MAX_IMPACT_POSITION + 1);
      expect(beyond.source, `${season}`).toBe("tail");
      expect(beyond.n, `${season}`).toBe(tables.impactTail.n);
      expect(beyond.p, `${season}`).toBe(tables.impactTail.p);

      // Position 0 and a negative position are not positions; they take the
      // tail rather than reading index -1 and returning undefined.
      expect(impactOrderingProbability(season, 0).source).toBe("tail");
      expect(rookieAllStarOrderingProbability(season, MAX_ROOKIE_ALL_STAR_POSITION + 1).source).toBe("tail");
    }
  });
});

describe("every committed table", () => {
  it("carries a probability in [0, 1] on a positive n at every stated position", () => {
    for (const season of AWARD_ORDERING_SEASONS) {
      const tables = awardOrderingTables(season);
      for (const row of [...tables.impact, ...tables.rookieAllStar, tables.impactTail, tables.rookieAllStarTail]) {
        if (row === null) continue;
        expect(row.p, `${season}`).toBeGreaterThanOrEqual(0);
        expect(row.p, `${season}`).toBeLessThanOrEqual(1);
        expect(row.n, `${season}`).toBeGreaterThan(0);
      }
    }
  });

  it("carries a residual pmf that sums to one at every rung of the fallback hierarchy", () => {
    for (const season of AWARD_ORDERING_SEASONS) {
      for (const bucket of DECORATION_BUCKETS) {
        for (const state of ROOKIE_STATES) {
          const rate = awardResidualRate(season, bucket, state);
          const sum = rate.pmf.reduce((a, b) => a + b, 0);
          expect(Math.abs(sum - 1), `${season} ${cellKey(bucket, state)}`).toBeLessThan(1e-9);
          expect(rate.pmf.length).toBe(AWARD_POINT_SUPPORT.length);
        }
      }
    }
  });

  it("says something: the most decorated team's Impact chance is far above the tail's", () => {
    for (const season of AWARD_ORDERING_SEASONS) {
      const first = impactOrderingProbability(season, 1);
      const tail = impactOrderingProbability(season, MAX_IMPACT_POSITION + 1);
      // A table whose position 1 matched its tail would be an ordering that
      // orders nothing, and would pass every other assertion in this file.
      expect(first.p, `${season}`).toBeGreaterThan(tail.p * 10);
      const firstRookie = rookieAllStarOrderingProbability(season, 1);
      const tailRookie = rookieAllStarOrderingProbability(season, MAX_ROOKIE_ALL_STAR_POSITION + 1);
      expect(firstRookie.p, `${season}`).toBeGreaterThan(tailRookie.p);
    }
  });
});

describe("the decomposition really removed mass", () => {
  /** Cells the base-rate table scores directly, so the two means describe the same population. */
  const SCORED_CELLS: readonly (readonly [DecorationBucket, RookieState])[] = [
    ["none", "rookie"],
    ["none", "veteran"],
    ["one-or-two", "veteran"],
    ["three-or-more", "veteran"],
  ];

  it("every residual cell is strictly LIGHTER than the base-rate cell it was carved out of", () => {
    for (const season of AWARD_ORDERING_SEASONS) {
      for (const [bucket, state] of SCORED_CELLS) {
        const base = meanSupportPoints(awardBaseRate(season, bucket, state).pmf);
        const residual = meanSupportPoints(awardResidualRate(season, bucket, state).pmf);
        // Layering the two Bernoulli draws on an UNREDUCED base rate is the
        // double count this whole decomposition exists to prevent, and a
        // residual that is not lighter is exactly what that mistake looks like.
        expect(residual, `${season} ${cellKey(bucket, state)}`).toBeLessThan(base);
        expect(residual, `${season} ${cellKey(bucket, state)}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("the mass removed from the most decorated veterans is the largest, which is where Impact actually goes", () => {
    for (const season of AWARD_ORDERING_SEASONS) {
      const removed = (bucket: DecorationBucket): number =>
        meanSupportPoints(awardBaseRate(season, bucket, "veteran").pmf) -
        meanSupportPoints(awardResidualRate(season, bucket, "veteran").pmf);
      expect(removed("three-or-more"), `${season}`).toBeGreaterThan(removed("none"));
    }
  });

  it("meanSupportPoints reads the support, not the index", () => {
    expect(meanSupportPoints([1, 0, 0, 0, 0, 0])).toBe(0);
    expect(meanSupportPoints([0, 0, 0, 1, 0, 0])).toBe(10);
    expect(meanSupportPoints([0.5, 0.5, 0, 0, 0, 0])).toBe(2.5);
  });
});
