/**
 * THE DISTRICT CUTOFF BACKTEST (fast task 261006, todo
 * `district-cutoff-line-backtest`; rebuilt on the as-of path by quick task
 * 261014-hx6): the District Locks tab's simulated line, walk-forward, at the
 * season start and at the end of every competition week of every district
 * season, against the cutoff that season settled on.
 *
 * Modes (every one but `--fetch` reads only local files):
 *
 *   npx tsx scripts/measureDistrictCutoff.ts --fetch [--origin URL] [--version V]
 *     Fills the origin cache (see THE ORIGIN CACHE) for the selected seasons.
 *
 *   npx tsx scripts/measureDistrictCutoff.ts --dry-run [--district KEY] [--seasons 2023,2024]
 *     The positions and the projected GENERATED bake count, from the district
 *     artifacts alone.
 *
 *   npx tsx scripts/measureDistrictCutoff.ts [--district KEY] [--seasons ...] [--shard k/n] [--force] [--version V]
 *     The backtest. One result file per district season.
 *
 *   npx tsx scripts/measureDistrictCutoff.ts --report [--json] [--verbose]
 *     Pools every result file and prints the pre-registered gate.
 *
 * THE BROWSER'S OWN CODE, IN THE COMPONENT'S OWN ORDER. This script defines no
 * model. At every position it calls what `DistrictLedger.tsx` calls at a
 * rewound stop: `districtStageAtPosition` (the field and the number
 * readings), `loadAsOfRewind`, `assembleAsOfDistrictEvents`, the Worker job
 * `runDistrictSimulationJob` with the as-of runner `runAsOfEvent`,
 * `buildDistrictLedgerRows`, `computeDistrictLedgerStatuses`,
 * `buildAdvancementChanceRun`, `advancementChances`, `predictedCutoff`,
 * `districtRangeState`, then `applyChampionshipFieldOverlay` and
 * `applyLedgerRangeState` for the shown chips. Between the assembly and the
 * rows it restates `useDistrictLedgerData.ts`' rewound memo as plain calls
 * (`pricedRunAtStop`), each block commented with the hook's line range.
 *
 * THE POSITIONS. Season start, then the last rail step of each competition
 * week, exactly the jump chips the retired rewind slider supplied and
 * `measureChampCutoff.ts` still derives. A position where nothing is open any
 * more prints the midpoint rule, not a simulated line, and is counted as
 * settled rather than scored.
 *
 * THE WINDOW IS 2023 TO 2026 BY CONSTRUCTION. `simulateDistrictEvent` declares
 * a playoff bracket for 2023 and later only (the eight alliance double
 * elimination format). An earlier district season is refused before anything
 * is loaded, and the report lists it as refused.
 *
 * THE TARGET. The tab's own settled cutoff at season end: the midpoint of the
 * last team inside the slots and the first team outside them over the final
 * rows, which is what the District Locks tab prints once every team has
 * finished (`predictedCutoff`, kind `final`). The published DCMP cut line
 * (`insights.dcmpCutLinePoints`) is reported beside it, not scored: it is the
 * total at the last qualifying slot (the slots-th highest) on the publisher's
 * verdict pass
 * (`recomputeDistrictVerdicts`), not a midpoint of a boundary pair, so the two
 * are not the same quantity. Until quick task 261007-il9 that pass also ranked
 * the all tier total, and artifacts published before then carry the all tier
 * line.
 *
 * PREDICT BEFORE UPDATE, ON THE AS-OF PATH. Every open event at a position is
 * priced the way the live tab prices a rewound stop since quick task
 * 261005-5g0: from the model as it stood at the stop's cut. A REAL event
 * (folded by the cut) has its remaining qualification rows priced, and its
 * roster rated, by the as-of pricer from the as-of state; a GENERATED event
 * (unstarted at the cut) is baked over generated schedules with the same
 * pricer. No stored per row prediction, no `teams[].metrics` and no baked
 * sidecar reaches pricing. An event whose as-of objects are not published, or
 * whose roster cannot be priced at the cut, reads UNAVAILABLE at the stop and
 * is counted, never priced from stored odds.
 *
 * `scripts/asOfRewindWeb.test.ts` is the truncation proof for the assembly:
 * the requests a rewound stop builds equal the requests built from a world
 * truncated at the cut. Seven leak checks per scored position back it here:
 * three on the row build (awards only from award final events, earned never
 * above the season final total, open events open on every row) and four on
 * the as-of plan (every REAL row strictly after the cut and the split exact,
 * baselines at or before the cut, played playoff rows at or before the cut,
 * GENERATED requests carrying no rows and no ratings).
 *
 * HISTORY: THE RETIRED STORED ODDS PATH. Until quick task 261014-hx6 this
 * script priced open events from the first qualification row after the
 * position, each row carrying the prediction stored when it was played, with
 * alliance and playoff cells read from each event artifact's publish time
 * `teams[].metrics`. A week 5 event at season start was so priced with odds
 * that already knew weeks 1 to 4, and playoffs with end of season ratings: a
 * look ahead leak. Its figures, kept as history only:
 *   - 2026-10-07 (after quick task 261007-jvz's finality cascade): 203 scored
 *     positions over 47 district seasons, simulated MAE 1.15 against the
 *     midpoint rule's 1.77, the range holding the settled cutoff at 181 of
 *     203 (89.2%), three positions above the band's ceiling.
 *   - 2026-10-06 (after quick task 261007-4qr's short roster rule): 193
 *     positions over 45 seasons, 1.17 against 1.80, 171 of 193 (88.6%).
 *
 * MEASURED ON THE AS-OF PATH: (filled by quick task 261014-hx6 Task 3).
 *
 * THE GATE, registered before the first full run:
 *
 *   1. The simulated line's MAE against the settled cutoff is below the
 *      midpoint rule's MAE at the same positions.
 *   2. The printed 10 to 90 range holds the settled cutoff in 72% to 88% of
 *      the scored positions (nominal 80%), the champ line's own band.
 *
 * Both are read over every scored position pooled; the per week split is
 * reported and not gated. Both bars were re-registered unchanged on
 * 2026-10-14, before the first as-of run.
 */
