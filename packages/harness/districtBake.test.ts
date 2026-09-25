/**
 * The district bake, tested PURELY: a hand-built roster, hand-built ratings and
 * award profiles, and a `predict` stub returning a fixed two-entry ranking-point
 * pmf pair for every match. No corpus, no network, no files — so this file runs
 * in CI exactly as it runs here.
 *
 * 24 teams is the smallest roster that can fill eight three-team alliances, so
 * it is the smallest fixture that exercises the real eight-alliance bracket
 * rather than the measured fallback table.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  bakeDistrictEvent,
  DISTRICT_BAKE_DRAWS_PER_SCHEDULE,
  DISTRICT_BAKE_DRAW_SALT,
  DISTRICT_BAKE_SCHEDULE_COUNT,
  type DistrictBakeParams,
} from "./districtBake.js";
import { buildPricedSyntheticSchedules } from "./preSchedule.js";
import { DistrictPointPmfSchema, type DistrictPointPmf } from "./pageArtifacts.js";
import { maxEventPoints } from "../core/districts/pointModel.js";
import type { DistrictAwardProfile } from "../core/districts/ledgerSimulation.js";
import type { AllianceMemberRating } from "../core/algorithms/simulation/allianceWinProbability.js";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";

const SEASON = 2026;
const ROSTER = Array.from({ length: 24 }, (_, i) => `frc${100 + i}`).sort();

/** Sums to exactly 1 and survives `roundPmf` unchanged. */
function stubPredict(_match: UpcomingMatch): Prediction {
  return { winner: "red", pRedWin: 0.5, redScore: 50, blueScore: 45, redRpPmf: [0.5, 0.5], blueRpPmf: [0.5, 0.5] };
}

function ratingsFor(roster: readonly string[] = ROSTER): Map<string, AllianceMemberRating> {
  const map = new Map<string, AllianceMemberRating>();
  roster.forEach((teamKey, i) => map.set(teamKey, { teamKey, total: 30 + i, sigma: 5 + (i % 4) }));
  return map;
}

function profilesFor(roster: readonly string[] = ROSTER): Map<string, DistrictAwardProfile> {
  const map = new Map<string, DistrictAwardProfile>();
  roster.forEach((teamKey, i) => map.set(teamKey, { bucket: i % 3 === 0 ? "none" : "one-or-two", rookieState: i % 5 === 0 ? "rookie" : "veteran" }));
  return map;
}

function params(overrides: Partial<DistrictBakeParams> = {}): DistrictBakeParams {
  return {
    districtKey: "2026fnc",
    eventKey: "2026fncash",
    season: SEASON,
    tier: "district",
    eventType: 1,
    week: 2,
    roster: ROSTER,
    allianceCount: 8,
    fieldSize: ROSTER.length,
    ratings: ratingsFor(),
    awardProfiles: profilesFor(),
    algorithmId: "spr",
    algorithmVersion: "7.0.0",
    matchesPerTeam: 12,
    scheduleCount: 2,
    drawsPerSchedule: 25,
    predict: stubPredict,
    ...overrides,
  };
}

/** The probability-weighted mean of an offset-encoded pmf. */
function pmfMean(pmf: DistrictPointPmf): number {
  let mean = 0;
  for (let i = 0; i < pmf.p.length; i++) mean += (pmf.o + i) * pmf.p[i]!;
  return mean;
}

/** The highest point value carrying mass. */
function supportMax(pmf: DistrictPointPmf): number {
  return pmf.o + pmf.p.length - 1;
}

