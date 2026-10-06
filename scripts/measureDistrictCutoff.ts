/**
 * THE DISTRICT CUTOFF BACKTEST (fast task 261006, todo
 * `district-cutoff-line-backtest`): the District Locks tab's simulated line,
 * walk-forward, at the season start and at the end of every competition week
 * of every district season on disk, against the cutoff that season settled on.
 *
 * Two modes:
 *
 *   npx tsx scripts/measureDistrictCutoff.ts --fetch [--origin URL] [--version V]
 *     Downloads every district tier event artifact the backtest needs into
 *     `data/local-publish/district-events/` (gitignored, read-only afterwards).
 *     The version defaults to the SPR entry of the published algorithms
 *     manifest. Files already on disk are not fetched again.
 *
 *   npx tsx scripts/measureDistrictCutoff.ts [--json] [--district KEY] [--seasons 2023,2024] [--verbose]
 *     The backtest and its pre-registered gate. Reads only local files.
 *
 * THE BROWSER'S OWN CODE, IN THE COMPONENT'S OWN ORDER. This script defines no
 * model: it calls `buildDistrictTimeline`, `districtStageAtPosition`,
 * `buildDistrictEventSimulationInput`, `simulateDistrictEvent`,
 * `buildDistrictLedgerRows`, `computeDistrictLedgerStatuses`,
 * `buildAdvancementChanceRun`, `advancementChances`, `predictedCutoff`,
 * `districtRangeState` and (through it) `simulatedLine`, which is the call
 * order `DistrictLedger.tsx` uses.
 *
 * THE POSITIONS. Season start, then the last rail step of each competition
 * week, exactly the jump chips the retired rewind slider supplied and
 * `measureChampCutoff.ts` still derives. A position where nothing is open any
 * more prints the midpoint rule, not a simulated line, and is counted as
 * settled rather than scored.
 *
 * THE WINDOW IS 2023 TO 2026 BY CONSTRUCTION. `simulateDistrictEvent` declares
 * a playoff bracket for 2023 and later only (the eight alliance double
 * elimination format), so every open event of an earlier season is refused,
 * no team's grand total can be built, and every 2016 to 2022 position reads
 * `noCall teamsExcluded`, exactly as the tab would. The report counts them
 * rather than hiding them. Measured 2026-10-06: 187 scored positions over 45
 * district seasons, simulated MAE 1.17 against the midpoint rule's 1.81, the
 * range holding the settled cutoff at 165 of 187 (88.2%), one position above
 * the band's ceiling; both bars are kept as registered.
 *
 * THE TARGET. The tab's own settled cutoff at season end: the midpoint of the
 * last team inside the slots and the first team outside them over the final
 * rows, which is what the District Locks tab prints once every team has
 * finished (`predictedCutoff`, kind `final`). The published DCMP cut line
 * (`insights.dcmpCutLinePoints`) is reported beside it, not scored: TBA's line
 * ranks a different total (all tiers, declines and ties included), so the two
 * are not the same quantity.
 *
 * PREDICT BEFORE UPDATE. Open events are priced from the first qualification
 * row after the position (`startMatchKeyAtPosition`), each row carrying the
 * prediction stored when it was played, made after every result before it.
 * That is the RETIRED stored odds rewind path, the same one the champ script's
 * earlier positions measure; the live tab now prices a rewound stop from the
 * as-of state (`asOfRewind.ts`), whose objects are not on disk. Alliance and
 * playoff cells read each event artifact's `teams[].metrics`, which are the
 * ratings at publish time; that is a known, bounded leak of the retired path
 * and is named in the report. Three leak checks per position prove the row
 * build itself reads nothing from after the position.
 *
 * THE GATE, registered before the first full run:
 *
 *   1. The simulated line's MAE against the settled cutoff is below the
 *      midpoint rule's MAE at the same positions.
 *   2. The printed 10 to 90 range holds the settled cutoff in 72% to 88% of
 *      the scored positions (nominal 80%), the champ line's own band.
 *
 * Both are read over every scored position pooled; the per week split is
 * reported and not gated.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DistrictArtifactSchema, EventArtifactSchema, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { advancementChances } from "../packages/core/districts/advancementChance.js";
import { simulateDistrictEvent } from "../packages/core/districts/ledgerSimulation.js";
import {
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  deriveStageFromState,
  distributionsFromResult,
  districtTierEvents,
  type DistrictEventDistributions,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import {
  buildDistrictTimeline,
  districtStageAtPosition,
  eventsWithOpenCategoriesAt,
  startMatchKeyAtPosition,
  timelineEventsOf,
  type DistrictTimeline,
} from "../apps/web/src/components/districts/districtTimeline.js";
import { districtMilestoneEvents } from "../apps/web/src/components/districts/districtMilestones.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildAdvancementChanceRun } from "../apps/web/src/components/districts/districtLedgerChances.js";
import { predictedCutoff, type ChampNoCallReason } from "../apps/web/src/components/districts/predictedCutoff.js";
import { districtRangeState } from "../apps/web/src/components/districts/ledgerRangeState.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import { loadDistrictArtifacts, LOCAL_DISTRICT_DIR } from "./measureChampCutoff.js";

/** Where `--fetch` writes and the backtest reads one event artifact per district tier event. Read-only after the fetch, gitignored. */
export const LOCAL_EVENT_DIR = "data/local-publish/district-events";
/** The algorithm the District Locks tab pins its event artifacts to (`useDistrictLedgerData.ts`). */
export const EVENT_ALGORITHM_ID = "spr";
const DEFAULT_ORIGIN = "https://data.sigmascout.org";
const MANIFEST_KEY = "v1/manifest/algorithms.json";
const FETCH_CONCURRENCY = 16;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Every district tier event key of one district season, sorted. */
export function districtEventKeysOf(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) for (const entry of districtTierEvents(team)) keys.add(entry.eventKey);
  return [...keys].sort();
}

