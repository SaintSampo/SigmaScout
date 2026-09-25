/**
 * THE LEAK TESTS ARE THE LOAD-BEARING ONES, and both fixtures are chosen so a
 * leak CHANGES THE ANSWER — a fixture where it does not proves nothing.
 *
 *   HALF ONE, the feature: a decoration counted one season too far REORDERS the
 *   field, so the team at position 1 is a different team and the table's
 *   position-1 win count moves.
 *   HALF TWO, the tables: a season's own events folded into its own table
 *   change every position's rate.
 *
 * Two describes: the first pure and synthetic and running everywhere, the
 * second corpus-guarded with `existsSync` plus an explicit `it.skip`.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import {
  AWARD_POINT_SUPPORT,
  cellKey,
  DECORATION_BUCKETS,
  ROOKIE_STATES,
} from "../packages/core/districts/awardBaseRates.js";
import {
  AWARD_ORDERING_SEASONS,
  awardOrderingTables,
  awardResidualRate,
  IMPACT_AWARD_POINTS,
  impactOrderingProbability,
  MAX_IMPACT_POSITION,
  MAX_ROOKIE_ALL_STAR_POSITION,
  MIN_ORDERED_FIELD_SIZE,
  MIN_POSITION_OBSERVATIONS,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  rookieAllStarOrderingProbability,
} from "../packages/core/districts/awardOrderingTables.js";
import { DISTRICT_REGISTERED_SEASONS } from "../packages/core/districts/pointModel.js";
import { priorJudgedAwardCount, type AwardInstance } from "./measureDistrictAwardBaseRates.js";
import {
  buildSeasonFields,
  buildSeasonOrderingTables,
  censusTotal,
  clearsPositionBar,
  emptyPosition,
  indexSeasonAwards,
  measureAwardOrderingTables,
  modalValue,
  orderFieldByImpactHistory,
  residualAwardPoints,
  toPositionRate,
  toSeasonOrderingTables,
  type AttendeeOutcome,
  type EventField,
} from "./measureAwardOrderingTables.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

const NO_ROOKIE_YEARS = new Map<string, number>();

/** One synthetic attendee. Everything not named defaults to a decorated-nothing veteran who won nothing. */
function attendee(teamKey: string, overrides: Partial<AttendeeOutcome> = {}): AttendeeOutcome {
  return {
    teamKey,
    priorJudgedAwards: 0,
    rookieState: "veteran",
    awardPoints: 0,
    wonImpact: false,
    wonRookieAllStar: false,
    judgedAwardTypesWon: 0,
    priorImpactWins: 0,
    ...overrides,
  };
}

/** `count` filler attendees with high team numbers, so a named fixture team always sorts ahead of them on a tie. */
function filler(count: number): AttendeeOutcome[] {
  return Array.from({ length: count }, (_, i) => attendee(`frc${9000 + i}`));
}

/** One event field of at least `MIN_ORDERED_FIELD_SIZE` attendees, led by the named ones. */
function field(season: number, eventKey: string, leaders: readonly AttendeeOutcome[]): EventField {
  return { season, eventKey, attendees: [...leaders, ...filler(Math.max(0, MIN_ORDERED_FIELD_SIZE - leaders.length))] };
}

// ───────────────────────────── the pure describe ─────────────────────────────

describe("LEAK HALF ONE — the decoration feature reorders the field", () => {
  // frc200 wins a judged award in 2002. At a 2002 event the honest count is 0
  // for both teams, so the ordering falls to team number and frc100 takes
  // position 1. Leaked by one season, frc200 has a decoration and takes it.
  const instances: AwardInstance[] = [{ year: 2002, eventKey: "2002a", awardType: 9, teamKey: "frc200" }];

  const buildFieldAt = (beforeYear: number): EventField => {
    const leaders = [
      attendee("frc100", { priorJudgedAwards: priorJudgedAwardCount(instances, "frc100", beforeYear) }),
      attendee("frc200", {
        priorJudgedAwards: priorJudgedAwardCount(instances, "frc200", beforeYear),
        wonImpact: true,
        awardPoints: IMPACT_AWARD_POINTS,
        judgedAwardTypesWon: 1,
      }),
    ];
    return { season: 2002, eventKey: "2002ev", attendees: [...leaders, ...filler(MIN_ORDERED_FIELD_SIZE - 2)] };
  };

  it("counts only seasons strictly before the event's own, and the leak moves the Impact winner to position 1", () => {
    const honest = buildSeasonOrderingTables(2003, [buildFieldAt(2002)]);
    const leaked = buildSeasonOrderingTables(2003, [buildFieldAt(2003)]);

    expect(priorJudgedAwardCount(instances, "frc200", 2002)).toBe(0);
    expect(priorJudgedAwardCount(instances, "frc200", 2003)).toBe(1);

    // The honest field puts the Impact winner at position 2 (team number
    // order); the leaked one puts it at position 1.
    expect(honest.impact[0]!.wins).toBe(0);
    expect(honest.impact[1]!.wins).toBe(1);
    expect(leaked.impact[0]!.wins).toBe(1);
    expect(leaked.impact[1]!.wins).toBe(0);
    expect(honest.impact[0]!.wins).not.toBe(leaked.impact[0]!.wins);
  });
});

