/**
 * THE GATE for the Champ Locks joint worst case lock proof (quick task
 * 261009-2tr, CONTEXT D4).
 *
 *   "It is mission critical that no team is told they are locked at any stop,
 *   and then later they are not locked."                    (Jacob, 2026-10-08)
 *
 * TENET A: a team the Champ Locks tab shows `Locked` on points at ANY stop of a
 * District Championship must be `locked` or `lockedAward` in the district
 * artifact's own published `champLock.status` at Now. Any other outcome is a
 * violation, and the run exits 1.
 *
 * THE STOPS, per single event District Championship of 2023 to 2026: Alliances
 * final, after Round 1 to Round 5, Playoffs final with the awards open, and
 * Now. Each is computed with the tab's OWN functions, exactly as
 * `ChampLocksLedger` computes them (`champTierEvents`, `buildDistrictTimeline`,
 * the district pass for the locked out set, `buildChampLedgerRows`,
 * `computeChampLedgerStatuses`), with distributions that carry the bracket
 * facts and nothing else: the milestones (`dcmpBracketMilestonesByTeam`) in
 * both runs, so the SHIPPED run is the tab as it renders today, and the joint
 * proof's `dcmpBracket` (`dcmpBracketFactsFor`) in the combined run only. No
 * Monte Carlo runs.
 *
 * THE YARDSTICK is the artifact's own published `champLock.status` at Now: the
 * all tier standing with every event final.
 *
 * SOURCES: `data/local-publish/districts` for the district artifacts, and
 * `data/corpus.sqlite`, opened READ ONLY, for each championship's alliances
 * (`event_alliances.picks`) and played playoff rows (`matches`, sf and f). No
 * network, no credential. When the corpus is absent the script prints that it
 * skipped and exits 0.
 *
 * EVERY CHAMPIONSHIP SHAPE (quick task 261009-kt3, CONTEXT D6). A DIVISIONED
 * championship (FIM, NE, ON, TX) is swept with every division advancing
 * together: Alliances final, Round 1 to 5 (a round with no played row in any
 * division has no stop), Divisions final with the finals not started, at four
 * divisions the finals after sf1 and sf2, after sf3 and sf4 and after sf5,
 * then the finals decided with the awards open, and Now. A district with TWO
 * CHAMPIONSHIPS (2026 California) advances both through the single event
 * stops. Each such stop passes an explicit stage per dcmp key (district events
 * at their Now stage), and the facts carry each key's role. At every
 * divisioned stop the D3 assertion holds: no team carries an open category of
 * ANY of its dcmp rows, division or finals, in its floor (a settled division
 * Playoffs value excepted) (`floorGap`). With the shipped single source fold
 * it reports 1,308 gaps; with every source folded, none. The skipped
 * list may hold only `no capacity`, `no District Championship` and
 * `unsupportedShape`, and the last must be empty for 2023 to 2026.
 *
 * Exit code 1 on any tenet A violation, any team the shipped run locks that
 * the combined run does not, or any floor gap.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DistrictArtifactSchema, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import { bracketRoundOfSet, bracketSetIdFor } from "../packages/core/districts/bracket.js";
import { championshipShape, finalsSetIdFor } from "../packages/core/districts/finalsBracket.js";
import { openCorpusReadOnly, selectEventAlliancesForSeason, selectMatchesChronological, type Corpus } from "../packages/corpus/db.js";
import {
  buildDistrictLedgerRows,
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  deriveStageFromState,
  playedBracketMatchesFor,
  tierEvents,
  type BracketSourceEvent,
  type DistrictEventDistributions,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import {
  buildDistrictTimeline,
  districtStageAtPosition,
  eventStartedAtPosition,
  type DistrictTimeline,
} from "../apps/web/src/components/districts/districtTimeline.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildChampLedgerRows, champTierEvents, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses, jointProofBound, type ChampLedgerStatusModel } from "../apps/web/src/components/districts/champLedgerStatus.js";

export const LOCAL_DISTRICT_DIR = "data/local-publish/districts";
export const CORPUS_PATH = "data/corpus.sqlite";
const DISTRICT_DETAIL_FILE = /^v1__district__(\d{4})[a-z0-9]+\.json$/;
const SWEPT_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];
const NO_EVENT_ARTIFACTS: ReadonlyMap<string, EventArtifact> = new Map();
const AWARD_TYPE_WINNER = 1;

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

/** What every stop of one championship shares: the tab's own timeline and its Now memos. */
export interface ChampJointContext {
  readonly dcmpKey: string;
  readonly dcmpEventKeys: readonly string[];
  readonly timeline: DistrictTimeline;
  readonly nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly startedDcmpKeysNow: ReadonlySet<string>;
}

