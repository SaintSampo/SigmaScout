/**
 * SEASON START "IN RANGE" TO "LOCKED AT END" (quick task 261014-hx6), for both
 * Locks tabs, on the as-of path. REPORT ONLY: this figure is never published.
 *
 * For every district season of 2023 to 2026: the teams each tab shows In range
 * at the season start, and how many of them end the season locked.
 *
 *   npx tsx scripts/measureLocksInRange.ts [--district KEY] [--seasons ...] [--shard k/n] [--force] [--version V]
 *     One result file per district season, reading only the origin cache
 *     `measureDistrictCutoff.ts --fetch` filled.
 *
 *   npx tsx scripts/measureLocksInRange.ts --report [--json]
 *     Pools every file; refuses an incomplete set.
 *
 * THE DISTRICT TAB is `measureDistrictCutoff.ts`' own `districtTabAtPosition`
 * at index 0, the same call the backtest scores, so its season start state is
 * the backtest's. In range is the shown chip (`applyChampionshipFieldOverlay`
 * at a rewound position, then `applyLedgerRangeState`).
 *
 * THE CHAMP TAB restates `ChampLocksLedger.tsx` lines 391 to 905 at a rewound
 * stop (`atNow` false, so `fieldProven` is true and `finalsMayBeAbsent` false)
 * as plain calls, in the component's order, each block commented with its
 * line range: the champ tier events with every district team as the first
 * championship's roster, the main run with the unstarted championships
 * skipped, the district pass and the district range state as that tab shows
 * it, then THE SIMULATED DCMP BAKE (`dcmpSimulatedField`,
 * `assembleSimulatedDcmpBake`, the Worker job, `simulatedDcmpBakeView`), the
 * estimates, the champ rows, verdicts, award draws and chance run under the
 * signature `${main}#${bake}`, the champ range state and the shown chips. A
 * district whose bake reads unavailable is reported with the state the tab
 * would show there and the reason.
 *
 * THE FINALS. The district tab's yardstick is `districtTierFinalVerdicts`
 * (`measureLedgerTenets.ts`); the champ tab's is each team's published
 * `champLock.status`. Locked counts `locked` plus `lockedAward`. Prequalified
 * is counted on its own and never as locked. `contending` (a tie at the line)
 * counts as not locked.
 *
 * HISTORY: THE RETIRED STORED ODDS PATH (the 2026-10-14 scratch report,
 * before this script existed). Pooled over every district season on disk:
 * district tab 82.6% (2,650 of 3,207) In range at season start ended locked,
 * points only 72.1%; champ tab 85.0% (612 of 720), points only 66.8%. 2024
 * Chesapeake's champ tab read noCall there, because 2024mdsev carries a
 * `frc0` placeholder team.
 *
 * MEASURED ON THE AS-OF PATH (quick task 261014-hx6, run 2026-10-14 at
 * spr@11.0.0+baseline, 48 result files, report only, never published).
 * Pooled from summed counts: district tab 73.9% (2,338 of 3,165) In range at
 * season start ended locked, points only 63.2% (2,000), 37 ties at the line,
 * 790 not locked; champ tab 65.6% (582 of 887), points only 50.6% (449), 2
 * ties at the line, 303 not locked; no prequalified on either tab. The champ
 * side ran the simulated DCMP bake. Against the retired path (82.6% and
 * 85.0%) the as-of numbers are lower on both tabs, as expected: that path
 * priced open events with odds that already knew the weeks after the stop.
 */