import { pathToFileURL } from "node:url";
import type { DistrictArtifact, EventArtifact } from "../packages/harness/pageArtifacts.js";
import { asOfAtOrBefore, type AsOfCut, type AsOfIndex } from "../packages/harness/asOfState.js";
import { advancementChances, type AdvancementChanceResult } from "../packages/core/districts/advancementChance.js";
import { championshipShape } from "../packages/core/districts/finalsBracket.js";
import type { DistrictTier } from "../packages/core/districts/pointModel.js";
import {
  DISTRICT_CATEGORIES,
  allDistrictTierEventKeys,
  buildDistrictLedgerRows,
  dcmpBracketFactsAtPosition,
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  deriveStageFromState,
  distributionsFromPreSim,
  distributionsFromResult,
  districtTierEvents,
  liveStageByEvent,
  securedElimByTeamFor,
  type DcmpBracketFacts,
  type DistrictEventDistributions,
  type DistrictLedgerGaps,
  type DistrictStageFinality,
  type FieldBackup,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import {
  buildDistrictTimeline,
  districtStageAtPosition,
  eventStartedAtPosition,
  eventsWithOpenCategoriesAt,
  timelineEventsOf,
  type DistrictTimeline,
} from "../apps/web/src/components/districts/districtTimeline.js";
import { districtMilestoneEvents } from "../apps/web/src/components/districts/districtMilestones.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildAdvancementChanceRun } from "../apps/web/src/components/districts/districtLedgerChances.js";
import { predictedCutoff, type ChampNoCallReason } from "../apps/web/src/components/districts/predictedCutoff.js";
import { applyLedgerRangeState, districtRangeState } from "../apps/web/src/components/districts/ledgerRangeState.js";
import { applyChampionshipFieldOverlay } from "../apps/web/src/components/districts/districtFieldOverlay.js";
import { dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import {
  asOfCandidateEvents,
  asOfCutId,
  asOfScheduleStopEventKey,
  loadAsOfRewind,
  resolveStopCut,
  type AsOfFetchers,
  type AsOfRewindInput,
  type AsOfRewindResult,
} from "../apps/web/src/components/districts/asOfRewind.js";
import { assembleAsOfDistrictEvents, districtRunSignature, type AssembledDistrictEvents } from "../apps/web/src/components/districts/districtRunAssembly.js";
import { runAsOfEvent } from "../apps/web/src/workers/districtAsOfJob.js";
import {
  isDistrictSimulationRequest,
  runDistrictSimulationJob,
  type DistrictSimulationEventEntry,
  type DistrictSimulationEventRequest,
} from "../apps/web/src/workers/districtSimulationProtocol.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import { buildQualRows } from "../apps/web/src/lib/simulationInputs.js";

/** The algorithm the District Locks tab pins its event artifacts and as-of objects to (`districtRunAssembly.ts`). */
export const EVENT_ALGORITHM_ID = "spr";
/** The first season `simulateDistrictEvent` has a playoff bracket for. Earlier district seasons are refused before anything loads. */
export const FIRST_BRACKET_SEASON = 2023;

// ---------------------------------------------------------------------------
// Small readers of the district artifact
// ---------------------------------------------------------------------------

/** Every district tier event key of one district season, sorted. */
export function districtEventKeysOf(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) for (const entry of districtTierEvents(team)) keys.add(entry.eventKey);
  return [...keys].sort();
}

/** The district tier events STARTED at now, by their own `state` blocks (`DistrictLedger.tsx` `startedKeys`): the tab's rewound fetch set. */
export function startedDistrictEventKeysOf(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) if (deriveStageFromState(entry.state).started) keys.add(entry.eventKey);
  }
  return [...keys].sort();
}

/** The component's own `now` memo: each district tier event's stage from its own `state` block, first team seen wins. */
function nowStageByEventOf(artifact: DistrictArtifact): Map<string, DistrictStageFinality> {
  const map = new Map<string, DistrictStageFinality>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (map.has(entry.eventKey)) continue;
      map.set(entry.eventKey, deriveStageFromState(entry.state).final);
    }
  }
  return map;
}

/** The district's district tier events, deduplicated, in the order first seen (`DistrictLedger.tsx` `districtEvents`). */
function districtEventsOf(artifact: DistrictArtifact): { eventKey: string; eventName: string; week: number | null }[] {
  const byKey = new Map<string, { eventKey: string; eventName: string; week: number | null }>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (!byKey.has(entry.eventKey)) byKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week });
    }
  }
  return [...byKey.values()];
}

/** The component's own timeline, from the district's district tier events and the event artifacts in hand. */
export function districtTimelineOf(artifact: DistrictArtifact, eventArtifacts: ReadonlyMap<string, EventArtifact>): DistrictTimeline {
  return buildDistrictTimeline({ events: timelineEventsOf(districtEventsOf(artifact), districtMilestoneEvents(artifact, ["district"])), eventArtifacts });
}

/**
 * Season start, then the last timeline position of each distinct week, in
 * week order: the measurement points the retired rewind slider's jump chips
 * supplied, derived as `measureChampCutoff.ts` derives them. Only positions
 * strictly before `nowIndex` are returned; now itself is the settled season.
 */
export function measurementPositions(timeline: DistrictTimeline): { index: number; label: string }[] {
  const lastIndexByWeek = new Map<number, number>();
  timeline.positions.forEach((position, index) => {
    if (position.step === undefined || position.week === null) return;
    lastIndexByWeek.set(position.week, index);
  });
  const weeks = [...lastIndexByWeek.keys()]
    .sort((a, b) => a - b)
    .map((week) => ({ index: lastIndexByWeek.get(week)!, label: `After week ${String(week + 1)}` }));
  return [{ index: 0, label: "Season start" }, ...weeks].filter(({ index }) => index < timeline.nowIndex);
}

function isAllFinal(stage: DistrictStageFinality | undefined): boolean {
  return stage !== undefined && stage.qual && stage.alliance && stage.elim && stage.award;
}

