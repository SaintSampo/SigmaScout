/**
 * The DCMP award slate measurement (quick task 261014-i8i): the pure
 * functions on hand built fixtures, the leak tests, and a corpus guarded
 * re measure of every committed literal.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { BRACKET_REGISTERED_SEASONS } from "../packages/core/districts/bracket.js";
import {
  DCMP_AWARD_SLATE_SEASONS,
  dcmpAwardSlateTables,
  dcmpEventRoles,
  type DcmpAwardSlateSeasonTables,
  type DcmpEventRole,
} from "../packages/core/districts/dcmpAwardSlate.js";
import {
  groupChampionships,
  judgedWinnerCount,
  loadSlateCorpus,
  measureSeasonSlate,
  MIN_SLATE_LIFT_OBSERVATIONS,
  priorCountsAt,
  rolesByEventType,
  SLATE_REGISTERED_SEASONS,
  toLift,
  toSlateTables,
  wonJudged,
  type MeasuredChampionship,
  type MeasuredDcmpEvent,
  type MeasuredTeamEvent,
  type SlateCorpusLoad,
} from "./measureDcmpAwardSlate.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

const ALL_ELIGIBLE = { impact: true, engineeringInspiration: true, rookieAllStar: true };

function teamEvent(teamKey: string, overrides: Partial<MeasuredTeamEvent> = {}): MeasuredTeamEvent {
  return {
    teamKey,
    awardPoints: 0,
    rookieState: "veteran",
    priorJudgedAwards: 0,
    priorImpactWins: 0,
    wonTypes: new Set<number>(),
    eligible: ALL_ELIGIBLE,
    ...overrides,
  };
}

/** One DCMP tier event; the role comes from the key set it is built with. */
function event(season: number, eventKey: string, role: DcmpEventRole, field: MeasuredTeamEvent[]): MeasuredDcmpEvent {
  return { season, districtKey: `${String(season)}zz`, eventKey, eventType: role === "division" ? 5 : 2, role, roleByType: role, field };
}

/**
 * A season's fixture championships: one single championship of 20 teams and
 * one divisioned championship (finals plus two divisions of 10). Team 1 of
 * the single wins Impact, team 2 EI, team 3 (a rookie) RAS, teams 4 to 9 a
 * judged award.
 */
function seasonFixture(season: number, impactHistory = 0): MeasuredDcmpEvent[] {
  const single = Array.from({ length: 20 }, (_, i) =>
    teamEvent(`frc${String(i + 1)}`, {
      rookieState: i === 2 ? "rookie" : "veteran",
      priorJudgedAwards: i < 6 ? 4 : 0,
      priorImpactWins: i === 0 ? impactHistory : 0,
      awardPoints: i === 0 ? 30 : i === 1 || i === 2 ? 24 : i < 9 ? 15 : 0,
      wonTypes: new Set(i === 0 ? [0] : i === 1 ? [9] : i === 2 ? [10] : i < 9 ? [20] : []),
    })
  );
  const divisionA = Array.from({ length: 10 }, (_, i) => teamEvent(`frc${String(i + 101)}`, { awardPoints: i < 3 ? 15 : 0, wonTypes: new Set(i < 3 ? [20] : []) }));
  const divisionB = Array.from({ length: 10 }, (_, i) => teamEvent(`frc${String(i + 201)}`, { awardPoints: i < 4 ? 15 : 0, wonTypes: new Set(i < 4 ? [20] : []) }));
  const finals = [teamEvent("frc101", { awardPoints: 30, wonTypes: new Set([0]) }), teamEvent("frc201")];
  return [
    event(season, `${String(season)}aacmp`, "single", single),
    event(season, `${String(season)}bbcmp`, "finals", finals),
    event(season, `${String(season)}bbcmp1`, "division", divisionA),
    event(season, `${String(season)}bbcmp2`, "division", divisionB),
  ];
}

describe("the registered seasons", () => {
  it("are the bracket's own, and the committed table's", () => {
    expect(SLATE_REGISTERED_SEASONS).toEqual([...BRACKET_REGISTERED_SEASONS]);
    expect([...DCMP_AWARD_SLATE_SEASONS]).toEqual([...SLATE_REGISTERED_SEASONS]);
  });
});

describe("the role rule", () => {
  it("event_type and key structure agree on a divisioned and a single championship", () => {
    const keys = ["2024micmp", "2024micmp1", "2024micmp2", "2024pncmp"];
    const types = new Map([
      ["2024micmp", 2],
      ["2024micmp1", 5],
      ["2024micmp2", 5],
      ["2024pncmp", 2],
    ]);
    expect([...rolesByEventType(types, keys)]).toEqual([...dcmpEventRoles(keys)]);
  });
});