import { pathToFileURL } from "node:url";
import type { DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import { advancementChances, type AdvancementChanceResult } from "../packages/core/districts/advancementChance.js";
import { champCutoffTuning } from "../packages/core/districts/hypotheticalDcmp.js";
import { buildDistrictLedgerRows } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { districtStageAtPosition, eventStartedAtPosition } from "../apps/web/src/components/districts/districtTimeline.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildAdvancementChanceRun } from "../apps/web/src/components/districts/districtLedgerChances.js";
import { predictedCutoff } from "../apps/web/src/components/districts/predictedCutoff.js";
import { applyLedgerRangeState, districtRangeState } from "../apps/web/src/components/districts/ledgerRangeState.js";
import { asOfScheduleStopEventKey, loadAsOfRewind } from "../apps/web/src/components/districts/asOfRewind.js";
import { assembleSimulatedDcmpBake, simulatedDcmpBakeView, type AssembledSimulatedDcmpBake, type SimulatedDcmpBakeViewParams } from "../apps/web/src/components/districts/districtRunAssembly.js";
import { buildChampLedgerRows, champFieldMembership, dcmpStartedForTeam, type SimulatedDcmpPricing } from "../apps/web/src/components/districts/champLedgerRows.js";
import { applyChampRangeState, computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";
import {
  buildChampAdvancementChanceRun,
  buildChampAwardDraws,
  champDcmpAwardsFinal,
  champFieldChances,
  champRangeState,
  dcmpSimulatedField,
  hypotheticalDcmpEstimates,
  simulatedDcmpState,
} from "../apps/web/src/components/districts/champLedgerChances.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import { districtTierFinalVerdicts } from "./measureLedgerTenets.js";
import {
  EVENT_ALGORITHM_ID,
  FIRST_BRACKET_SEASON,
  OriginCache,
  asOfFetchersFor,
  champTabContext,
  createRunMemo,
  districtEventKeysOf,
  districtTabAtPosition,
  districtTabContext,
  hasResultFile,
  inShard,
  loadEventArtifactsFromCache,
  parseCli,
  poolResultFiles,
  pricedRunAtStop,
  resultDirFor,
  rewindInputAt,
  runSingleRequest,
  runVersionOf,
  selectDistricts,
  startedChampEventKeysOf,
  startedDistrictEventKeysOf,
  writeResultFile,
  type ChampTabContext,
  type CliArgs,
  type DistrictTabContext,
  type TabSources,
} from "./measureDistrictCutoff.js";

// ---------------------------------------------------------------------------
// The tally
// ---------------------------------------------------------------------------

export interface InRangeTally {
  readonly inRange: number;
  readonly lockedPoints: number;
  readonly lockedAward: number;
  readonly prequalified: number;
  /** `contending` at the end: a tie at the line, counted as not locked. */
  readonly tieAtLine: number;
  readonly notLocked: number;
}

const EMPTY_TALLY: InRangeTally = { inRange: 0, lockedPoints: 0, lockedAward: 0, prequalified: 0, tieAtLine: 0, notLocked: 0 };

/** The season start In range teams against their final status. Locked is `locked` plus `lockedAward`; prequalified is its own count. */
export function tallyInRange(inRange: readonly string[], finals: ReadonlyMap<string, string>): InRangeTally {
  let lockedPoints = 0;
  let lockedAward = 0;
  let prequalified = 0;
  let tieAtLine = 0;
  let notLocked = 0;
  for (const teamKey of inRange) {
    const status = finals.get(teamKey);
    if (status === "locked") lockedPoints += 1;
    else if (status === "lockedAward") lockedAward += 1;
    else if (status === "prequalified") prequalified += 1;
    else if (status === "contending") tieAtLine += 1;
    else notLocked += 1;
  }
  return { inRange: inRange.length, lockedPoints, lockedAward, prequalified, tieAtLine, notLocked };
}

export function sumTallies(tallies: readonly InRangeTally[]): InRangeTally {
  return tallies.reduce(
    (sum, t) => ({
      inRange: sum.inRange + t.inRange,
      lockedPoints: sum.lockedPoints + t.lockedPoints,
      lockedAward: sum.lockedAward + t.lockedAward,
      prequalified: sum.prequalified + t.prequalified,
      tieAtLine: sum.tieAtLine + t.tieAtLine,
      notLocked: sum.notLocked + t.notLocked,
    }),
    EMPTY_TALLY
  );
}

/** Locked (on points or by award) of In range, from summed counts; `null` with nobody In range. */
export function lockedRate(tally: InRangeTally): number | null {
  return tally.inRange === 0 ? null : (tally.lockedPoints + tally.lockedAward) / tally.inRange;
}

/** Locked on points alone of In range, from summed counts. */
export function pointsOnlyRate(tally: InRangeTally): number | null {
  return tally.inRange === 0 ? null : tally.lockedPoints / tally.inRange;
}

// ---------------------------------------------------------------------------
// One tab at the season start
// ---------------------------------------------------------------------------

export interface TabInRange {
  /** The range state as the tab reads it: `simulated`, `pending`, `noCall:<reason>` or `settled:<kind>`. */
  readonly state: string;
  readonly line?: { readonly points: number; readonly p10: number; readonly p90: number };
  /** Open events with no distribution at the stop. */
  readonly unpriced: number;
  readonly inRange: readonly string[];
  readonly tally: InRangeTally;
  /** The champ tab only: the simulated DCMP bake as the rows read it, and why it is not ready. */
  readonly bake?: { readonly status: string; readonly reason?: string };
}

function rangeLabel(state: { readonly kind: string; readonly reason?: string }, boundaryKind?: string): string {
  if (state.kind === "noCall") return `noCall:${state.reason ?? ""}`;
  if (state.kind === "settled" && boundaryKind !== undefined) return `settled:${boundaryKind}`;
  return state.kind;
}

function inRangeOf(display: { readonly byTeam: ReadonlyMap<string, { readonly status: string }> }): string[] {
  const out: string[] = [];
  for (const [teamKey, result] of display.byTeam) if (result.status === "inRange") out.push(teamKey);
  return out.sort();
}

function distinctUnavailable(events: readonly { readonly eventKey: string }[]): number {
  return new Set(events.map((event) => event.eventKey)).size;
}

/** The District Locks tab at the season start: the backtest's own call at index 0. */
export async function districtSeasonStart(ctx: DistrictTabContext, sources: TabSources): Promise<TabInRange> {
  const tab = await districtTabAtPosition(ctx, 0, sources);
  const inRange = inRangeOf(tab.display);
  const state = tab.rangeState;
  return {
    state: rangeLabel(state, tab.boundary.kind),
    ...(state.kind === "simulated" ? { line: { points: state.points, p10: Math.round(state.likely.p10), p90: Math.round(state.likely.p90) } } : {}),
    unpriced: distinctUnavailable(tab.priced.unavailableEvents),
    inRange,
    tally: tallyInRange(inRange, districtTierFinalVerdicts(ctx.artifact)),
  };
}

/**
 * The Champ Locks tab at one rewound stop, `ChampLocksLedger.tsx` lines 391 to
 * 905 with `atNow` false: `fieldProven` true and `finalsMayBeAbsent` false.
 */
export async function champTabAtPosition(ctx: ChampTabContext, positionIndex: number, sources: TabSources) {
  const { artifact, timeline, dcmpEventKeys } = ctx;
  const fieldProven = true;
  const positionId = timeline.positions[positionIndex]!.id;
  // Lines 498 to 517: the FIELD and the NUMBER readings at the stop.
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, ctx.nowStageByEvent);
  const finalByEvent = districtStageAtPosition(timeline, positionIndex, ctx.nowFinalByEvent);
  // Lines 529 to 550: the as-of load, the first championship over every district team.
  const rewind = await loadAsOfRewind(rewindInputAt(ctx, positionIndex, stageByEvent, sources), sources.fetchers);
  // Lines 567 to 574: the championships whose field is a fact at the stop.
  const scheduleStopEventKey = asOfScheduleStopEventKey(positionId);
  const startedDcmpEventKeys = new Set(dcmpEventKeys.filter((key) => eventStartedAtPosition(timeline, positionIndex, key) || key === scheduleStopEventKey));
  // Lines 600 to 604: an unstarted championship stays out of the main run.
  const notStarted = dcmpEventKeys.filter((key) => !startedDcmpEventKeys.has(key));
  const skipEventKeys = notStarted.length === 0 ? undefined : new Set(notStarted);
  // Lines 606 to 617: the data hook.
  const priced = pricedRunAtStop({
    artifact,
    result: rewind,
    algorithmVersion: sources.version,
    eventArtifacts: sources.eventArtifacts,
    stageByEvent,
    pointsFinalByEvent: finalByEvent,
    allowedEventKeys: ctx.allowedEventKeys,
    tierByEvent: ctx.tierByEvent,
    skipEventKeys,
    memo: sources.memo,
    draws: sources.draws,
    seed: sources.seed,
  });
  // Lines 630 to 644: both passes read the number, and the field for the not picked note.
  const passOptions = {
    artifact,
    distributions: priced.distributions,
    stageByEvent: finalByEvent,
    fieldStageByEvent: stageByEvent,
    unavailableEvents: priced.unavailableEvents,
    gaps: { ...priced.gaps, missingEventArtifacts: sources.unloadedEventKeys },
    distributionsPending: false,
  };
  // Lines 651 to 660: the district tier pass.
  const districtRows = buildDistrictLedgerRows({ ...passOptions, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);
  // Lines 662 to 690: the district chance run and the field chance.
  const runSignature = priced.runSignature;
  const districtChanceRun = buildAdvancementChanceRun({ artifact, teams: districtRows.teams, statuses: districtStatuses, runSignature, positionId });
  const districtChance: AdvancementChanceResult | undefined = districtChanceRun === undefined ? undefined : advancementChances(districtChanceRun.inputs, sources.draws, sources.seed);
  const districtTierSettled = !districtRows.teams.some((team) => team.hasOpenCategory);
  const fieldChanceByTeam = champFieldChances(districtStatuses, districtChance?.chanceByTeam, districtTierSettled && districtChanceRun === undefined);
  // Lines 700 to 732: the district tier as the District Locks tab shows it.
  const districtBoundaryKind = predictedCutoff({
    teams: districtRows.teams,
    capacity: artifact.dcmpSlots,
    qualifiers: { awardQualified: new Set(districtStatuses.awardQualified), prequalified: new Set(districtStatuses.prequalified) },
    reservedSlots: districtStatuses.reservedSlots,
  }).kind;
  const districtShownRange = districtRangeState({
    boundaryKind: districtBoundaryKind,
    perEventRunSignature: runSignature ?? "",
    perEventRunFailed: priced.runFailed,
    run: {
      built: districtChanceRun !== undefined,
      status: districtChance === undefined ? "idle" : "complete",
      current: true,
      excludedTeams: districtChanceRun?.excludedTeams ?? [],
      ...(districtChance?.cutoffByRun === undefined ? {} : { cutoffByRun: districtChance.cutoffByRun }),
      ...(districtChance === undefined ? {} : { draws: districtChance.draws }),
    },
  });
  const districtShown = applyLedgerRangeState(districtStatuses, districtRows.teams, districtShownRange);

  // Lines 741 to 757 and `useSimulatedDcmpBake.ts`: THE SIMULATED DCMP BAKE.
  const simulatedDcmpActive = dcmpEventKeys.length > 0 && startedDcmpEventKeys.size === 0;
  const simulatedField = simulatedDcmpActive ? dcmpSimulatedField(districtShown, districtShownRange) : undefined;
  const eventKey = dcmpEventKeys[0];
  const assembled: AssembledSimulatedDcmpBake | undefined =
    simulatedDcmpActive && simulatedField?.status === "ready" && eventKey !== undefined
      ? assembleSimulatedDcmpBake({ artifact, result: rewind, algorithmVersion: sources.version, eventKey, roster: simulatedField.roster })
      : undefined;
  const bakeSignature = assembled?.status === "ready" ? assembled.signature : "";
  let runState: SimulatedDcmpBakeViewParams["runState"] = { status: "idle" };
  let bakeReason: string | undefined;
  if (assembled?.status === "ready") {
    const outcome = runSingleRequest(assembled.request, sources.version, sources.memo, sources.draws, sources.seed);
    if (outcome.failed) {
      runState = { status: "error" };
      bakeReason = "the bake request was refused as malformed";
    } else {
      runState = { status: "complete", signature: assembled.signature, events: [outcome.entry] };
      if (outcome.entry.status === "unavailable") bakeReason = `${outcome.entry.name}: ${outcome.entry.message}`;
    }
  } else if (assembled?.status === "unavailable") {
    bakeReason = assembled.reason;
  } else if (simulatedField !== undefined && simulatedField.status !== "ready") {
    bakeReason = `the simulated field is ${simulatedField.status}`;
  }
  const bake = simulatedDcmpBakeView({ asOf: { status: "ready" }, assembled, runState });
  const simulatedDcmp: SimulatedDcmpPricing | undefined = simulatedField === undefined ? undefined : { field: simulatedField, bake };
  const simulatedDcmpStatus = simulatedDcmp === undefined ? undefined : simulatedDcmpState(simulatedDcmp);

  // Lines 767 to 780: the DCMP estimate by field rank.
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const estimates = hypotheticalDcmpEstimates({
    season: artifact.year,
    districtTeams: districtRows.teams,
    fieldChanceFor: (teamKey) => {
      const team = sourceByKey.get(teamKey);
      if (team === undefined) return undefined;
      const membership = champFieldMembership(team, dcmpStartedForTeam(team, startedDcmpEventKeys, dcmpEventKeys, fieldProven), false);
      return membership === "in" ? 1 : membership === "out" ? 0 : fieldChanceByTeam.get(teamKey);
    },
    spreadScale: champCutoffTuning(artifact.year).setting.spreadScale,
  });

  // Lines 788 to 811: the champ rows, the verdicts and the award draws.
  const rows = buildChampLedgerRows({
    ...passOptions,
    fieldChanceByTeam,
    startedDcmpEventKeys,
    atLivePosition: false,
    fieldProven,
    dcmpEstimateByTeam: estimates.kind === "ready" ? estimates.byTeam : new Map(),
    ...(simulatedDcmp === undefined ? {} : { simulatedDcmp }),
  });
  const statuses = computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut, distributions: priced.distributions, fieldProven, finalsMayBeAbsent: false });
  const awardDraws = buildChampAwardDraws({ artifact, stageByEvent, fieldProven });

  // Lines 824 to 845: the champ chance run, waiting on the bake and carrying its signature.
  const champRunSignature =
    simulatedDcmpStatus === undefined ? runSignature : simulatedDcmpStatus === "ready" && runSignature !== null ? `${runSignature}#${bakeSignature}` : null;
  const champChanceRun =
    rows.gaps.teamsWithDistrictOnlyGrandTotal.length > 0
      ? undefined
      : buildChampAdvancementChanceRun({ artifact, teams: rows.teams, statuses, runSignature: champRunSignature, positionId, dcmpEventKey: rows.dcmpEventKey, fieldChanceByTeam, awardDraws });
  const champChance = champChanceRun === undefined ? undefined : advancementChances(champChanceRun.inputs, sources.draws, sources.seed);

  // Lines 852 to 905: the one range state, then the shown chips.
  const rangeState = champRangeState({
    dcmpAwardsFinal: champDcmpAwardsFinal(dcmpEventKeys, stageByEvent, fieldProven),
    cmpSlots: artifact.cmpSlots,
    perEventRunSignature: runSignature ?? "",
    perEventRunFailed: priced.runFailed,
    districtRun: { built: districtChanceRun !== undefined, status: districtChance === undefined ? "idle" : "complete", current: true },
    estimates: estimates.kind,
    ...(simulatedDcmpStatus === undefined ? {} : { simulatedDcmp: simulatedDcmpStatus }),
    unpricedInTeams: rows.teams.filter((team) => team.membership === "in" && team.grandTotalIsDistrictOnly).length,
    champRun: {
      built: champChanceRun !== undefined,
      status: champChance === undefined ? "idle" : "complete",
      current: true,
      excludedTeams: champChanceRun?.excludedTeams ?? [],
      ...(champChance?.cutoffByRun === undefined ? {} : { cutoffByRun: champChance.cutoffByRun }),
      ...(champChance === undefined ? {} : { draws: champChance.draws }),
    },
  });
  const display = applyChampRangeState(statuses, rows.teams, rangeState);
  return { positionId, rewind, priced, simulatedField, assembled, bake, bakeReason, simulatedDcmpStatus, estimates, rows, statuses, champChanceRun, champChance, rangeState, display };
}

