/**
 * A district event under 24 real teams prices at every stage (quick task
 * 261007-4qr).
 *
 * Since 261006-2t0 the simulated roster is the teams on a qualification row,
 * so a small event (2023gaalb, 2024vapor, 2025ncash, 2026mefal, 2026txmca) no
 * longer counts its playoff-only demo robots, and the core refused it outright
 * with `InsufficientRosterError`. That cost the whole district its range call
 * on both Locks tabs. The core now seats whole real alliances at the top seeds
 * and leaves the bottom seeds as filler that forfeits, which is what those
 * events actually did, and a demo key on a published alliance is filler too.
 *
 * Synthetic fixtures parsed through the REAL `EventArtifactSchema` and
 * `DistrictArtifactSchema`. No corpus, no network.
 */
import { describe, expect, it } from "vitest";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { simulateDistrictEvent } from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  distributionsFromResult,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";

const SEASON = 2026;
const EVENT_KEY = "2026meshort";
const ROSTER = Array.from({ length: 20 }, (_unused, i) => `frc${String(400 + i)}`);
const DEMO_KEYS = ["frc9990", "frc9991", "frc9992", "frc9993", "frc9994", "frc9995"];
const isDemoKey = (key: string): boolean => /^frc99[7-9]\d$/.test(key);
const PMF = [0.25, 0.25, 0.25, 0.25];

/** Alliances 1 to 6 hold the first eighteen real teams; 7 and 8 are whole demo alliances, as at 2026mefal. */
const ALLIANCES = [
  ...Array.from({ length: 6 }, (_unused, n) => ({ allianceNumber: n + 1, picks: ROSTER.slice(n * 3, n * 3 + 3) })),
  { allianceNumber: 7, picks: DEMO_KEYS.slice(0, 3) },
  { allianceNumber: 8, picks: DEMO_KEYS.slice(3, 6) },
];

function qualRow(i: number): Record<string, unknown> {
  // Four rows of six that between them seat all twenty real teams.
  const seat = (offset: number): string => ROSTER[(i * 6 + offset) % ROSTER.length]!;
  return {
    matchKey: `${EVENT_KEY}_qm${String(i + 1)}`,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: i + 1,
    sortTime: 1_760_000_000 + i * 600,
    redTeams: [seat(0), seat(1), seat(2)],
    blueTeams: [seat(3), seat(4), seat(5)],
    predictedWinner: "red",
    pRedWin: 0.5,
    predictedRedScore: 50,
    predictedBlueScore: 50,
    actualWinner: "red",
    actualRedScore: 60,
    actualBlueScore: 50,
    actualRedRp: 3,
    actualBlueRp: 1,
    redRpPmf: PMF,
    blueRpPmf: PMF,
  };
}

/** Alliance 1 beat demo alliance 8 in upper round one: the forfeit the corpus records. */
const PLAYED_SF1 = {
  matchKey: `${EVENT_KEY}_sf1m1`,
  compLevel: "sf",
  setNumber: 1,
  matchNumber: 1,
  sortTime: 1_760_010_000,
  redTeams: ALLIANCES[0]!.picks,
  blueTeams: ALLIANCES[7]!.picks,
  predictedWinner: "red",
  pRedWin: 0.5,
  predictedRedScore: 100,
  predictedBlueScore: 0,
  actualWinner: "red",
  actualRedScore: 100,
  actualBlueScore: 0,
  actualRedRp: 0,
  actualBlueRp: 0,
  redRpPmf: [1],
  blueRpPmf: [1],
};

const eventArtifact = EventArtifactSchema.parse({
  schemaVersion: 1,
  generation: "gen-1",
  computedAt: "2026-10-07T00:00:00.000Z",
  algorithmId: "spr",
  algorithmVersion: "9.0.0+rolling",
  eventKey: EVENT_KEY,
  season: SEASON,
  matches: [...Array.from({ length: 4 }, (_unused, i) => qualRow(i)), PLAYED_SF1],
  upcoming: [],
  teams: [
    ...ROSTER.map((teamKey, i) => ({
      teamKey,
      teamNumber: 400 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 80 - i }, sigma: { value: 8 } },
    })),
    // Playoff-only demo robots: on the teams list, on no qualification row.
    ...DEMO_KEYS.map((teamKey) => ({
      teamKey,
      teamNumber: Number(teamKey.slice(3)),
      nickname: `Off-Season Demo Team ${teamKey.slice(3)}`,
      metrics: {},
    })),
  ],
  alliances: ALLIANCES,
});