describe("judged winners", () => {
  it("count teams with award points above 0 and no consuming award there", () => {
    const [single] = seasonFixture(2022);
    expect(judgedWinnerCount(single!)).toBe(6);
    expect(wonJudged(teamEvent("frc1", { awardPoints: 30, wonTypes: new Set([0]) }))).toBe(false);
    expect(wonJudged(teamEvent("frc1", { awardPoints: 15, wonTypes: new Set([20]) }))).toBe(true);
  });
});

describe("groupChampionships and the degenerate filter", () => {
  it("groups a finals with its divisions and keeps a single alone", () => {
    const championships = groupChampionships(seasonFixture(2022));
    expect(championships.map((championship) => [championship.key, championship.events.length, championship.measured])).toEqual([
      ["2022aacmp", 1, true],
      ["2022bbcmp", 3, true],
    ]);
  });

  it("removes a championship below 11 teams, or with no award points", () => {
    const tiny = event(2020, "2020cccmp", "single", [teamEvent("frc1", { awardPoints: 30, wonTypes: new Set([0]) }), teamEvent("frc2", { awardPoints: 30 })]);
    const silent = event(2020, "2020ddcmp", "single", Array.from({ length: 30 }, (_, i) => teamEvent(`frc${String(i + 1)}`)));
    const championships = groupChampionships([tiny, silent]);
    expect(championships.every((championship) => !championship.measured)).toBe(true);
    expect(championships[0]!.reason).toContain("2 team(s)");
  });
});

describe("measureSeasonSlate — walk forward", () => {
  const prior: MeasuredChampionship[] = groupChampionships([...seasonFixture(2021), ...seasonFixture(2022)]);

  it("reads judged anchors from the most recent earlier season holding each role", () => {
    const measurement = measureSeasonSlate(2023, prior);
    expect(measurement.registered).toBe(true);
    expect(measurement.judgedAnchor.single).toEqual({ count: 6, source: "role", fromSeason: 2022, events: 1 });
    expect(measurement.judgedAnchor.division).toEqual({ count: 3.5, source: "role", fromSeason: 2022, events: 2 });
    expect(measurement.judgedAnchor.finals).toEqual({ count: 0, source: "role", fromSeason: 2022, events: 1 });
  });

  it("falls to the pooled single plus division rung for a role no earlier season held", () => {
    const singlesOnly = groupChampionships(seasonFixture(2022).filter((entry) => entry.role === "single"));
    const measurement = measureSeasonSlate(2023, singlesOnly);
    expect(measurement.judgedAnchor.finals).toEqual({ count: 6, source: "pooled", fromSeason: 2022, events: 1 });
  });

  it("LEAK: adding a season Y championship leaves season Y's table unchanged", () => {
    const without = measureSeasonSlate(2023, prior);
    const leaked = groupChampionships([...seasonFixture(2021), ...seasonFixture(2022), ...seasonFixture(2023, 5), ...seasonFixture(2024, 5)]);
    const withSeason = measureSeasonSlate(2023, leaked);
    expect(withSeason).toEqual(without);
    // And it WOULD change if it leaked: the 2023 fixture moves the Impact classes.
    const later = measureSeasonSlate(2024, leaked);
    expect(later.impact).not.toEqual(without.impact);
  });

  it("computes a lift as won over expected, the expectation being the pool's winner count over its size", () => {
    const measurement = measureSeasonSlate(2023, groupChampionships(seasonFixture(2022)));
    // Impact pool: 20 single teams (1 winner) plus the divisioned championship's
    // 20 distinct teams (its finals teams also play a division; 1 winner), all
    // with no prior Impact win.
    const none = measurement.impact.get("none")!;
    expect(none.n).toBe(40);
    expect(none.y).toBe(2);
    expect(none.e).toBeCloseTo(20 * (1 / 20) + 20 * (1 / 20), 12);
  });

  it("states no lift below the observation bar", () => {
    expect(toLift({ y: 10, e: 10, n: MIN_SLATE_LIFT_OBSERVATIONS - 1 })).toBeUndefined();
    expect(toLift({ y: 12, e: 10, n: MIN_SLATE_LIFT_OBSERVATIONS })).toEqual({ lift: 1.2, n: MIN_SLATE_LIFT_OBSERVATIONS });
  });
});

