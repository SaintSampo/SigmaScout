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
 * MEASURED ON THE AS-OF PATH (quick task 261014-hx6, run 2026-10-14 at
 * spr@11.0.0+baseline, 1,000 draws, seed 20260830, 48 result files): 205
 * scored positions over 48 district seasons, 2023 to 2026. Simulated MAE 1.25
 * against the midpoint rule's 2.43 (bias 0.20 and -0.62); the range held the
 * settled cutoff at 183 of 205 (89.3%). Gate 1 PASS, gate 2 FAIL (above the
 * band, as the retired run also was), overall NO-GO; the range is shown with
 * its coverage quoted, the champ ruling. All seven leak checks passed at 205
 * of 205. 1,194 GENERATED events and 0 REAL events at scored positions, none
 * unavailable, no season skipped. 48 settled positions and 1 excluded team
 * fallback (2024chs) were not scored, 0 no call. 1,197 bakes at a mean of
 * 191 ms. Published on the District Locks methodology page, source 9.
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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  EventArtifactSchema,
  artifactKey,
  asOfIndexKey,
  asOfLogKey,
  asOfSeasonKey,
  asOfStartKey,
  type DistrictArtifact,
  type EventArtifact,
} from "../packages/harness/pageArtifacts.js";
import { AlgorithmsManifestSchema } from "../packages/harness/manifestSchemas.js";
import {
  AsOfIndexSchema,
  AsOfLogSchema,
  AsOfSeasonSchema,
  AsOfStartSchema,
  asOfAtOrBefore,
  type AsOfCut,
  type AsOfIndex,
} from "../packages/harness/asOfState.js";
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
  tierEvents,
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
import { champTierEvents, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
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
import { loadDistrictArtifacts, LOCAL_DISTRICT_DIR } from "./measureChampCutoff.js";

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

export type JobOutcome = { readonly failed: false; readonly entry: DistrictSimulationEventEntry } | { readonly failed: true };

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
export function runSingleRequest(request: DistrictSimulationEventRequest, version: string, memo: RunMemo, draws: number, seed: number): JobOutcome {
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
        const outcome = runSingleRequest(request, params.algorithmVersion, params.memo, params.draws, params.seed);
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

/** The Champ Locks tab's per artifact memos (`ChampLocksLedger.tsx` lines 391 to 538). */
export interface ChampTabContext {
  readonly artifact: DistrictArtifact;
  readonly dcmpEventKeys: readonly string[];
  readonly allowedEventKeys: readonly string[];
  readonly timeline: DistrictTimeline;
  readonly nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly nowFinalByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly tierByEvent: ReadonlyMap<string, DistrictTier>;
  /** Every champ tier event, the first championship carrying every district team as its roster (quick task 261007-mxf). */
  readonly candidates: AsOfRewindInput["candidates"];
}

/** Every district and dcmp tier event started at now (`ChampLocksLedger.tsx` `startedKeys`): the champ tab's rewound fetch set. */
export function startedChampEventKeysOf(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) if (deriveStageFromState(entry.state).started) keys.add(entry.eventKey);
    }
  }
  return [...keys].sort();
}

export function champTabContext(artifact: DistrictArtifact, eventArtifacts: ReadonlyMap<string, EventArtifact>): ChampTabContext {
  const events = champTierEvents(artifact);
  const dcmpEventKeys = dcmpEventKeysFor(artifact);
  const nowStageByEvent = new Map<string, DistrictStageFinality>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        if (nowStageByEvent.has(entry.eventKey)) continue;
        nowStageByEvent.set(entry.eventKey, deriveStageFromState(entry.state).final);
      }
    }
  }
  const allDistrictTeamKeys = artifact.teams.map((team) => team.teamKey).sort();
  return {
    artifact,
    dcmpEventKeys,
    allowedEventKeys: events.map((event) => event.eventKey).sort(),
    timeline: buildDistrictTimeline({ events: timelineEventsOf(events, districtMilestoneEvents(artifact, ["district", "dcmp"])), eventArtifacts }),
    nowStageByEvent,
    nowFinalByEvent: liveStageByEvent(artifact, ["district", "dcmp"]),
    tierByEvent: new Map(events.map((event) => [event.eventKey, event.tier] as const)),
    candidates: events.map((event) => ({
      eventKey: event.eventKey,
      tier: event.tier,
      week: event.week,
      ...(event.eventKey === dcmpEventKeys[0] ? { roster: allDistrictTeamKeys } : {}),
    })),
  };
}

