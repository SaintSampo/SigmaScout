/**
 * THE SWEEP for the District Locks tab's settled playoffs rule (quick task
 * 261009-txb, CONTEXT D1 to D3).
 *
 *   "It is mission critical that no team is told they are locked at any stop,
 *   and then later they are not locked."                    (Jacob, 2026-10-08)
 *
 * WHAT IS MEASURED, AND WHY. Quick task 261008-26o made the District Locks tab
 * settle a knocked out alliance's playoff points as soon as its bracket
 * placement is decided, and feeds that into the lock math
 * (`settledPlayoffPoints`, `settledElimBounds`, read by
 * `districtLedgerStatus.ts`). The two shipped sweeps
 * (`scripts/measureLedgerTenets.ts`, `scripts/measureChampTenets.ts`) pass no
 * bracket facts, so at the district tier that rule had never been run against
 * history. This script runs it at every playoff round stop of every district
 * tier event of every 2023 to 2026 district season with a published
 * `dcmpSlots`. It measures; it changes no lock math.
 *
 * THE TWO RUNS, at every stop, both through the tab's OWN functions
 * (`buildDistrictLedgerRows`, `computeDistrictLedgerStatuses`):
 *
 *   blunt    no distributions at all: the rule the shipped sweeps measure.
 *   settled  one distributions entry, for the stop's own event only, carrying
 *            its `playoffMilestoneByTeam` and nothing else, built from the
 *            corpus alliances and the played rows up to the stop by the
 *            helpers the browser uses (`playedBracketMatchesFor`,
 *            `dcmpBracketMilestonesByTeam`). Every other event sits where the
 *            timeline puts it, with no bracket facts. No Monte Carlo runs.
 *
 * THE STOPS, per event, on the tab's own timeline built with no event
 * artifacts (as both shipped sweeps build theirs): Alliances final, after
 * Round 1 to Round 5 (a round with no played row has no stop; every round stop
 * reads the event's Alliance selection position with the played rows of Rounds
 * 1 to n), and Playoffs final with the awards open.
 *
 * THE FOUR TENETS. Any violation of any of them sets exit code 1.
 *
 *   A  a team shown `Locked` on points, in either run, is `locked` or
 *      `lockedAward` in the final standing.
 *   B  a team shown `Locked out`, in either run, did not qualify on points in
 *      the final standing.
 *   C  no team Locked under the blunt rule is not Locked under the settled
 *      rule at the same stop.
 *   D  no take back, Jacob's sentence above in its literal form: under the
 *      settled rule, a team shown Locked (on points or by award) at a stop of
 *      an event is shown Locked at every later stop of that event.
 *
 * Tenets A and B use the outcome rules of `scripts/measureLedgerTenets.ts`
 * (`outcomeForLockedShown`, `outcomeForLockedOutShown`), imported and never
 * restated: only `violation` fails, and the award qualified and unresolved tie
 * outcomes are counted under their own names. The blunt rule's own take back
 * count is a reference column: it is reported and never moves the exit code.
 *
 * THE YARDSTICK DECISION (confirmed 2026-10-09). The district tier final
 * standing scores tenets A and B: `districtTierFinalVerdicts(artifact)`, the
 * shipped district sweep's own default. The artifact's published
 * `districtLock.status` is printed as a CENSUS that never moves the exit code,
 * because the local artifacts in `data/local-publish/districts` were written
 * 2026-09-25, before quick task 261007-il9, and on them that field still ranks
 * the all tier total. Scored against it, both runs would report rows that are
 * a property of the stale field and not of either rule.
 *
 * THE COVERAGE LIMIT. Every swept event is finished, so every settled row a
 * finished season can produce is the `exact` kind (TBA's own `elim`). The
 * branch of `settledPlayoffPoints` that is not exact (live, mid playoffs,
 * where the placement maximum joins only the ceiling) is not reachable from
 * finished seasons and is NOT covered by this sweep.
 *
 * FIRST RUN, 2026-10-09 at 9e979118: tenets A and B zero; tenets C and D 41
 * rows each, on the same 41 team stops, every one a team Locked by the pooled
 * argument alone. The pooled pool still counts the whole playoff pool of an
 * event whose settled playoff points are already in the decided alliances'
 * floors, so those points sit on both sides of the pooled test. Quick task
 * 261009-uhb fixes that; nothing here does. Every other total lives in this
 * task's SUMMARY.
 *
 * SOURCES: `data/local-publish/districts` for the district artifacts, and
 * `data/corpus.sqlite`, opened READ ONLY, for each event's alliances
 * (`event_alliances.picks`) and played playoff rows (`matches`, sf and f). No
 * network, no credential: the `package.json` entry
 * (`measure:ledger-settled-tenets`) carries no env file flag. When the corpus
 * is absent the script prints that it skipped and exits 0.
 *
 * Usage:
 *   npx tsx scripts/measureLedgerSettledTenets.ts [--district <districtKey>] [--json]
 *   pnpm measure:ledger-settled-tenets
 *
 * Exit code 1 on any tenet A, B, C or D violation.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { DistrictArtifact, EventArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import {
  InvalidBracketDecisionError,
  bracketDecisionsFromPlayedMatches,
  bracketRoundOfSet,
  bracketSetIdFor,
  routePlayedBracket,
} from "../packages/core/districts/bracket.js";
import { openCorpusReadOnly, selectEventAlliancesForSeason } from "../packages/corpus/db.js";
import {
  buildDistrictLedgerRows,
  dcmpBracketMilestonesByTeam,
  deriveStageFromState,
  districtTierEvents,
  playedBracketMatchesFor,
  type BracketSourceEvent,
  type DistrictEventDistributions,
  type DistrictLedgerTeam,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import { buildDistrictTimeline, districtStageAtPosition, type DistrictTimeline } from "../apps/web/src/components/districts/districtTimeline.js";
import {
  computeDistrictLedgerStatuses,
  type DistrictLedgerStatusModel,
  type DistrictLedgerStatusResult,
} from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { CORPUS_PATH, bracketFromCorpus } from "./measureChampJointLocks.js";
import {
  LOCAL_DISTRICT_DIR,
  districtTierFinalVerdicts,
  loadDistrictArtifacts,
  outcomeForLockedOutShown,
  outcomeForLockedShown,
  publishedFinalVerdicts,
} from "./measureLedgerTenets.js";

export const SWEPT_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];
const NO_EVENT_ARTIFACTS: ReadonlyMap<string, EventArtifact> = new Map<string, EventArtifact>();
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map<string, DistrictEventDistributions>();
const BRACKET_ALLIANCES = 8;
const BRACKET_ROUND_COUNT = 5;

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

export interface SettledStop {
  readonly label: string;
  /** The timeline position whose stage the stop reads. */
  readonly index: number;
  /** The played playoff rows the stop reads, by match key. */
  readonly playedKeys: ReadonlySet<string>;
}