export interface ChampJointStop {
  readonly label: string;
  /** The timeline position whose stage the stop reads. */
  readonly index: number;
  /** The played playoff rows the stop reads, by match key. */
  readonly playedKeys: ReadonlySet<string>;
  readonly context: ChampJointContext;
}

/**
 * The stops of CONTEXT D4 for one single event championship. Built from
 * `champTierEvents` and `buildDistrictTimeline` with no event artifacts, as
 * `measureChampTenets.ts` builds them, so the round stops read the DCMP's
 * Alliance selection stage (Playoffs and Awards open) with the played rows of
 * Rounds 1 to r. A round with no played row has no stop.
 */
export function dcmpStops(artifact: DistrictArtifact, bracket: BracketSourceEvent): ChampJointStop[] {
  const dcmpEventKeys = dcmpEventKeysFor(artifact);
  const dcmpKey = dcmpEventKeys[0];
  if (dcmpKey === undefined) return [];
  const nowStageByEvent = new Map<string, DistrictStageFinality>();
  const startedKeys = new Set<string>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        const stage = deriveStageFromState(entry.state);
        if (!nowStageByEvent.has(entry.eventKey)) nowStageByEvent.set(entry.eventKey, stage.final);
        if (stage.started) startedKeys.add(entry.eventKey);
      }
    }
  }
  const timeline = buildDistrictTimeline({ events: champTierEvents(artifact), eventArtifacts: NO_EVENT_ARTIFACTS });
  const context: ChampJointContext = {
    dcmpKey,
    dcmpEventKeys,
    timeline,
    nowStageByEvent,
    startedDcmpKeysNow: new Set(dcmpEventKeys.filter((key) => startedKeys.has(key))),
  };

  const playoffRows = bracket.matches.filter((match) => match.compLevel === "sf" || match.compLevel === "f");
  const allKeys = new Set(playoffRows.filter((match) => match.actualWinner !== undefined).map((match) => match.matchKey));
  const roundOf = (match: (typeof playoffRows)[number]): number | undefined => {
    const setId = bracketSetIdFor(match.compLevel, match.setNumber);
    return setId === undefined ? undefined : bracketRoundOfSet(setId);
  };

  const stops: ChampJointStop[] = [];
  const allianceIndex = timeline.positions.findIndex((position) => position.step?.kind === "alliance" && position.step.eventKey === dcmpKey);
  if (allianceIndex >= 0) {
    stops.push({ label: "Alliances final", index: allianceIndex, playedKeys: new Set(), context });
    for (let round = 1; round <= 5; round++) {
      const rows = playoffRows.filter((match) => match.actualWinner !== undefined && (roundOf(match) ?? Infinity) <= round);
      if (!playoffRows.some((match) => match.actualWinner !== undefined && roundOf(match) === round)) continue;
      stops.push({ label: `Round ${String(round)}`, index: allianceIndex, playedKeys: new Set(rows.map((match) => match.matchKey)), context });
    }
  }
  const playoffsIndex = timeline.positions.findIndex((position) => position.step?.kind === "playoffs" && position.step.eventKey === dcmpKey);
  if (playoffsIndex >= 0) stops.push({ label: "Playoffs final, awards open", index: playoffsIndex, playedKeys: allKeys, context });
  stops.push({ label: "Now", index: timeline.nowIndex, playedKeys: allKeys, context });
  return stops;
}

/**
 * The tab's statuses at one stop. The district pass gives the locked out set,
 * the played rows give the bracket facts and the milestones, and the champ
 * rows and statuses are built by the tab's own functions. `withJoint` adds the
 * `dcmpBracket` facts, which is the only thing the joint proof reads.
 */
export function statusesAtStop(artifact: DistrictArtifact, stop: ChampJointStop, bracket: BracketSourceEvent, withJoint: boolean): ChampLedgerStatusModel {
  const { context, index } = stop;
  const { timeline, dcmpKey } = context;
  const atNow = index >= timeline.nowIndex;
  const stageByEvent = districtStageAtPosition(timeline, index, context.nowStageByEvent);

  const districtRows = buildDistrictLedgerRows({ artifact, distributions: new Map(), stageByEvent: atNow ? undefined : stageByEvent, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);

  const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
  const played = playedBracketMatchesFor(bracket, stop.playedKeys);
  const stage = atNow ? context.nowStageByEvent.get(dcmpKey) : stageByEvent.get(dcmpKey);
  const facts = dcmpBracketFactsFor({
    eventKey: dcmpKey,
    season: artifact.year,
    tier: "dcmp",
    stage,
    alliances,
    playedMatches: played.matches,
    unresolvedMatchCount: played.unresolvedMatchKeys.length,
    fieldBackups: played.fieldBackups,
  });
  const entry: DistrictEventDistributions = {
    eventKey: dcmpKey,
    byTeam: new Map(),
    playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches),
    ...(withJoint && facts !== undefined ? { dcmpBracket: facts } : {}),
  };
  const distributions: ReadonlyMap<string, DistrictEventDistributions> = new Map([[dcmpKey, entry]]);

  const startedDcmpEventKeys = atNow
    ? context.startedDcmpKeysNow
    : new Set(context.dcmpEventKeys.filter((key) => eventStartedAtPosition(timeline, index, key)));
  const rows = buildChampLedgerRows({
    artifact,
    distributions,
    ...(atNow ? {} : { stageByEvent }),
    startedDcmpEventKeys,
    atLivePosition: atNow,
  });
  return computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut, distributions });
}