describe("LEAK HALF TWO — the tables themselves", () => {
  it("the table registered for a season is unchanged by that season's own events, by deep equality", () => {
    // Prior seasons: nobody ever wins Impact.
    const prior = [2000, 2001, 2002].map((season) => field(season, `${season}ev`, [attendee("frc1")]));
    // The scored season's own events are EXTREME: position 1 always wins.
    const scoredSeasonOwn = [
      field(2003, "2003ev", [
        attendee("frc1", { wonImpact: true, awardPoints: IMPACT_AWARD_POINTS, judgedAwardTypesWon: 1 }),
      ]),
    ];

    const honest = buildSeasonOrderingTables(2003, prior);
    const leaked = buildSeasonOrderingTables(2003, [...prior, ...scoredSeasonOwn]);

    expect(honest.impact[0]!.wins).toBe(0);
    expect(leaked.impact[0]!.wins).toBe(1);
    expect(honest.impact[0]!.n).toBe(3);
    expect(leaked.impact[0]!.n).toBe(4);
    expect(toPositionRate(honest.impact[0]!)).not.toEqual(toPositionRate(leaked.impact[0]!));
  });
});

describe("the ordering", () => {
  it("puts the most decorated first and breaks a tie by ASCENDING team number", () => {
    const measurement = buildSeasonOrderingTables(2003, [
      field(2000, "2000ev", [
        attendee("frc9999", { priorJudgedAwards: 5, wonImpact: true }),
        attendee("frc1", { priorJudgedAwards: 1 }),
        attendee("frc2", { priorJudgedAwards: 1 }),
      ]),
    ]);
    // frc9999 is the most decorated and wins, so position 1 holds the win even
    // though its team number is the largest in the field.
    expect(measurement.impact[0]!.wins).toBe(1);
    // frc1 and frc2 tie on decoration; the lower number takes position 2.
    expect(measurement.impact[1]!.n).toBe(1);
    expect(measurement.impact[1]!.wins).toBe(0);
  });

  it("ranks the rookie block on its OWN length, never appending veterans below it", () => {
    const measurement = buildSeasonOrderingTables(2003, [
      field(2000, "2000ev", [
        attendee("frc50", { rookieState: "rookie", wonRookieAllStar: true }),
        attendee("frc60", { rookieState: "rookie" }),
      ]),
    ]);
    // Two rookies, so exactly two rookie positions were occupied — the nine
    // filler veterans are not ranked at all.
    expect(measurement.rookieAllStar[0]!.n).toBe(1);
    expect(measurement.rookieAllStar[1]!.n).toBe(1);
    expect(measurement.rookieAllStar[2]!.n).toBe(0);
    expect(measurement.rookieAllStarTail.n).toBe(0);
    expect(measurement.rookieAllStar[0]!.wins).toBe(1);
  });

  it("pools everything past the last named position into the tail", () => {
    const leaders = Array.from({ length: MAX_IMPACT_POSITION + 3 }, (_, i) =>
      attendee(`frc${100 + i}`, { priorJudgedAwards: 50 - i, wonImpact: i === MAX_IMPACT_POSITION })
    );
    const measurement = buildSeasonOrderingTables(2003, [{ season: 2000, eventKey: "2000ev", attendees: leaders }]);
    expect(measurement.impact[MAX_IMPACT_POSITION - 1]!.wins).toBe(0);
    expect(measurement.impactTail.n).toBe(3);
    expect(measurement.impactTail.wins).toBe(1);
  });

  it("the REFERENCE ordering sorts on prior Impact wins first and is NOT the shipped one", () => {
    const attendees = [
      attendee("frc1", { priorJudgedAwards: 9, priorImpactWins: 0 }),
      attendee("frc2", { priorJudgedAwards: 1, priorImpactWins: 3 }),
    ];
    expect(orderFieldByImpactHistory(attendees)[0]).toBe("frc2");
    // The shipped ordering disagrees, which is exactly why the reference block
    // is measured rather than assumed to be the same thing.
    const measurement = buildSeasonOrderingTables(2003, [
      field(2000, "2000ev", [
        attendee("frc1", { priorJudgedAwards: 9, priorImpactWins: 0, wonImpact: true }),
        attendee("frc2", { priorJudgedAwards: 1, priorImpactWins: 3 }),
      ]),
    ]);
    expect(measurement.impact[0]!.wins).toBe(1);
    expect(measurement.referenceImpact[0]!.wins).toBe(0);
  });
});

