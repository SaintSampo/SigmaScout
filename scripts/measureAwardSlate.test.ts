/**
 * The award slate measurement (quick task 261014-qje): the pure functions on
 * hand built fixtures, the leak tests, and a corpus guarded re measure of every
 * committed literal in `packages/core/districts/awardSlate.ts`.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { ZERO_AWARD_PROFILE } from "../packages/core/districts/ledgerSimulation.js";
import {
  AWARD_SLOTS,
  awardSlateTables,
  DCMP_TIER_AWARD_SLATE_SEASONS,
  DISTRICT_AWARD_SLATE_SEASONS,
  districtAwardEligibility,
  SEASON_AWARD_TYPES,
  type AwardSlateTier,
} from "../packages/core/districts/awardSlate.js";
import {
  censusLists,
  groupChampionships,
  loadAwardSlateCorpus,
  measurementInput,
  measureSlotLifts,
  measureTierSeason,
  districtPointAwardCensus,
  measureTypeCounts,
  MIN_SLATE_LIFT_OBSERVATIONS,
  priorDecorationCount,
  SLATE_REGISTERED_SEASONS,
  toLift,
  toSeasonTables,
  trainingSeasonsFor,
  typeWinnerCount,
  type AwardInstance,
  type AwardSlateCorpusLoad,
  type SlateEvent,
  type SlateTeamEvent,
} from "./measureAwardSlate.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

const ALL_ELIGIBLE = { impact: true, engineeringInspiration: true, rookieAllStar: true };

function teamEvent(teamKey: string, overrides: Partial<SlateTeamEvent> = {}): SlateTeamEvent {
  return { teamKey, awardPoints: 0, rookieState: "veteran", priorDecorations: 0, priorImpactWins: 0, wonTypes: new Set<number>(), eligible: ALL_ELIGIBLE, ...overrides };
}

function districtEvent(season: number, eventKey: string, field: SlateTeamEvent[]): SlateEvent {
  return { season, tier: "district", districtKey: `${String(season)}zz`, eventKey, week: 1, role: "district", field };
}

/**
 * One district event of 20: team 1 wins Impact, team 2 EI, team 3 (a rookie)
 * RAS, team 4 (a rookie) Rookie Inspiration, teams 5 to 9 one judged award
 * each (type 20), team 1 also a judged award (a stack).
 */
function seasonEvent(season: number, eventKey = `${String(season)}aaa`): SlateEvent {
  const field = Array.from({ length: 20 }, (_, i) =>
    teamEvent(`frc${String(i + 1)}`, {
      rookieState: i === 2 || i === 3 ? "rookie" : "veteran",
      priorDecorations: i < 9 ? 4 : 0,
      priorImpactWins: i === 0 ? 3 : 0,
      wonTypes: new Set(i === 0 ? [0, 20] : i === 1 ? [9] : i === 2 ? [10] : i === 3 ? [15] : i < 9 ? [20] : []),
    })
  );
  return districtEvent(season, eventKey, field);
}

const LISTS: Record<number, readonly number[]> = {
  2019: [0, 9, 10, 15, 20],
  2020: [0, 9, 10, 15, 20],
  2021: [0, 9, 10, 15, 20],
  2022: [0, 9, 10, 15, 20],
  2023: [0, 9, 10, 15, 20, 82],
};

describe("priorDecorationCount (Q-09)", () => {
  const instances: AwardInstance[] = [
    // Individual awards and non point types: never a decoration.
    { year: 2024, eventKey: "2024a", awardType: 4, teamKey: "frc1" },
    { year: 2024, eventKey: "2024a", awardType: 3, teamKey: "frc1" },
    { year: 2024, eventKey: "2024a", awardType: 5, teamKey: "frc1" },
    { year: 2024, eventKey: "2024a", awardType: 68, teamKey: "frc1" },
    { year: 2024, eventKey: "2024a", awardType: 69, teamKey: "frc1" },
    { year: 2024, eventKey: "2024a", awardType: 1, teamKey: "frc1" },
    // A Safety win in 2019 counts for 2026: no window.
    { year: 2019, eventKey: "2019a", awardType: 18, teamKey: "frc1" },
    // A shared award's second row counts once.
    { year: 2023, eventKey: "2023a", awardType: 20, teamKey: "frc1" },
    { year: 2023, eventKey: "2023a", awardType: 20, teamKey: "frc1" },
    // The priced season never counts.
    { year: 2026, eventKey: "2026a", awardType: 17, teamKey: "frc1" },
    { year: 2023, eventKey: "2023a", awardType: 0, teamKey: "frc2" },
  ];

  it("counts distinct wins of the 18 point paying types over every earlier award season", () => {
    expect(priorDecorationCount(instances, "frc1", 2026)).toBe(2);
    expect(priorDecorationCount(instances, "frc1", 2027)).toBe(3);
    expect(priorDecorationCount(instances, "frc1", 2019)).toBe(0);
    expect(priorDecorationCount(instances, "frc2", 2026)).toBe(1);
  });

  it("never reads the priced season (leak half one)", () => {
    const withSeason = [...instances, { year: 2026, eventKey: "2026b", awardType: 0, teamKey: "frc1" }];
    expect(priorDecorationCount(withSeason, "frc1", 2026)).toBe(priorDecorationCount(instances, "frc1", 2026));
  });
});

