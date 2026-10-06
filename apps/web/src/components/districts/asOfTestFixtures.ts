/**
 * TEST ONLY: published as-of objects (quick task 261005-5g0) for a set of
 * fixture event artifacts, so a component test can rewind a Locks tab the way
 * production does. Every played match is folded through the production
 * reducer `applyAsOfFold`, in the one `(t, eventKey, i)` order, with ONE
 * constant tuple per team: the numbers are plausible rather than a replay of
 * the model (the oracle tests in `scripts/asOfOracle.test.ts` prove the
 * numbers), and they price every row and rate every team so a rewound run
 * produces distributions.
 *
 * Imported by tests only; nothing in the app reaches it.
 */
import { spr } from "../../../../../packages/core/algorithms/spr.js";
import { rpRuleModuleForSeason } from "../../../../../packages/core/rankingPoints/rules.js";
import {
  applyAsOfFold,
  asOfTupleKeys,
  createAsOfSeason,
  createAsOfStart,
  type AsOfIndex,
  type AsOfLog,
  type AsOfSeason,
  type AsOfStamp,
  type AsOfTeamTuple,
} from "../../../../../packages/harness/asOfState.js";
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
import type { DistrictStageFinality } from "./districtLedgerRows.js";

/** One team's constant tuple: an SPR part, a Sigma belief and no RP history (the RP cold prior prices it from the population). */
function tupleFor(teamKey: string): AsOfTeamTuple {
  const n = Number(teamKey.replace(/\D/g, "")) % 17;
  return [[20 + n, 40, 0, 5], [6, 0, 6, 400, 20 + n], null];
}

/** A league row with a populated Sigma and RP population, so every rookie rule and cold prior has something to read. */
function leagueFor(varCount: number): number[] {
  const init = spr.initState([]);
  const league: number[] = [init.logTau, init.scale, 40_000, 360_000, 800];
  for (let v = 0; v < varCount; v++) league.push(800, 20, 800 * 36);
  for (let v = 0; v < varCount; v++) league.push(0, 0);
  return league;
}

export interface AsOfTestObjects {
  /** Object key to JSON body, exactly what a fetch of `artifactUrl(key)` returns. */
  readonly bodies: ReadonlyMap<string, string>;
  readonly indexes: ReadonlyMap<string, AsOfIndex>;
  readonly logs: ReadonlyMap<string, AsOfLog>;
  readonly season: AsOfSeason;
}

/**
 * Folds every played row of `eventArtifacts` (qualification and playoff) in
 * `(sortTime, eventKey, row order)` order. `extraTeams` join the season start
 * object, so a roster team with no match by a cut resolves.
 */
export function buildAsOfTestObjects(params: {
  readonly season: number;
  readonly version: string;
  readonly eventArtifacts: readonly EventArtifact[];
  readonly extraTeams?: readonly string[];
}): AsOfTestObjects {
  const vars = rpRuleModuleForSeason(params.season).thresholdVariables.map((v) => v.name);
  const stamp: AsOfStamp = { generation: "gen-1", computedAt: "2026-09-25T00:00:00.000Z", algorithmId: "spr", algorithmVersion: params.version };
  const league = leagueFor(vars.length);
  const season = createAsOfSeason({ season: params.season, vars, L0: league, stamp });
  const indexes = new Map<string, AsOfIndex>();
  const logs = new Map<string, AsOfLog>();

  const folds = params.eventArtifacts.flatMap((artifact) =>
    artifact.matches.map((match, order) => ({ eventKey: artifact.eventKey, match, order, t: match.sortTime ?? 0 }))
  );
  folds.sort((a, b) => a.t - b.t || (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0) || a.order - b.order);
  const teams = new Set<string>(params.extraTeams ?? []);
  for (const fold of folds) {
    const keys = asOfTupleKeys(fold.match.redTeams, fold.match.blueTeams);
    for (const key of keys) teams.add(key);
    const result = applyAsOfFold(
      { index: indexes.get(fold.eventKey), log: logs.get(fold.eventKey), season },
      {
        eventKey: fold.eventKey,
        matchKey: fold.match.matchKey,
        t: fold.t,
        compLevel: fold.match.compLevel,
        L: league,
        teams: keys.map((teamKey) => ({ teamKey, before: tupleFor(teamKey), after: tupleFor(teamKey) })),
      },
      stamp
    );
    indexes.set(fold.eventKey, result.index);
    logs.set(fold.eventKey, result.log);
  }
  for (const artifact of params.eventArtifacts) for (const team of artifact.teams) teams.add(team.teamKey);
  const start = createAsOfStart({ season: params.season, vars, teams: new Map([...teams].map((teamKey) => [teamKey, tupleFor(teamKey)] as const)), stamp });

  const keyParams = { algorithmId: "spr", version: params.version };
  const bodies = new Map<string, string>();
  for (const [eventKey, index] of indexes) bodies.set(asOfIndexKey({ eventKey, ...keyParams }), JSON.stringify(index));
  for (const [eventKey, log] of logs) bodies.set(asOfLogKey({ eventKey, ...keyParams }), JSON.stringify(log));
  bodies.set(asOfSeasonKey({ season: params.season, ...keyParams }), JSON.stringify(season));
  bodies.set(asOfStartKey({ season: params.season, ...keyParams }), JSON.stringify(start));
  return { bodies, indexes, logs, season };
}

/** The as-of body a fetched URL names, or `undefined` when the URL is not an as-of object or the fixture holds none (a 404). */
export function asOfBodyFor(objects: AsOfTestObjects | undefined, url: string): string | undefined {
  if (objects === undefined) return undefined;
  for (const [key, body] of objects.bodies) if (url.endsWith(key)) return body;
  return undefined;
}