type BracketRow = BracketSourceEvent["matches"][number];

/** A row of the playoff bracket: TBA's `sf` or `f`. */
function isPlayoffRow(match: BracketRow): boolean {
  return match.compLevel === "sf" || match.compLevel === "f";
}

/** The round (1 to 5) a row belongs to, or `undefined` for the final and for a row this bracket does not carry. */
function roundOfRow(match: BracketRow): number | undefined {
  const setId = bracketSetIdFor(match.compLevel, match.setNumber);
  return setId === undefined ? undefined : bracketRoundOfSet(setId);
}

/**
 * One district tier event's stops, `dcmpStops`' rule at the district tier
 * (CONTEXT D1). The round stops share the event's Alliance selection position,
 * where its Playoffs and Awards categories are open, and differ only in the
 * played rows they read: Rounds 1 to n. A round with no played row has no
 * stop, and a row with no round (the final) joins only the last stop, which
 * sits at the event's Playoffs position. No Now stop: D1 lists none.
 */
export function settledStops(timeline: DistrictTimeline, eventKey: string, bracket: BracketSourceEvent): SettledStop[] {
  const played = bracket.matches.filter((match) => isPlayoffRow(match) && match.actualWinner !== undefined);
  const stops: SettledStop[] = [];

  const allianceIndex = timeline.positions.findIndex((position) => position.step?.kind === "alliance" && position.step.eventKey === eventKey);
  if (allianceIndex >= 0) {
    stops.push({ label: "Alliances final", index: allianceIndex, playedKeys: new Set() });
    for (let round = 1; round <= BRACKET_ROUND_COUNT; round++) {
      if (!played.some((match) => roundOfRow(match) === round)) continue;
      const rows = played.filter((match) => (roundOfRow(match) ?? Infinity) <= round);
      stops.push({ label: `Round ${String(round)}`, index: allianceIndex, playedKeys: new Set(rows.map((match) => match.matchKey)) });
    }
  }
  const playoffsIndex = timeline.positions.findIndex((position) => position.step?.kind === "playoffs" && position.step.eventKey === eventKey);
  if (playoffsIndex >= 0) {
    stops.push({ label: "Playoffs final, awards open", index: playoffsIndex, playedKeys: new Set(played.map((match) => match.matchKey)) });
  }
  return stops;
}

/**
 * Why an event is NOT swept, or `undefined` for a sweepable one. Tested in
 * this order: no alliances in the corpus, not an eight alliance bracket, no
 * played playoff row, a played row the bracket refuses to route.
 *
 * A bracket that ROUTES without deciding every placement (a tied row decides
 * nothing) is swept, not skipped, and counted in the census.
 */