describe("the training seasons (Q-07)", () => {
  const awardSeasons = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];
  it("need three award seasons before them, and step over 2021", () => {
    expect(trainingSeasonsFor(2023, [2016, 2017, 2018, 2019, 2020, 2022], awardSeasons)).toEqual([2019, 2020, 2022]);
    expect(trainingSeasonsFor(2023, [2016, 2017, 2018, 2019, 2022], awardSeasons)).toEqual([2019, 2022]);
    expect(trainingSeasonsFor(2019, [2016, 2017, 2018], awardSeasons)).toEqual([]);
  });
});

describe("measureTypeCounts (Q-04, Q-10)", () => {
  it("counts distinct eligible audience winners per event in the most recent earlier season declaring the type", () => {
    const events = [seasonEvent(2021), seasonEvent(2022), seasonEvent(2022, "2022bbb")];
    const counts = measureTypeCounts(2023, "district", events, LISTS).district!;
    expect(counts[0]).toEqual({ count: 1, source: "role", fromSeason: 2022, events: 2 });
    expect(counts[20]).toEqual({ count: 6, source: "role", fromSeason: 2022, events: 2 });
    expect(counts[15]).toEqual({ count: 1, source: "role", fromSeason: 2022, events: 2 });
  });

  it("gives a first season type the mean count of the season's other same point types (new-award)", () => {
    const counts = measureTypeCounts(2023, "district", [seasonEvent(2022)], LISTS).district!;
    // 5 point types declared in 2023 besides 82: 15 (1 per event) and 20 (6 per event).
    expect(counts[82]).toEqual({ count: 3.5, source: "new-award", fromSeason: 2022, events: 2 });
  });

  it("leaves out ineligible winners, winners outside the audience, and events with no eligible audience member", () => {
    const base = seasonEvent(2022);
    const field = base.field.map((team) =>
      team.teamKey === "frc1" ? { ...team, eligible: { ...ALL_ELIGIBLE, impact: false } } : team.teamKey === "frc3" ? { ...team, rookieState: "veteran" as const } : team
    );
    const event = { ...base, field };
    expect(typeWinnerCount(event, 0)).toBe(0);
    expect(typeWinnerCount(event, 10)).toBe(0);
    const noRookies = { ...base, eventKey: "2022ccc", field: base.field.map((team) => ({ ...team, rookieState: "veteran" as const })) };
    const counts = measureTypeCounts(2023, "district", [base, noRookies], LISTS).district!;
    expect(counts[10]).toEqual({ count: 1, source: "role", fromSeason: 2022, events: 1 });
  });

  it("is walk forward: adding a season 2023 event leaves 2023's counts unchanged (leak half two)", () => {
    const prior = [seasonEvent(2021), seasonEvent(2022)];
    const leaked = [...prior, { ...seasonEvent(2023), field: seasonEvent(2023).field.map((team) => ({ ...team, wonTypes: new Set([0, 9, 15, 20]) })) }];
    expect(measureTypeCounts(2023, "district", leaked, LISTS)).toEqual(measureTypeCounts(2023, "district", prior, LISTS));
  });

  it("at the DCMP falls back to the pooled single plus division events when a role has no earlier season, and leaves out the qualifying awards", () => {
    const single: SlateEvent = { ...seasonEvent(2022), tier: "dcmp", role: "single", eventKey: "2022zzcmp" };
    const counts = measureTypeCounts(2023, "dcmp", [single], LISTS);
    expect(counts.single![20]).toEqual({ count: 6, source: "role", fromSeason: 2022, events: 1 });
    expect(counts.division![20]).toEqual({ count: 6, source: "pooled", fromSeason: 2022, events: 1 });
    expect(Object.keys(counts.single!).map(Number)).toEqual([15, 20, 82]);
  });
});