// ---------------------------------------------------------------------------
// A small three event district with its as-of objects, for the planner and the
// assembly tests: 2026waaa finished (week 0), 2026wabbb four of eight played
// (week 1), 2026wazzz unstarted with no artifact (week 2).
// ---------------------------------------------------------------------------

export const FIXTURE_SEASON = 2026;
export const FIXTURE_VERSION = "9.0.0+rolling";
export const TEAMS = Array.from({ length: 12 }, (_unused, i) => `frc${String(100 + i)}`);
export const T0 = 1_772_000_000; // epoch seconds

/** Six team alliances cycling through `teams`, row `n` at `t0 + n * 600`. */
function rows(eventKey: string, teams: readonly string[], count: number, t0: number) {
  return Array.from({ length: count }, (_unused, n) => ({
    matchKey: `${eventKey}_qm${String(n + 1)}`,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: n + 1,
    sortTime: t0 + n * 600,
    redTeams: [teams[(n * 6) % teams.length]!, teams[(n * 6 + 1) % teams.length]!, teams[(n * 6 + 2) % teams.length]!],
    blueTeams: [teams[(n * 6 + 3) % teams.length]!, teams[(n * 6 + 4) % teams.length]!, teams[(n * 6 + 5) % teams.length]!],
    predictedWinner: "red" as const,
    pRedWin: 0.5,
    predictedRedScore: 50,
    predictedBlueScore: 50,
    redRpPmf: [0.25, 0.25, 0.25, 0.25],
    blueRpPmf: [0.25, 0.25, 0.25, 0.25],
  }));
}

export function eventArtifact(eventKey: string, t0: number, played: number, total: number, playoffAt?: number): EventArtifact {
  const all = rows(eventKey, TEAMS, total, t0);
  const playedRows = all.slice(0, played).map((row, n) => ({ ...row, actualWinner: "red", actualRedScore: 60, actualBlueScore: 40, actualRedRp: 2 + (n % 2), actualBlueRp: n % 2 }));
  const playoff =
    playoffAt === undefined
      ? []
      : [{ ...all[0]!, matchKey: `${eventKey}_f1m1`, compLevel: "f", sortTime: playoffAt, actualWinner: "red", actualRedScore: 60, actualBlueScore: 40 }];
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: FIXTURE_VERSION,
    eventKey,
    season: FIXTURE_SEASON,
    eventType: 1,
    week: 0,
    matches: [...playedRows, ...playoff],
    upcoming: all.slice(played),
    teams: TEAMS.map((teamKey, i) => ({ teamKey, teamNumber: 100 + i, nickname: teamKey, rank: i + 1, record: { wins: 3, losses: 3, ties: 0 }, rp: 2, metrics: {} })),
  });
}

/** `2026waaa` finished (week 0), `2026wabbb` four of eight played (week 1), `2026wazzz` unstarted (week 2, no artifact). */
export const AAA = eventArtifact("2026waaa", T0, 6, 6, T0 + 3_600 * 2);
export const BBB = eventArtifact("2026wabbb", T0 + 7 * 86_400, 4, 8);

export function districtArtifact(): DistrictArtifact {
  const state = (played: number, total: number, done: boolean) => ({ qualMatchesPlayed: played, qualMatchesTotal: total, alliancesPicked: done, playoffsDone: done, awardsPosted: done });
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
      teamNumber: 100 + i,
      nickname: teamKey,
      rank: i + 1,
      pointTotal: 20,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [{ eventKey: "2026waaa", eventName: "A", week: 0, tier: "district", qual: 10, alliance: 5, elim: 5, award: 0, total: 20, state: state(6, 6, true) }],
      remainingEvents: [
        { eventKey: "2026wabbb", eventName: "B", week: 1, tier: "district", maxPoints: 83, state: state(4, 8, false) },
        ...(i < 8 ? [{ eventKey: "2026wazzz", eventName: "Z", week: 2, tier: "district", maxPoints: 83, state: state(0, 0, false) }] : []),
      ],
      maxRemainingDistrict: 83,
      maxRemainingChamp: 83,
      qualifyingAwards: [],
      awardProfile: { bucket: "none", rookie: false },
      districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
      champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
    })),
    insights: { teamCount: 12, eventCount: 3, dcmpCutLinePoints: 20, cmpCutLinePoints: 40, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
  });
}

export const EVENTS = [
  { eventKey: "2026waaa", eventName: "A", week: 0, playoffsDone: true },
  { eventKey: "2026wabbb", eventName: "B", week: 1, playoffsDone: false },
  { eventKey: "2026wazzz", eventName: "Z", week: 2, playoffsDone: false },
];
export const ARTIFACTS = new Map([
  ["2026waaa", AAA],
  ["2026wabbb", BBB],
]);
export const OBJECTS = buildAsOfTestObjects({ season: FIXTURE_SEASON, version: FIXTURE_VERSION, eventArtifacts: [AAA, BBB], extraTeams: TEAMS });
export const NOW_STAGES: ReadonlyMap<string, DistrictStageFinality> = new Map([
  ["2026waaa", { qual: true, alliance: true, elim: true, award: true }],
  ["2026wabbb", { qual: false, alliance: false, elim: false, award: false }],
  ["2026wazzz", { qual: false, alliance: false, elim: false, award: false }],
]);
export const CANDIDATES = EVENTS.map((event) => ({ eventKey: event.eventKey, tier: "district" as const, week: event.week }));