/** The events with an open category at the stop, sorted (`useDistrictLedgerData.ts` `openEventKeys`, lines 711 to 719, module private there). */
function openEventKeys(keys: readonly string[], stageByEvent: ReadonlyMap<string, DistrictStageFinality>): string[] {
  return keys
    .filter((eventKey) => {
      const stage = stageByEvent.get(eventKey);
      return stage !== undefined && DISTRICT_CATEGORIES.some((category) => !stage[category]);
    })
    .sort();
}

// ---------------------------------------------------------------------------
// The as-of pricing layer
// ---------------------------------------------------------------------------

/** Thrown when an event artifact's `algorithmVersion` is not the run's: one version per run, never mixed. */
export class EventArtifactVersionError extends Error {
  constructor(eventKey: string, found: string, expected: string) {
    super(`${eventKey}: event artifact is ${EVENT_ALGORITHM_ID}@${found}, the run is ${EVENT_ALGORITHM_ID}@${expected}`);
    this.name = "EventArtifactVersionError";
  }
}

/** Refuses any event artifact not at the run version. */
export function assertEventArtifactVersions(eventArtifacts: ReadonlyMap<string, EventArtifact>, version: string): void {
  for (const [eventKey, artifact] of eventArtifacts) {
    if (artifact.algorithmVersion !== version) throw new EventArtifactVersionError(eventKey, artifact.algorithmVersion, version);
  }
}

type JobOutcome = { readonly failed: false; readonly entry: DistrictSimulationEventEntry } | { readonly failed: true };

/**
 * One process's memo of Worker job results, keyed by the request's own run
 * signature (`districtRunSignature([request])`, which folds the cut, the mode,
 * the roster and the rows or bake parameters) under the run version. Two
 * positions that resolve to the same cut, and the in-range script's two tabs,
 * share every bake through it.
 */
export interface RunMemo {
  readonly entries: Map<string, JobOutcome>;
  readonly stats: { bakes: number; bakeMs: number; realRuns: number; hits: number };
}

export function createRunMemo(): RunMemo {
  return { entries: new Map(), stats: { bakes: 0, bakeMs: 0, realRuns: 0, hits: 0 } };
}

/**
 * Runs ONE request through the Worker's own job with the as-of runner. One
 * event per job is equivalent to the tab's one job per stop: the job isolates
 * each event's failure and seeds every event alike
 * (`districtSimulationProtocol.ts` `runDistrictSimulationJob`).
 */
function runRequest(request: DistrictSimulationEventRequest, version: string, memo: RunMemo, draws: number, seed: number): JobOutcome {
  const key = `${version}|${districtRunSignature([request])}`;
  const hit = memo.entries.get(key);
  if (hit !== undefined) {
    memo.stats.hits += 1;
    return hit;
  }
  let outcome: JobOutcome = { failed: true };
  const started = performance.now();
  runDistrictSimulationJob(
    { type: "run", events: [request], draws, seed },
    (message) => {
      if (message.type === "result") outcome = { failed: false, entry: message.events[0]! };
      else if (message.type === "error") outcome = { failed: true };
    },
    runAsOfEvent
  );
  const ms = performance.now() - started;
  if (request.asOf?.mode === "generated") {
    memo.stats.bakes += 1;
    memo.stats.bakeMs += ms;
  } else {
    memo.stats.realRuns += 1;
  }
  memo.entries.set(key, outcome);
  return outcome;
}

type DcmpFactsRequest = NonNullable<Parameters<typeof dcmpBracketFactsAtPosition>[0]["request"]>;
type RequestInput = DistrictSimulationEventRequest["input"];

/**
 * `useDistrictLedgerData.ts` `securedElimForRequest`, lines 306 to 329,
 * restated: the hook module imports React and an `@/` alias that node cannot
 * resolve, so its exports cannot be imported here. A digest test in
 * `measureDistrictCutoff.test.ts` fails the moment the hook's copy changes.
 */
function securedElimForRequest(params: {
  readonly eventArtifact: EventArtifact | undefined;
  readonly season: number;
  readonly tier: DistrictTier;
  readonly playedElimMatches: RequestInput["playedElimMatches"];
  readonly unresolvedMatchCount: number;
}): ReadonlyMap<string, number> | undefined {
  const { eventArtifact, playedElimMatches } = params;
  if (eventArtifact === undefined || playedElimMatches === undefined || playedElimMatches.length === 0) return undefined;
  if (params.unresolvedMatchCount !== 0) return undefined;
  const rowId = (compLevel: string, setNumber: number, matchNumber: number): string => `${compLevel}|${String(setNumber)}|${String(matchNumber)}`;
  const keyByRow = new Map<string, string>();
  for (const match of eventArtifact.matches) {
    if (match.compLevel !== "qm") keyByRow.set(rowId(match.compLevel, match.setNumber, match.matchNumber), match.matchKey);
  }
  const keys = new Set<string>();
  for (const played of playedElimMatches) {
    const matchKey = keyByRow.get(rowId(played.compLevel, played.setNumber, played.matchNumber));
    if (matchKey === undefined) return undefined;
    keys.add(matchKey);
  }
  const secured = securedElimByTeamFor(eventArtifact, params.season, params.tier, keys);
  return secured.size === 0 ? undefined : secured;
}

/**
 * `useDistrictLedgerData.ts` `attachRequestFacts`, lines 393 to 451, restated
 * for a rewound stop (`live` false), which returns after the request loop.
 * Restated for the reason `securedElimForRequest` above states.
 */