const districtArtifact: DistrictArtifact = DistrictArtifactSchema.parse({
  schemaVersion: 1,
  generation: "gen-1",
  computedAt: "2026-10-07T00:00:00.000Z",
  districtKey: "2026ne",
  year: SEASON,
  abbreviation: "ne",
  displayName: "New England",
  dcmpSlots: 90,
  cmpSlots: 32,
  teams: ROSTER.map((teamKey, i) => ({
    teamKey,
    teamNumber: 400 + i,
    nickname: `Nickname ${teamKey}`,
    rank: i + 1,
    pointTotal: 0,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [
      {
        eventKey: EVENT_KEY,
        eventName: "Short Event",
        week: 1,
        tier: "district",
        qual: 0,
        alliance: 0,
        elim: 0,
        award: 0,
        total: 0,
        state: { qualMatchesPlayed: 2, qualMatchesTotal: 4, alliancesPicked: false, playoffsDone: false, awardsPosted: false },
      },
    ],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
    champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
    awardProfile: { bucket: "none", rookie: false },
  })),
  insights: {
    teamCount: ROSTER.length,
    eventCount: 1,
    dcmpCutLinePoints: 40,
    cmpCutLinePoints: 80,
    districtLockedCount: 0,
    districtEliminatedCount: 0,
    champLockedCount: 0,
    champEliminatedCount: 0,
  },
});

interface Position {
  readonly name: string;
  readonly stage: DistrictStageFinality;
  readonly startMatchKey: string | null;
  readonly conditionOnPlayedElims: boolean;
  readonly openCategories: readonly ("qual" | "alliance" | "elim" | "award")[];
}

const POSITIONS: readonly Position[] = [
  {
    name: "(a) mid-quals",
    stage: { qual: false, alliance: false, elim: false, award: false },
    startMatchKey: `${EVENT_KEY}_qm3`,
    conditionOnPlayedElims: false,
    openCategories: ["qual", "alliance", "elim", "award"],
  },
  {
    name: "(b) quals done, alliances not final",
    stage: { qual: true, alliance: false, elim: false, award: false },
    startMatchKey: null,
    conditionOnPlayedElims: false,
    openCategories: ["alliance", "elim", "award"],
  },
  {
    name: "(c) alliances announced",
    stage: { qual: true, alliance: true, elim: false, award: false },
    startMatchKey: null,
    conditionOnPlayedElims: false,
    openCategories: ["elim", "award"],
  },
  {
    name: "(d) playoffs under way",
    stage: { qual: true, alliance: true, elim: false, award: false },
    startMatchKey: null,
    conditionOnPlayedElims: true,
    openCategories: ["elim", "award"],
  },
];

const CATEGORY_INDEX = { qual: 0, alliance: 1, elim: 2, award: 3 } as const;

describe("a 20-team district event with two demo alliances prices at every stage (quick task 261007-4qr)", () => {
  for (const position of POSITIONS) {
    it(`${position.name}: builds, simulates, keeps filler out of every output, and opens the team's cells`, () => {
      const built = buildDistrictEventSimulationInput({
        eventKey: EVENT_KEY,
        season: SEASON,
        eventArtifact,
        districtArtifact,
        stage: position.stage,
        startMatchKey: position.startMatchKey,
        conditionOnPlayedElims: position.conditionOnPlayedElims,
      });
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error("unreachable");
      const input = built.input;
      expect(input.fieldSize).toBe(ROSTER.length);
      expect(input.baselines.some((baseline) => isDemoKey(baseline.teamKey))).toBe(false);
      if (position.stage.alliance) expect(input.knownAlliances).toHaveLength(8);
      if (position.conditionOnPlayedElims) {
        expect(input.playedElimMatches).toEqual([{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 }]);
      }

      const result = simulateDistrictEvent(input, 200, 20261007);
      for (const map of [result.qualPoints, result.selectionPoints, result.elimPoints, result.awardPoints, result.eventTotal, result.selectionRoutes]) {
        expect([...map.keys()].some(isDemoKey)).toBe(false);
      }

      const rows = buildDistrictLedgerRows({
        artifact: districtArtifact,
        distributions: new Map([[EVENT_KEY, distributionsFromResult(result)]]),
        stageByEvent: new Map([[EVENT_KEY, position.stage]]),
      });
      const subject = rows.teams.find((team) => team.teamKey === ROSTER[0])!;
      const row = subject.rows.find((entry) => entry.eventKey === EVENT_KEY)!;
      for (const category of position.openCategories) {
        expect(row.cells[CATEGORY_INDEX[category]]!.kind, category).toBe("open");
      }
      expect(row.eventTotal.kind).toBe("open");
      expect(subject.grandTotal.kind).toBe("open");
    });
  }
});