/** The `loadAsOfRewind` input either tab builds at one stop (`useAsOfRewind.ts` lines 97 to 136). */
export function rewindInputAt(
  ctx: Pick<DistrictTabContext, "artifact" | "timeline" | "candidates">,
  positionIndex: number,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality>,
  sources: Pick<TabSources, "eventArtifacts" | "unloadedEventKeys">
): AsOfRewindInput {
  const positionId = ctx.timeline.positions[positionIndex]!.id;
  return {
    districtArtifact: ctx.artifact,
    timeline: ctx.timeline,
    positionIndex,
    eventArtifacts: sources.eventArtifacts,
    stageByEvent,
    candidates: asOfCandidateEvents({ candidates: ctx.candidates, stageByEvent }),
    scheduleStopEventKey: asOfScheduleStopEventKey(positionId),
    unloadedEventKeys: sources.unloadedEventKeys,
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
  const rewind = await loadAsOfRewind(rewindInputAt(ctx, positionIndex, stageByEvent, sources), recorder.fetchers);
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
  /** Every REAL plan's rows sit strictly after the cut by the event's INDEX, and those rows plus its rows at or before the cut are exactly its qualification rows. */
  readonly realRowsAfterCut: boolean;
  /** Every REAL plan's baseline counts no more matches for a team than its qualification rows at or before the cut. */
  readonly baselinesAtOrBeforeCut: boolean;
  /** Every played playoff row a REAL plan conditions on sits at or before the cut. */
  readonly playedPlayoffsAtOrBeforeCut: boolean;
  /** Every GENERATED request carries no remaining match and an empty ratings map: the Worker prices it from the as-of state alone. */
  readonly generatedCarriesNoSchedule: boolean;
}

export type AsOfLeakChecks = Pick<PositionLeakChecks, "realRowsAfterCut" | "baselinesAtOrBeforeCut" | "playedPlayoffsAtOrBeforeCut" | "generatedCarriesNoSchedule">;

/**
 * THE AS-OF LEAK CHECKS at one stop, read off the load's own plans and the
 * requests the assembly built, against the cut `resolveStopCut` reads from the
 * same INDEXes. `scripts/asOfRewindWeb.test.ts` is the truncation proof for
 * the assembly itself; these check every stop the backtest scores.
 */
export function asOfLeakChecks(params: {
  readonly rewind: AsOfRewindResult;
  readonly cut: AsOfCut | undefined;
  readonly indexes: ReadonlyMap<string, AsOfIndex | null>;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly requests: readonly DistrictSimulationEventRequest[];
}): AsOfLeakChecks {
  let realRowsAfterCut = true;
  let baselinesAtOrBeforeCut = true;
  let playedPlayoffsAtOrBeforeCut = true;
  if (params.rewind.status === "ready") {
    for (const [eventKey, outcome] of params.rewind.events) {
      if (outcome.status !== "ready" || outcome.state.plan.mode !== "real") continue;
      const plan = outcome.state.plan;
      const eventArtifact = params.eventArtifacts.get(eventKey);
      const index = params.indexes.get(eventKey) ?? null;
      const cut = params.cut;
      if (eventArtifact === undefined || cut === undefined) {
        realRowsAfterCut = false;
        continue;
      }
      const rowOf = new Map<string, number>();
      index?.m.forEach(([matchKey], i) => rowOf.set(matchKey, i));
      const atOrBefore = (matchKey: string): boolean => {
        const i = rowOf.get(matchKey);
        return i !== undefined && index !== null && asOfAtOrBefore(eventKey, [index.m[i]![1], i], cut);
      };
      const qualRows = buildQualRows(eventArtifact);
      const before = qualRows.filter((row) => atOrBefore(row.matchKey));
      const remaining = plan.rows.map((row) => row.matchKey);
      const union = new Set([...remaining, ...before.map((row) => row.matchKey)]);
      if (remaining.some(atOrBefore) || union.size !== qualRows.length || remaining.length + before.length !== qualRows.length || qualRows.some((row) => !union.has(row.matchKey))) {
        realRowsAfterCut = false;
      }
      const appearances = new Map<string, number>();
      for (const row of before) for (const teamKey of [...row.redTeams, ...row.blueTeams]) appearances.set(teamKey, (appearances.get(teamKey) ?? 0) + 1);
      if (plan.baselines.some((baseline) => baseline.matchesPlayed > (appearances.get(baseline.teamKey) ?? 0))) baselinesAtOrBeforeCut = false;
      if (!plan.playedPlayoffMatchKeys.every(atOrBefore)) playedPlayoffsAtOrBeforeCut = false;
    }
  }
  const generatedCarriesNoSchedule = params.requests.every(
    (request) => request.asOf?.mode !== "generated" || (request.input.remainingMatches.length === 0 && request.input.ratings.size === 0)
  );
  return { realRowsAfterCut, baselinesAtOrBeforeCut, playedPlayoffsAtOrBeforeCut, generatedCarriesNoSchedule };
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
function outcomeAtPosition(tab: DistrictTabAtPosition, artifact: DistrictArtifact, label: string, settled: number, eventArtifacts: ReadonlyMap<string, EventArtifact>): PositionOutcome {
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
    ...asOfLeakChecks({ rewind: tab.rewind, cut: tab.cut, indexes: tab.indexes, eventArtifacts, requests: tab.priced.assembled.events }),
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
    outcomes.push(outcomeAtPosition(tab, artifact, label, settled.points, sources.eventArtifacts));
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

// ---------------------------------------------------------------------------
// The origin cache
// ---------------------------------------------------------------------------

/**
 * THE ORIGIN CACHE: a gitignored mirror of `data.sigmascout.org` keys, read
 * offline by every run. Event artifacts sit at `v1/event/{eventKey}/spr@{V}.json`,
 * as-of objects at their key functions' own paths (`asOfIndexKey` and kin), the
 * manifest at `v1/manifest/algorithms.json`. A 404 is stored as a sibling
 * `.404` marker and reads `null`, as `lib/api/asOf.ts` reads a 404.
 *
 * OFFLINE (the default) never touches the network: a key with neither a body
 * nor a marker throws `OriginCacheMissError` naming it, which aborts the run.
 * It never reads as unavailable. FILL fetches a miss from the origin through
 * an injected fetch, Zod parses it with the object's own schema, then writes
 * it (temp file, then rename). Only a 404 becomes a marker; any other failure
 * throws and caches nothing.
 */
export const ORIGIN_CACHE_DIR = "data/local-publish/origin-cache";
/** Where the result files live, one directory per run version. Gitignored. */
export const BACKTEST_DIR = "data/local-publish/locks-backtest";
export const DEFAULT_ORIGIN = "https://data.sigmascout.org";
export const MANIFEST_KEY = "v1/manifest/algorithms.json";
const FETCH_CONCURRENCY = 16;
const NOT_FOUND_SUFFIX = ".404";

export class OriginCacheMissError extends Error {
  constructor(readonly key: string) {
    super(`origin cache miss: ${key} (run --fetch first; an offline run never reads a miss as unavailable)`);
    this.name = "OriginCacheMissError";
  }
}

export class OriginFetchError extends Error {
  constructor(
    readonly key: string,
    readonly status: number
  ) {
    super(`origin fetch failed: ${key} HTTP ${String(status)}`);
    this.name = "OriginFetchError";
  }
}

/** The slice of `fetch` the cache uses, so a test injects a stub. */
export type FetchLike = (url: string) => Promise<{ readonly status: number; readonly ok: boolean; text(): Promise<string> }>;

export interface OriginCacheOptions {
  readonly root?: string;
  readonly mode?: "offline" | "fill";
  readonly origin?: string;
  readonly fetch?: FetchLike;
  readonly concurrency?: number;
}

/** At most `max` tasks in flight; a released slot is handed straight to the next waiter. */
class Limiter {
  #active = 0;
  readonly #queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.max) await new Promise<void>((resolve) => this.#queue.push(resolve));
    else this.#active += 1;
    try {
      return await task();
    } finally {
      const next = this.#queue.shift();
      if (next !== undefined) next();
      else this.#active -= 1;
    }
  }
}

function writeFileAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

export class OriginCache {
  readonly root: string;
  readonly mode: "offline" | "fill";
  readonly origin: string;
  readonly stats = { fetched: 0, notFound: 0, failed: 0, bytes: 0, hits: 0 };
  readonly #fetch: FetchLike;
  readonly #limiter: Limiter;
  #memo = new Map<string, Promise<unknown>>();

  constructor(options: OriginCacheOptions = {}) {
    this.root = options.root ?? ORIGIN_CACHE_DIR;
    this.mode = options.mode ?? "offline";
    this.origin = options.origin ?? DEFAULT_ORIGIN;
    this.#fetch = options.fetch ?? ((url) => fetch(url));
    this.#limiter = new Limiter(options.concurrency ?? FETCH_CONCURRENCY);
  }

  pathOf(key: string): string {
    return join(this.root, ...key.split("/"));
  }

  /** Drops the parsed objects held in memory (not the files), between district seasons. */
  clearMemo(): void {
    this.#memo = new Map();
  }

  /** One key's object, `null` for a recorded 404. `refresh` (fill mode only) drops the cached copy first. */
  get<T>(key: string, parse: (body: unknown) => T, options: { readonly refresh?: boolean } = {}): Promise<T | null> {
    if (options.refresh === true && this.mode === "fill") {
      this.#memo.delete(key);
      rmSync(this.pathOf(key), { force: true });
      rmSync(`${this.pathOf(key)}${NOT_FOUND_SUFFIX}`, { force: true });
    }
    const held = this.#memo.get(key);
    if (held !== undefined) return held as Promise<T | null>;
    const loaded = this.#load(key, parse);
    this.#memo.set(key, loaded);
    // A failed load is not held: the next read tries again (and an offline miss throws again).
    loaded.catch(() => this.#memo.delete(key));
    return loaded;
  }

  async #load<T>(key: string, parse: (body: unknown) => T): Promise<T | null> {
    const path = this.pathOf(key);
    if (existsSync(path)) {
      this.stats.hits += 1;
      return parse(JSON.parse(readFileSync(path, "utf8")));
    }
    if (existsSync(`${path}${NOT_FOUND_SUFFIX}`)) {
      this.stats.hits += 1;
      return null;
    }
    if (this.mode === "offline") throw new OriginCacheMissError(key);
    return this.#limiter.run(async () => {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.#fetch(`${this.origin}/${key}`);
      } catch (error) {
        this.stats.failed += 1;
        throw error;
      }
      if (res.status === 404) {
        writeFileAtomic(`${path}${NOT_FOUND_SUFFIX}`, "404\n");
        this.stats.notFound += 1;
        return null;
      }
      if (!res.ok) {
        this.stats.failed += 1;
        throw new OriginFetchError(key, res.status);
      }
      const text = await res.text();
      let parsed: T;
      try {
        parsed = parse(JSON.parse(text));
      } catch (error) {
        this.stats.failed += 1;
        throw error;
      }
      writeFileAtomic(path, text);
      this.stats.fetched += 1;
      this.stats.bytes += Buffer.byteLength(text);
      return parsed;
    });
  }
}