describe("priorCountsAt — a team's prior counts never read its own season", () => {
  it("counts only seasons strictly before", () => {
    const instances = [
      { year: 2022, eventKey: "2022wabon", awardType: 0, teamKey: "frc1" },
      { year: 2022, eventKey: "2022wabon", awardType: 20, teamKey: "frc1" },
      { year: 2023, eventKey: "2023wabon", awardType: 0, teamKey: "frc1" },
      { year: 2023, eventKey: "2023wabon", awardType: 20, teamKey: "frc1" },
    ];
    expect(priorCountsAt(instances, "frc1", 2023)).toEqual({ priorJudgedAwards: 2, priorImpactWins: 1 });
    expect(priorCountsAt(instances, "frc1", 2022)).toEqual({ priorJudgedAwards: 0, priorImpactWins: 0 });
  });
});

// ───────────────────────── the corpus guarded describe ─────────────────────────

describe("the committed slate tables reproduce a fresh measurement", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:districts && pnpm ingest:awards-all) first`, () => {});
    return;
  }

  let cached: SlateCorpusLoad | undefined;
  const load = (): SlateCorpusLoad => {
    if (cached !== undefined) return cached;
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      cached = loadSlateCorpus(db);
      return cached;
    } finally {
      db.close();
    }
  };

  function expectLiftsMatch(label: string, committed: Readonly<Record<string, { lift: number; n: number } | undefined>>, fresh: Readonly<Record<string, { lift: number; n: number } | undefined>>): void {
    expect(Object.keys(committed).sort(), `${label} classes`).toEqual(Object.keys(fresh).sort());
    for (const key of Object.keys(fresh)) {
      expect(committed[key]!.n, `${label} ${key} n`).toBe(fresh[key]!.n);
      expect(Math.abs(committed[key]!.lift - fresh[key]!.lift), `${label} ${key} lift`).toBeLessThan(1e-9);
    }
  }

  it("re measures every registered season: each lift within 1e-9, each n exactly, each anchor", () => {
    const { championships } = load();
    for (const season of SLATE_REGISTERED_SEASONS) {
      const measurement = measureSeasonSlate(season, championships);
      expect(measurement.registered, `${season} registered`).toBe(true);
      const fresh: DcmpAwardSlateSeasonTables = toSlateTables(measurement);
      const committed = dcmpAwardSlateTables(season);
      for (const role of ["single", "division", "finals"] as const) {
        const a = committed.judgedAnchor[role];
        const b = fresh.judgedAnchor[role];
        expect(Math.abs(a.count - b.count), `${season} ${role} anchor`).toBeLessThan(1e-9);
        expect({ ...a, count: 0 }, `${season} ${role} anchor rung`).toEqual({ ...b, count: 0 });
      }
      expectLiftsMatch(`${season} impact`, committed.impactLift, fresh.impactLift);
      expectLiftsMatch(`${season} EI`, committed.engineeringInspirationLift, fresh.engineeringInspirationLift);
      expectLiftsMatch(`${season} judged cells`, committed.judgedLiftCells, fresh.judgedLiftCells);
      expectLiftsMatch(`${season} judged buckets`, committed.judgedLiftBuckets, fresh.judgedLiftBuckets);
      // A pin that passes on nothing pins nothing.
      expect(Object.keys(fresh.judgedLiftCells).length, `${season} judged cells`).toBeGreaterThan(0);
    }
  });

  it("key structure and TBA event_type agree on every DCMP tier event in the corpus", () => {
    const { seasons } = load();
    const events = seasons.flatMap((census) => census.events);
    expect(events.length).toBeGreaterThan(150);
    for (const entry of events) expect(entry.role, entry.eventKey).toBe(entry.roleByType);
  });

  it("no rookie has won Engineering Inspiration at either tier in any corpus season", () => {
    const { seasons } = load();
    expect(seasons.length).toBeGreaterThan(5);
    let winners = 0;
    for (const census of seasons) {
      expect(census.districtTierEi.rookies, `${census.season} district tier`).toBe(0);
      expect(census.dcmpTierEi.rookies, `${census.season} DCMP tier`).toBe(0);
      winners += census.districtTierEi.winners + census.dcmpTierEi.winners;
    }
    expect(winners).toBeGreaterThan(500);
  });

  it("the degenerate filter removes exactly the 2020 championships", () => {
    const { championships } = load();
    const removed = championships.filter((championship) => !championship.measured);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((championship) => championship.season === 2020)).toBe(true);
    expect(championships.filter((championship) => championship.season === 2020).every((championship) => !championship.measured)).toBe(true);
  });
});