// ---------------------------------------------------------------------------
// Stops of a divisioned championship and of two championships (261009-kt3)
// ---------------------------------------------------------------------------

/** One stop over several dcmp keys: each key's stage and played rows at the stop, stated explicitly. */
export interface ChampionshipStop {
  readonly label: string;
  readonly atNow: boolean;
  /** Every dcmp key's stage at the stop (ignored at Now, which reads the artifact's own states). */
  readonly stageByKey: ReadonlyMap<string, DistrictStageFinality>;
  /** Every dcmp key's played playoff rows at the stop, by match key. */
  readonly playedKeysByKey: ReadonlyMap<string, ReadonlySet<string>>;
  /** The dcmp keys started at the stop. */
  readonly startedKeys: ReadonlySet<string>;
}

const ALL_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };
const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const ALLIANCES_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
const PLAYOFFS_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };

/** The Now stage of every event on the artifact, and the dcmp keys started at Now. */
function nowStages(artifact: DistrictArtifact): { stageByEvent: Map<string, DistrictStageFinality>; started: Set<string> } {
  const stageByEvent = new Map<string, DistrictStageFinality>();
  const started = new Set<string>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        const stage = deriveStageFromState(entry.state);
        if (!stageByEvent.has(entry.eventKey)) stageByEvent.set(entry.eventKey, stage.final);
        if (stage.started) started.add(entry.eventKey);
      }
    }
  }
  return { stageByEvent, started };
}

type PlayoffRow = BracketSourceEvent["matches"][number];
const playedPlayoffRows = (bracket: BracketSourceEvent | undefined): PlayoffRow[] =>
  (bracket?.matches ?? []).filter((match) => (match.compLevel === "sf" || match.compLevel === "f") && match.actualWinner !== undefined);
const divisionRoundOf = (match: PlayoffRow): number => {
  const setId = bracketSetIdFor(match.compLevel, match.setNumber);
  return setId === undefined ? Infinity : (bracketRoundOfSet(setId) ?? Infinity);
};
const keysOf = (rows: readonly PlayoffRow[]): Set<string> => new Set(rows.map((match) => match.matchKey));

/**
 * The D6 stops of a DIVISIONED championship (every division advances
 * together): Alliances final, Round 1 to 5 (a round with no played row in any
 * division has no stop), Divisions final with the finals not started, at four
 * divisions the finals after sf1 and sf2, after sf3 and sf4 and after sf5, then
 * the finals decided with the awards open, and Now. Or, for TWO CHAMPIONSHIPS,
 * Alliances final, Round 1 to 5 and Playoffs final with the awards open, both
 * championships together, and Now.
 */