function attachRequestFactsRewound(
  map: Map<string, DistrictEventDistributions>,
  params: {
    readonly requests: readonly DistrictSimulationEventRequest[];
    readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
    readonly season: number;
    readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
    readonly unresolvedEventKeys: ReadonlySet<string>;
    readonly fieldBackupsByEvent?: ReadonlyMap<string, readonly FieldBackup[]> | undefined;
  }
): void {
  for (const request of params.requests) {
    const { eventKey, input } = request;
    const existing = map.get(eventKey);
    const unresolvedMatchCount = params.unresolvedEventKeys.has(eventKey) ? 1 : 0;
    const playoffMilestoneByTeam =
      existing?.playoffMilestoneByTeam !== undefined || input.knownAlliances === undefined
        ? undefined
        : dcmpBracketMilestonesByTeam(input.knownAlliances, input.playedElimMatches ?? []);
    const dcmpBracket =
      input.tier !== "dcmp"
        ? undefined
        : dcmpBracketFactsFor({
            eventKey,
            season: params.season,
            tier: input.tier,
            stage: params.stageByEvent.get(eventKey),
            alliances: input.knownAlliances,
            playedMatches: input.playedElimMatches ?? [],
            unresolvedMatchCount,
            fieldBackups: params.fieldBackupsByEvent?.get(eventKey),
          });
    const securedElimByTeam = securedElimForRequest({ eventArtifact: params.eventArtifacts.get(eventKey), season: params.season, tier: input.tier, playedElimMatches: input.playedElimMatches, unresolvedMatchCount });
    if (playoffMilestoneByTeam === undefined && dcmpBracket === undefined && securedElimByTeam === undefined) continue;
    map.set(eventKey, {
      ...(existing ?? { eventKey, byTeam: new Map() }),
      ...(playoffMilestoneByTeam === undefined ? {} : { playoffMilestoneByTeam }),
      ...(dcmpBracket === undefined ? {} : { dcmpBracket }),
      ...(securedElimByTeam === undefined ? {} : { securedElimByTeam }),
    });
  }
}

/**
 * `useDistrictLedgerData.ts` `divisionedDcmpBracketFacts`, lines 468 to 498,
 * restated for the reason `securedElimForRequest` above states. A rewound stop
 * passes no `finalsMayBeAbsent` (false).
 */
function divisionedDcmpBracketFacts(params: {
  readonly artifact: DistrictArtifact;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly requestByKey: ReadonlyMap<string, DcmpFactsRequest>;
}): Map<string, DcmpBracketFacts> {
  const out = new Map<string, DcmpBracketFacts>();
  const shape = championshipShape(dcmpEventKeysFor(params.artifact), false);
  if (shape.kind !== "divisioned") return out;
  const roles: readonly [string, "division" | "finals"][] = [
    ...shape.divisionKeys.map((key) => [key, "division"] as [string, "division"]),
    [shape.finalsKey, "finals"],
  ];
  for (const [eventKey, role] of roles) {
    const eventArtifact = params.eventArtifacts.get(eventKey);
    if (eventArtifact === undefined) continue;
    const request = params.requestByKey.get(eventKey);
    const facts = dcmpBracketFactsAtPosition({
      eventKey,
      season: params.artifact.year,
      role,
      ...(role === "finals" ? { expectedAllianceCount: shape.divisionKeys.length } : {}),
      stage: params.stageByEvent.get(eventKey),
      eventArtifact,
      ...(request === undefined ? {} : { request }),
    });
    if (facts !== undefined) out.set(eventKey, facts);
  }
  return out;
}

export interface PricedRunParams {
  readonly artifact: DistrictArtifact;
  readonly result: AsOfRewindResult;
  readonly algorithmVersion: string;
  /** The event artifacts in hand: the tab's rewound fetch set (every started event loaded at the version). */
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /** The FIELD reading at the stop. */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /** The NUMBER reading at the stop. */
  readonly pointsFinalByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly tierByEvent: ReadonlyMap<string, DistrictTier>;
  readonly skipEventKeys?: ReadonlySet<string> | undefined;
  /** The tab's `allowedEventKeys`; absent reads `allDistrictTierEventKeys(artifact)`, the District Locks tab's default. */
  readonly allowedEventKeys?: readonly string[] | undefined;
  readonly memo: RunMemo;
  readonly draws: number;
  readonly seed: number;
}

export interface PricedRun {
  readonly assembled: AssembledDistrictEvents;
  readonly entries: readonly DistrictSimulationEventEntry[];
  /** The tab's `runState.status === "error"`: the request was malformed. */
  readonly runFailed: boolean;
  /** The tab's `runSignature` for a landed run: the assembled signature (`""` with nothing to run), `null` when the run failed. */
  readonly runSignature: string | null;
  readonly distributions: Map<string, DistrictEventDistributions>;
  readonly unavailableEvents: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps: Partial<DistrictLedgerGaps>;
}

/**
 * THE REWOUND MEMOS OF `useDistrictLedgerData.ts`, lines 588 to 688, as plain
 * calls in the hook's order, for a run that has landed.
 */