/** The as-of fetchers over the cache. `fresh` is accepted and ignored: a finished season's snapshot does not move. */
export function asOfFetchersFor(cache: OriginCache, season: number, version: string): AsOfFetchers {
  const keyParams = { algorithmId: EVENT_ALGORITHM_ID, version };
  return {
    index: (eventKey) => cache.get(asOfIndexKey({ eventKey, ...keyParams }), (body) => AsOfIndexSchema.parse(body)),
    log: (eventKey) => cache.get(asOfLogKey({ eventKey, ...keyParams }), (body) => AsOfLogSchema.parse(body)),
    season: () => cache.get(asOfSeasonKey({ season, ...keyParams }), (body) => AsOfSeasonSchema.parse(body)),
    start: () => cache.get(asOfStartKey({ season, ...keyParams }), (body) => AsOfStartSchema.parse(body)),
  };
}

export function eventArtifactKeyFor(eventKey: string, version: string): string {
  return artifactKey({ page: "event", eventKey, algorithmId: EVENT_ALGORITHM_ID, version });
}

/**
 * The event artifacts for `eventKeys` at the run version. A recorded 404 is
 * `missing` (the tab's `missingEventArtifacts`); an artifact at another
 * version is refused, never mixed in.
 */
export async function loadEventArtifactsFromCache(
  cache: OriginCache,
  eventKeys: readonly string[],
  version: string
): Promise<{ eventArtifacts: Map<string, EventArtifact>; missing: string[] }> {
  const loaded = await Promise.all(eventKeys.map((eventKey) => cache.get(eventArtifactKeyFor(eventKey, version), (body) => EventArtifactSchema.parse(body))));
  const eventArtifacts = new Map<string, EventArtifact>();
  const missing: string[] = [];
  eventKeys.forEach((eventKey, n) => {
    const artifact = loaded[n];
    if (artifact === null || artifact === undefined) missing.push(eventKey);
    else eventArtifacts.set(eventKey, artifact);
  });
  assertEventArtifactVersions(eventArtifacts, version);
  return { eventArtifacts, missing: missing.sort() };
}