export function championshipStops(artifact: DistrictArtifact, brackets: ReadonlyMap<string, BracketSourceEvent>): ChampionshipStop[] {
  const shape = championshipShape(dcmpEventKeysFor(artifact));
  if (shape.kind !== "divisioned" && shape.kind !== "multiple") return [];
  const now = nowStages(artifact);
  const playedKeys = shape.kind === "divisioned" ? shape.divisionKeys : shape.keys;
  const finalsKey = shape.kind === "divisioned" ? shape.finalsKey : undefined;
  const stops: ChampionshipStop[] = [];
  const stop = (label: string, playedStage: DistrictStageFinality, rounds: number, finalsStage: DistrictStageFinality, finalsRows: Set<string>, finalsStarted: boolean): void => {
    const stageByKey = new Map<string, DistrictStageFinality>();
    const playedKeysByKey = new Map<string, ReadonlySet<string>>();
    for (const key of playedKeys) {
      stageByKey.set(key, playedStage);
      playedKeysByKey.set(key, keysOf(playedPlayoffRows(brackets.get(key)).filter((match) => divisionRoundOf(match) <= rounds)));
    }
    if (finalsKey !== undefined) {
      stageByKey.set(finalsKey, finalsStage);
      playedKeysByKey.set(finalsKey, finalsRows);
    }
    stops.push({ label, atNow: false, stageByKey, playedKeysByKey, startedKeys: new Set([...playedKeys, ...(finalsStarted && finalsKey !== undefined ? [finalsKey] : [])]) });
  };

  stop("Alliances final", ALLIANCES_FINAL, 0, ALL_OPEN, new Set(), false);
  for (let round = 1; round <= 5; round++) {
    if (!playedKeys.some((key) => playedPlayoffRows(brackets.get(key)).some((match) => divisionRoundOf(match) === round))) continue;
    stop(`Round ${String(round)}`, ALLIANCES_FINAL, round, ALL_OPEN, new Set(), false);
  }
  if (shape.kind === "multiple") {
    stop("Playoffs final, awards open", PLAYOFFS_FINAL, Infinity, ALL_OPEN, new Set(), false);
  } else {
    stop("Divisions final, finals not started", ALL_FINAL, Infinity, ALL_OPEN, new Set(), false);
    const divisionCount = shape.divisionKeys.length;
    const finalsRows = playedPlayoffRows(brackets.get(shape.finalsKey));
    const finalsSetOf = (match: PlayoffRow): string | undefined => finalsSetIdFor(match.compLevel, match.setNumber, divisionCount);
    if (divisionCount === 4) {
      for (const [label, sets] of [
        ["Finals after sf1 and sf2", ["sf1", "sf2"]],
        ["Finals after sf3 and sf4", ["sf1", "sf2", "sf3", "sf4"]],
        ["Finals after sf5", ["sf1", "sf2", "sf3", "sf4", "sf5"]],
      ] as const) {
        const rows = finalsRows.filter((match) => (sets as readonly string[]).includes(finalsSetOf(match) ?? ""));
        stop(label, ALL_FINAL, Infinity, ALLIANCES_FINAL, keysOf(rows), true);
      }
    }
    stop("Finals decided, awards open", ALL_FINAL, Infinity, PLAYOFFS_FINAL, keysOf(finalsRows), true);
  }
  stops.push({
    label: "Now",
    atNow: true,
    stageByKey: new Map(),
    playedKeysByKey: new Map([...playedKeys, ...(finalsKey === undefined ? [] : [finalsKey])].map((key) => [key, keysOf(playedPlayoffRows(brackets.get(key)))] as const)),
    startedKeys: new Set(dcmpEventKeysFor(artifact).filter((key) => now.started.has(key))),
  });
  return stops;
}

/**
 * The tab's statuses at one stop over several dcmp keys, built exactly as
 * `statusesAtStop` builds a single championship's: the district pass for the
 * locked out set, then the champ rows and statuses, with distributions that
 * carry each key's milestones (both runs; none for a finals key, which has no
 * eight alliance bracket) and, in the combined run only, each key's facts with
 * its role (`division`, `finals` with as many alliances as divisions, or
 * `championship`).
 */
export function statusesAtChampionshipStop(
  artifact: DistrictArtifact,
  stop: ChampionshipStop,
  brackets: ReadonlyMap<string, BracketSourceEvent>,
  withJoint: boolean
): ChampLedgerStatusModel {
  const shape = championshipShape(dcmpEventKeysFor(artifact));
  const now = nowStages(artifact);
  const stageByEvent = new Map(now.stageByEvent);
  if (!stop.atNow) for (const [key, stage] of stop.stageByKey) stageByEvent.set(key, stage);

  const districtRows = buildDistrictLedgerRows({ artifact, distributions: new Map(), stageByEvent: stop.atNow ? undefined : stageByEvent, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);

  const distributions = new Map<string, DistrictEventDistributions>();
  for (const [key, playedKeys] of stop.playedKeysByKey) {
    const bracket = brackets.get(key);
    if (bracket === undefined) continue;
    const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
    const played = playedBracketMatchesFor(bracket, playedKeys);
    const isFinals = shape.kind === "divisioned" && key === shape.finalsKey;
    const role = shape.kind === "divisioned" ? (isFinals ? "finals" : "division") : "championship";
    const facts = dcmpBracketFactsFor({
      eventKey: key,
      season: artifact.year,
      tier: "dcmp",
      stage: stageByEvent.get(key),
      alliances,
      playedMatches: played.matches,
      unresolvedMatchCount: played.unresolvedMatchKeys.length,
      fieldBackups: played.fieldBackups,
      role,
      ...(isFinals && shape.kind === "divisioned" ? { expectedAllianceCount: shape.divisionKeys.length } : {}),
    });
    distributions.set(key, {
      eventKey: key,
      byTeam: new Map(),
      ...(isFinals ? {} : { playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches) }),
      ...(withJoint && facts !== undefined ? { dcmpBracket: facts } : {}),
    });
  }

  const rows = buildChampLedgerRows({
    artifact,
    distributions,
    ...(stop.atNow ? {} : { stageByEvent }),
    startedDcmpEventKeys: stop.startedKeys,
    atLivePosition: stop.atNow,
  });
  return computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut, distributions });
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface JointStopRecord {
  readonly label: string;
  readonly pointsSlots: number;
  /** `applied`, or the reason the proof did not run. */
  readonly joint: string;
  readonly shippedLocked: number;
  readonly jointOnly: number;
  readonly combinedLocked: number;
  readonly violations: number;
}