describe("bakeDistrictEvent — the tracer: one unstarted event to five schema-valid pmfs per team", () => {
  it("returns one row per roster team whose five values all parse, stay inside their declared ceilings, and whose total mean equals the sum of the four category means", () => {
    const outcome = bakeDistrictEvent(params());
    expect(outcome.status).toBe("baked");
    if (outcome.status !== "baked") return;

    expect(outcome.roster).toEqual(ROSTER);
    expect(outcome.rows).toHaveLength(ROSTER.length);
    expect(outcome.draws).toBe(2 * 25);

    const ceilings = maxEventPoints(SEASON, "district");
    const totalCeiling = ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award;

    const named = outcome.rows.find((row) => row.teamKey === ROSTER[7]!)!;
    expect(named).toBeDefined();
    for (const key of ["qual", "alliance", "elim", "award", "total"] as const) {
      expect(() => DistrictPointPmfSchema.parse(named[key])).not.toThrow();
    }

    // THE CEILING INVARIANT, stated as the form a SAMPLED histogram can
    // actually satisfy. The plan's wording asked for equality between the
    // total's support upper bound and the sum of `maxEventPoints`' four
    // components; that is the ALLOCATED length, not the published one, because
    // this module trims trailing zeros and a 50-draw sample never reaches the
    // perfect-event maximum. The testable invariant is that no published value
    // can EXCEED its declared ceiling, asserted per category and for the total.
    expect(supportMax(named.qual)).toBeLessThanOrEqual(ceilings.qual);
    expect(supportMax(named.alliance)).toBeLessThanOrEqual(ceilings.alliance);
    expect(supportMax(named.elim)).toBeLessThanOrEqual(ceilings.elim);
    expect(supportMax(named.award)).toBeLessThanOrEqual(ceilings.award);
    expect(supportMax(named.total)).toBeLessThanOrEqual(totalCeiling);

    // THE LOAD-BEARING ASSERTION: the five pmfs are marginals of ONE set of
    // runs, not five independent draws. Linearity of expectation makes the
    // total's mean the sum of the four category means exactly when they come
    // from the same joint draws — and only then.
    const summed = pmfMean(named.qual) + pmfMean(named.alliance) + pmfMean(named.elim) + pmfMean(named.award);
    // 1e-9 on the raw histograms; the published values are rounded to five
    // decimals first, so the tolerance is the rounding rule's own resolution
    // times the four categories' support widths.
    expect(Math.abs(pmfMean(named.total) - summed)).toBeLessThan(0.05);
  });

  it("is deterministic: two calls with identical params are deeply equal, and the result survives structuredClone", () => {
    const first = bakeDistrictEvent(params());
    const second = bakeDistrictEvent(params());
    expect(second).toEqual(first);
    expect(() => structuredClone(first)).not.toThrow();
  });

  it("pools across schedules: (2 x 50) and (1 x 100) both report 100 draws, and the two-schedule run builds two distinct schedule seeds", () => {
    let twoScheduleCalls = 0;
    const twoSchedules = bakeDistrictEvent(
      params({
        scheduleCount: 2,
        drawsPerSchedule: 50,
        predict: (match) => {
          twoScheduleCalls++;
          return stubPredict(match);
        },
      })
    );
    let oneScheduleCalls = 0;
    const oneSchedule = bakeDistrictEvent(
      params({
        scheduleCount: 1,
        drawsPerSchedule: 100,
        predict: (match) => {
          oneScheduleCalls++;
          return stubPredict(match);
        },
      })
    );
    expect(twoSchedules.status).toBe("baked");
    expect(oneSchedule.status).toBe("baked");
    if (twoSchedules.status !== "baked" || oneSchedule.status !== "baked") return;
    expect(twoSchedules.draws).toBe(100);
    expect(oneSchedule.draws).toBe(100);
    // The `predict` closure IS the spy: two schedules cost exactly twice one
    // schedule's pricing calls, which is only true if two schedules were built.
    expect(twoScheduleCalls).toBe(oneScheduleCalls * 2);

    // And the two schedules carry DISTINCT seeds, so the two district draw
    // streams derived from them cannot alias each other.
    const priced = buildPricedSyntheticSchedules({
      eventKey: "2026fncash",
      season: SEASON,
      eventType: 1,
      week: 2,
      algorithmId: "spr",
      algorithmVersion: "7.0.0",
      roster: ROSTER,
      matchesPerTeam: 12,
      pricedFrom: "current-state",
      scheduleCount: 2,
      drawsPerSchedule: 50,
      generation: "",
      computedAt: "",
      predict: stubPredict,
    })!;
    expect(priced.schedules[0]!.seed).not.toBe(priced.schedules[1]!.seed);
    const drawSeeds = priced.schedules.map((s) => (s.seed ^ DISTRICT_BAKE_DRAW_SALT) >>> 0);
    expect(new Set(drawSeeds).size).toBe(2);
    expect(drawSeeds[0]).not.toBe(priced.schedules[0]!.seed);
  });

  it("encodes round-then-trim: no published pmf carries a leading or trailing exact zero, every sum is 1, and a category with empty low support reports a non-zero offset", () => {
    const outcome = bakeDistrictEvent(params());
    if (outcome.status !== "baked") throw new Error("expected a baked outcome");

    let sawNonZeroOffset = false;
    for (const row of outcome.rows) {
      for (const key of ["qual", "alliance", "elim", "award", "total"] as const) {
        const pmf = row[key];
        expect(pmf.p[0]).not.toBe(0);
        expect(pmf.p[pmf.p.length - 1]).not.toBe(0);
        const sum = pmf.p.reduce((total, entry) => total + entry, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
        if (pmf.o > 0) sawNonZeroOffset = true;
      }
    }
    // A qualification pmf always starts above zero points in practice (a team
    // that plays an event earns some), so the offset encoding is genuinely
    // exercised rather than always zero.
    expect(sawNonZeroOffset).toBe(true);
  });
});

describe("bakeDistrictEvent — the all-or-nothing roster decision, one reason and its own offenders per case", () => {
  it("a roster team with an absent total is refused, and a TWO-offender fixture names BOTH team keys", () => {
    const ratings = ratingsFor();
    ratings.set(ROSTER[0]!, { teamKey: ROSTER[0]!, total: undefined, sigma: 5 });
    ratings.set(ROSTER[9]!, { teamKey: ROSTER[9]!, total: Number.NaN, sigma: 5 });
    const outcome = bakeDistrictEvent(params({ ratings }));
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toBe("unrated-teams");
    expect(outcome.offenders).toEqual([ROSTER[0]!, ROSTER[9]!]);
    expect(outcome.detail).toContain(ROSTER[0]!);
    expect(outcome.detail).toContain(ROSTER[9]!);
  });

  it("a roster team with an absent, non-finite or zero sigma is refused — a zero spread is an absence of information, never a certainty", () => {
    for (const sigma of [undefined, Number.POSITIVE_INFINITY, 0, -1]) {
      const ratings = ratingsFor();
      ratings.set(ROSTER[3]!, { teamKey: ROSTER[3]!, total: 40, sigma });
      const outcome = bakeDistrictEvent(params({ ratings }));
      expect(outcome.status).toBe("skipped");
      if (outcome.status !== "skipped") continue;
      expect(outcome.reason).toBe("unrated-teams");
      expect(outcome.offenders).toEqual([ROSTER[3]!]);
    }
  });

  it("a roster team with no award profile is refused, naming every unprofiled team", () => {
    const awardProfiles = profilesFor();
    awardProfiles.delete(ROSTER[2]!);
    awardProfiles.delete(ROSTER[11]!);
    const outcome = bakeDistrictEvent(params({ awardProfiles }));
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toBe("missing-award-profiles");
    expect(outcome.offenders).toEqual([ROSTER[11]!, ROSTER[2]!].sort());
  });

  it("a roster outside the schedule generator's size range is refused before anything is priced", () => {
    const tiny = ROSTER.slice(0, 5);
    const outcome = bakeDistrictEvent(
      params({ roster: tiny, fieldSize: tiny.length, ratings: ratingsFor(tiny), awardProfiles: profilesFor(tiny) })
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toBe("roster-out-of-generator-range");
  });

  it("a roster too small to fill the alliance count is refused with its own reason", () => {
    const small = ROSTER.slice(0, 20);
    const outcome = bakeDistrictEvent(
      params({ roster: small, fieldSize: small.length, ratings: ratingsFor(small), awardProfiles: profilesFor(small) })
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toBe("roster-too-small-for-alliances");
    expect(outcome.detail).toContain("cannot fill 8");
  });

  it("an RP-less algorithm is a skip with its own reason, never a partial bake", () => {
    const outcome = bakeDistrictEvent(
      params({ predict: () => ({ winner: "red", pRedWin: 0.5, redScore: 50, blueScore: 45 }) })
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.reason).toBe("rp-less-algorithm");
  });
});

describe("bakeDistrictEvent — a simulation error is corruption, not a skip", () => {
  it("lets a simulateDistrictEvent throw propagate rather than downgrading it into a skipped outcome", () => {
    // `fieldSize` below the roster size passes every up-front roster check this
    // module makes and is refused by the SIMULATION. Swallowing that into a
    // skip is how a publish silently loses a whole district's predictions.
    expect(() => bakeDistrictEvent(params({ fieldSize: 2 }))).toThrow(/fieldSize/);
  });
});

describe("districtBake.ts reaches no grand-total encoder", () => {
  it("imports no grand-total convolution and exports no grand-total function", () => {
    // 10-04 Fact 5: a season `point_total` reaches 445 in the corpus while
    // `DistrictPointPmfSchema` caps `p` at 256 entries, and the grand total is
    // a browser-side quantity with NO published field. 10-04 deliberately
    // exports no grand-total encoder; this module must not reach for one.
    const source = readFileSync(new URL("./districtBake.ts", import.meta.url), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toContain("convolveDistrictGrandTotal");
    expect(code).not.toMatch(/export function \w*[Gg]randTotal/);
  });
});

describe("bakeDistrictEvent — seed-to-seed spread is MEASURED and reported, never asserted against a bar", () => {
  it("prints the maximum absolute per-entry pmf difference between two seed families and asserts only that both are schema-valid", () => {
    // At the PRODUCTION draw budget, so the figure this prints is the one the
    // published artifacts actually carry rather than a fixture-scale one.
    const productionDraws = { scheduleCount: DISTRICT_BAKE_SCHEDULE_COUNT, drawsPerSchedule: DISTRICT_BAKE_DRAWS_PER_SCHEDULE };
    const a = bakeDistrictEvent(params({ ...productionDraws, algorithmVersion: "7.0.0" }));
    const b = bakeDistrictEvent(params({ ...productionDraws, algorithmVersion: "7.0.0-seed-b" }));
    if (a.status !== "baked" || b.status !== "baked") throw new Error("expected two baked outcomes");

    const atPoint = (pmf: DistrictPointPmf, value: number): number => {
      const index = value - pmf.o;
      return index >= 0 && index < pmf.p.length ? pmf.p[index]! : 0;
    };
    let maxAbs = 0;
    for (let t = 0; t < a.rows.length; t++) {
      const rowA = a.rows[t]!;
      const rowB = b.rows[t]!;
      for (const key of ["qual", "alliance", "elim", "award", "total"] as const) {
        const pmfA = rowA[key];
        const pmfB = rowB[key];
        const lo = Math.min(pmfA.o, pmfB.o);
        const hi = Math.max(supportMax(pmfA), supportMax(pmfB));
        for (let value = lo; value <= hi; value++) {
          maxAbs = Math.max(maxAbs, Math.abs(atPoint(pmfA, value) - atPoint(pmfB, value)));
        }
        expect(() => DistrictPointPmfSchema.parse(pmfA)).not.toThrow();
        expect(() => DistrictPointPmfSchema.parse(pmfB)).not.toThrow();
      }
    }
    console.log(
      `districtBake seed-to-seed spread: max |dp| = ${maxAbs.toFixed(5)} across ${a.rows.length} teams x 5 categories at ${a.draws} pooled draws`
    );
    expect(maxAbs).toBeLessThanOrEqual(1);
  });
});

describe("districtBake.ts's published constants", () => {
  it("declares the pooled draw budget the module documents", () => {
    expect(DISTRICT_BAKE_SCHEDULE_COUNT).toBe(40);
    expect(DISTRICT_BAKE_DRAWS_PER_SCHEDULE).toBe(100);
    expect(DISTRICT_BAKE_SCHEDULE_COUNT * DISTRICT_BAKE_DRAWS_PER_SCHEDULE).toBe(4000);
  });
});