/** The run version: `--version`, else the cached manifest's spr entry (refetched first in fill mode). */
export async function runVersionOf(cache: OriginCache, cliVersion: string | undefined): Promise<string> {
  if (cliVersion !== undefined) return cliVersion;
  const manifest = await cache.get(MANIFEST_KEY, (body) => AlgorithmsManifestSchema.parse(body), { refresh: true });
  if (manifest === null) throw new Error(`${MANIFEST_KEY} is not published`);
  const entry = manifest.algorithms.find((algorithm) => algorithm.id === EVENT_ALGORITHM_ID);
  if (entry === undefined) throw new Error(`the manifest carries no ${EVENT_ALGORITHM_ID} entry`);
  return entry.version;
}

// ---------------------------------------------------------------------------
// Projection and shards
// ---------------------------------------------------------------------------

export interface ProjectedPosition {
  readonly label: string;
  readonly positionId: string;
  readonly openEvents: number;
  readonly generated: number;
}

/**
 * The positions and the GENERATED bakes one district season will cost, from
 * the district artifact alone (`--dry-run`, and the shard weights): an open
 * event with no step at or before the position is unstarted there, and an
 * unstarted event is baked. A refused season costs nothing.
 */
export function projectedBakes(artifact: DistrictArtifact): { positions: ProjectedPosition[]; total: number } {
  if (refusalOf(artifact) !== undefined) return { positions: [], total: 0 };
  const timeline = districtTimelineOf(artifact, new Map());
  const nowStageByEvent = nowStageByEventOf(artifact);
  const positions = measurementPositions(timeline).map(({ index, label }) => {
    const open = eventsWithOpenCategoriesAt(districtStageAtPosition(timeline, index, nowStageByEvent));
    return { label, positionId: timeline.positions[index]!.id, openEvents: open.length, generated: open.filter((eventKey) => !eventStartedAtPosition(timeline, index, eventKey)).length };
  });
  return { positions, total: positions.reduce((sum, position) => sum + position.generated, 0) };
}

export function parseShard(value: string | undefined): { readonly k: number; readonly n: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const k = match === null ? Number.NaN : Number(match[1]);
  const n = match === null ? Number.NaN : Number(match[2]);
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1 || k < 1 || k > n) throw new Error(`--shard must be k/n with 1 <= k <= n, got ${value}`);
  return { k, n };
}

/**
 * Every item on exactly one of `n` shards (1 based), deterministically,
 * balanced on weight: heaviest first (ties by key), each to the lightest shard
 * so far (ties to the lowest index).
 */
export function assignShards(items: readonly { readonly key: string; readonly weight: number }[], n: number): Map<string, number> {
  const loads = Array.from({ length: n }, () => 0);
  const out = new Map<string, number>();
  const sorted = [...items].sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const item of sorted) {
    let best = 0;
    for (let s = 1; s < n; s++) if (loads[s]! < loads[best]!) best = s;
    loads[best]! += item.weight;
    out.set(item.key, best + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result files
// ---------------------------------------------------------------------------

export function resultDirFor(version: string, kind: "district-cutoff" | "in-range", base: string = BACKTEST_DIR): string {
  return join(base, `${EVENT_ALGORITHM_ID}@${version}`, kind);
}

/** One result file, written to a temp file and renamed into place, so a killed run never leaves a half file. */
export function writeResultFile(dir: string, districtKey: string, value: unknown): string {
  const path = join(dir, `${districtKey}.json`);
  writeFileAtomic(path, `${JSON.stringify(value, null, 1)}\n`);
  return path;
}

/** Whether a district season's result file is already on disk (a rerun skips it unless `--force`). */
export function hasResultFile(dir: string, districtKey: string): boolean {
  return existsSync(join(dir, `${districtKey}.json`));
}

export type PooledResults<T> =
  | { readonly status: "complete"; readonly files: readonly T[] }
  | { readonly status: "incomplete"; readonly missing: readonly string[] }
  | { readonly status: "versionMismatch"; readonly keys: readonly string[] };

/** Every expected district season's file, or the gaps. Refuses a file written at another version. */
export function poolResultFiles<T extends { readonly version: string }>(dir: string, expectedKeys: readonly string[], version: string): PooledResults<T> {
  const missing = expectedKeys.filter((key) => !hasResultFile(dir, key));
  if (missing.length > 0) return { status: "incomplete", missing };
  const files = expectedKeys.map((key) => JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as T);
  const wrong = expectedKeys.filter((_key, n) => files[n]!.version !== version);
  if (wrong.length > 0) return { status: "versionMismatch", keys: wrong };
  return { status: "complete", files };
}

export interface DistrictCutoffResultFile {
  readonly kind: "district-cutoff";
  readonly districtKey: string;
  readonly year: number;
  readonly version: string;
  readonly draws: number;
  readonly seed: number;
  readonly elapsedMs: number;
  readonly bakes: number;
  readonly meanBakeMs: number;
  readonly realRuns: number;
  readonly outcome: DistrictOutcome;
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

export const DEFAULT_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];

export interface CliArgs {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly fetch: boolean;
  readonly dryRun: boolean;
  readonly report: boolean;
  readonly force: boolean;
  readonly origin: string;
  readonly version: string | undefined;
  readonly district: string | undefined;
  readonly seasons: ReadonlySet<number>;
  readonly shard: { readonly k: number; readonly n: number } | undefined;
}

export function parseCli(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      fetch: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      report: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      origin: { type: "string" },
      version: { type: "string" },
      district: { type: "string" },
      seasons: { type: "string" },
      shard: { type: "string" },
    },
    strict: true,
  });
  return {
    json: values.json,
    verbose: values.verbose,
    fetch: values.fetch,
    dryRun: values["dry-run"],
    report: values.report,
    force: values.force,
    origin: values.origin ?? DEFAULT_ORIGIN,
    version: values.version,
    district: values.district,
    seasons: new Set(values.seasons === undefined ? DEFAULT_SEASONS : values.seasons.split(",").map((part) => Number(part.trim()))),
    shard: parseShard(values.shard),
  };
}