/** The event artifacts on disk for one district, schema validated. An event with no file is simply absent from the map. */
export function loadEventArtifacts(artifact: DistrictArtifact, dir: string = LOCAL_EVENT_DIR): Map<string, EventArtifact> {
  const out = new Map<string, EventArtifact>();
  for (const eventKey of districtEventKeysOf(artifact)) {
    const path = join(dir, `${eventKey}.json`);
    if (!existsSync(path)) continue;
    out.set(eventKey, EventArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// --fetch
// ---------------------------------------------------------------------------

async function sprVersionFromManifest(origin: string): Promise<string> {
  const res = await fetch(`${origin}/${MANIFEST_KEY}?cb=${String(Date.now())}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${String(res.status)}`);
  const manifest = (await res.json()) as { algorithms: { id: string; version: string }[] };
  const entry = manifest.algorithms.find((algorithm) => algorithm.id === EVENT_ALGORITHM_ID);
  if (entry === undefined) throw new Error(`manifest carries no ${EVENT_ALGORITHM_ID} entry`);
  return entry.version;
}

async function fetchEventArtifacts(artifacts: readonly DistrictArtifact[], origin: string, version: string | undefined): Promise<void> {
  const resolved = version ?? (await sprVersionFromManifest(origin));
  mkdirSync(LOCAL_EVENT_DIR, { recursive: true });
  const wanted = new Set<string>();
  for (const artifact of artifacts) for (const key of districtEventKeysOf(artifact)) wanted.add(key);
  const pending = [...wanted].filter((key) => !existsSync(join(LOCAL_EVENT_DIR, `${key}.json`))).sort();
  console.log(`event artifacts wanted ${String(wanted.size)}, on disk ${String(wanted.size - pending.length)}, fetching ${String(pending.length)} at ${EVENT_ALGORITHM_ID}@${resolved}`);
  let fetched = 0;
  let missing = 0;
  let failed = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= pending.length) return;
      const eventKey = pending[index]!;
      const url = `${origin}/v1/event/${eventKey}/${EVENT_ALGORITHM_ID}@${resolved}.json`;
      try {
        const res = await fetch(url);
        if (res.status === 404) {
          missing += 1;
          continue;
        }
        if (!res.ok) {
          failed += 1;
          console.log(`  ${eventKey}: HTTP ${String(res.status)}`);
          continue;
        }
        const text = await res.text();
        EventArtifactSchema.parse(JSON.parse(text));
        writeFileSync(join(LOCAL_EVENT_DIR, `${eventKey}.json`), text);
        fetched += 1;
        if (fetched % 100 === 0) console.log(`  ${String(fetched)} fetched`);
      } catch (error) {
        failed += 1;
        console.log(`  ${eventKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));
  console.log(`fetched ${String(fetched)}, not published (404) ${String(missing)}, failed ${String(failed)}`);
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
  /** Open events that had no artifact on disk or whose simulation the core refused: their cells read unavailable. */
  readonly unpricedEvents: number;
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
  /** District tier events with no artifact on disk. */
  readonly eventsWithoutArtifact: readonly string[];
}

export type DistrictOutcome =
  | { readonly ok: true; readonly backtest: DistrictBacktest }
  | { readonly ok: false; readonly districtKey: string; readonly year: number; readonly reason: string };

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

/** The component's own timeline, from the district's district tier events and every artifact on disk. */
export function districtTimelineOf(artifact: DistrictArtifact, eventArtifacts: ReadonlyMap<string, EventArtifact>): DistrictTimeline {
  const byKey = new Map<string, { eventKey: string; eventName: string; week: number | null }>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (!byKey.has(entry.eventKey)) byKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week });
    }
  }
  return buildDistrictTimeline({ events: timelineEventsOf([...byKey.values()], districtMilestoneEvents(artifact, ["district"])), eventArtifacts });
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

/** The distributions the tab would hold at a position: every open event simulated from the first row after the position. */
function distributionsAtPosition(
  artifact: DistrictArtifact,
  timeline: DistrictTimeline,
  index: number,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality>,
  eventArtifacts: ReadonlyMap<string, EventArtifact>
): { distributions: Map<string, DistrictEventDistributions>; unpriced: number } {
  const distributions = new Map<string, DistrictEventDistributions>();
  let unpriced = 0;
  for (const eventKey of eventsWithOpenCategoriesAt(stageByEvent)) {
    const eventArtifact = eventArtifacts.get(eventKey);
    const stage = stageByEvent.get(eventKey);
    if (eventArtifact === undefined || stage === undefined) {
      unpriced += 1;
      continue;
    }
    const built = buildDistrictEventSimulationInput({
      eventKey,
      season: artifact.year,
      eventArtifact,
      districtArtifact: artifact,
      stage,
      startMatchKey: startMatchKeyAtPosition(timeline, index, eventKey),
      conditionOnPlayedElims: false,
      tier: "district",
    });
    if (!built.ok) {
      unpriced += 1;
      continue;
    }
    // PER EVENT FAILURE IS ISOLATED, as `runDistrictSimulationJob` isolates it.
    try {
      distributions.set(eventKey, distributionsFromResult(simulateDistrictEvent(built.input, SIMULATION_DRAWS, DEFAULT_SIMULATION_SEED)));
    } catch {
      unpriced += 1;
    }
  }
  return { distributions, unpriced };
}

/** The whole District Locks pipeline at one rail position, in the component's call order. */
function runAtPosition(
  artifact: DistrictArtifact,
  timeline: DistrictTimeline,
  index: number,
  label: string,
  nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>,
  eventArtifacts: ReadonlyMap<string, EventArtifact>,
  settled: number,
  draws: number,
  seed: number
): PositionOutcome {
  const positionId = timeline.positions[index]!.id;
  const stageByEvent = districtStageAtPosition(timeline, index, nowStageByEvent);
  const { distributions, unpriced } = distributionsAtPosition(artifact, timeline, index, stageByEvent, eventArtifacts);

  const rows = buildDistrictLedgerRows({ artifact, distributions, stageByEvent, tier: "district" });
  const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
  const chanceRun = buildAdvancementChanceRun({ artifact, teams: rows.teams, statuses, runSignature: "", positionId });
  const result = chanceRun === undefined ? undefined : advancementChances(chanceRun.inputs, draws, seed);
  const qualifiers = { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) };
  const boundary = predictedCutoff({ teams: rows.teams, capacity: artifact.dcmpSlots, qualifiers, reservedSlots: statuses.reservedSlots });

  const state = districtRangeState({
    boundaryKind: boundary.kind,
    perEventRunSignature: "",
    run: {
      built: chanceRun !== undefined,
      status: result === undefined ? "idle" : "complete",
      current: true,
      excludedTeams: chanceRun?.excludedTeams ?? [],
      ...(result?.cutoffByRun === undefined ? {} : { cutoffByRun: result.cutoffByRun }),
      ...(result === undefined ? {} : { draws: result.draws }),
    },
  });

  // `districtRangeState` reads `settled` for every boundary kind but `predicted`, so past this check the midpoint exists.
  if (boundary.kind !== "predicted") return { kind: "settled", positionId, label };
  const midpoint = boundary.points;
  if (state.kind === "settled") return { kind: "excludedFallback", positionId, label, excluded: chanceRun?.excludedTeams.length ?? 0 };
  if (state.kind === "noCall") return { kind: "noCall", positionId, label, reason: state.reason };
  if (state.kind === "pending") return { kind: "noCall", positionId, label, reason: "runRefused" };

  // The leak checks: nothing after the position reached the rows.
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const rowByTeam = new Map(rows.teams.map((team) => [team.teamKey, team] as const));
  const openKeys = new Set(eventsWithOpenCategoriesAt(stageByEvent));
  const leaks: PositionLeakChecks = {
    awardsFromFinalEventsOnly: statuses.awardQualified.every((teamKey) => {
      const team = sourceByKey.get(teamKey);
      return team !== undefined && team.qualifyingAwards.some((award) => stageByEvent.get(award.eventKey)?.award === true);
    }),
    earnedNeverAhead: rows.teams.every((team) => team.earnedAtPosition <= team.earnedDistrictTotal + 1e-9),
    openEventsOpenInRows: rows.teams.every((team) => team.rows.every((row) => !openKeys.has(row.eventKey) || !isAllFinal(row.stage.final))),
  };
  void rowByTeam;

  const published = artifact.insights.dcmpCutLinePoints;
  const p10 = Math.round(state.likely.p10);
  const p90 = Math.round(state.likely.p90);
  return {
    kind: "scored",
    row: {
      districtKey: artifact.districtKey,
      year: artifact.year,
      positionIndex: index,
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
      unpricedEvents: unpriced,
      leaks,
    },
  };
}

export interface BacktestOptions {
  readonly draws?: number;
  readonly seed?: number;
}

/**
 * One district season at every measurement position. Refuses a district with
 * no published capacity, one whose district tier season is not finished (its
 * settled cutoff does not exist yet), and one whose settled cutoff is absent
 * (every team inside the slots).
 */
export function backtestDistrict(artifact: DistrictArtifact, eventArtifacts: ReadonlyMap<string, EventArtifact>, options: BacktestOptions = {}): DistrictOutcome {
  const draws = options.draws ?? SIMULATION_DRAWS;
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const fail = (reason: string): DistrictOutcome => ({ ok: false, districtKey: artifact.districtKey, year: artifact.year, reason });
  if (artifact.dcmpSlots === null) return fail("no published dcmpSlots");
  const nowStageByEvent = nowStageByEventOf(artifact);
  if (nowStageByEvent.size === 0) return fail("no district tier events");
  for (const [eventKey, stage] of nowStageByEvent) if (!isAllFinal(stage)) return fail(`district event ${eventKey} is not final`);

  // The settled target: the tab's own rule over the final rows.
  const finalRows = buildDistrictLedgerRows({ artifact, distributions: new Map(), stageByEvent: nowStageByEvent, tier: "district" });
  const finalStatuses = computeDistrictLedgerStatuses({ artifact, teams: finalRows.teams });
  const finalCutoff = predictedCutoff({
    teams: finalRows.teams,
    capacity: artifact.dcmpSlots,
    qualifiers: { awardQualified: new Set(finalStatuses.awardQualified), prequalified: new Set(finalStatuses.prequalified) },
    reservedSlots: finalStatuses.reservedSlots,
  });
  if (finalCutoff.kind !== "final") return fail(`settled cutoff is ${finalCutoff.kind}, not final`);

  const timeline = districtTimelineOf(artifact, eventArtifacts);
  const outcomes = measurementPositions(timeline).map(({ index, label }) =>
    runAtPosition(artifact, timeline, index, label, nowStageByEvent, eventArtifacts, finalCutoff.points, draws, seed)
  );
  return {
    ok: true,
    backtest: {
      districtKey: artifact.districtKey,
      year: artifact.year,
      settled: finalCutoff.points,
      published: artifact.insights.dcmpCutLinePoints,
      outcomes,
      eventsWithoutArtifact: districtEventKeysOf(artifact).filter((key) => !eventArtifacts.has(key)),
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
// Reporting
// ---------------------------------------------------------------------------

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

interface CliArgs {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly fetch: boolean;
  readonly origin: string;
  readonly version: string | undefined;
  readonly district: string | undefined;
  readonly seasons: ReadonlySet<number> | undefined;
}

function parseCli(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      fetch: { type: "boolean", default: false },
      origin: { type: "string" },
      version: { type: "string" },
      district: { type: "string" },
      seasons: { type: "string" },
    },
    strict: true,
  });
  return {
    json: values.json,
    verbose: values.verbose,
    fetch: values.fetch,
    origin: values.origin ?? DEFAULT_ORIGIN,
    version: values.version,
    district: values.district,
    seasons: values.seasons === undefined ? undefined : new Set(values.seasons.split(",").map((part) => Number(part.trim()))),
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const cli = parseCli(argv);
  let artifacts = loadDistrictArtifacts(LOCAL_DISTRICT_DIR);
  if (cli.district !== undefined) artifacts = artifacts.filter((artifact) => artifact.districtKey === cli.district);
  if (cli.seasons !== undefined) artifacts = artifacts.filter((artifact) => cli.seasons!.has(artifact.year));

  if (cli.fetch) {
    await fetchEventArtifacts(artifacts, cli.origin, cli.version);
    return;
  }

  const started = Date.now();
  const backtests: DistrictBacktest[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const artifact of artifacts) {
    const outcome = backtestDistrict(artifact, loadEventArtifacts(artifact));
    if (outcome.ok) backtests.push(outcome.backtest);
    else skipped.push({ key: artifact.districtKey, reason: outcome.reason });
    if (!cli.json) process.stderr.write(`  ${artifact.districtKey} ${outcome.ok ? "done" : `skipped: ${outcome.reason}`}\n`);
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
  const leakCounts = {
    awardsFromFinalEventsOnly: rows.filter((row) => row.leaks.awardsFromFinalEventsOnly).length,
    earnedNeverAhead: rows.filter((row) => row.leaks.earnedNeverAhead).length,
    openEventsOpenInRows: rows.filter((row) => row.leaks.openEventsOpenInRows).length,
  };
  const leaksClean = Object.values(leakCounts).every((count) => count === rows.length);
  const labels = [...new Set(rows.map((row) => row.label))].sort((a, b) => (a === "Season start" ? -1 : b === "Season start" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  const seasons = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);
  const eventsWithoutArtifact = backtests.reduce((sum, backtest) => sum + backtest.eventsWithoutArtifact.length, 0);
  const positionsWithUnpriced = rows.filter((row) => row.unpricedEvents > 0).length;

  if (cli.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          verdict,
          leakCounts,
          byWeek: Object.fromEntries(labels.map((label) => [label, summarize(rows.filter((row) => row.label === label))])),
          bySeason: Object.fromEntries(seasons.map((year) => [year, summarize(rows.filter((row) => row.year === year))])),
          districts: backtests.length,
          settledPositions: settledCount,
          fallbacks,
          noCalls,
          skipped,
          eventsWithoutArtifact,
          positionsWithUnpriced,
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("");
  console.log("DISTRICT CUTOFF BACKTEST: the District Locks simulated line at season start and after each week, walk-forward");
  console.log(`  source: ${LOCAL_DISTRICT_DIR} and ${LOCAL_EVENT_DIR} (read-only, no network)`);
  console.log(`  draws ${String(SIMULATION_DRAWS)}, seed ${String(DEFAULT_SIMULATION_SEED)}; ${String(backtests.length)} district seasons, ${String(rows.length)} scored positions, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log("  target: the tab's own settled cutoff at season end (midpoint rule over the final rows); TBA's published DCMP cut line reported beside it, not scored");
  console.log("");

  if (cli.verbose) {
    console.log("PER POSITION");
    console.log("  district  position                      slots  settled  pub   sim (p10 to p90)    midpoint  open  unpriced");
    for (const row of rows) {
      console.log(
        `  ${row.districtKey.padEnd(9)} ${row.positionId.padEnd(29)} ${pad(row.dcmpSlots, 5)} ${pad(row.settled, 8)} ${pad(num(row.published), 4)}  ${pad(row.simulated, 4)} (${pad(row.p10, 3)} to ${pad(row.p90, 3)})${row.coversSettled ? " " : "*"}  ${pad(row.midpoint, 8)}  ${pad(row.openEvents, 4)}  ${pad(row.unpricedEvents, 8)}`
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
  console.log(`  district tier events with no artifact on disk        ${String(eventsWithoutArtifact)}; scored positions with an unpriced open event ${String(positionsWithUnpriced)}`);
  console.log("");

  console.log(`LEAK CHECKS (positions passing, of ${String(rows.length)})`);
  console.log(`  award qualified only from award final events   ${String(leakCounts.awardsFromFinalEventsOnly)}`);
  console.log(`  earned at position never above season final    ${String(leakCounts.earnedNeverAhead)}`);
  console.log(`  open events open on every row                  ${String(leakCounts.openEventsOpenInRows)}`);
  console.log("  known, bounded: alliance and playoff cells read each event artifact's publish time ratings (the retired stored odds path)");
  console.log("");

  console.log("GATE (registered before the run)");
  for (const condition of verdict.conditions) console.log(`  ${String(condition.id)}. ${condition.pass ? "PASS" : "FAIL"}  ${condition.label}: ${condition.detail}`);
  if (!leaksClean) console.log("  LEAK CHECK FAILED: a fact from after the position reached the rows");
  console.log("");
  console.log(verdict.go && leaksClean ? "GO" : "NO-GO");
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:district-cutoff failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