export interface JointViolation {
  readonly kind: "tenetA" | "shippedLostLock" | "floorGap";
  readonly districtKey: string;
  readonly stop: string;
  readonly teamKey: string;
  readonly pointsSlots: number;
  readonly bound: number | null;
  readonly finalStatus: LockStatus;
  /** For a floorGap: the floor shown, and the most it may be. */
  readonly detail?: string;
}

export interface JointFirstLock {
  readonly districtKey: string;
  readonly teamKey: string;
  readonly before: string;
  readonly after: string;
}

export type SweptShape = "single" | "divisioned" | "multiple";

export interface JointSweep {
  readonly districtKey: string;
  readonly shape: SweptShape;
  readonly dcmpKey: string;
  readonly stops: readonly JointStopRecord[];
  readonly violations: readonly JointViolation[];
  readonly earlier: readonly JointFirstLock[];
  readonly qualifiers: number;
}

const lockedOnPoints = (model: ChampLedgerStatusModel): string[] =>
  [...model.byTeam.values()].filter((result) => result.status === "locked" && !result.byAward).map((result) => result.teamKey);

/** One stop of any shape, as the sweep reads it. */
interface SweepStop {
  readonly label: string;
  readonly compute: (withJoint: boolean) => ChampLedgerStatusModel;
  /**
   * The D3 floor assertion's facts (divisioned only): every dcmp key's stage at
   * the stop, and per key the teams whose Playoffs are settled there (a decided
   * placement, whose exact value may rejoin the floor).
   */
  readonly d3?: { readonly stageByKey: ReadonlyMap<string, DistrictStageFinality>; readonly settledByKey: ReadonlyMap<string, ReadonlySet<string>> };
}

function sweepStops(artifact: DistrictArtifact, shape: SweptShape, dcmpKey: string, stops: readonly SweepStop[]): JointSweep {
  const finalStatus = new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const));
  const records: JointStopRecord[] = [];
  const violations: JointViolation[] = [];
  const firstBefore = new Map<string, number>();
  const firstAfter = new Map<string, number>();

  stops.forEach((stop, stopIndex) => {
    const shipped = stop.compute(false);
    const combined = stop.compute(true);
    const shippedKeys = new Set(lockedOnPoints(shipped));
    const combinedKeys = lockedOnPoints(combined);
    let stopViolations = 0;

    for (const teamKey of combinedKeys) {
      const status = finalStatus.get(teamKey) ?? "unknown";
      if (status === "locked" || status === "lockedAward") continue;
      stopViolations += 1;
      violations.push({
        kind: "tenetA",
        districtKey: artifact.districtKey,
        stop: stop.label,
        teamKey,
        pointsSlots: combined.pointsSlots,
        bound: combined.jointProof === undefined ? null : jointProofBound(combined.jointProof, teamKey),
        finalStatus: status,
      });
    }
    for (const teamKey of shippedKeys) {
      if (combinedKeys.includes(teamKey)) continue;
      stopViolations += 1;
      violations.push({ kind: "shippedLostLock", districtKey: artifact.districtKey, stop: stop.label, teamKey, pointsSlots: combined.pointsSlots, bound: null, finalStatus: finalStatus.get(teamKey) ?? "unknown" });
    }
    // D3: no team carries an open category of ANY of its dcmp rows (division
    // and finals alike) in its floor; a settled division Playoffs value is the
    // one category that may rejoin it.
    if (stop.d3 !== undefined) {
      const d3 = stop.d3;
      for (const team of artifact.teams) {
        const rows = team.eventPoints.filter((entry) => d3.stageByKey.has(entry.eventKey));
        if (rows.length === 0) continue;
        let most = team.pointTotal;
        for (const row of rows) {
          const stage = d3.stageByKey.get(row.eventKey)!;
          for (const category of ["qual", "alliance", "elim", "award"] as const) {
            if (stage[category]) continue;
            if (category === "elim" && d3.settledByKey.get(row.eventKey)?.has(team.teamKey) === true) continue;
            most -= row[category];
          }
        }
        for (const model of [shipped, combined]) {
          const floor = model.floorByTeam?.get(team.teamKey);
          if (floor === undefined || floor <= most) continue;
          stopViolations += 1;
          violations.push({
            kind: "floorGap",
            districtKey: artifact.districtKey,
            stop: stop.label,
            teamKey: team.teamKey,
            pointsSlots: model.pointsSlots,
            bound: null,
            finalStatus: finalStatus.get(team.teamKey) ?? "unknown",
            detail: `floor ${String(floor)} above ${String(most)}`,
          });
        }
      }
    }

    for (const [teamKey, result] of shipped.byTeam) if (result.status === "locked" && !firstBefore.has(teamKey)) firstBefore.set(teamKey, stopIndex);
    for (const [teamKey, result] of combined.byTeam) if (result.status === "locked" && !firstAfter.has(teamKey)) firstAfter.set(teamKey, stopIndex);

    records.push({
      label: stop.label,
      pointsSlots: combined.pointsSlots,
      joint: combined.jointProof === undefined ? "absent" : combined.jointProof.applied ? "applied" : combined.jointProof.reason,
      shippedLocked: shippedKeys.size,
      jointOnly: [...combined.byTeam.values()].filter((result) => result.lockedBy === "joint").length,
      combinedLocked: combinedKeys.length,
      violations: stopViolations,
    });
  });

  const qualifiers = artifact.teams.filter((team) => team.champLock.status === "locked" || team.champLock.status === "lockedAward");
  const earlier: JointFirstLock[] = [];
  for (const team of qualifiers) {
    const before = firstBefore.get(team.teamKey);
    const after = firstAfter.get(team.teamKey);
    if (after === undefined) continue;
    if (before !== undefined && before <= after) continue;
    earlier.push({ districtKey: artifact.districtKey, teamKey: team.teamKey, before: before === undefined ? "never" : stops[before]!.label, after: stops[after]!.label });
  }
  return { districtKey: artifact.districtKey, shape, dcmpKey, stops: records, violations, earlier, qualifiers: qualifiers.length };
}