export function pricedRunAtStop(params: PricedRunParams): PricedRun {
  const { artifact, result, eventArtifacts, stageByEvent, tierByEvent } = params;
  // Lines 588 to 602: the as-of assembly (the view is `ready`: a load that
  // throws aborts the script loudly instead of reading as `failed`).
  const assembled = assembleAsOfDistrictEvents({
    artifact,
    result,
    algorithmVersion: params.algorithmVersion,
    eventArtifacts,
    stageByEvent,
    pointsFinalByEvent: params.pointsFinalByEvent,
    tierByEvent,
    skipEventKeys: params.skipEventKeys,
    candidateKeys: openEventKeys(params.allowedEventKeys ?? allDistrictTierEventKeys(artifact), stageByEvent),
  });

  // Lines 620 to 624: the run. The tab posts every request in one message,
  // and a message the Worker's guard refuses is a run error; that one check is
  // made on the whole set, then each event runs in its own job.
  let runFailed = false;
  const entries: DistrictSimulationEventEntry[] = [];
  if (assembled.events.length > 0) {
    if (!isDistrictSimulationRequest({ type: "run", events: assembled.events, draws: params.draws, seed: params.seed })) runFailed = true;
    else {
      for (const request of assembled.events) {
        const outcome = runRequest(request, params.algorithmVersion, params.memo, params.draws, params.seed);
        if (outcome.failed) {
          runFailed = true;
          break;
        }
        entries.push(outcome.entry);
      }
    }
    if (runFailed) entries.length = 0;
  }

  // Lines 626 to 678: entries to distributions, then the request facts.
  const distributions = new Map<string, DistrictEventDistributions>();
  const unresolved = new Set(assembled.eventsWithUnresolvedElimMatches);
  for (const entry of entries) {
    if (entry.status === "ok") distributions.set(entry.eventKey, distributionsFromResult(entry.result));
    else if (entry.status === "baked") distributions.set(entry.eventKey, distributionsFromPreSim(entry));
  }
  attachRequestFactsRewound(distributions, {
    requests: assembled.events,
    eventArtifacts,
    season: artifact.year,
    stageByEvent,
    unresolvedEventKeys: unresolved,
    fieldBackupsByEvent: assembled.fieldBackupsByEvent,
  });
  const divisioned = divisionedDcmpBracketFacts({
    artifact,
    eventArtifacts,
    stageByEvent,
    requestByKey: new Map(
      assembled.events.map((request) => [
        request.eventKey,
        {
          ...(request.input.knownAlliances === undefined ? {} : { knownAlliances: request.input.knownAlliances }),
          ...(request.input.playedElimMatches === undefined ? {} : { playedElimMatches: request.input.playedElimMatches }),
          unresolvedMatchCount: unresolved.has(request.eventKey) ? 1 : 0,
          fieldBackups: assembled.fieldBackupsByEvent?.get(request.eventKey),
        },
      ] as const)
    ),
  });
  for (const [eventKey, dcmpBracket] of divisioned) {
    const existing = distributions.get(eventKey);
    distributions.set(eventKey, existing === undefined ? { eventKey, byTeam: new Map(), dcmpBracket } : { ...existing, dcmpBracket });
  }

  // Lines 680 to 688: unavailable events and excluded matches.
  const fromRun = entries.flatMap((entry) => (entry.status === "unavailable" ? [{ eventKey: entry.eventKey, name: entry.name }] : []));
  const unavailableEvents = assembled.asOfUnavailable.length === 0 ? fromRun : [...assembled.asOfUnavailable, ...fromRun];
  const asOfExcluded = entries.flatMap((entry) => (entry.status === "ok" && entry.excludedMatchKeys !== undefined ? [entry.eventKey] : []));
  const eventsWithExcludedMatches = asOfExcluded.length === 0 ? assembled.eventsWithExcludedMatches : [...assembled.eventsWithExcludedMatches, ...asOfExcluded];

  return {
    assembled,
    entries,
    runFailed,
    runSignature: runFailed ? null : assembled.signature,
    distributions,
    unavailableEvents,
    gaps: {
      eventsWithExcludedMatches,
      eventsWithFallbackFieldSize: assembled.eventsWithFallbackFieldSize,
      eventsWithPartialAllianceList: assembled.eventsWithPartialAllianceList,
      eventsWithUnresolvedElimMatches: assembled.eventsWithUnresolvedElimMatches,
    },
  };
}

/** Wraps fetchers so every INDEX one load fetched is kept, for the stop's cut and the leak checks. */
export function recordingFetchers(fetchers: AsOfFetchers): { fetchers: AsOfFetchers; indexes: Map<string, AsOfIndex | null> } {
  const indexes = new Map<string, AsOfIndex | null>();
  return {
    indexes,
    fetchers: {
      index: async (eventKey, options) => {
        const index = await fetchers.index(eventKey, options);
        indexes.set(eventKey, index);
        return index;
      },
      log: (eventKey, options) => fetchers.log(eventKey, options),
      season: (options) => fetchers.season(options),
      start: () => fetchers.start(),
    },
  };
}

// ---------------------------------------------------------------------------
// The District Locks tab at one rewound stop
// ---------------------------------------------------------------------------

/** What one run reads beside the district artifact. */
export interface TabSources {
  /** The tab's rewound fetch set: every event started at now, loaded at `version`. */
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /** Started events with no artifact at `version`: unavailable at every stop (`useAsOfRewind`'s `unloadedEventKeys`). */
  readonly unloadedEventKeys: readonly string[];
  readonly fetchers: AsOfFetchers;
  readonly version: string;
  readonly memo: RunMemo;
  readonly draws: number;
  readonly seed: number;
}

/** The tab's per artifact memos, computed once per district season. */
export interface DistrictTabContext {
  readonly artifact: DistrictArtifact;
  readonly timeline: DistrictTimeline;
  readonly nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly nowFinalByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly tierByEvent: ReadonlyMap<string, DistrictTier>;
  readonly candidates: AsOfRewindInput["candidates"];
}

/** `DistrictLedger.tsx` lines 253 to 391: the memos that do not move with the stop. */
export function districtTabContext(artifact: DistrictArtifact, eventArtifacts: ReadonlyMap<string, EventArtifact>): DistrictTabContext {
  const districtEvents = districtEventsOf(artifact);
  return {
    artifact,
    timeline: districtTimelineOf(artifact, eventArtifacts),
    nowStageByEvent: nowStageByEventOf(artifact),
    nowFinalByEvent: liveStageByEvent(artifact, ["district"]),
    tierByEvent: new Map(allDistrictTierEventKeys(artifact).map((eventKey) => [eventKey, "district"] as const)),
    candidates: districtEvents.map((event) => ({ eventKey: event.eventKey, tier: "district" as const, week: event.week })),
  };
}

export interface DistrictTabAtPosition {
  readonly positionIndex: number;
  readonly positionId: string;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly finalByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly rewind: AsOfRewindResult;
  /** The stop's cut, from the INDEXes the load fetched; `undefined` when the stop has no exact instant. */
  readonly cut: AsOfCut | undefined;
  readonly indexes: ReadonlyMap<string, AsOfIndex | null>;
  readonly priced: PricedRun;
  readonly rows: ReturnType<typeof buildDistrictLedgerRows>;
  readonly statuses: ReturnType<typeof computeDistrictLedgerStatuses>;
  readonly chanceRun: ReturnType<typeof buildAdvancementChanceRun>;
  readonly chance: AdvancementChanceResult | undefined;
  readonly boundary: ReturnType<typeof predictedCutoff>;
  readonly rangeState: ReturnType<typeof districtRangeState>;
  /** The chips the tab SHOWS: the field overlay (rewound, so the raw model) then the range state. */
  readonly display: ReturnType<typeof showDistrictStatuses>;
}