describe("measureSlotLifts (Q-06)", () => {
  it("pools each slot's eligible audience minus earlier slot winners, and states won over expected", () => {
    const lifts = measureSlotLifts("district", [2022], [seasonEvent(2022), seasonEvent(2021)], []);
    // Impact pool: all 20; team 1 won. Its class: three or more prior Impact wins, three or more decorations.
    const impact = lifts.impact;
    expect(impact.cells.get("three-or-more|three-or-more")).toEqual({ y: 1, e: 1 / 20, n: 1 });
    const none = impact.primary.get("none")!;
    expect([none.y, none.n]).toEqual([0, 19]);
    expect(none.e).toBeCloseTo(19 / 20, 12);
    // EI pool: the 18 veterans who did not win Impact; team 2 won.
    const ei = lifts.engineeringInspiration;
    expect([...ei.cells.values()].reduce((sum, acc) => sum + acc.n, 0)).toBe(17);
    // judged pool: the 16 teams that won no higher award; a stack (team 1: Impact plus judged) is out.
    const judged = lifts.judged;
    const n = [...judged.cells.values()].reduce((sum, acc) => sum + acc.n, 0);
    const y = [...judged.cells.values()].reduce((sum, acc) => sum + acc.y, 0);
    expect(n).toBe(16);
    expect(y).toBe(5);
    const decorated = judged.cells.get("three-or-more|veteran")!;
    expect([decorated.y, decorated.n]).toEqual([5, 5]);
    expect(decorated.e).toBeCloseTo((5 / 16) * 5, 12);
  });

  it("is walk forward: only the training seasons are read", () => {
    const a = measureSlotLifts("district", [2022], [seasonEvent(2022)], []);
    const b = measureSlotLifts("district", [2022], [seasonEvent(2022), seasonEvent(2023)], []);
    expect(b).toEqual(a);
  });

  it("states a lift only at or above the observation bar", () => {
    expect(toLift({ y: 10, e: 5, n: MIN_SLATE_LIFT_OBSERVATIONS - 1 })).toBeUndefined();
    expect(toLift({ y: 10, e: 5, n: MIN_SLATE_LIFT_OBSERVATIONS })).toEqual({ lift: 2, n: MIN_SLATE_LIFT_OBSERVATIONS });
    expect(toLift({ y: 0, e: 0, n: 500 })).toBeUndefined();
  });

  it("groups DCMP championships and pools the qualifying slots over the whole championship", () => {
    const finals: SlateEvent = { ...seasonEvent(2022), tier: "dcmp", role: "finals", eventKey: "2022zzcmp", field: [teamEvent("frc1", { wonTypes: new Set([0]), awardPoints: 30 })] };
    const division: SlateEvent = { ...seasonEvent(2022), tier: "dcmp", role: "division", eventKey: "2022zzcmp1" };
    const championships = groupChampionships([finals, division]);
    expect(championships.map((c) => [c.key, c.events.length, c.measured])).toEqual([["2022zzcmp", 2, true]]);
    const lifts = measureSlotLifts("dcmp", [2022], [], championships);
    // frc1 won Impact at the finals and at the division: counted once over the championship's union of 20 teams.
    expect([...lifts.impact.cells.values()].reduce((sum, acc) => sum + acc.n, 0)).toBe(20);
    expect([...lifts.impact.cells.values()].reduce((sum, acc) => sum + acc.y, 0)).toBe(1);
  });
});

describe("the district eligibility the loader reads (Q-05 leak test)", () => {
  it("a later week award never makes an earlier event's team ineligible", () => {
    const weeks = new Map([
      ["2026w1", 1],
      ["2026w2", 2],
    ]);
    const out = districtAwardEligibility({
      eventKey: "2026w1",
      teams: [{ teamKey: "frc1", rookie: false, heldAwards: [{ eventKey: "2026w2", awardType: 0 }], districtEventKeys: ["2026w1", "2026w2"] }],
      weekOf: (key) => weeks.get(key) ?? null,
      awardFinal: () => true,
      season: 2026,
      profileOf: () => ZERO_AWARD_PROFILE,
    });
    expect(out[0]!.impact).toBe(1);
  });
});

describe("the registered seasons", () => {
  it("are 2023 to 2026 at both tiers, and the committed tables' own", () => {
    expect(SLATE_REGISTERED_SEASONS).toEqual([2023, 2024, 2025, 2026]);
    expect([...DISTRICT_AWARD_SLATE_SEASONS]).toEqual([...SLATE_REGISTERED_SEASONS]);
    expect([...DCMP_TIER_AWARD_SLATE_SEASONS]).toEqual([...SLATE_REGISTERED_SEASONS]);
  });
});