/** The selected district seasons, split into those that can run and those refused by construction (before 2023). */
export function selectDistricts(cli: Pick<CliArgs, "district" | "seasons">, dir: string = LOCAL_DISTRICT_DIR): { eligible: DistrictArtifact[]; refusedByConstruction: DistrictArtifact[] } {
  let artifacts = loadDistrictArtifacts(dir).filter((artifact) => cli.seasons.has(artifact.year));
  if (cli.district !== undefined) artifacts = artifacts.filter((artifact) => artifact.districtKey === cli.district);
  return {
    eligible: artifacts.filter((artifact) => artifact.year >= FIRST_BRACKET_SEASON),
    refusedByConstruction: artifacts.filter((artifact) => artifact.year < FIRST_BRACKET_SEASON),
  };
}

function printRefusedByConstruction(refused: readonly DistrictArtifact[]): void {
  if (refused.length === 0) return;
  console.log(`refused by construction (no playoff bracket model before ${String(FIRST_BRACKET_SEASON)}), nothing loaded: ${refused.map((artifact) => artifact.districtKey).join(", ")}`);
}

/** The shard filter: every district season when no `--shard`, else the ones `assignShards` puts on shard k. */
export function inShard<T extends { readonly districtKey: string }>(items: readonly T[], shard: CliArgs["shard"], weightOf: (item: T) => number): T[] {
  if (shard === undefined) return [...items];
  const assigned = assignShards(items.map((item) => ({ key: item.districtKey, weight: weightOf(item) })), shard.n);
  return items.filter((item) => assigned.get(item.districtKey) === shard.k);
}

/** The district cutoff run's shard weight: its projected bakes, plus one so a season with none still spreads. */
export function districtCutoffWeight(artifact: DistrictArtifact): number {
  return projectedBakes(artifact).total + 1;
}

function dryRun(eligible: readonly DistrictArtifact[], refused: readonly DistrictArtifact[], cli: CliArgs): void {
  const selected = inShard(eligible, cli.shard, districtCutoffWeight);
  console.log(`DRY RUN: positions and projected GENERATED bakes, from ${LOCAL_DISTRICT_DIR} only${cli.shard === undefined ? "" : ` (shard ${String(cli.shard.k)}/${String(cli.shard.n)})`}`);
  let total = 0;
  for (const artifact of selected) {
    const refusal = refusalOf(artifact);
    if (refusal !== undefined) {
      console.log(`  ${artifact.districtKey.padEnd(9)} refused: ${refusal} (a result file is still written)`);
      continue;
    }
    const projection = projectedBakes(artifact);
    total += projection.total;
    console.log(`  ${artifact.districtKey.padEnd(9)} bakes ${String(projection.total).padStart(4)}   ${projection.positions.map((p) => `${p.label} ${String(p.generated)}/${String(p.openEvents)}`).join(", ")}`);
  }
  printRefusedByConstruction(refused);
  console.log(`district seasons ${String(selected.length)} (result files expected), projected GENERATED bakes ${String(total)}`);
}