describe("the residual", () => {
  it("removes exactly the Impact and Rookie All Star point values, and nothing else", () => {
    expect(residualAwardPoints(attendee("frc1", { awardPoints: 15, wonImpact: true }))).toBe(5);
    expect(residualAwardPoints(attendee("frc1", { awardPoints: 13, wonRookieAllStar: true }))).toBe(5);
    expect(
      residualAwardPoints(attendee("frc1", { awardPoints: 18, wonImpact: true, wonRookieAllStar: true }))
    ).toBe(0);
    expect(residualAwardPoints(attendee("frc1", { awardPoints: 5 }))).toBe(5);
  });

  it("censuses a NEGATIVE residual as unmodelled rather than clamping it to zero", () => {
    // `district_rankings` says 0 award points while `event_awards_all` says the
    // team won Impact — two third-party tables disagreeing. The honest outcome
    // is an unmodelled census entry, never a silent clamp.
    const measurement = buildSeasonOrderingTables(2003, [
      field(2000, "2000ev", [attendee("frc1", { awardPoints: 0, wonImpact: true })]),
    ]);
    expect([...measurement.residualSeasonPooled.unmodelled.entries()]).toEqual([[-IMPACT_AWARD_POINTS, 1]]);
    // And it is NOT counted into any bin: the ten remaining attendees are.
    expect(measurement.residualSeasonPooled.n).toBe(MIN_ORDERED_FIELD_SIZE - 1);
  });

  it("buckets a residual by the team's own decoration bucket and rookie state", () => {
    const measurement = buildSeasonOrderingTables(2003, [
      field(2000, "2000ev", [attendee("frc1", { priorJudgedAwards: 5, awardPoints: 5 })]),
    ]);
    expect(measurement.residualCells.get(cellKey("three-or-more", "veteran"))!.n).toBe(1);
    expect(measurement.residualCells.get(cellKey("three-or-more", "veteran"))!.counts[1]).toBe(1);
  });
});

describe("the observation bars", () => {
  it("a position below the bar is null in the emitted table; a position AT the bar is present", () => {
    const below = emptyPosition();
    below.n = MIN_POSITION_OBSERVATIONS - 1;
    const at = emptyPosition();
    at.n = MIN_POSITION_OBSERVATIONS;
    expect(clearsPositionBar(below)).toBe(false);
    expect(clearsPositionBar(at)).toBe(true);

    const fields = Array.from({ length: MIN_POSITION_OBSERVATIONS - 1 }, (_, i) =>
      field(2000 + (i % 3), `ev${i}`, [attendee("frc1")])
    );
    expect(toSeasonOrderingTables(buildSeasonOrderingTables(2003, fields)).impact[0]).toBeNull();

    const atBar = [...fields, field(2002, "evLast", [attendee("frc1")])];
    expect(toSeasonOrderingTables(buildSeasonOrderingTables(2003, atBar)).impact[0]).not.toBeNull();
  });

  it("refuses to register a season with fewer than three prior district seasons, and says why", () => {
    const fields = Array.from({ length: 400 }, (_, i) => field(2000 + (i % 2), `ev${i}`, [attendee("frc1")]));
    const measurement = buildSeasonOrderingTables(2003, fields);
    expect(measurement.registered).toBe(false);
    expect(measurement.registrationReason).toContain("prior district season");
  });

  it("refuses to register a season whose position 1 is below the observation bar, and says why", () => {
    const fields = Array.from({ length: 30 }, (_, i) => field(2000 + (i % 3), `ev${i}`, [attendee("frc1")]));
    const measurement = buildSeasonOrderingTables(2003, fields);
    expect(measurement.registered).toBe(false);
    expect(measurement.registrationReason).toContain("Impact position 1");
  });
});