export function bracketSkipReason(bracket: BracketSourceEvent | undefined): string | undefined {
  const alliances = bracket?.alliances;
  if (bracket === undefined || alliances === undefined || alliances.length === 0) return "no alliances in the corpus";
  if (alliances.length !== BRACKET_ALLIANCES) return `not an eight alliance bracket (${String(alliances.length)} alliances)`;
  if (!bracket.matches.some((match) => isPlayoffRow(match) && match.actualWinner !== undefined)) return "no played playoff rows in the corpus";
  try {
    routePlayedBracket(bracketDecisionsFromPlayedMatches(playedBracketMatchesFor(bracket).matches));
  } catch (error) {
    if (error instanceof InvalidBracketDecisionError) return `bracket does not route (${error.message})`;
    throw error;
  }
  return undefined;
}

/**
 * TENET D, pure. The stops in order, each with the teams shown Locked there
 * (on points or by award). One row per (team, later stop) at which a team
 * Locked at an earlier stop is not Locked, so a team taken back at two stops
 * gives two rows. Rows come in stop order, then by team key.
 */
export function takeBackRows(
  stops: readonly { readonly label: string; readonly locked: ReadonlySet<string> }[]
): { readonly teamKey: string; readonly stop: string; readonly firstLockedStop: string }[] {
  const firstLockedStopByTeam = new Map<string, string>();
  const rows: { teamKey: string; stop: string; firstLockedStop: string }[] = [];
  for (const stop of stops) {
    const here: { teamKey: string; stop: string; firstLockedStop: string }[] = [];
    for (const [teamKey, firstLockedStop] of firstLockedStopByTeam) {
      if (!stop.locked.has(teamKey)) here.push({ teamKey, stop: stop.label, firstLockedStop });
    }
    here.sort((a, b) => (a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0));
    rows.push(...here);
    for (const teamKey of stop.locked) {
      if (!firstLockedStopByTeam.has(teamKey)) firstLockedStopByTeam.set(teamKey, stop.label);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Statuses at a stop
// ---------------------------------------------------------------------------

/** What every stop of one district season shares: the tab's own timeline and its Now memo. */
export interface SettledDistrictContext {
  readonly timeline: DistrictTimeline;
  readonly nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /** The district tier event keys, sorted. */
  readonly eventKeys: readonly string[];
}

/**
 * The two memos exactly as `sweepDistrict` (`measureLedgerTenets.ts`) builds
 * them, first team seen wins: the district's district tier event list, and
 * each event's Now stage from its `state` block alone. The timeline is built
 * with no event artifacts, as both shipped sweeps build theirs.
 */
export function settledDistrictContext(artifact: DistrictArtifact): SettledDistrictContext {
  const eventsByKey = new Map<string, { eventKey: string; eventName: string; week: number | null }>();
  const nowStageByEvent = new Map<string, DistrictStageFinality>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (!eventsByKey.has(entry.eventKey)) {
        eventsByKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week });
      }
      if (nowStageByEvent.has(entry.eventKey)) continue;
      nowStageByEvent.set(entry.eventKey, deriveStageFromState(entry.state).final);
    }
  }
  const timeline = buildDistrictTimeline({ events: [...eventsByKey.values()], eventArtifacts: NO_EVENT_ARTIFACTS });
  return { timeline, nowStageByEvent, eventKeys: [...eventsByKey.keys()].sort() };
}

/**
 * The tab's statuses at one stop. `withSettled` false passes no distributions
 * (the blunt rule). True passes ONE entry, for this event only, carrying its
 * `playoffMilestoneByTeam` from the corpus alliances and the stop's played
 * rows, which is the only thing the settled rule reads.
 */
export function statusesAtSettledStop(
  artifact: DistrictArtifact,
  context: SettledDistrictContext,
  eventKey: string,
  stop: SettledStop,
  bracket: BracketSourceEvent,
  withSettled: boolean
): { readonly statuses: DistrictLedgerStatusModel; readonly teams: readonly DistrictLedgerTeam[] } {
  const { timeline, nowStageByEvent } = context;
  const atNow = stop.index >= timeline.nowIndex;
  const stageByEvent = districtStageAtPosition(timeline, stop.index, nowStageByEvent);

  let distributions = NO_DISTRIBUTIONS;
  if (withSettled) {
    const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
    const played = playedBracketMatchesFor(bracket, stop.playedKeys);
    const entry: DistrictEventDistributions = {
      eventKey,
      byTeam: new Map(),
      playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches),
    };
    distributions = new Map([[eventKey, entry]]);
  }

  const rows = buildDistrictLedgerRows({
    artifact,
    distributions,
    stageByEvent: atNow ? undefined : stageByEvent,
  });
  const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
  return { statuses, teams: rows.teams };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export type SettledRun = "blunt" | "settled";