/** Every dcmp key's stage at a stop, and per division key the teams on an alliance its played rows have placed. */
function d3Facts(
  artifact: DistrictArtifact,
  stop: ChampionshipStop,
  brackets: ReadonlyMap<string, BracketSourceEvent>,
  keys: readonly string[],
  divisionKeys: readonly string[]
): { stageByKey: Map<string, DistrictStageFinality>; settledByKey: Map<string, Set<string>> } {
  const now = nowStages(artifact).stageByEvent;
  const stageByKey = new Map(keys.map((key) => [key, (stop.atNow ? now.get(key) : stop.stageByKey.get(key)) ?? ALL_OPEN] as const));
  const settledByKey = new Map<string, Set<string>>();
  for (const key of divisionKeys) {
    const bracket = brackets.get(key);
    const settled = new Set<string>();
    if (bracket !== undefined) {
      const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
      const played = playedBracketMatchesFor(bracket, stop.playedKeysByKey.get(key) ?? new Set());
      for (const [teamKey, milestone] of dcmpBracketMilestonesByTeam(alliances, played.matches)) if (milestone.kind === "decided") settled.add(teamKey);
    }
    settledByKey.set(key, settled);
  }
  return { stageByKey, settledByKey };
}

/** The single event sweep, exactly as shipped (261009-2tr). */
export function sweepJoint(artifact: DistrictArtifact, bracket: BracketSourceEvent): JointSweep {
  const stops = dcmpStops(artifact, bracket);
  return sweepStops(
    artifact,
    "single",
    stops[0]?.context.dcmpKey ?? "",
    stops.map((stop) => ({ label: stop.label, compute: (withJoint: boolean) => statusesAtStop(artifact, stop, bracket, withJoint) }))
  );
}