async function fetchMode(eligible: readonly DistrictArtifact[], refused: readonly DistrictArtifact[], cli: CliArgs): Promise<void> {
  const cache = new OriginCache({ mode: "fill", origin: cli.origin });
  const version = await runVersionOf(cache, cli.version);
  console.log(`fill mode: ${cli.origin} into ${cache.root} at ${EVENT_ALGORITHM_ID}@${version}`);
  // Event artifacts: every district tier and dcmp tier event of the selected seasons.
  const wanted = new Set<string>();
  for (const artifact of eligible) {
    for (const key of districtEventKeysOf(artifact)) wanted.add(key);
    for (const key of dcmpEventKeysFor(artifact)) wanted.add(key);
    for (const event of champTierEvents(artifact)) wanted.add(event.eventKey);
  }
  let failures = 0;
  const keys = [...wanted].sort();
  console.log(`event artifacts wanted ${String(keys.length)}`);
  await Promise.all(
    keys.map(async (eventKey) => {
      try {
        await cache.get(eventArtifactKeyFor(eventKey, version), (body) => EventArtifactSchema.parse(body));
      } catch (error) {
        failures += 1;
        console.log(`  ${eventKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );
  console.log(`  event artifacts done: fetched ${String(cache.stats.fetched)}, not published (404) ${String(cache.stats.notFound)}, failed ${String(cache.stats.failed)}`);

  // As-of objects: every object a resolve names, at every stop either script reads. No simulation.
  for (const artifact of eligible) {
    if (refusalOf(artifact) !== undefined) continue;
    try {
      const fetchers = asOfFetchersFor(cache, artifact.year, version);
      const district = await loadEventArtifactsFromCache(cache, startedDistrictEventKeysOf(artifact), version);
      const ctx = districtTabContext(artifact, district.eventArtifacts);
      const sources = { eventArtifacts: district.eventArtifacts, unloadedEventKeys: district.missing };
      for (const { index } of measurementPositions(ctx.timeline)) {
        await loadAsOfRewind(rewindInputAt(ctx, index, districtStageAtPosition(ctx.timeline, index, ctx.nowStageByEvent), sources), fetchers);
      }
      const champ = await loadEventArtifactsFromCache(cache, startedChampEventKeysOf(artifact), version);
      const champCtx = champTabContext(artifact, champ.eventArtifacts);
      await loadAsOfRewind(
        rewindInputAt(champCtx, 0, districtStageAtPosition(champCtx.timeline, 0, champCtx.nowStageByEvent), { eventArtifacts: champ.eventArtifacts, unloadedEventKeys: champ.missing }),
        fetchers
      );
      process.stderr.write(`  ${artifact.districtKey} warm\n`);
    } catch (error) {
      failures += 1;
      console.log(`  ${artifact.districtKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
    cache.clearMemo();
  }
  printRefusedByConstruction(refused);
  // A caught error is a fetch failure (also in `stats.failed`) or a refusal
  // such as a version mismatch; the larger count is the honest floor.
  const failed = Math.max(failures, cache.stats.failed);
  console.log(
    `fetched ${String(cache.stats.fetched)} objects (${String(cache.stats.bytes)} bytes), not published (404) ${String(cache.stats.notFound)}, already cached ${String(cache.stats.hits)}, failed ${String(failed)}`
  );
}

async function runMode(eligible: readonly DistrictArtifact[], refused: readonly DistrictArtifact[], cli: CliArgs): Promise<void> {
  const cache = new OriginCache({ mode: "offline" });
  const version = await runVersionOf(cache, cli.version);
  const dir = resultDirFor(version, "district-cutoff");
  const selected = inShard(eligible, cli.shard, districtCutoffWeight);
  process.stderr.write(`district cutoff backtest at ${EVENT_ALGORITHM_ID}@${version}: ${String(selected.length)} district seasons into ${dir}\n`);
  printRefusedByConstruction(refused);
  for (const artifact of selected) {
    if (!cli.force && hasResultFile(dir, artifact.districtKey)) {
      process.stderr.write(`  ${artifact.districtKey} exists, skipped (--force reruns it)\n`);
      continue;
    }
    const started = Date.now();
    const memo = createRunMemo();
    let outcome: DistrictOutcome;
    const refusal = refusalOf(artifact);
    if (refusal !== undefined) {
      outcome = { ok: false, districtKey: artifact.districtKey, year: artifact.year, reason: refusal };
    } else {
      const loaded = await loadEventArtifactsFromCache(cache, startedDistrictEventKeysOf(artifact), version);
      outcome = await backtestDistrict(artifact, {
        eventArtifacts: loaded.eventArtifacts,
        unloadedEventKeys: loaded.missing,
        fetchers: asOfFetchersFor(cache, artifact.year, version),
        version,
        memo,
        draws: SIMULATION_DRAWS,
        seed: DEFAULT_SIMULATION_SEED,
      });
    }
    const elapsedMs = Date.now() - started;
    const file: DistrictCutoffResultFile = {
      kind: "district-cutoff",
      districtKey: artifact.districtKey,
      year: artifact.year,
      version,
      draws: SIMULATION_DRAWS,
      seed: DEFAULT_SIMULATION_SEED,
      elapsedMs,
      bakes: memo.stats.bakes,
      meanBakeMs: memo.stats.bakes === 0 ? 0 : memo.stats.bakeMs / memo.stats.bakes,
      realRuns: memo.stats.realRuns,
      outcome,
    };
    writeResultFile(dir, artifact.districtKey, file);
    cache.clearMemo();
    const scored = outcome.ok ? outcome.backtest.outcomes.filter((o) => o.kind === "scored").length : 0;
    process.stderr.write(
      `  ${artifact.districtKey} ${outcome.ok ? `done, ${String(scored)} scored` : `refused: ${outcome.reason}`}; bakes ${String(file.bakes)} at mean ${file.meanBakeMs.toFixed(0)} ms, real runs ${String(file.realRuns)}, ${(elapsedMs / 1000).toFixed(1)} s\n`
    );
  }
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function num(value: number | null, digits = 0): string {
  return value === null || Number.isNaN(value) ? "-" : value.toFixed(digits);
}

function pct(covered: number, n: number): string {
  return n === 0 ? "n/a" : `${((100 * covered) / n).toFixed(1)}%`;
}

function summaryLine(title: string, rows: readonly PositionRow[]): void {
  const s = summarize(rows);
  console.log(
    `  ${title.padEnd(16)} n=${pad(s.n, 4)}  vs settled: sim MAE ${pad(num(s.simulatedVsSettled.mae, 1), 5)} bias ${pad(num(s.simulatedVsSettled.bias, 1), 6)}  midpoint MAE ${pad(num(s.midpointVsSettled.mae, 1), 5)} bias ${pad(num(s.midpointVsSettled.bias, 1), 6)}  range holds ${pad(s.coveredSettled, 4)} (${pct(s.coveredSettled, s.n)})` +
      `   vs published: sim MAE ${pad(num(s.simulatedVsPublished.mae, 1), 5)}  midpoint MAE ${pad(num(s.midpointVsPublished.mae, 1), 5)}  holds ${pad(s.coveredPublished, 4)} of ${pad(s.nPublished, 4)} (${pct(s.coveredPublished, s.nPublished)})`
  );
}

const LEAK_CHECK_LABELS: Readonly<Record<keyof PositionLeakChecks, string>> = {
  awardsFromFinalEventsOnly: "award qualified only from award final events",
  earnedNeverAhead: "earned at position never above season final",
  openEventsOpenInRows: "open events open on every row",
  realRowsAfterCut: "REAL rows strictly after the cut, split exact",
  baselinesAtOrBeforeCut: "REAL baselines from rows at or before the cut",
  playedPlayoffsAtOrBeforeCut: "played playoff rows at or before the cut",
  generatedCarriesNoSchedule: "GENERATED requests carry no rows, no ratings",
};

async function reportMode(eligible: readonly DistrictArtifact[], refused: readonly DistrictArtifact[], cli: CliArgs): Promise<void> {
  const version = await runVersionOf(new OriginCache({ mode: "offline" }), cli.version);
  const dir = resultDirFor(version, "district-cutoff");
  const pooled = poolResultFiles<DistrictCutoffResultFile>(dir, eligible.map((artifact) => artifact.districtKey), version);
  if (pooled.status === "incomplete") {
    console.log(`NO-GO incomplete: ${String(pooled.missing.length)} of ${String(eligible.length)} district seasons have no result file in ${dir}: ${pooled.missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (pooled.status === "versionMismatch") {
    console.log(`NO-GO version mismatch: ${pooled.keys.join(", ")} were not written at ${EVENT_ALGORITHM_ID}@${version}`);
    process.exitCode = 1;
    return;
  }
  const backtests: DistrictBacktest[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const file of pooled.files) {
    if (file.outcome.ok) backtests.push(file.outcome.backtest);
    else skipped.push({ key: file.districtKey, reason: file.outcome.reason });
  }
  const rows: PositionRow[] = [];
  let settledCount = 0;
  const fallbacks: { key: string; positionId: string; excluded: number }[] = [];
  const noCalls: { key: string; positionId: string; reason: ChampNoCallReason }[] = [];
  for (const backtest of backtests) {
    for (const outcome of backtest.outcomes) {
      if (outcome.kind === "scored") rows.push(outcome.row);
      else if (outcome.kind === "settled") settledCount += 1;
      else if (outcome.kind === "excludedFallback") fallbacks.push({ key: backtest.districtKey, positionId: outcome.positionId, excluded: outcome.excluded });
      else noCalls.push({ key: backtest.districtKey, positionId: outcome.positionId, reason: outcome.reason });
    }
  }
  const summary = summarize(rows);
  const verdict = gateVerdict(summary);
  const leakKeys = Object.keys(LEAK_CHECK_LABELS) as (keyof PositionLeakChecks)[];
  const leakCounts = Object.fromEntries(leakKeys.map((key) => [key, rows.filter((row) => row.leaks[key]).length])) as Record<keyof PositionLeakChecks, number>;
  const leaksClean = leakKeys.every((key) => leakCounts[key] === rows.length);
  const unavailableByReason: Record<string, number> = {};
  for (const row of rows) for (const [name, count] of Object.entries(row.unavailable)) unavailableByReason[name] = (unavailableByReason[name] ?? 0) + count;
  const labels = [...new Set(rows.map((row) => row.label))].sort((a, b) => (a === "Season start" ? -1 : b === "Season start" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  const seasons = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);
  const eventsWithoutArtifact = backtests.reduce((sum, backtest) => sum + backtest.eventsWithoutArtifact.length, 0);
  const positionsWithUnpriced = rows.filter((row) => row.unpricedEvents > 0).length;
  const bakes = pooled.files.reduce((sum, file) => sum + file.bakes, 0);
  const bakeMs = pooled.files.reduce((sum, file) => sum + file.bakes * file.meanBakeMs, 0);
  const elapsedMs = pooled.files.reduce((sum, file) => sum + file.elapsedMs, 0);
  const realEvents = rows.reduce((sum, row) => sum + row.realEvents, 0);
  const generatedEvents = rows.reduce((sum, row) => sum + row.generatedEvents, 0);

  if (cli.json) {
    console.log(
      JSON.stringify(
        {
          version,
          path: "as-of",
          draws: SIMULATION_DRAWS,
          seed: DEFAULT_SIMULATION_SEED,
          summary,
          verdict,
          leakCounts,
          leaksClean,
          go: verdict.go && leaksClean,
          byWeek: Object.fromEntries(labels.map((label) => [label, summarize(rows.filter((row) => row.label === label))])),
          bySeason: Object.fromEntries(seasons.map((year) => [year, summarize(rows.filter((row) => row.year === year))])),
          districts: backtests.length,
          settledPositions: settledCount,
          fallbacks,
          noCalls,
          skipped,
          refusedByConstruction: refused.map((artifact) => artifact.districtKey),
          eventsWithoutArtifact,
          positionsWithUnpriced,
          unavailableByReason,
          realEvents,
          generatedEvents,
          bakes,
          meanBakeMs: bakes === 0 ? 0 : bakeMs / bakes,
          elapsedMs,
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("");
  console.log("DISTRICT CUTOFF BACKTEST: the District Locks simulated line at season start and after each week, walk-forward, on the as-of path");
  console.log(`  source: ${dir} (${String(pooled.files.length)} result files), event artifacts and as-of objects at ${EVENT_ALGORITHM_ID}@${version}`);
  console.log(`  draws ${String(SIMULATION_DRAWS)}, seed ${String(DEFAULT_SIMULATION_SEED)}; ${String(backtests.length)} district seasons, ${String(rows.length)} scored positions; bakes ${String(bakes)} at mean ${(bakes === 0 ? 0 : bakeMs / bakes).toFixed(0)} ms, ${(elapsedMs / 60_000).toFixed(1)} min summed`);
  console.log("  target: the tab's own settled cutoff at season end (midpoint rule over the final rows); TBA's published DCMP cut line reported beside it, not scored");
  console.log("");

  if (cli.verbose) {
    console.log("PER POSITION");
    console.log("  district  position                      slots  settled  pub   sim (p10 to p90)    midpoint  open  real  gen  unpriced");
    for (const row of rows) {
      console.log(
        `  ${row.districtKey.padEnd(9)} ${row.positionId.padEnd(29)} ${pad(row.dcmpSlots, 5)} ${pad(row.settled, 8)} ${pad(num(row.published), 4)}  ${pad(row.simulated, 4)} (${pad(row.p10, 3)} to ${pad(row.p90, 3)})${row.coversSettled ? " " : "*"}  ${pad(row.midpoint, 8)}  ${pad(row.openEvents, 4)}  ${pad(row.realEvents, 4)}  ${pad(row.generatedEvents, 3)}  ${pad(row.unpricedEvents, 8)}`
      );
    }
    console.log("  (* the printed range misses the settled cutoff)");
    console.log("");
  }

  console.log("BY POSITION (what the gate pools)");
  for (const label of labels) summaryLine(label, rows.filter((row) => row.label === label));
  summaryLine("All positions", rows);
  console.log("");

  console.log("BY SEASON");
  for (const year of seasons) summaryLine(String(year), rows.filter((row) => row.year === year));
  console.log("");

  console.log("POSITIONS NOT SCORED");
  console.log(`  settled (nothing open, midpoint rule printed)        ${String(settledCount)}`);
  console.log(`  excluded team fallback (midpoint, no likely range)   ${String(fallbacks.length)}${fallbacks.length === 0 ? "" : `  (${fallbacks.map((f) => `${f.key} ${f.positionId} x${String(f.excluded)}`).join(", ")})`}`);
  const noCallSeasons = new Map<number, number>();
  const noCallReasons = new Map<string, number>();
  for (const call of noCalls) {
    const year = Number(call.key.slice(0, 4));
    noCallSeasons.set(year, (noCallSeasons.get(year) ?? 0) + 1);
    noCallReasons.set(call.reason, (noCallReasons.get(call.reason) ?? 0) + 1);
  }
  console.log(
    `  no call                                              ${String(noCalls.length)}${
      noCalls.length === 0
        ? ""
        : `  by reason ${[...noCallReasons].map(([reason, count]) => `${reason} ${String(count)}`).join(", ")}; by season ${[...noCallSeasons]
            .sort((a, b) => a[0] - b[0])
            .map(([year, count]) => `${String(year)} ${String(count)}`)
            .join(", ")}`
    }`
  );
  console.log(`  district seasons skipped                             ${String(skipped.length)}`);
  for (const skip of skipped) console.log(`    ${skip.key}: ${skip.reason}`);
  if (refused.length > 0) console.log(`  refused by construction (before ${String(FIRST_BRACKET_SEASON)})                 ${String(refused.length)}: ${refused.map((artifact) => artifact.districtKey).join(", ")}`);
  console.log(`  started events with no artifact at the version       ${String(eventsWithoutArtifact)}; scored positions with an unpriced open event ${String(positionsWithUnpriced)}`);
  console.log("");

  console.log("PRICING AT SCORED POSITIONS");
  console.log(`  REAL events (as-of state)   ${String(realEvents)}`);
  console.log(`  GENERATED events (baked)    ${String(generatedEvents)}`);
  console.log(`  unavailable by reason       ${Object.keys(unavailableByReason).length === 0 ? "none" : Object.entries(unavailableByReason).map(([name, count]) => `${name} ${String(count)}`).join(", ")}`);
  console.log("");

  console.log(`LEAK CHECKS (positions passing, of ${String(rows.length)})`);
  for (const key of leakKeys) console.log(`  ${LEAK_CHECK_LABELS[key].padEnd(48)} ${String(leakCounts[key])}`);
  console.log("");

  console.log("GATE (registered before the run, re-registered unchanged 2026-10-14)");
  for (const condition of verdict.conditions) console.log(`  ${String(condition.id)}. ${condition.pass ? "PASS" : "FAIL"}  ${condition.label}: ${condition.detail}`);
  if (!leaksClean) console.log("  LEAK CHECK FAILED: a fact from after the position reached the rows or the plan");
  console.log("");
  console.log(verdict.go && leaksClean ? "GO" : "NO-GO");
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const cli = parseCli(argv);
  const { eligible, refusedByConstruction } = selectDistricts(cli);
  if (cli.dryRun) return dryRun(eligible, refusedByConstruction, cli);
  if (cli.fetch) return fetchMode(eligible, refusedByConstruction, cli);
  if (cli.report) return reportMode(eligible, refusedByConstruction, cli);
  return runMode(eligible, refusedByConstruction, cli);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:district-cutoff failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