describe("the corpus re measure", () => {
  let cached: AwardSlateCorpusLoad | undefined;
  const load = (): AwardSlateCorpusLoad => {
    if (cached !== undefined) return cached;
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      cached = loadAwardSlateCorpus(db);
      return cached;
    } finally {
      db.close();
    }
  };
  const corpusIt = CORPUS_AVAILABLE ? it : it.skip;

  corpusIt("re measures every registered season and tier: each count and lift within 1e-9, each n exactly", () => {
    const corpus = load();
    const input = measurementInput(corpus);
    let lifts = 0;
    for (const tier of ["district", "dcmp"] as AwardSlateTier[]) {
      for (const season of SLATE_REGISTERED_SEASONS) {
        const measurement = measureTierSeason(season, tier, input);
        expect(measurement.registered, `${tier} ${String(season)} registered`).toBe(true);
        const fresh = toSeasonTables(measurement);
        const committed = awardSlateTables(season, tier);
        expect(committed.trainingSeasons, `${tier} ${String(season)} training`).toEqual(fresh.trainingSeasons);
        expect(Object.keys(committed.counts).sort(), `${tier} ${String(season)} roles`).toEqual(Object.keys(fresh.counts).sort());
        for (const [role, counts] of Object.entries(fresh.counts)) {
          const committedCounts = committed.counts[role as keyof typeof committed.counts]!;
          expect(Object.keys(committedCounts), `${tier} ${String(season)} ${role} types`).toEqual(Object.keys(counts!));
          for (const [type, entry] of Object.entries(counts!)) {
            const mine = committedCounts[Number(type)]!;
            expect(Math.abs(mine.count - entry.count), `${tier} ${String(season)} ${role} ${type}`).toBeLessThan(1e-9);
            expect({ ...mine, count: 0 }).toEqual({ ...entry, count: 0 });
          }
        }
        for (const slot of AWARD_SLOTS) {
          for (const rung of ["cells", "primary"] as const) {
            const a = committed.lifts[slot][rung];
            const b = fresh.lifts[slot][rung];
            expect(Object.keys(a).sort(), `${tier} ${String(season)} ${slot} ${rung}`).toEqual(Object.keys(b).sort());
            for (const key of Object.keys(b)) {
              expect(a[key]!.n, `${tier} ${String(season)} ${slot} ${key} n`).toBe(b[key]!.n);
              expect(Math.abs(a[key]!.lift - b[key]!.lift), `${tier} ${String(season)} ${slot} ${key} lift`).toBeLessThan(1e-9);
              lifts++;
            }
          }
        }
      }
    }
    // A pin that passes on nothing pins nothing.
    expect(lifts).toBeGreaterThan(100);
  });

  corpusIt("SEASON_AWARD_TYPES equals the corpus census for every corpus season", () => {
    expect(SEASON_AWARD_TYPES).toEqual(censusLists(load()));
  });

  corpusIt("the training seasons per registered season and tier are the printed lists", () => {
    const input = measurementInput(load());
    const of = (tier: AwardSlateTier): number[][] => SLATE_REGISTERED_SEASONS.map((season) => measureTierSeason(season, tier, input).trainingSeasons as number[]);
    expect(of("district")).toEqual([
      [2019, 2020, 2022],
      [2019, 2020, 2022, 2023],
      [2019, 2020, 2022, 2023, 2024],
      [2019, 2020, 2022, 2023, 2024, 2025],
    ]);
    expect(of("dcmp")).toEqual([
      [2019, 2022],
      [2019, 2022, 2023],
      [2019, 2022, 2023, 2024],
      [2019, 2022, 2023, 2024, 2025],
    ]);
  });

  corpusIt("no rookie won Engineering Inspiration at either tier, and no team repeated EI or RAS at the district tier from 2019 on", () => {
    const corpus = load();
    const input = measurementInput(corpus);
    let eiWinners = 0;
    for (const event of input.events) {
      for (const team of event.field) {
        if (!team.wonTypes.has(9)) continue;
        eiWinners++;
        expect(team.rookieState, `${event.eventKey} ${team.teamKey}`).not.toBe("rookie");
      }
    }
    expect(eiWinners).toBeGreaterThan(500);
    for (const census of corpus.seasons.filter((entry) => entry.season >= 2019)) {
      expect(census.repeatWinners[9], `${String(census.season)} EI`).toBe(0);
      expect(census.repeatWinners[10], `${String(census.season)} RAS`).toBe(0);
    }
  });

  corpusIt("the point value cross check prints 0 mismatches", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      const census = districtPointAwardCensus(db);
      expect(census.teamEvents).toBeGreaterThan(20_000);
      expect(census.mismatches).toEqual([]);
    } finally {
      db.close();
    }
  });
});
