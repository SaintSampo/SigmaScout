/**
 * A ROUND STOP, END TO END (quick task 261007-3g2): the `?at=<eventKey>:round:<n>`
 * id resolves to a round step on the timeline, the as-of cut lands on that
 * round's last played row, the rewound request carries exactly the played
 * playoff rows at or before the cut, and the as-of Worker job's draws respect
 * them (an alliance eliminated by the stop draws zero playoff points).
 *
 * The fixture is built here from the shared as-of fixture helpers: one finished
 * qualification schedule of 24 teams, eight alliances, and Rounds 1 and 2 of
 * the bracket played under "red always wins".
 */
import { describe, expect, it } from "vitest";
import { BRACKET_SETS, type BracketFeed } from "../../../../../packages/core/districts/bracket.js";
import type { AsOfIndex, AsOfLog, AsOfSeason, AsOfStart } from "../../../../../packages/harness/asOfState.js";
import {
  asOfIndexKey,
  asOfLogKey,
  asOfSeasonKey,
  asOfStartKey,
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type EventArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { runAsOfEvent } from "../../workers/districtAsOfJob.js";
import type { DistrictAsOfEventRequest } from "../../workers/districtSimulationProtocol.js";
import { loadAsOfRewind, type AsOfFetchers } from "./asOfRewind.js";
import { buildAsOfTestObjects, FIXTURE_SEASON, FIXTURE_VERSION, T0 } from "./asOfTestFixtures.js";
import type { DistrictStageFinality } from "./districtLedgerRows.js";
import { assembleAsOfDistrictEvents } from "./districtRunAssembly.js";
import { buildDistrictTimeline, cutAtPosition, districtStageAtPosition, resolveDistrictTimelinePosition } from "./districtTimeline.js";

const EV = "2026wabkt";
const TEAMS = Array.from({ length: 24 }, (_unused, i) => `frc${String(200 + i)}`);

/** Alliance n picks teams[(n-1)x3] to teams[(n-1)x3+2]. */
function picksOf(allianceNumber: number): string[] {
  const at = (allianceNumber - 1) * 3;
  return [TEAMS[at]!, TEAMS[at + 1]!, TEAMS[at + 2]!];
}

/** The bracket under "red always wins": feedA is red and wins, so winnerOf(X) is X's red alliance and loserOf(X) its blue one. */
function redAlwaysWinsSides(): Map<string, { red: number; blue: number }> {
  const sides = new Map<string, { red: number; blue: number }>();
  const resolve = (feed: BracketFeed): number => {
    if (feed.kind === "seed") return feed.seed;
    const set = sides.get(feed.setId)!;
    return feed.kind === "winner" ? set.red : set.blue;
  };
  for (const set of BRACKET_SETS) {
    if (set.id === "f") continue;
    sides.set(set.id, { red: resolve(set.feedA), blue: resolve(set.feedB) });
  }
  return sides;
}

const BASE_PREDICTION = {
  predictedWinner: "red" as const,
  pRedWin: 0.5,
  predictedRedScore: 50,
  predictedBlueScore: 50,
  redRpPmf: [0.25, 0.25, 0.25, 0.25],
  blueRpPmf: [0.25, 0.25, 0.25, 0.25],
};

function bracketEventArtifact(): EventArtifact {
  const qm = Array.from({ length: 8 }, (_unused, n) => ({
    ...BASE_PREDICTION,
    matchKey: `${EV}_qm${String(n + 1)}`,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: n + 1,
    sortTime: T0 + n * 600,
    redTeams: [TEAMS[(n * 6) % 24]!, TEAMS[(n * 6 + 1) % 24]!, TEAMS[(n * 6 + 2) % 24]!],
    blueTeams: [TEAMS[(n * 6 + 3) % 24]!, TEAMS[(n * 6 + 4) % 24]!, TEAMS[(n * 6 + 5) % 24]!],
    actualWinner: "red",
    actualRedScore: 60,
    actualBlueScore: 40,
    actualRedRp: 2 + (n % 2),
    actualBlueRp: n % 2,
  }));
  const sides = redAlwaysWinsSides();
  const sf = Array.from({ length: 8 }, (_unused, k) => {
    const n = k + 1;
    const { red, blue } = sides.get(`sf${String(n)}`)!;
    return {
      ...BASE_PREDICTION,
      matchKey: `${EV}_sf${String(n)}m1`,
      compLevel: "sf" as const,
      setNumber: n,
      matchNumber: 1,
      sortTime: T0 + 7200 + n * 600,
      redTeams: picksOf(red),
      blueTeams: picksOf(blue),
      actualWinner: "red",
      actualRedScore: 60,
      actualBlueScore: 40,
    };
  });
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: FIXTURE_VERSION,
    eventKey: EV,
    season: FIXTURE_SEASON,
    eventType: 1,
    week: 0,
    matches: [...qm, ...sf],
    upcoming: [],
    teams: TEAMS.map((teamKey, i) => ({ teamKey, teamNumber: 200 + i, nickname: teamKey, rank: i + 1, record: { wins: 1, losses: 1, ties: 0 }, rp: 2, metrics: {} })),
    alliances: Array.from({ length: 8 }, (_unused, k) => ({ allianceNumber: k + 1, picks: picksOf(k + 1) })),
  });
}