/** The Champ Locks tab at the season start, tallied against each team's published `champLock.status`. */
export async function champSeasonStart(ctx: ChampTabContext, sources: TabSources): Promise<TabInRange> {
  const tab = await champTabAtPosition(ctx, 0, sources);
  const inRange = inRangeOf(tab.display);
  const finals = new Map(ctx.artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const));
  const state = tab.rangeState;
  return {
    state: rangeLabel(state),
    ...(state.kind === "simulated" ? { line: { points: state.points, p10: Math.round(state.likely.p10), p90: Math.round(state.likely.p90) } } : {}),
    unpriced: distinctUnavailable(tab.priced.unavailableEvents),
    inRange,
    tally: tallyInRange(inRange, finals),
    bake: { status: tab.simulatedDcmpStatus === undefined ? "inactive" : tab.bake.status, ...(tab.bakeReason === undefined ? {} : { reason: tab.bakeReason }) },
  };
}

// ---------------------------------------------------------------------------
// One district season
// ---------------------------------------------------------------------------

/** Why a district season has no in-range reading, from the district artifact alone; `undefined` when it has one. */
export function inRangeRefusalOf(artifact: DistrictArtifact): string | undefined {
  if (artifact.year < FIRST_BRACKET_SEASON) return `season ${String(artifact.year)} has no playoff bracket model (${String(FIRST_BRACKET_SEASON)} and later only)`;
  if (districtEventKeysOf(artifact).length === 0) return "no district tier events";
  return undefined;
}