/** The sweep of a divisioned championship or of two championships, with the D3 floor assertion at every divisioned stop. */
export function sweepChampionship(artifact: DistrictArtifact, brackets: ReadonlyMap<string, BracketSourceEvent>): JointSweep {
  const shape = championshipShape(dcmpEventKeysFor(artifact));
  if (shape.kind !== "divisioned" && shape.kind !== "multiple") throw new Error(`sweepChampionship: ${artifact.districtKey} is ${shape.kind}`);
  const stops = championshipStops(artifact, brackets);
  return sweepStops(
    artifact,
    shape.kind,
    shape.kind === "divisioned" ? shape.finalsKey : shape.keys.join("+"),
    stops.map((stop) => ({
      label: stop.label,
      compute: (withJoint: boolean) => statusesAtChampionshipStop(artifact, stop, brackets, withJoint),
      ...(shape.kind === "divisioned" ? { d3: d3Facts(artifact, stop, brackets, [...shape.divisionKeys, shape.finalsKey], shape.divisionKeys) } : {}),
    }))
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface SkippedDistrict {
  readonly districtKey: string;
  readonly reason: string;
}

export interface LoadedJointDistricts {
  readonly kept: DistrictArtifact[];
  readonly skipped: SkippedDistrict[];
}

/** The 2023 to 2026 district artifacts the proof can run on, of every championship shape, and every other one with its reason. */
export function loadJointDistricts(dir: string = LOCAL_DISTRICT_DIR): LoadedJointDistricts {
  const kept: DistrictArtifact[] = [];
  const skipped: SkippedDistrict[] = [];
  for (const file of readdirSync(dir).sort()) {
    const match = DISTRICT_DETAIL_FILE.exec(file);
    if (match === null || !SWEPT_SEASONS.includes(Number(match[1]))) continue;
    const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    const keys = dcmpEventKeysFor(artifact);
    const shape = championshipShape(keys);
    const winnerKeys = shape.kind === "single" ? [shape.key] : shape.kind === "divisioned" ? [shape.finalsKey] : shape.kind === "multiple" ? shape.keys : [];
    const winnerPostedAt = (key: string): boolean => artifact.teams.some((team) => team.qualifyingAwards.some((award) => award.awardType === AWARD_TYPE_WINNER && award.eventKey === key));
    if (artifact.cmpSlots === null) skipped.push({ districtKey: artifact.districtKey, reason: "no capacity (cmpSlots null)" });
    else if (shape.kind === "none") skipped.push({ districtKey: artifact.districtKey, reason: "no District Championship on the artifact" });
    else if (shape.kind === "unsupported") skipped.push({ districtKey: artifact.districtKey, reason: `unsupportedShape: ${shape.detail}` });
    else if (!winnerKeys.every(winnerPostedAt)) skipped.push({ districtKey: artifact.districtKey, reason: "winner award not posted" });
    else kept.push(artifact);
  }
  return { kept, skipped };
}

/** One championship's alliances and played playoff rows from the corpus, as the structural event `playedBracketMatchesFor` reads. */
export function bracketFromCorpus(db: Corpus, alliancesBySeason: Map<number, ReturnType<typeof selectEventAlliancesForSeason>>, season: number, eventKey: string): BracketSourceEvent | undefined {
  let bySeason = alliancesBySeason.get(season);
  if (bySeason === undefined) {
    bySeason = selectEventAlliancesForSeason(db, season);
    alliancesBySeason.set(season, bySeason);
  }
  const alliances = bySeason.get(eventKey);
  if (alliances === undefined || alliances.length === 0) return undefined;
  const matches = selectMatchesChronological(db, { eventKey })
    .filter((match) => match.compLevel === "sf" || match.compLevel === "f")
    .map((match) => ({
      matchKey: match.matchKey,
      compLevel: match.compLevel,
      setNumber: match.setNumber,
      matchNumber: match.matchNumber,
      redTeams: match.redTeams,
      blueTeams: match.blueTeams,
      actualWinner: match.winner,
    }));
  return { alliances: alliances.map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] })), matches };
}