export interface SettledViolation {
  readonly tenet: "A" | "B" | "C" | "D";
  readonly run: SettledRun;
  readonly districtKey: string;
  readonly eventKey: string;
  readonly stop: string;
  readonly teamKey: string;
  /** The yardstick's verdict: the district tier final standing unless the caller passed another. */
  readonly finalStatus: LockStatus;
  /** The artifact's own published `districtLock.status`. Census only. */
  readonly publishedStatus: LockStatus;
  /** How the team was Locked: `award` for the award chip, else the lock math's own `lockedBy`. `null` for a Locked out display. */
  readonly lockedBy: string | null;
  /** Tenet D only: the first stop of the event at which the team was shown Locked. */
  readonly firstLockedStop?: string;
}

/** One run's counts at one stop. */
export interface SettledRunCounts {
  readonly lockedOnPoints: number;
  readonly lockedByAward: number;
  readonly lockedOut: number;
  /** Tenet A outcomes of the Locked on points displays. */
  readonly lockedKept: number;
  readonly lockedAwardQualified: number;
  readonly lockedViolations: number;
  /** Tenet B outcomes of the Locked out displays. */
  readonly lockedOutKept: number;
  readonly lockedOutAwardQualified: number;
  readonly lockedOutUnresolvedTie: number;
  readonly lockedOutViolations: number;
  /** The displays the PUBLISHED field would score as a violation. Census only. */
  readonly publishedWouldViolateA: number;
  readonly publishedWouldViolateB: number;
  readonly pooledRemainingPoints: number;
}

export interface SettledStopRecord {
  readonly label: string;
  readonly index: number;
  readonly playedRows: number;
  readonly blunt: SettledRunCounts;
  readonly settled: SettledRunCounts;
  /** Locked on points under the settled rule and not under the blunt rule, sorted. */
  readonly gained: readonly string[];
  /** Locked on points under the blunt rule and not under the settled rule, sorted. */
  readonly lost: readonly string[];
  /** Locked out under the settled rule and not under the blunt rule, sorted. */
  readonly lockedOutGained: readonly string[];
  /** Locked out under the blunt rule and not under the settled rule, sorted. Counted, never scored. */
  readonly lockedOutLost: readonly string[];
  /** The settled run's rows carrying `settledElim`, how many of them are exact, and their points sum. */
  readonly settledRows: number;
  readonly settledExact: number;
  readonly settledPoints: number;
}

export interface SettledEventSweep {
  readonly eventKey: string;
  readonly stops: readonly SettledStopRecord[];
  /** Tenet D's rule run over the BLUNT rule's Locked sets: a reference count, never a violation. */
  readonly takeBackBlunt: number;
  /** Played playoff rows whose two sides could not both be resolved to one alliance. Census. */
  readonly unresolvedPlayoffRows: number;
  /** How many of the eight placements the played rows decide. Census. */
  readonly placementsDecided: number;
  readonly violations: readonly SettledViolation[];
}

export interface SettledDistrictSweep {
  readonly districtKey: string;
  readonly year: number;
  readonly events: readonly SettledEventSweep[];
  readonly skipped: readonly { readonly eventKey: string; readonly reason: string }[];
  /** Teams on which the published `districtLock.status` and the yardstick differ. Census. */
  readonly publishedDiffers: number;
  readonly violations: readonly SettledViolation[];
}

/** How a Locked display was reached: `award` for the award chip, else the lock math's own `lockedBy`. */
function lockedHow(result: DistrictLedgerStatusResult): string | null {
  return result.byAward ? "award" : result.lockedBy;
}

function sortedDifference(from: ReadonlySet<string>, without: ReadonlySet<string>): string[] {
  return [...from].filter((teamKey) => !without.has(teamKey)).sort();
}

interface ScoredRun {
  readonly counts: SettledRunCounts;
  readonly lockedOnPoints: ReadonlySet<string>;
  /** Locked on points or by award: what tenets C and D read. */
  readonly lockedAny: ReadonlySet<string>;
  readonly lockedOut: ReadonlySet<string>;
  readonly lockedHowByTeam: ReadonlyMap<string, string | null>;
}

/**
 * Sweeps one event: both runs at every stop, tenets A and B per display,
 * tenet C per stop, tenet D across the stops.
 *
 * `finalVerdicts` IS THE YARDSTICK tenets A and B are scored against, and it
 * is read from this map and from nowhere else, which is how the corrupted
 * yardstick test proves the checker can fail.
 */