export interface InRangeResultFile {
  readonly kind: "in-range";
  readonly districtKey: string;
  readonly year: number;
  readonly version: string;
  readonly elapsedMs: number;
  readonly bakes: number;
  readonly meanBakeMs: number;
  readonly refused?: string;
  /** Absent when the district publishes no `dcmpSlots`. */
  readonly district?: TabInRange;
  /** Absent when the district publishes no `cmpSlots`. */
  readonly champ?: TabInRange;
}

/** The weight a district season carries for `--shard`: its events, the season start bakes it costs. */
export function inRangeWeight(artifact: DistrictArtifact): number {
  return districtEventKeysOf(artifact).length + 2;
}

/** Both tabs at the season start for one district season, sharing one memo so a bake both tabs post runs once. */
export async function inRangeForDistrict(
  artifact: DistrictArtifact,
  sources: {
    readonly district: Omit<TabSources, "memo" | "draws" | "seed">;
    readonly champ: Omit<TabSources, "memo" | "draws" | "seed">;
  },
  memo = createRunMemo()
): Promise<Omit<InRangeResultFile, "kind" | "version" | "elapsedMs" | "bakes" | "meanBakeMs">> {
  const refused = inRangeRefusalOf(artifact);
  if (refused !== undefined) return { districtKey: artifact.districtKey, year: artifact.year, refused };
  const common = { memo, draws: SIMULATION_DRAWS, seed: DEFAULT_SIMULATION_SEED };
  const district = artifact.dcmpSlots === null ? undefined : await districtSeasonStart(districtTabContext(artifact, sources.district.eventArtifacts), { ...sources.district, ...common });
  const champ = artifact.cmpSlots === null ? undefined : await champSeasonStart(champTabContext(artifact, sources.champ.eventArtifacts), { ...sources.champ, ...common });
  return { districtKey: artifact.districtKey, year: artifact.year, ...(district === undefined ? {} : { district }), ...(champ === undefined ? {} : { champ }) };
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

async function runMode(eligible: readonly DistrictArtifact[], cli: CliArgs): Promise<void> {
  const cache = new OriginCache({ mode: "offline" });
  const version = await runVersionOf(cache, cli.version);
  const dir = resultDirFor(version, "in-range");
  const selected = inShard(eligible, cli.shard, inRangeWeight);
  process.stderr.write(`in-range report at ${EVENT_ALGORITHM_ID}@${version}: ${String(selected.length)} district seasons into ${dir}\n`);
  for (const artifact of selected) {
    if (!cli.force && hasResultFile(dir, artifact.districtKey)) {
      process.stderr.write(`  ${artifact.districtKey} exists, skipped (--force reruns it)\n`);
      continue;
    }
    const started = Date.now();
    const memo = createRunMemo();
    const fetchers = asOfFetchersFor(cache, artifact.year, version);
    let body: Awaited<ReturnType<typeof inRangeForDistrict>>;
    if (inRangeRefusalOf(artifact) !== undefined) body = await inRangeForDistrict(artifact, { district: emptySources(fetchers, version), champ: emptySources(fetchers, version) }, memo);
    else {
      const district = await loadEventArtifactsFromCache(cache, startedDistrictEventKeysOf(artifact), version);
      const champ = await loadEventArtifactsFromCache(cache, startedChampEventKeysOf(artifact), version);
      body = await inRangeForDistrict(
        artifact,
        {
          district: { eventArtifacts: district.eventArtifacts, unloadedEventKeys: district.missing, fetchers, version },
          champ: { eventArtifacts: champ.eventArtifacts, unloadedEventKeys: champ.missing, fetchers, version },
        },
        memo
      );
    }
    const elapsedMs = Date.now() - started;
    const file: InRangeResultFile = { kind: "in-range", ...body, version, elapsedMs, bakes: memo.stats.bakes, meanBakeMs: memo.stats.bakes === 0 ? 0 : memo.stats.bakeMs / memo.stats.bakes };
    writeResultFile(dir, artifact.districtKey, file);
    cache.clearMemo();
    process.stderr.write(
      `  ${artifact.districtKey} ${file.refused ?? `district ${file.district?.state ?? "-"}, champ ${file.champ?.state ?? "-"}${file.champ?.bake?.reason === undefined ? "" : ` (bake: ${file.champ.bake.reason})`}`}; bakes ${String(file.bakes)}, ${(elapsedMs / 1000).toFixed(1)} s\n`
    );
  }
}

function emptySources(fetchers: TabSources["fetchers"], version: string): Omit<TabSources, "memo" | "draws" | "seed"> {
  return { eventArtifacts: new Map(), unloadedEventKeys: [], fetchers, version };
}

function rate(value: number | null): string {
  return value === null ? "-" : `${(100 * value).toFixed(1)}%`;
}

async function reportMode(eligible: readonly DistrictArtifact[], refused: readonly DistrictArtifact[], cli: CliArgs): Promise<void> {
  const version = await runVersionOf(new OriginCache({ mode: "offline" }), cli.version);
  const dir = resultDirFor(version, "in-range");
  const pooled = poolResultFiles<InRangeResultFile>(dir, eligible.map((artifact) => artifact.districtKey), version);
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
  const rows: { tab: "district" | "champ"; districtKey: string; year: number; reading: TabInRange }[] = [];
  for (const file of pooled.files) {
    if (file.district !== undefined) rows.push({ tab: "district", districtKey: file.districtKey, year: file.year, reading: file.district });
    if (file.champ !== undefined) rows.push({ tab: "champ", districtKey: file.districtKey, year: file.year, reading: file.champ });
  }
  const pooledByTab = Object.fromEntries(
    (["district", "champ"] as const).map((tab) => {
      const tally = sumTallies(rows.filter((row) => row.tab === tab).map((row) => row.reading.tally));
      return [tab, { tally, locked: lockedRate(tally), pointsOnly: pointsOnlyRate(tally) }];
    })
  ) as Record<"district" | "champ", { tally: InRangeTally; locked: number | null; pointsOnly: number | null }>;
  const refusedFiles = pooled.files.filter((file) => file.refused !== undefined).map((file) => ({ key: file.districtKey, reason: file.refused! }));

  if (cli.json) {
    console.log(JSON.stringify({ version, path: "as-of", published: false, pooled: pooledByTab, refused: refusedFiles, refusedByConstruction: refused.map((a) => a.districtKey), rows }, null, 2));
    return;
  }
  console.log("");
  console.log("SEASON START IN RANGE TO LOCKED AT END, both Locks tabs, on the as-of path (REPORT ONLY, never published)");
  console.log(`  source: ${dir} (${String(pooled.files.length)} result files) at ${EVENT_ALGORITHM_ID}@${version}; champ side on the simulated DCMP bake`);
  console.log("");
  console.log("  tab       district  state                    unpriced  inRange   pts  award  pre  tie   no    pct");
  for (const row of rows) {
    const t = row.reading.tally;
    console.log(
      `  ${row.tab.padEnd(9)} ${row.districtKey.padEnd(9)} ${row.reading.state.padEnd(24)} ${String(row.reading.unpriced).padStart(8)}  ${String(t.inRange).padStart(7)}  ${String(t.lockedPoints).padStart(4)}  ${String(t.lockedAward).padStart(5)}  ${String(t.prequalified).padStart(3)}  ${String(t.tieAtLine).padStart(3)}  ${String(t.notLocked).padStart(3)}  ${rate(lockedRate(t)).padStart(6)}${row.reading.bake?.reason === undefined ? "" : `   bake ${row.reading.bake.status}: ${row.reading.bake.reason}`}`
    );
  }
  console.log("");
  console.log("POOLED (from summed counts)");
  for (const tab of ["district", "champ"] as const) {
    const p = pooledByTab[tab];
    console.log(`  ${tab.padEnd(9)} locked ${rate(p.locked)} (${String(p.tally.lockedPoints + p.tally.lockedAward)} of ${String(p.tally.inRange)}), points only ${rate(p.pointsOnly)} (${String(p.tally.lockedPoints)}); prequalified ${String(p.tally.prequalified)}, tie at the line ${String(p.tally.tieAtLine)}, not locked ${String(p.tally.notLocked)}`);
  }
  for (const r of refusedFiles) console.log(`  refused ${r.key}: ${r.reason}`);
  if (refused.length > 0) console.log(`  refused by construction (before ${String(FIRST_BRACKET_SEASON)}), nothing loaded: ${refused.map((a) => a.districtKey).join(", ")}`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const cli = parseCli(argv);
  if (cli.fetch || cli.dryRun) throw new Error("measureLocksInRange.ts reads the cache `measureDistrictCutoff.ts --fetch` fills; it has no --fetch or --dry-run of its own");
  const { eligible, refusedByConstruction } = selectDistricts(cli);
  if (cli.report) return reportMode(eligible, refusedByConstruction, cli);
  if (refusedByConstruction.length > 0) console.log(`refused by construction (before ${String(FIRST_BRACKET_SEASON)}), nothing loaded: ${refusedByConstruction.map((a) => a.districtKey).join(", ")}`);
  return runMode(eligible, cli);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:locks-in-range failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