function showDistrictStatuses(
  statuses: ReturnType<typeof computeDistrictLedgerStatuses>,
  artifact: DistrictArtifact,
  teams: ReturnType<typeof buildDistrictLedgerRows>["teams"],
  rangeState: ReturnType<typeof districtRangeState>
) {
  // `DistrictLedger.tsx` lines 548 and 556: the field overlay at a rewound
  // position (`atLive` false, the raw model untouched), then the range state.
  return applyLedgerRangeState(applyChampionshipFieldOverlay(statuses, artifact, { atLive: false }), teams, rangeState);
}

/**
 * THE DISTRICT LOCKS TAB AT ONE REWOUND STOP, `DistrictLedger.tsx` lines 319
 * to 556 in order: the two stage readings, the as-of load, the priced run,
 * the rows, the verdicts, the chance run, the boundary rule and the range
 * state, then the shown chips.
 */
export async function districtTabAtPosition(ctx: DistrictTabContext, positionIndex: number, sources: TabSources): Promise<DistrictTabAtPosition> {
  const { artifact, timeline } = ctx;
  const positionId = timeline.positions[positionIndex]!.id;
  // Lines 319 to 338: the FIELD reading and the NUMBER reading at the stop.
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, ctx.nowStageByEvent);
  const finalByEvent = districtStageAtPosition(timeline, positionIndex, ctx.nowFinalByEvent);

  // Lines 347 to 359 and `useAsOfRewind.ts` lines 97 to 136: the as-of load.
  const recorder = recordingFetchers(sources.fetchers);
  const rewind = await loadAsOfRewind(
    {
      districtArtifact: artifact,
      timeline,
      positionIndex,
      eventArtifacts: sources.eventArtifacts,
      stageByEvent,
      candidates: asOfCandidateEvents({ candidates: ctx.candidates, stageByEvent }),
      scheduleStopEventKey: asOfScheduleStopEventKey(positionId),
      unloadedEventKeys: sources.unloadedEventKeys,
    },
    recorder.fetchers
  );
  const stop = resolveStopCut(timeline, positionIndex, recorder.indexes);
  const cut = stop.status === "ok" ? stop.cut : undefined;
  if (rewind.status === "ready" && (cut === undefined || asOfCutId(cut) !== rewind.cutId)) {
    throw new Error(`${artifact.districtKey} ${positionId}: the recomputed cut does not match the load's cut ${rewind.cutId}`);
  }

  // Lines 393 to 401: the data hook.
  const priced = pricedRunAtStop({
    artifact,
    result: rewind,
    algorithmVersion: sources.version,
    eventArtifacts: sources.eventArtifacts,
    stageByEvent,
    pointsFinalByEvent: finalByEvent,
    tierByEvent: ctx.tierByEvent,
    memo: sources.memo,
    draws: sources.draws,
    seed: sources.seed,
  });

  // Lines 413 to 428: the rows read the NUMBER, and the field for the not picked note.
  const rows = buildDistrictLedgerRows({
    artifact,
    distributions: priced.distributions,
    stageByEvent: finalByEvent,
    fieldStageByEvent: stageByEvent,
    unavailableEvents: priced.unavailableEvents,
    gaps: { ...priced.gaps, missingEventArtifacts: sources.unloadedEventKeys },
    distributionsPending: false,
  });
  const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });

  // Lines 449 to 461: the chance run, on the landed run's signature.
  const chanceRun = buildAdvancementChanceRun({ artifact, teams: rows.teams, statuses, runSignature: priced.runSignature, positionId });
  const chance = chanceRun === undefined ? undefined : advancementChances(chanceRun.inputs, sources.draws, sources.seed);

  // Lines 474 to 536: the boundary rule's kind and the one range state.
  const boundary = predictedCutoff({
    teams: rows.teams,
    capacity: artifact.dcmpSlots,
    qualifiers: { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) },
    reservedSlots: statuses.reservedSlots,
  });
  const rangeState = districtRangeState({
    boundaryKind: boundary.kind,
    perEventRunSignature: priced.runSignature ?? "",
    perEventRunFailed: priced.runFailed,
    run: {
      built: chanceRun !== undefined,
      status: chance === undefined ? "idle" : "complete",
      current: true,
      excludedTeams: chanceRun?.excludedTeams ?? [],
      ...(chance?.cutoffByRun === undefined ? {} : { cutoffByRun: chance.cutoffByRun }),
      ...(chance === undefined ? {} : { draws: chance.draws }),
    },
  });

  return {
    positionIndex,
    positionId,
    stageByEvent,
    finalByEvent,
    rewind,
    cut,
    indexes: recorder.indexes,
    priced,
    rows,
    statuses,
    chanceRun,
    chance,
    boundary,
    rangeState,
    display: showDistrictStatuses(statuses, artifact, rows.teams, rangeState),
  };
}

// ---------------------------------------------------------------------------
// The backtest, one district at one position
// ---------------------------------------------------------------------------

export interface PositionLeakChecks {
  /** Every award qualified team holds a consuming award at a district tier event whose awards are final at the position. */
  readonly awardsFromFinalEventsOnly: boolean;
  /** No team's earned number at the position exceeds its season final district tier total. */
  readonly earnedNeverAhead: boolean;
  /** Every event with an open category at the position is open on every team's row for it. */
  readonly openEventsOpenInRows: boolean;
}