/** Every dcmp key's corpus bracket for one artifact, or the first key the corpus lacks. */
export function bracketsFromCorpus(
  db: Corpus,
  alliancesBySeason: Map<number, ReturnType<typeof selectEventAlliancesForSeason>>,
  artifact: DistrictArtifact
): { brackets: Map<string, BracketSourceEvent> } | { missing: string } {
  const brackets = new Map<string, BracketSourceEvent>();
  for (const key of dcmpEventKeysFor(artifact)) {
    const bracket = bracketFromCorpus(db, alliancesBySeason, artifact.year, key);
    if (bracket === undefined) return { missing: key };
    brackets.set(key, bracket);
  }
  return { brackets };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function reportSweep(sweep: JointSweep): void {
  console.log(``);
  console.log(`${sweep.districtKey} (${sweep.shape}, ${sweep.dcmpKey}), ${String(sweep.qualifiers)} eventual qualifiers`);
  console.log(`  ${"stop".padEnd(36)} ${pad("S'", 3)} ${"joint".padEnd(18)} ${pad("shipped", 7)} ${pad("joint only", 10)} ${pad("combined", 8)} ${pad("viol", 4)}`);
  for (const stop of sweep.stops) {
    console.log(
      `  ${stop.label.padEnd(36)} ${pad(stop.pointsSlots, 3)} ${stop.joint.padEnd(18)} ${pad(stop.shippedLocked, 7)} ${pad(stop.jointOnly, 10)} ${pad(stop.combinedLocked, 8)} ${pad(stop.violations, 4)}`
    );
  }
}

/** One shape's totals line set. */
function reportTotals(label: string, sweeps: readonly JointSweep[]): void {
  const sum = (pick: (stop: JointStopRecord) => number): number => sweeps.reduce((acc, sweep) => acc + sweep.stops.reduce((inner, stop) => inner + pick(stop), 0), 0);
  console.log(``);
  console.log(`TOTALS, ${label}`);
  console.log(`  championships swept                  ${String(sweeps.length)}`);
  console.log(`  stops                                ${String(sweeps.reduce((acc, sweep) => acc + sweep.stops.length, 0))}`);
  console.log(`  stops where the proof ran            ${String(sweeps.reduce((acc, sweep) => acc + sweep.stops.filter((stop) => stop.joint === "applied").length, 0))}`);
  console.log(`  Locked on points, shipped            ${String(sum((stop) => stop.shippedLocked))}`);
  console.log(`  Locked by the joint proof alone      ${String(sum((stop) => stop.jointOnly))}`);
  console.log(`  Locked on points, combined           ${String(sum((stop) => stop.combinedLocked))}`);
  console.log(`  violations                           ${String(sum((stop) => stop.violations))}`);
  console.log(`  qualifiers locked at an earlier stop ${String(sweeps.reduce((acc, sweep) => acc + sweep.earlier.length, 0))}`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const asJson = argv.includes("--json");
  if (!existsSync(CORPUS_PATH)) {
    console.log(`skipped: ${CORPUS_PATH} is absent`);
    return;
  }
  const started = Date.now();
  const db = openCorpusReadOnly(CORPUS_PATH);
  const loaded = loadJointDistricts();
  const skipped = [...loaded.skipped];
  const sweeps: JointSweep[] = [];
  const alliancesBySeason = new Map<number, ReturnType<typeof selectEventAlliancesForSeason>>();
  try {
    for (const artifact of loaded.kept) {
      const found = bracketsFromCorpus(db, alliancesBySeason, artifact);
      if ("missing" in found) {
        skipped.push({ districtKey: artifact.districtKey, reason: `no corpus alliances for ${found.missing}` });
        continue;
      }
      const shape = championshipShape(dcmpEventKeysFor(artifact));
      sweeps.push(shape.kind === "single" ? sweepJoint(artifact, found.brackets.get(shape.key)!) : sweepChampionship(artifact, found.brackets));
    }
  } finally {
    db.close();
  }
  const violations = sweeps.flatMap((sweep) => sweep.violations);
  const earlier = sweeps.flatMap((sweep) => sweep.earlier);
  const seconds = (Date.now() - started) / 1000;

  if (asJson) {
    console.log(JSON.stringify({ sweeps, skipped, violations, earlier, seconds }, null, 2));
  } else {
    console.log(``);
    console.log(`CHAMP JOINT LOCKS — the Champ Locks tab's own status code at every DCMP stop, shipped and with the joint proof.`);
    console.log(`  tenet A:    a team shown "Locked" on points at any stop is locked or lockedAward in the published champLock.status at Now`);
    console.log(`  D3:         no team carries an open category of any of its dcmp rows in its floor`);
    console.log(`  sources:    ${LOCAL_DISTRICT_DIR}, ${CORPUS_PATH} (read only, no network, no credential)`);
    for (const sweep of sweeps) reportSweep(sweep);
    const single = sweeps.filter((sweep) => sweep.shape === "single");
    reportTotals("single event championships", single);
    reportTotals("divisioned championships", sweeps.filter((sweep) => sweep.shape === "divisioned"));
    reportTotals("two championship districts", sweeps.filter((sweep) => sweep.shape === "multiple"));
    reportTotals("every championship", sweeps);
    const sum = (list: readonly JointSweep[], pick: (stop: JointStopRecord) => number): number => list.reduce((acc, sweep) => acc + sweep.stops.reduce((inner, stop) => inner + pick(stop), 0), 0);
    console.log(``);
    console.log(
      `SINGLE SUBTOTAL ${String(single.length)} championships / ${String(single.reduce((acc, sweep) => acc + sweep.stops.length, 0))} stops / proof applied at ${String(single.reduce((acc, sweep) => acc + sweep.stops.filter((stop) => stop.joint === "applied").length, 0))} / shipped ${String(sum(single, (stop) => stop.shippedLocked))} / joint only ${String(sum(single, (stop) => stop.jointOnly))} / combined ${String(sum(single, (stop) => stop.combinedLocked))} / violations ${String(sum(single, (stop) => stop.violations))}`
    );
    console.log(`  time                                 ${seconds.toFixed(1)} s`);
    console.log(``);
    console.log(`FIRST LOCK MOVED EARLIER (${String(earlier.length)})`);
    for (const move of earlier) console.log(`  ${move.districtKey.padEnd(9)} ${move.teamKey.padEnd(9)} ${move.before.padEnd(36)} -> ${move.after}`);
    console.log(``);
    console.log(`SKIPPED (${String(skipped.length)})`);
    for (const entry of skipped) console.log(`  ${entry.districtKey.padEnd(9)} ${entry.reason}`);
    console.log(``);
    if (violations.length === 0) console.log(`VIOLATIONS: none`);
    else {
      console.log(`VIOLATIONS (${String(violations.length)})`);
      for (const v of violations) {
        console.log(
          `  ${v.kind.padEnd(16)} ${v.districtKey.padEnd(9)} ${v.teamKey.padEnd(9)} at ${v.stop} pointsSlots ${String(v.pointsSlots)} bound ${v.bound === null ? "n/a" : String(v.bound)} -> final ${v.finalStatus}${v.detail === undefined ? "" : ` (${v.detail})`}`
        );
      }
    }
  }
  if (violations.length > 0) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:champ-joint-locks failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