export function sweepSettledEvent(
  artifact: DistrictArtifact,
  context: SettledDistrictContext,
  eventKey: string,
  bracket: BracketSourceEvent,
  finalVerdicts: ReadonlyMap<string, LockStatus>
): SettledEventSweep {
  const published = publishedFinalVerdicts(artifact);
  const violations: SettledViolation[] = [];
  const records: SettledStopRecord[] = [];
  const bluntLockedByStop: { label: string; locked: ReadonlySet<string> }[] = [];
  const settledLockedByStop: { label: string; locked: ReadonlySet<string> }[] = [];
  const settledHowByStop = new Map<string, ReadonlyMap<string, string | null>>();

  const violation = (tenet: SettledViolation["tenet"], run: SettledRun, stop: string, teamKey: string, lockedBy: string | null, firstLockedStop?: string): SettledViolation => ({
    tenet,
    run,
    districtKey: artifact.districtKey,
    eventKey,
    stop,
    teamKey,
    finalStatus: finalVerdicts.get(teamKey) ?? "unknown",
    publishedStatus: published.get(teamKey) ?? "unknown",
    lockedBy,
    ...(firstLockedStop === undefined ? {} : { firstLockedStop }),
  });

  const scoreRun = (run: SettledRun, stop: SettledStop, model: DistrictLedgerStatusModel): ScoredRun => {
    const lockedOnPoints = new Set<string>();
    const lockedAny = new Set<string>();
    const lockedOut = new Set<string>();
    const lockedHowByTeam = new Map<string, string | null>();
    let lockedByAward = 0;
    let lockedKept = 0;
    let lockedAwardQualified = 0;
    let lockedViolations = 0;
    let lockedOutKept = 0;
    let lockedOutAwardQualified = 0;
    let lockedOutUnresolvedTie = 0;
    let lockedOutViolations = 0;
    let publishedWouldViolateA = 0;
    let publishedWouldViolateB = 0;

    for (const [teamKey, result] of model.byTeam) {
      if (result.status === "locked") {
        lockedAny.add(teamKey);
        lockedHowByTeam.set(teamKey, lockedHow(result));
        if (result.byAward) {
          lockedByAward += 1;
          continue;
        }
        lockedOnPoints.add(teamKey);
        const outcome = outcomeForLockedShown(finalVerdicts.get(teamKey) ?? "unknown");
        if (outcome === "kept") lockedKept += 1;
        else if (outcome === "award-qualified-at-now") lockedAwardQualified += 1;
        else {
          lockedViolations += 1;
          violations.push(violation("A", run, stop.label, teamKey, result.lockedBy));
        }
        if (outcomeForLockedShown(published.get(teamKey) ?? "unknown") === "violation") publishedWouldViolateA += 1;
      } else if (result.status === "lockedOut") {
        lockedOut.add(teamKey);
        const outcome = outcomeForLockedOutShown(finalVerdicts.get(teamKey) ?? "unknown");
        if (outcome === "kept") lockedOutKept += 1;
        else if (outcome === "award-qualified-at-now") lockedOutAwardQualified += 1;
        else if (outcome === "unresolved-tie-at-now") lockedOutUnresolvedTie += 1;
        else {
          lockedOutViolations += 1;
          violations.push(violation("B", run, stop.label, teamKey, null));
        }
        if (outcomeForLockedOutShown(published.get(teamKey) ?? "unknown") === "violation") publishedWouldViolateB += 1;
      }
    }

    return {
      counts: {
        lockedOnPoints: lockedOnPoints.size,
        lockedByAward,
        lockedOut: lockedOut.size,
        lockedKept,
        lockedAwardQualified,
        lockedViolations,
        lockedOutKept,
        lockedOutAwardQualified,
        lockedOutUnresolvedTie,
        lockedOutViolations,
        publishedWouldViolateA,
        publishedWouldViolateB,
        pooledRemainingPoints: model.pooledRemainingPoints,
      },
      lockedOnPoints,
      lockedAny,
      lockedOut,
      lockedHowByTeam,
    };
  };

  for (const stop of settledStops(context.timeline, eventKey, bracket)) {
    const bluntModel = statusesAtSettledStop(artifact, context, eventKey, stop, bracket, false);
    const settledModel = statusesAtSettledStop(artifact, context, eventKey, stop, bracket, true);
    const blunt = scoreRun("blunt", stop, bluntModel.statuses);
    const settled = scoreRun("settled", stop, settledModel.statuses);

    // TENET C: Locked under the blunt rule (either chip), not Locked under the settled rule here.
    for (const teamKey of sortedDifference(blunt.lockedAny, settled.lockedAny)) {
      violations.push(violation("C", "settled", stop.label, teamKey, blunt.lockedHowByTeam.get(teamKey) ?? null));
    }

    let settledRows = 0;
    let settledExact = 0;
    let settledPoints = 0;
    for (const team of settledModel.teams) {
      for (const row of team.rows) {
        if (row.settledElim === undefined) continue;
        settledRows += 1;
        if (row.settledElim.exact) settledExact += 1;
        settledPoints += row.settledElim.points;
      }
    }

    bluntLockedByStop.push({ label: stop.label, locked: blunt.lockedAny });
    settledLockedByStop.push({ label: stop.label, locked: settled.lockedAny });
    settledHowByStop.set(stop.label, settled.lockedHowByTeam);
    records.push({
      label: stop.label,
      index: stop.index,
      playedRows: stop.playedKeys.size,
      blunt: blunt.counts,
      settled: settled.counts,
      gained: sortedDifference(settled.lockedOnPoints, blunt.lockedOnPoints),
      lost: sortedDifference(blunt.lockedOnPoints, settled.lockedOnPoints),
      lockedOutGained: sortedDifference(settled.lockedOut, blunt.lockedOut),
      lockedOutLost: sortedDifference(blunt.lockedOut, settled.lockedOut),
      settledRows,
      settledExact,
      settledPoints,
    });
  }

  // TENET D: under the settled rule, a lock shown at a stop is shown at every later stop of the event.
  for (const row of takeBackRows(settledLockedByStop)) {
    const how = settledHowByStop.get(row.firstLockedStop)?.get(row.teamKey) ?? null;
    violations.push(violation("D", "settled", row.stop, row.teamKey, how, row.firstLockedStop));
  }

  const played = playedBracketMatchesFor(bracket);
  let placementsDecided = 0;
  try {
    placementsDecided = routePlayedBracket(bracketDecisionsFromPlayedMatches(played.matches)).placementByAlliance.size;
  } catch (error) {
    if (!(error instanceof InvalidBracketDecisionError)) throw error;
  }

  return {
    eventKey,
    stops: records,
    takeBackBlunt: takeBackRows(bluntLockedByStop).length,
    unresolvedPlayoffRows: played.unresolvedMatchKeys.length,
    placementsDecided,
    violations,
  };
}