export interface PositionRow {
  readonly districtKey: string;
  readonly year: number;
  readonly positionIndex: number;
  readonly positionId: string;
  readonly label: string;
  readonly dcmpSlots: number;
  /** The tab's own settled cutoff at season end. */
  readonly settled: number;
  /** TBA's published DCMP cut line, reported beside the settled value and never scored. */
  readonly published: number | null;
  /** The simulated line as printed: `Math.round` of the run median. */
  readonly simulated: number;
  readonly p10: number;
  readonly p90: number;
  readonly coversSettled: boolean;
  readonly coversPublished: boolean | null;
  /** The midpoint rule at the same position, over the same rows. */
  readonly midpoint: number;
  readonly openEvents: number;
  /** Open events priced from the as-of state of a folded event (REAL). */
  readonly realEvents: number;
  /** Open events baked over generated schedules (GENERATED). */
  readonly generatedEvents: number;
  /** Open events that read unavailable at the stop: their cells carry no distribution. */
  readonly unpricedEvents: number;
  /** The unavailable events by the `name` that refused them. */
  readonly unavailable: Readonly<Record<string, number>>;
  readonly leaks: PositionLeakChecks;
}

export type PositionOutcome =
  | { readonly kind: "scored"; readonly row: PositionRow }
  /** Nothing is open at the position: the tab prints the midpoint rule and no simulated line exists to score. */
  | { readonly kind: "settled"; readonly positionId: string; readonly label: string }
  /** The chance run landed but left a team out: the tab prints the midpoint rule with no likely range. */
  | { readonly kind: "excludedFallback"; readonly positionId: string; readonly label: string; readonly excluded: number }
  | { readonly kind: "noCall"; readonly positionId: string; readonly label: string; readonly reason: ChampNoCallReason };

export interface DistrictBacktest {
  readonly districtKey: string;
  readonly year: number;
  readonly settled: number;
  readonly published: number | null;
  readonly outcomes: readonly PositionOutcome[];
  /** Started district tier events with no artifact at the run version. */
  readonly eventsWithoutArtifact: readonly string[];
}

export type DistrictOutcome =
  | { readonly ok: true; readonly backtest: DistrictBacktest }
  | { readonly ok: false; readonly districtKey: string; readonly year: number; readonly reason: string };

/** The unavailable events at the stop, counted by name, one count per event. */
function unavailableByName(events: readonly { readonly eventKey: string; readonly name: string }[]): { count: number; byName: Record<string, number> } {
  const seen = new Set<string>();
  const byName: Record<string, number> = {};
  for (const event of events) {
    if (seen.has(event.eventKey)) continue;
    seen.add(event.eventKey);
    byName[event.name] = (byName[event.name] ?? 0) + 1;
  }
  return { count: seen.size, byName };
}

/** One position's outcome, from the tab's own state there. */
function outcomeAtPosition(tab: DistrictTabAtPosition, artifact: DistrictArtifact, label: string, settled: number): PositionOutcome {
  const { positionId, rangeState: state, boundary, stageByEvent, rows, statuses, chanceRun } = tab;
  // `districtRangeState` reads `settled` for every boundary kind but `predicted`, so past this check the midpoint exists.
  if (boundary.kind !== "predicted") return { kind: "settled", positionId, label };
  const midpoint = boundary.points;
  if (state.kind === "settled") return { kind: "excludedFallback", positionId, label, excluded: chanceRun?.excludedTeams.length ?? 0 };
  if (state.kind === "noCall") return { kind: "noCall", positionId, label, reason: state.reason };
  if (state.kind === "pending") return { kind: "noCall", positionId, label, reason: "runRefused" };

  // The row leak checks: nothing after the position reached the rows.
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const openKeys = new Set(eventsWithOpenCategoriesAt(stageByEvent));
  const leaks: PositionLeakChecks = {
    awardsFromFinalEventsOnly: statuses.awardQualified.every((teamKey) => {
      const team = sourceByKey.get(teamKey);
      return team !== undefined && team.qualifyingAwards.some((award) => stageByEvent.get(award.eventKey)?.award === true);
    }),
    earnedNeverAhead: rows.teams.every((team) => team.earnedAtPosition <= team.earnedDistrictTotal + 1e-9),
    openEventsOpenInRows: rows.teams.every((team) => team.rows.every((row) => !openKeys.has(row.eventKey) || !isAllFinal(row.stage.final))),
  };

  const modes = tab.priced.assembled.events.map((event) => event.asOf?.mode);
  const unavailable = unavailableByName(tab.priced.unavailableEvents);
  const published = artifact.insights.dcmpCutLinePoints;
  const p10 = Math.round(state.likely.p10);
  const p90 = Math.round(state.likely.p90);
  return {
    kind: "scored",
    row: {
      districtKey: artifact.districtKey,
      year: artifact.year,
      positionIndex: tab.positionIndex,
      positionId,
      label,
      dcmpSlots: artifact.dcmpSlots!,
      settled,
      published,
      simulated: state.points,
      p10,
      p90,
      coversSettled: settled >= p10 && settled <= p90,
      coversPublished: published === null ? null : published >= p10 && published <= p90,
      midpoint,
      openEvents: openKeys.size,
      realEvents: modes.filter((mode) => mode === "real").length,
      generatedEvents: modes.filter((mode) => mode === "generated").length,
      unpricedEvents: unavailable.count,
      unavailable: unavailable.byName,
      leaks,
    },
  };
}

/** The settled target: the tab's own rule over the final rows. `undefined` with the refusal when the season has none. */
function settledCutoffOf(artifact: DistrictArtifact): { points: number } | { reason: string } {
  const nowStageByEvent = nowStageByEventOf(artifact);
  const finalRows = buildDistrictLedgerRows({ artifact, distributions: new Map(), stageByEvent: nowStageByEvent, tier: "district" });
  const finalStatuses = computeDistrictLedgerStatuses({ artifact, teams: finalRows.teams });
  const finalCutoff = predictedCutoff({
    teams: finalRows.teams,
    capacity: artifact.dcmpSlots,
    qualifiers: { awardQualified: new Set(finalStatuses.awardQualified), prequalified: new Set(finalStatuses.prequalified) },
    reservedSlots: finalStatuses.reservedSlots,
  });
  if (finalCutoff.kind !== "final") return { reason: `settled cutoff is ${finalCutoff.kind}, not final` };
  return { points: finalCutoff.points };
}