describe("the event filter", () => {
  const rows = (eventKey: string, count: number): { teamKey: string; eventKey: string; awardPoints: number }[] =>
    Array.from({ length: count }, (_, i) => ({ teamKey: `frc${100 + i}`, eventKey, awardPoints: 0 }));

  it("drops an event that carries NO award row at all — counting it would deflate every rate", () => {
    const awards = indexSeasonAwards([{ year: 2000, eventKey: "2000has", awardType: 0, teamKey: "frc100" }]);
    const load = buildSeasonFields(
      2000,
      [...rows("2000has", MIN_ORDERED_FIELD_SIZE), ...rows("2000none", MIN_ORDERED_FIELD_SIZE)],
      awards,
      NO_ROOKIE_YEARS,
      () => 0,
      () => 0
    );
    expect(load.fields.map((f) => f.eventKey)).toEqual(["2000has"]);
    expect(load.eventsWithoutAwardRows).toEqual(["2000none"]);
  });

  it("drops an event below the field-size bar — a one-attendee field is the Impact winner's row and nothing else", () => {
    const awards = indexSeasonAwards([
      { year: 2000, eventKey: "2000big", awardType: 0, teamKey: "frc100" },
      { year: 2000, eventKey: "2000tiny", awardType: 0, teamKey: "frc100" },
    ]);
    const load = buildSeasonFields(
      2000,
      [...rows("2000big", MIN_ORDERED_FIELD_SIZE), ...rows("2000tiny", MIN_ORDERED_FIELD_SIZE - 1)],
      awards,
      NO_ROOKIE_YEARS,
      () => 0,
      () => 0
    );
    expect(load.fields.map((f) => f.eventKey)).toEqual(["2000big"]);
    expect(load.eventsBelowFieldSizeBar).toEqual(["2000tiny"]);
  });

  it("reads the Impact and Rookie All Star recipients off the season's own award rows", () => {
    const awards = indexSeasonAwards([
      { year: 2000, eventKey: "2000ev", awardType: 0, teamKey: "frc100" },
      { year: 2000, eventKey: "2000ev", awardType: 10, teamKey: "frc101" },
      // A non-judged type never counts toward `judgedAwardTypesWon`.
      { year: 2000, eventKey: "2000ev", awardType: 1, teamKey: "frc100" },
    ]);
    const load = buildSeasonFields(2000, rows("2000ev", MIN_ORDERED_FIELD_SIZE), awards, NO_ROOKIE_YEARS, () => 0, () => 0);
    const byKey = new Map(load.fields[0]!.attendees.map((a) => [a.teamKey, a] as const));
    expect(byKey.get("frc100")!.wonImpact).toBe(true);
    expect(byKey.get("frc100")!.judgedAwardTypesWon).toBe(1);
    expect(byKey.get("frc101")!.wonRookieAllStar).toBe(true);
    expect(byKey.get("frc102")!.wonImpact).toBe(false);
  });
});

describe("the census helpers", () => {
  it("takes the modal value and breaks a tie toward the SMALLER value", () => {
    expect(modalValue(new Map())).toBeUndefined();
    expect(modalValue(new Map([[10, 5], [5, 2]]))).toBe(10);
    expect(modalValue(new Map([[10, 3], [5, 3]]))).toBe(5);
    expect(censusTotal(new Map([[10, 3], [5, 2]]))).toBe(5);
  });
});

// ───────────────────────── the corpus-guarded describe ─────────────────────────