function bracketDistrictArtifact(): DistrictArtifact {
  const state = { qualMatchesPlayed: 8, qualMatchesTotal: 8, alliancesPicked: true, playoffsDone: false, awardsPosted: false };
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: FIXTURE_SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 6,
    cmpSlots: 2,
    teams: TEAMS.map((teamKey, i) => ({
      teamKey,
      teamNumber: 200 + i,
      nickname: teamKey,
      rank: i + 1,
      pointTotal: 0,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [],
      remainingEvents: [{ eventKey: EV, eventName: "Bunker", week: 0, tier: "district", maxPoints: 83, state }],
      maxRemainingDistrict: 83,
      maxRemainingChamp: 83,
      qualifyingAwards: [],
      awardProfile: { bucket: "none", rookie: false },
      districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
      champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
    })),
    insights: { teamCount: 24, eventCount: 1, dcmpCutLinePoints: 20, cmpCutLinePoints: 40, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
  });
}

const EVENT_ARTIFACT = bracketEventArtifact();
const ARTIFACTS = new Map([[EV, EVENT_ARTIFACT]]);
const OBJECTS = buildAsOfTestObjects({ season: FIXTURE_SEASON, version: FIXTURE_VERSION, eventArtifacts: [EVENT_ARTIFACT], extraTeams: TEAMS });
const NOW_STAGES: ReadonlyMap<string, DistrictStageFinality> = new Map([[EV, { qual: true, alliance: true, elim: false, award: false }]]);
const EVENTS = [{ eventKey: EV, eventName: "Bunker", week: 0, playoffsDone: false }];

function fetchers(): AsOfFetchers {
  const keyParams = { algorithmId: "spr", version: FIXTURE_VERSION };
  const read = <T,>(key: string): T | null => {
    const body = OBJECTS.bodies.get(key);
    return body === undefined ? null : (JSON.parse(body) as T);
  };
  return {
    index: async (eventKey) => read<AsOfIndex>(asOfIndexKey({ eventKey, ...keyParams })),
    log: async (eventKey) => read<AsOfLog>(asOfLogKey({ eventKey, ...keyParams })),
    season: async () => read<AsOfSeason>(asOfSeasonKey({ season: FIXTURE_SEASON, ...keyParams })),
    start: async () => read<AsOfStart>(asOfStartKey({ season: FIXTURE_SEASON, ...keyParams })),
  };
}

const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });

/** The one rewound request a stop id assembles, through the same steps the Locks tab takes. */
async function requestAt(atId: string): Promise<DistrictAsOfEventRequest> {
  const positionIndex = resolveDistrictTimelinePosition(timeline, atId);
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, NOW_STAGES);
  const result = await loadAsOfRewind(
    {
      districtArtifact: bracketDistrictArtifact(),
      timeline,
      positionIndex,
      eventArtifacts: ARTIFACTS,
      stageByEvent,
      candidates: [{ eventKey: EV, tier: "district", week: 0 }],
      scheduleStopEventKey: undefined,
    },
    fetchers()
  );
  const assembled = assembleAsOfDistrictEvents({
    artifact: bracketDistrictArtifact(),
    result,
    algorithmVersion: FIXTURE_VERSION,
    eventArtifacts: ARTIFACTS,
    stageByEvent,
    candidateKeys: [EV],
  });
  expect(assembled.asOfUnavailable).toEqual([]);
  expect(assembled.events).toHaveLength(1);
  const event = assembled.events[0]!;
  expect(event.asOf?.mode).toBe("real");
  return event as DistrictAsOfEventRequest;
}

const playedKeys = (event: DistrictAsOfEventRequest): string[] | undefined =>
  event.input.playedElimMatches?.map((match) => `${EV}_${match.compLevel}${String(match.setNumber)}m${String(match.matchNumber)}`);

const sfKeys = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_unused, k) => `${EV}_sf${String(from + k)}m1`);

describe("a round stop link rebuilds the bracket from the sets played by then", () => {
  it("(a) resolves round ids to round steps anchored on each round's last played set, and an unplayed round to now", () => {
    for (const [round, anchor] of [
      [1, `${EV}_sf4m1`],
      [2, `${EV}_sf8m1`],
    ] as const) {
      const index = resolveDistrictTimelinePosition(timeline, `${EV}:round:${String(round)}`);
      expect(index).not.toBe(timeline.nowIndex);
      expect(timeline.positions[index]!.step?.kind).toBe("round");
      expect(timeline.positions[index]!.step?.round).toBe(round);
      expect(cutAtPosition(timeline, index)).toEqual({ kind: "row", eventKey: EV, matchKey: anchor, played: true, stage: true });
    }
    expect(resolveDistrictTimelinePosition(timeline, `${EV}:round:3`)).toBe(timeline.nowIndex);
    expect(timeline.playoffRoundsDecided.get(EV)).toBe(2);
  });

  it("(b) the rewound request carries exactly the played playoff rows at or before the stop", async () => {
    expect(playedKeys(await requestAt(`${EV}:round:1`))).toEqual(sfKeys(1, 4));
    expect(playedKeys(await requestAt(`${EV}:round:2`))).toEqual(sfKeys(1, 8));
    expect((await requestAt(`${EV}:alliance`)).input.playedElimMatches).toBeUndefined();
  });

  it("(c) the as-of Worker job draws zero playoff points for an alliance eliminated by the stop, and not before it", async () => {
    const draws = 200;
    const seed = 20261007;
    // Alliance 5 lost sf2 to alliance 4 in Round 1, then sf5 to alliance 8 in Round 2.
    const allianceFive = picksOf(5);

    const roundTwo = runAsOfEvent(await requestAt(`${EV}:round:2`), draws, seed);
    if (roundTwo.status !== "ok") throw new Error(`expected an ok entry, got ${roundTwo.status}`);
    for (const teamKey of allianceFive) {
      const histogram = roundTwo.result.elimPoints.get(teamKey);
      expect(histogram, teamKey).toBeDefined();
      expect(histogram![0], teamKey).toBe(draws);
    }

    const roundOne = runAsOfEvent(await requestAt(`${EV}:round:1`), draws, seed);
    if (roundOne.status !== "ok") throw new Error(`expected an ok entry, got ${roundOne.status}`);
    const captain = roundOne.result.elimPoints.get(allianceFive[0]!)!;
    expect(captain[0]!).toBeLessThan(draws);
  });
});