/** Why a district season cannot be backtested, decided from the district artifact alone; `undefined` when it can. */
export function refusalOf(artifact: DistrictArtifact): string | undefined {
  if (artifact.year < FIRST_BRACKET_SEASON) return `season ${String(artifact.year)} has no playoff bracket model (${String(FIRST_BRACKET_SEASON)} and later only)`;
  if (artifact.dcmpSlots === null) return "no published dcmpSlots";
  const nowStageByEvent = nowStageByEventOf(artifact);
  if (nowStageByEvent.size === 0) return "no district tier events";
  for (const [eventKey, stage] of nowStageByEvent) if (!isAllFinal(stage)) return `district event ${eventKey} is not final`;
  return undefined;
}

/**
 * One district season at every measurement position, on the as-of path.
 * Refuses, before any fetcher is called, a season before 2023, a district
 * with no published capacity, one whose district tier season is not finished
 * (its settled cutoff does not exist yet), and one whose settled cutoff is
 * absent (every team inside the slots). Throws on an event artifact at another
 * version.
 */
export async function backtestDistrict(artifact: DistrictArtifact, sources: TabSources): Promise<DistrictOutcome> {
  const fail = (reason: string): DistrictOutcome => ({ ok: false, districtKey: artifact.districtKey, year: artifact.year, reason });
  const refusal = refusalOf(artifact);
  if (refusal !== undefined) return fail(refusal);
  const settled = settledCutoffOf(artifact);
  if ("reason" in settled) return fail(settled.reason);
  assertEventArtifactVersions(sources.eventArtifacts, sources.version);

  const ctx = districtTabContext(artifact, sources.eventArtifacts);
  const outcomes: PositionOutcome[] = [];
  for (const { index, label } of measurementPositions(ctx.timeline)) {
    const tab = await districtTabAtPosition(ctx, index, sources);
    outcomes.push(outcomeAtPosition(tab, artifact, label, settled.points));
  }
  return {
    ok: true,
    backtest: {
      districtKey: artifact.districtKey,
      year: artifact.year,
      settled: settled.points,
      published: artifact.insights.dcmpCutLinePoints,
      outcomes,
      eventsWithoutArtifact: [...sources.unloadedEventKeys].sort(),
    },
  };
}

// Kept for the as-of leak checks (added with the expansion).
void asOfAtOrBefore;
void buildQualRows;
void eventStartedAtPosition;

// ---------------------------------------------------------------------------
// Summaries and the gate
// ---------------------------------------------------------------------------

export interface LineStats {
  readonly n: number;
  readonly mae: number;
  readonly bias: number;
}

export function lineStats(rows: readonly PositionRow[], pick: (row: PositionRow) => number | null, target: (row: PositionRow) => number | null): LineStats {
  let n = 0;
  let abs = 0;
  let signed = 0;
  for (const row of rows) {
    const value = pick(row);
    const truth = target(row);
    if (value === null || truth === null) continue;
    n += 1;
    abs += Math.abs(value - truth);
    signed += value - truth;
  }
  return { n, mae: n === 0 ? Number.NaN : abs / n, bias: n === 0 ? Number.NaN : signed / n };
}

export interface BacktestSummary {
  readonly n: number;
  readonly simulatedVsSettled: LineStats;
  readonly midpointVsSettled: LineStats;
  readonly coveredSettled: number;
  readonly simulatedVsPublished: LineStats;
  readonly midpointVsPublished: LineStats;
  /** Positions with a published line. */
  readonly nPublished: number;
  readonly coveredPublished: number;
}

export function summarize(rows: readonly PositionRow[]): BacktestSummary {
  const settled = (row: PositionRow): number => row.settled;
  const published = (row: PositionRow): number | null => row.published;
  const withPublished = rows.filter((row) => row.published !== null);
  return {
    n: rows.length,
    simulatedVsSettled: lineStats(rows, (row) => row.simulated, settled),
    midpointVsSettled: lineStats(rows, (row) => row.midpoint, settled),
    coveredSettled: rows.filter((row) => row.coversSettled).length,
    simulatedVsPublished: lineStats(rows, (row) => row.simulated, published),
    midpointVsPublished: lineStats(rows, (row) => row.midpoint, published),
    nPublished: withPublished.length,
    coveredPublished: withPublished.filter((row) => row.coversPublished === true).length,
  };
}

/** Coverage inside 72% to 88%, in integers: `18 n <= 25 covered <= 22 n`. The champ line's own band. */
export function coverageInBand(covered: number, n: number): boolean {
  return 25 * covered >= 18 * n && 25 * covered <= 22 * n;
}

export interface GateCondition {
  readonly id: number;
  readonly label: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface GateVerdict {
  readonly conditions: readonly GateCondition[];
  readonly go: boolean;
}

/** THE GATE, registered before the first full run: both conditions over every scored position pooled. */
export function gateVerdict(summary: BacktestSummary): GateVerdict {
  const fmt = (value: number): string => (Number.isNaN(value) ? "-" : value.toFixed(2));
  const conditions: GateCondition[] = [
    {
      id: 1,
      label: "simulated line MAE against the settled cutoff below the midpoint rule's MAE at the same positions",
      pass: summary.n > 0 && summary.simulatedVsSettled.mae < summary.midpointVsSettled.mae,
      detail: `${fmt(summary.simulatedVsSettled.mae)} < ${fmt(summary.midpointVsSettled.mae)} (n = ${String(summary.n)})`,
    },
    {
      id: 2,
      label: "printed 10 to 90 range holds the settled cutoff in 72% to 88% of scored positions",
      pass: summary.n > 0 && coverageInBand(summary.coveredSettled, summary.n),
      detail: `${String(summary.coveredSettled)} of ${String(summary.n)} (${summary.n === 0 ? "n/a" : ((100 * summary.coveredSettled) / summary.n).toFixed(1)}%)`,
    },
  ];
  return { conditions, go: conditions.every((condition) => condition.pass) };
}

export async function main(): Promise<void> {
  throw new Error("measure:district-cutoff: the offline origin cache is not wired yet (tracer commit)");
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:district-cutoff failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