/**
 * Sweeps one district season: every district tier event either swept or
 * recorded as skipped with its reason. `finalVerdicts` defaults to the
 * district tier final standing, the yardstick.
 */
export function sweepSettledDistrict(
  artifact: DistrictArtifact,
  bracketFor: (eventKey: string) => BracketSourceEvent | undefined,
  finalVerdicts: ReadonlyMap<string, LockStatus> = districtTierFinalVerdicts(artifact)
): SettledDistrictSweep {
  const context = settledDistrictContext(artifact);
  const events: SettledEventSweep[] = [];
  const skipped: { eventKey: string; reason: string }[] = [];
  for (const eventKey of context.eventKeys) {
    const bracket = bracketFor(eventKey);
    const reason = bracketSkipReason(bracket);
    if (bracket === undefined || reason !== undefined) {
      skipped.push({ eventKey, reason: reason ?? "no alliances in the corpus" });
      continue;
    }
    events.push(sweepSettledEvent(artifact, context, eventKey, bracket, finalVerdicts));
  }

  const published = publishedFinalVerdicts(artifact);
  let publishedDiffers = 0;
  for (const team of artifact.teams) {
    if ((published.get(team.teamKey) ?? "unknown") !== (finalVerdicts.get(team.teamKey) ?? "unknown")) publishedDiffers += 1;
  }

  return {
    districtKey: artifact.districtKey,
    year: artifact.year,
    events,
    skipped,
    publishedDiffers,
    violations: events.flatMap((event) => event.violations),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

interface SeasonTotals {
  districts: number;
  events: number;
  stops: number;
  lockedBlunt: number;
  lockedSettled: number;
  gained: number;
  lost: number;
  lockedOutBlunt: number;
  lockedOutSettled: number;
  takeBackBlunt: number;
  violationsA: number;
  violationsB: number;
  violationsC: number;
  violationsD: number;
}

function seasonTotals(sweeps: readonly SettledDistrictSweep[]): SeasonTotals {
  const totals: SeasonTotals = {
    districts: sweeps.length,
    events: 0,
    stops: 0,
    lockedBlunt: 0,
    lockedSettled: 0,
    gained: 0,
    lost: 0,
    lockedOutBlunt: 0,
    lockedOutSettled: 0,
    takeBackBlunt: 0,
    violationsA: 0,
    violationsB: 0,
    violationsC: 0,
    violationsD: 0,
  };
  for (const sweep of sweeps) {
    for (const event of sweep.events) {
      totals.events += 1;
      totals.takeBackBlunt += event.takeBackBlunt;
      for (const stop of event.stops) {
        totals.stops += 1;
        totals.lockedBlunt += stop.blunt.lockedOnPoints;
        totals.lockedSettled += stop.settled.lockedOnPoints;
        totals.gained += stop.gained.length;
        totals.lost += stop.lost.length;
        totals.lockedOutBlunt += stop.blunt.lockedOut;
        totals.lockedOutSettled += stop.settled.lockedOut;
      }
    }
    for (const entry of sweep.violations) {
      if (entry.tenet === "A") totals.violationsA += 1;
      else if (entry.tenet === "B") totals.violationsB += 1;
      else if (entry.tenet === "C") totals.violationsC += 1;
      else totals.violationsD += 1;
    }
  }
  return totals;
}

const SEASON_COLUMNS: readonly (readonly [string, number, (totals: SeasonTotals) => number])[] = [
  ["districts", 9, (t) => t.districts],
  ["events", 6, (t) => t.events],
  ["stops", 5, (t) => t.stops],
  ["Lk blunt", 8, (t) => t.lockedBlunt],
  ["Lk settled", 10, (t) => t.lockedSettled],
  ["gained", 6, (t) => t.gained],
  ["lost", 4, (t) => t.lost],
  ["Out blunt", 9, (t) => t.lockedOutBlunt],
  ["Out settled", 11, (t) => t.lockedOutSettled],
  ["takeback blunt", 14, (t) => t.takeBackBlunt],
  ["A", 3, (t) => t.violationsA],
  ["B", 3, (t) => t.violationsB],
  ["C", 3, (t) => t.violationsC],
  ["D", 3, (t) => t.violationsD],
];

function reportSeasons(sweeps: readonly SettledDistrictSweep[]): void {
  console.log(``);
  console.log(`PER SEASON (Lk = Locked on points, Out = Locked out; A to D = violations per tenet)`);
  console.log(`  ${"season".padEnd(6)} ${SEASON_COLUMNS.map(([name, width]) => pad(name, width)).join(" ")}`);
  const line = (label: string, list: readonly SettledDistrictSweep[]): void => {
    const totals = seasonTotals(list);
    console.log(`  ${label.padEnd(6)} ${SEASON_COLUMNS.map(([, width, pick]) => pad(pick(totals), width)).join(" ")}`);
  };
  for (const season of SWEPT_SEASONS) {
    const list = sweeps.filter((sweep) => sweep.year === season);
    if (list.length > 0) line(String(season), list);
  }
  line("all", sweeps);
}

function reportCensus(sweeps: readonly SettledDistrictSweep[], seconds: number): void {
  const stops = sweeps.flatMap((sweep) => sweep.events.flatMap((event) => event.stops));
  const events = sweeps.flatMap((sweep) => sweep.events);
  const sum = (pick: (stop: SettledStopRecord) => number): number => stops.reduce((acc, stop) => acc + pick(stop), 0);
  const settledRows = sum((stop) => stop.settledRows);
  const settledExact = sum((stop) => stop.settledExact);
  console.log(``);
  console.log(`CENSUS (reported, never scored)`);
  for (const run of ["blunt", "settled"] as const) {
    console.log(
      `  ${run.padEnd(7)} Locked on points: kept ${String(sum((stop) => stop[run].lockedKept))}, award qualified ${String(sum((stop) => stop[run].lockedAwardQualified))}, violations ${String(sum((stop) => stop[run].lockedViolations))}; Locked by award ${String(sum((stop) => stop[run].lockedByAward))}`
    );
    console.log(
      `  ${run.padEnd(7)} Locked out: kept ${String(sum((stop) => stop[run].lockedOutKept))}, award qualified ${String(sum((stop) => stop[run].lockedOutAwardQualified))}, unresolved tie ${String(sum((stop) => stop[run].lockedOutUnresolvedTie))}, violations ${String(sum((stop) => stop[run].lockedOutViolations))}`
    );
  }
  console.log(`  settled rows                                        ${String(settledRows)} (exact ${String(settledExact)}, not exact ${String(settledRows - settledExact)}), ${String(sum((stop) => stop.settledPoints))} points`);
  console.log(`  events with an unresolved playoff row               ${String(events.filter((event) => event.unresolvedPlayoffRows > 0).length)}`);
  console.log(`  events whose bracket does not decide all eight      ${String(events.filter((event) => event.placementsDecided < BRACKET_ALLIANCES).length)}`);
  console.log(`  Locked out gained by the settled rule               ${String(sum((stop) => stop.lockedOutGained.length))}`);
  console.log(`  Locked out lost to the settled rule                 ${String(sum((stop) => stop.lockedOutLost.length))}`);
  console.log(
    `  teams on which the published districtLock.status differs from the yardstick: ${String(sweeps.reduce((acc, sweep) => acc + sweep.publishedDiffers, 0))} in ${String(sweeps.filter((sweep) => sweep.publishedDiffers > 0).length)} of ${String(sweeps.length)} seasons`
  );
  for (const run of ["blunt", "settled"] as const) {
    console.log(
      `  the published field would score, ${run.padEnd(7)}          tenet A ${String(sum((stop) => stop[run].publishedWouldViolateA))}, tenet B ${String(sum((stop) => stop[run].publishedWouldViolateB))}`
    );
  }
  console.log(`  time                                                ${seconds.toFixed(1)} s`);
}

/** The value after `--district`, or `undefined`. */
function districtArgument(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--district");
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error("--district needs a district key, for example --district 2026pnw");
  return value;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const asJson = argv.includes("--json");
  const onlyDistrict = districtArgument(argv);
  if (!existsSync(CORPUS_PATH)) {
    console.log(`skipped: ${CORPUS_PATH} is absent`);
    return;
  }
  const started = Date.now();
  const loaded = loadDistrictArtifacts(LOCAL_DISTRICT_DIR);
  const inScope = (districtKey: string, year: number): boolean => SWEPT_SEASONS.includes(year) && (onlyDistrict === undefined || districtKey === onlyDistrict);
  const kept = loaded.artifacts.filter((artifact) => inScope(artifact.districtKey, artifact.year));
  // A season of the swept years with no published capacity is named, never silently dropped.
  const noCapacity = loaded.skippedNoCapacity.filter((districtKey) => inScope(districtKey, Number(districtKey.slice(0, 4))));
  if (kept.length === 0 && noCapacity.length === 0) {
    throw new Error(`no district season to sweep${onlyDistrict === undefined ? "" : ` named ${onlyDistrict}`} in ${LOCAL_DISTRICT_DIR} for ${SWEPT_SEASONS.join(", ")}`);
  }

  const sweeps: SettledDistrictSweep[] = [];
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const alliancesBySeason = new Map<number, ReturnType<typeof selectEventAlliancesForSeason>>();
    for (const artifact of kept) {
      sweeps.push(sweepSettledDistrict(artifact, (eventKey) => bracketFromCorpus(db, alliancesBySeason, artifact.year, eventKey)));
    }
  } finally {
    db.close();
  }

  const skipped: { districtKey: string; eventKey: string; reason: string }[] = [
    ...noCapacity.map((districtKey) => ({ districtKey, eventKey: "(whole season)", reason: "no capacity: dcmpSlots is null" })),
    ...sweeps.flatMap((sweep) => sweep.skipped.map((entry) => ({ districtKey: sweep.districtKey, eventKey: entry.eventKey, reason: entry.reason }))),
  ];
  const violations = sweeps.flatMap((sweep) => sweep.violations);
  const seconds = (Date.now() - started) / 1000;

  if (asJson) {
    console.log(JSON.stringify({ sweeps, skipped, violations, seconds }, null, 2));
  } else {
    console.log(``);
    console.log(`LEDGER SETTLED TENETS: the District Locks tab's own status code at every playoff round stop, blunt and settled.`);
    console.log(`  tenet A:    a team shown "Locked" on points at any stop, in either run, is locked or lockedAward in the final standing`);
    console.log(`  tenet B:    a team shown "Locked out" at any stop, in either run, did not qualify on points in the final standing`);
    console.log(`  tenet C:    no team Locked under the blunt rule is not Locked under the settled rule at the same stop`);
    console.log(`  tenet D:    no take back: under the settled rule, a team Locked at a stop of an event is Locked at every later stop of it`);
    console.log(`  yardstick:  the district tier final standing (districtTierFinalVerdicts); the published districtLock.status is a census only`);
    console.log(`  stops:      Alliances final, Round 1 to Round 5, Playoffs final with the awards open, per district tier event`);
    console.log(`  sources:    ${LOCAL_DISTRICT_DIR}, ${CORPUS_PATH} (read only, no network, no credential)`);
    reportSeasons(sweeps);
    reportCensus(sweeps, seconds);
    console.log(``);
    console.log(`SKIPPED (${String(skipped.length)})`);
    for (const entry of skipped) console.log(`  ${entry.districtKey.padEnd(9)} ${entry.eventKey.padEnd(14)} ${entry.reason}`);
    console.log(``);
    if (violations.length === 0) console.log(`VIOLATIONS: none`);
    else {
      console.log(`VIOLATIONS (${String(violations.length)})`);
      for (const v of violations) {
        console.log(
          `  tenet ${v.tenet} ${v.run.padEnd(7)} ${v.districtKey.padEnd(9)} ${v.eventKey.padEnd(10)} ${v.stop.padEnd(28)} ${v.teamKey.padEnd(9)} final ${v.finalStatus.padEnd(11)} published ${v.publishedStatus.padEnd(11)} lockedBy ${v.lockedBy ?? "n/a"}${v.firstLockedStop === undefined ? "" : ` first Locked at ${v.firstLockedStop}`}`
        );
      }
    }
  }
  if (violations.length > 0) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:ledger-settled-tenets failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