describe("the committed module reproduces a fresh measurement", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:districts && pnpm ingest:awards-all) first`, () => {});
    return;
  }

  const measure = (): ReturnType<typeof measureAwardOrderingTables> => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      return measureAwardOrderingTables(db, DISTRICT_REGISTERED_SEASONS);
    } finally {
      db.close();
    }
  };

  it("re-measures every registered season and matches every probability within 1e-9 and every n exactly", () => {
    const result = measure();

    // The registered set matches EXACTLY: a module registering a season the
    // script would not is a number with no harness.
    expect(result.registeredSeasons).toEqual([...AWARD_ORDERING_SEASONS]);

    for (const season of AWARD_ORDERING_SEASONS) {
      const fresh = toSeasonOrderingTables(result.bySeason.get(season)!);
      const committed = awardOrderingTables(season);
      expect(committed.impact, `${season} impact`).toEqual(fresh.impact);
      expect(committed.impactTail, `${season} impact tail`).toEqual(fresh.impactTail);
      expect(committed.rookieAllStar, `${season} rookie`).toEqual(fresh.rookieAllStar);
      expect(committed.rookieAllStarTail, `${season} rookie tail`).toEqual(fresh.rookieAllStarTail);

      // And through the LOOKUPS, which is the surface the ledger actually uses.
      for (let k = 1; k <= MAX_IMPACT_POSITION; k++) {
        const row = fresh.impact[k - 1];
        const looked = impactOrderingProbability(season, k);
        expect(looked.source, `${season} impact ${k} source`).toBe(row === null ? "tail" : "position");
        expect(looked.n, `${season} impact ${k} n`).toBe(row === null ? fresh.impactTail.n : row!.n);
        expect(Math.abs(looked.p - (row === null ? fresh.impactTail.p : row!.p))).toBeLessThan(1e-9);
      }
      expect(impactOrderingProbability(season, MAX_IMPACT_POSITION + 1).source).toBe("tail");
      for (let j = 1; j <= MAX_ROOKIE_ALL_STAR_POSITION; j++) {
        const row = fresh.rookieAllStar[j - 1];
        const looked = rookieAllStarOrderingProbability(season, j);
        expect(looked.n, `${season} rookie ${j} n`).toBe(row === null ? fresh.rookieAllStarTail.n : row!.n);
      }

      // The residual table, through its own fallback hierarchy.
      for (const bucket of DECORATION_BUCKETS) {
        for (const state of ROOKIE_STATES) {
          const key = cellKey(bucket, state);
          const freshCell = fresh.residualCells[key];
          const freshFallback = freshCell ?? fresh.residualBucketPooled[bucket] ?? fresh.residualSeasonPooled;
          const expectedSource =
            freshCell !== undefined ? "cell" : fresh.residualBucketPooled[bucket] !== undefined ? "bucket-pooled" : "season-pooled";
          const looked = awardResidualRate(season, bucket, state);
          expect(looked.source, `${season} ${key} source`).toBe(expectedSource);
          expect(looked.n, `${season} ${key} n`).toBe(freshFallback.n);
          for (let i = 0; i < AWARD_POINT_SUPPORT.length; i++) {
            expect(Math.abs(looked.pmf[i]! - freshFallback.pmf[i]!), `${season} ${key} entry ${i}`).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it("the committed award point values are the corpus's own modal values, per registered season", () => {
    const result = measure();
    for (const season of AWARD_ORDERING_SEASONS) {
      const measurement = result.bySeason.get(season)!;
      expect(censusTotal(measurement.soleImpactPoints), `${season} sole-Impact census`).toBeGreaterThan(100);
      expect(modalValue(measurement.soleImpactPoints), `${season} Impact points`).toBe(IMPACT_AWARD_POINTS);
      expect(censusTotal(measurement.soleRookieAllStarPoints), `${season} sole-RAS census`).toBeGreaterThan(100);
      expect(modalValue(measurement.soleRookieAllStarPoints), `${season} RAS points`).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
    }
  });

  it("every contributing event fills all ten Impact positions, so the ten rates are comparable", () => {
    const result = measure();
    for (const season of AWARD_ORDERING_SEASONS) {
      const measurement = result.bySeason.get(season)!;
      // A pin that passes on nothing pins nothing.
      expect(measurement.eventCount, `${season} events`).toBeGreaterThan(100);
      for (let k = 2; k <= MAX_IMPACT_POSITION; k++) {
        expect(measurement.impact[k - 1]!.n, `${season} position ${k}`).toBe(measurement.impact[0]!.n);
      }
      expect(measurement.impact[0]!.n).toBe(measurement.eventCount);
    }
  });
});
