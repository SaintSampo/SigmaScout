/**
 * THE CHAMP CUTOFF BACKTEST (quick task 260927-6bf, decision L5): the Champ
 * Locks tab's simulated line, walk-forward, at the end of every district
 * season on disk, against the published `insights.cmpCutLinePoints`.
 *
 * Four modes:
 *
 *   npx tsx scripts/measureChampCutoff.ts --write-history
 *     Reads every `data/local-publish/districts/v1__district__{YYYY}{code}.json`
 *     and writes `packages/core/districts/dcmpHistory.generated.ts`: per season,
 *     the DCMP totals of every attendee in ten field rank buckets plus a win
 *     count, and per district code the DCMP judged award census.
 *
 *   npx tsx scripts/measureChampCutoff.ts --write-tuning
 *     Runs the pre-registered walk-forward selection over the K1 to K3 grid and
 *     writes `packages/core/districts/champCutoffTuning.generated.ts`. Run it
 *     after `--write-history`.
 *
 *   npx tsx scripts/measureChampCutoff.ts --check-history
 *     Regenerates BOTH files in memory and exits 1 on any drift from either
 *     committed file.
 *
 *   npx tsx scripts/measureChampCutoff.ts [--json]
 *     The backtest and its pre-registered GO / NO-GO gate.
 *
 * THE BROWSER'S OWN CODE, IN THE COMPONENT'S OWN ORDER. This script defines no
 * model: it calls `champTierEvents`, `buildDistrictTimeline`, the district
 * pass and its chance run, `champFieldChances`, `hypotheticalDcmpEstimates`,
 * `buildChampLedgerRows`, `computeChampLedgerStatuses`, `buildChampAwardDraws`,
 * `buildChampAdvancementChanceRun`, `advancementChances`, `champRangeState` and
 * `simulatedLine`, which is the call order `ChampLocksLedger.tsx` uses.
 *
 * PREDICT BEFORE UPDATE. The one position per season is the LAST rail step
 * before the District Championship starts, with no event artifacts, so no
 * DCMP registration, DCMP result or DCMP award is known there; four leak
 * checks per district prove it rather than assert it. Every tuning knob is
 * selected on seasons strictly before the one scored.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type EventArtifact,
} from "../packages/harness/pageArtifacts.js";
import { advancementChances } from "../packages/core/districts/advancementChance.js";
import { pointsRaceSlots } from "../packages/core/districts/locks.js";
import { simulateDistrictEvent } from "../packages/core/districts/ledgerSimulation.js";
import {
  CHAMP_CUTOFF_DEFAULT_SETTING,
  CHAMP_CUTOFF_TUNING_GRID,
  HYPOTHETICAL_DCMP_BUCKETS,
  hypotheticalDcmpBucketIndex,
  dcmpJudgedAwardCount,
  districtCode,
  normalizedFieldRanks,
  type ChampCutoffSetting,
  type ChampCutoffTuningEntry,
  type DcmpDistrictAwardCounts,
  type DcmpHistory,
} from "../packages/core/districts/hypotheticalDcmp.js";
import {
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  deriveStageFromState,
  distributionsFromResult,
  tierEvents,
  type DistrictEventDistributions,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import {
  buildDistrictTimeline,
  districtStageAtPosition,
  eventStartedAtPosition,
  startMatchKeyAtPosition,
  type DistrictTimeline,
} from "../apps/web/src/components/districts/districtTimeline.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildAdvancementChanceRun } from "../apps/web/src/components/districts/districtLedgerChances.js";
import {
  buildChampLedgerRows,
  champFieldMembership,
  champTierEvents,
  dcmpEventKeysFor,
} from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";
import {
  buildChampAdvancementChanceRun,
  buildChampAwardDraws,
  champFieldChances,
  champRangeState,
  hypotheticalDcmpEstimates,
} from "../apps/web/src/components/districts/champLedgerChances.js";
import { predictedCutoff } from "../apps/web/src/components/districts/predictedCutoff.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";

/** 10-06's dry run wrote every published district season here. Read-only, gitignored. */
export const LOCAL_DISTRICT_DIR = "data/local-publish/districts";
/** The committed phase 10 fixtures: 2026 PNW's eight event artifacts, for the earlier position observations. */
export const PHASE10_FIXTURE_DIR = "data/fixtures/phase10";
export const HISTORY_MODULE = "packages/core/districts/dcmpHistory.generated.ts";
export const TUNING_MODULE = "packages/core/districts/champCutoffTuning.generated.ts";

/** The seasons the gate scores. 2017 and 2018 are fit only. */
export const SCORED_SEASONS: readonly number[] = [2019, 2022, 2023, 2024, 2025, 2026];
/** The seasons the tuning module maps; 2027 is fit on everything through 2026. */
export const TUNING_SEASONS: readonly number[] = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];
/** "Small" districts in the report split: 25 Championship slots or fewer. */
const SMALL_DISTRICT_SLOTS = 25;
/** The two award slot means the planner measured, printed beside the run's own. */
const MEASURED_AWARD_SLOTS = 7.6;
const MEASURED_OUTSIDE_SLOTS = 3.0;

const DISTRICT_DETAIL_FILE = /^v1__district__(\d{4})([a-z]+)\.json$/;
const NO_EVENT_ARTIFACTS: ReadonlyMap<string, EventArtifact> = new Map<string, EventArtifact>();
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map<string, DistrictEventDistributions>();

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Reads and SCHEMA-VALIDATES every district detail artifact in `dir`, sorted by district key. */
export function loadDistrictArtifacts(dir: string = LOCAL_DISTRICT_DIR): DistrictArtifact[] {
  const out: DistrictArtifact[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!DISTRICT_DETAIL_FILE.test(file)) continue;
    out.push(DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8"))));
  }
  return out.sort((a, b) => (a.districtKey < b.districtKey ? -1 : a.districtKey > b.districtKey ? 1 : 0));
}

function dcmpKeysOf(artifact: DistrictArtifact): Set<string> {
  const keys = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) keys.add(entry.eventKey);
  return keys;
}

/**
 * Whether the District Championship was PLAYED: a winning alliance (award
 * type 1) at a dcmp tier key. Dcmp tier `eventPoints` alone is not enough:
 * 2020's cancelled championships still carry a 30 point Impact row for the
 * teams TBA named, with no match ever played, and reading those as a DCMP
 * would put a season with a 20 to 46 point "cut line" into every fit set.
 */
function hasDcmpResults(artifact: DistrictArtifact): boolean {
  const dcmpKeys = dcmpKeysOf(artifact);
  return (
    artifact.teams.some((team) => team.eventPoints.some((row) => row.tier === "dcmp")) &&
    artifact.teams.some((team) => team.qualifyingAwards.some((award) => award.awardType === 1 && dcmpKeys.has(award.eventKey)))
  );
}

/** A district season the backtest can score: a published capacity, a published champ cut line, and a District Championship that happened. */
export function isBacktestable(artifact: DistrictArtifact): boolean {
  return artifact.cmpSlots !== null && artifact.insights.cmpCutLinePoints !== null && hasDcmpResults(artifact);
}

// ---------------------------------------------------------------------------
// --write-history
// ---------------------------------------------------------------------------

/**
 * Every season's DCMP observations and award census, from the artifacts
 * alone. Attendees are teams with at least one dcmp tier `eventPoints` entry;
 * each is ranked on its DISTRICT total (`pointTotal` minus its DCMP totals)
 * by `normalizedFieldRanks` at field chance 1 — the same function the page
 * applies.
 */
export function buildDcmpHistory(artifacts: readonly DistrictArtifact[]): DcmpHistory {
  const bySeason = new Map<number, { totals: number[][]; wins: number[]; districts: Record<string, DcmpDistrictAwardCounts> }>();
  for (const artifact of artifacts) {
    if (artifact.cmpSlots === null || !hasDcmpResults(artifact)) continue;
    const dcmpKeys = dcmpKeysOf(artifact);
    let season = bySeason.get(artifact.year);
    if (season === undefined) {
      season = {
        totals: Array.from({ length: HYPOTHETICAL_DCMP_BUCKETS }, () => []),
        wins: new Array<number>(HYPOTHETICAL_DCMP_BUCKETS).fill(0),
        districts: {},
      };
      bySeason.set(artifact.year, season);
    }

    const attendees = artifact.teams
      .filter((team) => team.eventPoints.some((row) => row.tier === "dcmp"))
      .map((team) => {
        const dcmpTotal = team.eventPoints.filter((row) => row.tier === "dcmp").reduce((sum, row) => sum + row.total, 0);
        const won = team.qualifyingAwards.some((award) => award.awardType === 1 && dcmpKeys.has(award.eventKey));
        return { teamKey: team.teamKey, projection: team.pointTotal - dcmpTotal, fieldChance: 1, dcmpTotal, won };
      });
    const ranks = normalizedFieldRanks(attendees);
    for (const attendee of attendees) {
      const bucket = hypotheticalDcmpBucketIndex(ranks.get(attendee.teamKey)!);
      season.totals[bucket]!.push(attendee.dcmpTotal);
      if (attendee.won) season.wins[bucket]! += 1;
    }

    const recipients = (awardType: number): number =>
      artifact.teams.filter((team) => team.qualifyingAwards.some((award) => award.awardType === awardType && dcmpKeys.has(award.eventKey))).length;
    // THE JUDGED AWARD COUNT PER DCMP TIER EVENT (quick task 261009-2tr): the
    // event's award points less its consuming awards, over one judged award's
    // value, and the most over the district's dcmp tier events. Per event, so
    // a divisioned championship's divisions are read one at a time.
    let judgedAwards = 0;
    for (const eventKey of dcmpKeys) {
      const recipientsAt = (awardType: number): number =>
        artifact.teams.filter((team) => team.qualifyingAwards.some((award) => award.awardType === awardType && award.eventKey === eventKey)).length;
      let awardPointsTotal = 0;
      for (const team of artifact.teams) for (const row of team.eventPoints) if (row.eventKey === eventKey) awardPointsTotal += row.award;
      judgedAwards = Math.max(
        judgedAwards,
        dcmpJudgedAwardCount({
          season: artifact.year,
          awardPointsTotal,
          impact: recipientsAt(0),
          engineeringInspiration: recipientsAt(9),
          rookieAllStar: recipientsAt(10),
        })
      );
    }
    season.districts[districtCode(artifact.districtKey)] = {
      cmpSlots: artifact.cmpSlots,
      impact: recipients(0),
      engineeringInspiration: recipients(9),
      rookieAllStar: recipients(10),
      judgedAwards,
    };
  }

  const history: Record<number, DcmpHistory[number]> = {};
  for (const year of [...bySeason.keys()].sort((a, b) => a - b)) {
    const season = bySeason.get(year)!;
    const districts: Record<string, DcmpDistrictAwardCounts> = {};
    for (const code of Object.keys(season.districts).sort()) districts[code] = season.districts[code]!;
    history[year] = {
      buckets: season.totals.map((totals, index) => ({ totals: [...totals].sort((a, b) => a - b), wins: season.wins[index]! })),
      districts,
    };
  }
  return history;
}

const GENERATED_DATE_PREFIX = "// Generated: ";

function header(command: string, source: string): string[] {
  return [
    "// GENERATED, DO NOT EDIT BY HAND.",
    `// Command: ${command}`,
    `${GENERATED_DATE_PREFIX}${new Date().toISOString().slice(0, 10)}`,
    `// Source: ${source}`,
    "// Quick task 260927-6bf. `--check-history` regenerates this file and fails on any drift.",
  ];
}

export function renderHistoryModule(history: DcmpHistory): string {
  const lines = [
    ...header("npx tsx scripts/measureChampCutoff.ts --write-history", `${LOCAL_DISTRICT_DIR} (gitignored; every district detail artifact with a published cmpSlots and DCMP results)`),
    'import type { DcmpHistory } from "./hypotheticalDcmp.js";',
    "",
    "export const DCMP_HISTORY: DcmpHistory = {",
  ];
  for (const year of Object.keys(history).map(Number).sort((a, b) => a - b)) {
    const season = history[year]!;
    lines.push(`  ${String(year)}: {`);
    lines.push("    buckets: [");
    for (const bucket of season.buckets) lines.push(`      { wins: ${String(bucket.wins)}, totals: ${JSON.stringify(bucket.totals)} },`);
    lines.push("    ],");
    lines.push("    districts: {");
    for (const [code, entry] of Object.entries(season.districts)) {
      lines.push(
        `      ${code}: { cmpSlots: ${String(entry.cmpSlots)}, impact: ${String(entry.impact)}, engineeringInspiration: ${String(entry.engineeringInspiration)}, rookieAllStar: ${String(entry.rookieAllStar)}, judgedAwards: ${String(entry.judgedAwards)} },`
      );
    }
    lines.push("    },");
    lines.push("  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}

export function renderTuningModule(entries: readonly ChampCutoffTuningEntry[]): string {
  const lines = [
    ...header(
      "npx tsx scripts/measureChampCutoff.ts --write-tuning",
      `${LOCAL_DISTRICT_DIR} through the walk-forward selection over CHAMP_CUTOFF_TUNING_GRID; each season's setting is selected on seasons strictly before it`
    ),
    'import type { ChampCutoffTuningEntry } from "./hypotheticalDcmp.js";',
    "",
    "export const CHAMP_CUTOFF_TUNING: readonly ChampCutoffTuningEntry[] = [",
  ];
  for (const entry of entries) {
    lines.push(
      `  { season: ${String(entry.season)}, setting: { weighting: ${JSON.stringify(entry.setting.weighting)}, countMode: ${JSON.stringify(entry.setting.countMode)}, spreadScale: ${String(entry.setting.spreadScale)} }, fitSeasons: ${JSON.stringify(entry.fitSeasons)}, fitCount: ${String(entry.fitCount)}, fitCoverage: ${entry.fitCoverage === null ? "null" : String(Number(entry.fitCoverage.toFixed(6)))}, fitMae: ${entry.fitMae === null ? "null" : String(Number(entry.fitMae.toFixed(6)))} },`
    );
  }
  lines.push("];", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The backtest, one district at one position
// ---------------------------------------------------------------------------

export interface DistrictLeakChecks {
  /** `statuses.awardQualified` is empty: no DCMP award is a fact at the position. */
  readonly awardQualifiedEmpty: boolean;
  /** No team's membership is `in` or `out`: no DCMP registration is read. */
  readonly noMembershipFact: boolean;
  /** Every non district only team's DCMP row is `estimated`: the real roster priced nothing. */
  readonly everyDcmpRowEstimated: boolean;
  /** No award draw candidate holds its award at a dcmp tier event. */
  readonly noDcmpTierCandidate: boolean;
}

export interface DistrictBacktestRow {
  readonly districtKey: string;
  readonly year: number;
  readonly positionId: string;
  readonly cmpSlots: number;
  readonly published: number;
  /** The simulated line as printed: `Math.round` of the run median. */
  readonly simulated: number;
  /** The likely range as printed: the rounded p10 and p90. */
  readonly p10: number;
  readonly p90: number;
  readonly covered: boolean;
  /** The shipped `predictedCutoff` midpoint at the same position; null where it is not `predicted`/`final`. */
  readonly sameNaive: number | null;
  /** The `(pointsSlots - 3)`th pool median at the same position. */
  readonly sameMinus3: number | null;
  /** The `cmpSlots`th highest FINAL `pointTotal` over all teams. */
  readonly oracleNaive: number;
  /** The `(cmpSlots - 3)`th highest final `pointTotal`. */
  readonly oracleMinus3: number;
  readonly meanAwardSlots: number;
  readonly meanOutsideSlots: number;
  /** Runs whose drawn winners and awards left no points slot to read a line at (the line is read over the others). */
  readonly runsWithoutLine: number;
  readonly leaks: DistrictLeakChecks;
}

export type DistrictBacktestOutcome =
  | { readonly ok: true; readonly row: DistrictBacktestRow }
  | { readonly ok: false; readonly districtKey: string; readonly year: number; readonly reason: string };

/** The component's own `now` memo: each event's stage from its own `state` block, first team seen wins, across both tiers. */
function nowStageByEventOf(artifact: DistrictArtifact): Map<string, DistrictStageFinality> {
  const map = new Map<string, DistrictStageFinality>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        if (map.has(entry.eventKey)) continue;
        map.set(entry.eventKey, deriveStageFromState(entry.state).final);
      }
    }
  }
  return map;
}

/** The LAST rail index before `timeline.nowIndex` at which NO District Championship has started. */
export function endOfDistrictSeasonIndex(timeline: DistrictTimeline, dcmpEventKeys: readonly string[]): number {
  let index = -1;
  for (let i = 0; i < timeline.nowIndex; i++) {
    if (!dcmpEventKeys.some((key) => eventStartedAtPosition(timeline, i, key))) index = i;
  }
  return index;
}

interface PositionRun {
  readonly outcome: DistrictBacktestOutcome;
}

/**
 * The whole champ pipeline at one rail position of one district, in the
 * component's call order. `distributions` is empty for the end of district
 * season position, where every district event is final.
 */
function runAtPosition(
  artifact: DistrictArtifact,
  setting: ChampCutoffSetting,
  timeline: DistrictTimeline,
  positionIndex: number,
  nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>,
  distributions: ReadonlyMap<string, DistrictEventDistributions>,
  draws: number,
  seed: number
): PositionRun {
  const fail = (reason: string): PositionRun => ({ outcome: { ok: false, districtKey: artifact.districtKey, year: artifact.year, reason } });
  const cmpSlots = artifact.cmpSlots;
  const published = artifact.insights.cmpCutLinePoints;
  if (cmpSlots === null || published === null) return fail("no cmpSlots or no published cut line");
  const dcmpEventKeys = dcmpEventKeysFor(artifact);
  if (dcmpEventKeys.length === 0) return fail("no dcmp event key");

  const positionId = timeline.positions[positionIndex]!.id;
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, nowStageByEvent);
  const dcmpStarted = dcmpEventKeys.some((key) => eventStartedAtPosition(timeline, positionIndex, key));
  if (dcmpStarted) return fail("the DCMP has started at the position");

  // The district pass, its verdicts and its chance run.
  const districtRows = buildDistrictLedgerRows({ artifact, distributions, stageByEvent, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtRun = buildAdvancementChanceRun({ artifact, teams: districtRows.teams, statuses: districtStatuses, runSignature: "", positionId });
  const districtTierSettled = !districtRows.teams.some((team) => team.hasOpenCategory);
  const raw = districtRun === undefined ? undefined : advancementChances(districtRun.inputs, draws, seed).chanceByTeam;
  const fieldChanceByTeam = champFieldChances(districtStatuses, raw, districtTierSettled);

  // The estimate, with `fieldChanceFor` from the membership exactly as the tab reads it.
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const fieldChanceFor = (teamKey: string): number | undefined => {
    const team = sourceByKey.get(teamKey);
    if (team === undefined) return undefined;
    const membership = champFieldMembership(team, false, false);
    return membership === "in" ? 1 : membership === "out" ? 0 : fieldChanceByTeam.get(teamKey);
  };
  const estimates = hypotheticalDcmpEstimates({ season: artifact.year, districtTeams: districtRows.teams, fieldChanceFor, spreadScale: setting.spreadScale });

  const rows = buildChampLedgerRows({
    artifact,
    distributions,
    stageByEvent,
    fieldChanceByTeam,
    dcmpStarted: false,
    atLivePosition: false,
    ...(estimates.kind === "ready" ? { dcmpEstimateByTeam: estimates.byTeam } : {}),
  });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);
  const statuses = computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut });
  const awardDraws = buildChampAwardDraws({ artifact, stageByEvent, setting });
  const champRun =
    estimates.kind === "ready"
      ? buildChampAdvancementChanceRun({
          artifact,
          teams: rows.teams,
          statuses,
          runSignature: "",
          positionId,
          dcmpEventKey: rows.dcmpEventKey,
          fieldChanceByTeam,
          awardDraws,
        })
      : undefined;
  const result = champRun === undefined ? undefined : advancementChances(champRun.inputs, draws, seed);
  const unpricedInTeams = rows.teams.filter((team) => team.membership === "in" && team.grandTotalIsDistrictOnly).length;

  const state = champRangeState({
    dcmpAwardsFinal: dcmpEventKeys.every((key) => stageByEvent.get(key)?.award ?? false),
    cmpSlots,
    perEventRunSignature: "",
    districtRun: { built: districtRun !== undefined, status: districtRun === undefined ? "idle" : "complete", current: true },
    estimates: estimates.kind,
    unpricedInTeams,
    champRun: {
      built: champRun !== undefined,
      status: result === undefined ? "idle" : "complete",
      current: true,
      excludedTeams: champRun?.excludedTeams ?? [],
      ...(result?.cutoffByRun === undefined ? {} : { cutoffByRun: result.cutoffByRun }),
      ...(result === undefined ? {} : { draws: result.draws }),
    },
  });
  if (state.kind !== "simulated") return fail(`range state ${state.kind}${state.kind === "noCall" ? ` (${state.reason})` : ""}`);

  // The same position naive: the shipped midpoint rule over the same rows.
  const qualifiers = { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) };
  const naive = predictedCutoff({ teams: rows.teams, capacity: cmpSlots, qualifiers, reservedSlots: statuses.reservedSlots });
  const narrowing = pointsRaceSlots(
    rows.teams.map((team) => team.teamKey),
    cmpSlots,
    qualifiers,
    statuses.reservedSlots
  );
  const poolKeys = new Set(narrowing.poolKeys);
  const pool = rows.teams.filter((team) => poolKeys.has(team.teamKey));
  const minus3Index = narrowing.pointsSlots - 3 - 1;
  const sameMinus3 = minus3Index >= 0 && minus3Index < pool.length ? pool[minus3Index]!.projection : null;

  const finals = artifact.teams.map((team) => team.pointTotal).sort((a, b) => b - a);
  const oracleNaive = finals[cmpSlots - 1]!;
  const oracleMinus3 = finals[Math.max(cmpSlots - 4, 0)]!;

  const dcmpKeys = dcmpKeysOf(artifact);
  const leaks: DistrictLeakChecks = {
    awardQualifiedEmpty: statuses.awardQualified.length === 0,
    noMembershipFact: rows.teams.every((team) => team.membership === "open"),
    everyDcmpRowEstimated: rows.teams.every((team) => team.grandTotalIsDistrictOnly || team.membership === "out" || team.dcmpRow.estimated),
    // Every candidate must hold the drawn award at a DISTRICT tier event; one
    // holding it only at a dcmp tier event is a leak.
    noDcmpTierCandidate: awardDraws.every((draw) =>
      draw.candidates.every((candidate) => {
        const team = sourceByKey.get(candidate.teamKey);
        return team !== undefined && team.qualifyingAwards.some((award) => award.awardType === draw.awardType && !dcmpKeys.has(award.eventKey));
      })
    ),
  };

  const mean = (values: ArrayLike<number> | undefined): number => {
    if (values === undefined || values.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i]!;
    return sum / values.length;
  };

  const p10 = Math.round(state.likely.p10);
  const p90 = Math.round(state.likely.p90);
  return {
    outcome: {
      ok: true,
      row: {
        districtKey: artifact.districtKey,
        year: artifact.year,
        positionId,
        cmpSlots,
        published,
        simulated: state.points,
        p10,
        p90,
        covered: published >= p10 && published <= p90,
        sameNaive: naive.kind === "predicted" || naive.kind === "final" ? naive.points : null,
        sameMinus3,
        oracleNaive,
        oracleMinus3,
        meanAwardSlots: mean(result?.awardSlotsByRun),
        meanOutsideSlots: mean(result?.outsideAwardSlotsByRun),
        runsWithoutLine: result?.runsWithoutLine ?? 0,
        leaks,
      },
    },
  };
}

export interface BacktestOptions {
  readonly draws?: number;
  readonly seed?: number;
}

/**
 * One district season at the END OF ITS DISTRICT SEASON — the last rail step
 * before the District Championship starts — under ONE grid setting, which is
 * passed explicitly so the tuning selection and the scoring both call this.
 */
export function backtestDistrict(artifact: DistrictArtifact, setting: ChampCutoffSetting, options: BacktestOptions = {}): DistrictBacktestOutcome {
  const draws = options.draws ?? SIMULATION_DRAWS;
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const fail = (reason: string): DistrictBacktestOutcome => ({ ok: false, districtKey: artifact.districtKey, year: artifact.year, reason });
  if (!isBacktestable(artifact)) return fail("not backtestable");
  const dcmpEventKeys = dcmpEventKeysFor(artifact);

  const timeline = buildDistrictTimeline({ events: champTierEvents(artifact), eventArtifacts: NO_EVENT_ARTIFACTS });
  const nowStageByEvent = nowStageByEventOf(artifact);
  const index = endOfDistrictSeasonIndex(timeline, dcmpEventKeys);
  if (index < 0) return fail("no position before the DCMP");

  // Every district tier event must be final there, or the empty
  // distribution map would leave open cells unpriced.
  const stageByEvent = districtStageAtPosition(timeline, index, nowStageByEvent);
  const districtKeys = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "district")) districtKeys.add(entry.eventKey);
  for (const eventKey of districtKeys) {
    const stage = stageByEvent.get(eventKey);
    if (stage === undefined || !(stage.qual && stage.alliance && stage.elim && stage.award)) {
      return fail(`district event ${eventKey} is not final at the end of district season position`);
    }
  }

  return runAtPosition(artifact, setting, timeline, index, nowStageByEvent, NO_DISTRIBUTIONS, draws, seed).outcome;
}

// ---------------------------------------------------------------------------
// Summaries, selection and the gate
// ---------------------------------------------------------------------------

export interface LineStats {
  readonly n: number;
  readonly mae: number;
  readonly bias: number;
}

function lineStats(rows: readonly DistrictBacktestRow[], pick: (row: DistrictBacktestRow) => number | null): LineStats {
  let n = 0;
  let abs = 0;
  let signed = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null) continue;
    n += 1;
    abs += Math.abs(value - row.published);
    signed += value - row.published;
  }
  return { n, mae: n === 0 ? Number.NaN : abs / n, bias: n === 0 ? Number.NaN : signed / n };
}

export interface BacktestSummary {
  readonly n: number;
  readonly simulated: LineStats;
  readonly sameNaive: LineStats;
  readonly sameMinus3: LineStats;
  readonly oracleNaive: LineStats;
  readonly oracleMinus3: LineStats;
  readonly covered: number;
  readonly meanAwardSlots: number;
  readonly meanOutsideSlots: number;
}

export function summarize(rows: readonly DistrictBacktestRow[]): BacktestSummary {
  const n = rows.length;
  return {
    n,
    simulated: lineStats(rows, (row) => row.simulated),
    sameNaive: lineStats(rows, (row) => row.sameNaive),
    sameMinus3: lineStats(rows, (row) => row.sameMinus3),
    oracleNaive: lineStats(rows, (row) => row.oracleNaive),
    oracleMinus3: lineStats(rows, (row) => row.oracleMinus3),
    covered: rows.filter((row) => row.covered).length,
    meanAwardSlots: n === 0 ? Number.NaN : rows.reduce((sum, row) => sum + row.meanAwardSlots, 0) / n,
    meanOutsideSlots: n === 0 ? Number.NaN : rows.reduce((sum, row) => sum + row.meanOutsideSlots, 0) / n,
  };
}

/** One grid setting scored over a fit set: exact integer tallies, so ties compare exactly. */
export interface FitScore {
  readonly n: number;
  readonly covered: number;
  /** The sum of `|simulated - published|` over the fit set: integers, so an exact comparison. */
  readonly absErrorSum: number;
}

/** Coverage inside 72% to 88%, in integers: `18 n <= 25 covered <= 22 n`. */
export function coverageInBand(covered: number, n: number): boolean {
  return 25 * covered >= 18 * n && 25 * covered <= 22 * n;
}

/**
 * THE PRE-REGISTERED SELECTION RULE, over scores in GRID ORDER: the settings
 * whose coverage is inside 72% to 88%, lowest MAE first; if none is inside,
 * the coverage closest to 80%, ties to the lower MAE; remaining ties to the
 * earlier grid order; an empty fit set picks the default (index 0).
 */
export function selectSetting(scores: readonly FitScore[]): number {
  if (scores.length === 0 || scores.every((score) => score.n === 0)) return 0;
  const inBand = scores.map((score, index) => ({ score, index })).filter(({ score }) => coverageInBand(score.covered, score.n));
  // MAE compared as absErrorSum / n cross multiplied, exact in integers.
  const maeLess = (a: FitScore, b: FitScore): number => a.absErrorSum * b.n - b.absErrorSum * a.n;
  if (inBand.length > 0) {
    let best = inBand[0]!;
    for (const candidate of inBand.slice(1)) if (maeLess(candidate.score, best.score) < 0) best = candidate;
    return best.index;
  }
  // Distance to 80% as |5 covered - 4 n| / (5 n), compared cross multiplied.
  const distance = (score: FitScore): [number, number] => [Math.abs(5 * score.covered - 4 * score.n), 5 * score.n];
  let best = 0;
  for (let index = 1; index < scores.length; index++) {
    const [dc, nc] = distance(scores[index]!);
    const [db, nb] = distance(scores[best]!);
    const cmp = dc * nb - db * nc;
    if (cmp < 0 || (cmp === 0 && maeLess(scores[index]!, scores[best]!) < 0)) best = index;
  }
  return best;
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

/** The pre-registered oracle values the harness must reproduce, to one decimal. */
export const ORACLE_EXPECTED = { naiveMae: 20.3, naiveBias: -20.2, minus3Mae: 9.0, minus3Bias: -2.6 } as const;

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/**
 * What the gate reads. The gate is registered over the 69 backtestable
 * seasons, so the season count and the two ORACLE lines are taken over all of
 * them (the oracle reads final points alone and depends on no position),
 * while the simulated and same position lines exist only where a line could
 * be drawn at the end of district position.
 */
export interface GateSummary {
  /** Every backtestable scored season, whether or not a line could be drawn at its position. */
  readonly seasons: number;
  /** The seasons with a simulated line. */
  readonly scored: BacktestSummary;
  readonly oracleNaive: LineStats;
  readonly oracleMinus3: LineStats;
}

/** The two oracle lines over every backtestable season: the `cmpSlots`th and `(cmpSlots - 3)`th highest final `pointTotal`. */
export function oracleStats(artifacts: readonly DistrictArtifact[]): { readonly oracleNaive: LineStats; readonly oracleMinus3: LineStats } {
  let n = 0;
  let naiveAbs = 0;
  let naiveSigned = 0;
  let minus3Abs = 0;
  let minus3Signed = 0;
  for (const artifact of artifacts) {
    if (!isBacktestable(artifact)) continue;
    const published = artifact.insights.cmpCutLinePoints!;
    const slots = artifact.cmpSlots!;
    const finals = artifact.teams.map((team) => team.pointTotal).sort((a, b) => b - a);
    const naive = finals[slots - 1]!;
    const minus3 = finals[Math.max(slots - 4, 0)]!;
    n += 1;
    naiveAbs += Math.abs(naive - published);
    naiveSigned += naive - published;
    minus3Abs += Math.abs(minus3 - published);
    minus3Signed += minus3 - published;
  }
  return {
    oracleNaive: { n, mae: n === 0 ? Number.NaN : naiveAbs / n, bias: n === 0 ? Number.NaN : naiveSigned / n },
    oracleMinus3: { n, mae: n === 0 ? Number.NaN : minus3Abs / n, bias: n === 0 ? Number.NaN : minus3Signed / n },
  };
}

/**
 * THE GATE, registered before the run (L5). Conditions 2 to 5 on the SAME
 * tuned lines. Coverage is counted over ALL `seasons`: a season whose position
 * printed no range is not covered, which is the plan's own "50 to 60 of 69".
 */
export function gateVerdict(gate: GateSummary): GateVerdict {
  const fmt = (value: number): string => value.toFixed(2);
  const { scored } = gate;
  const oracleOk =
    oneDecimal(gate.oracleNaive.mae) === ORACLE_EXPECTED.naiveMae &&
    oneDecimal(gate.oracleNaive.bias) === ORACLE_EXPECTED.naiveBias &&
    oneDecimal(gate.oracleMinus3.mae) === ORACLE_EXPECTED.minus3Mae &&
    oneDecimal(gate.oracleMinus3.bias) === ORACLE_EXPECTED.minus3Bias;
  const conditions: GateCondition[] = [
    {
      id: 1,
      label: `oracle lines reproduce over all ${String(gate.seasons)} seasons (naive 20.3 / -20.2, cmpSlots - 3 9.0 / -2.6)`,
      pass: oracleOk,
      detail: `naive ${fmt(gate.oracleNaive.mae)} / ${fmt(gate.oracleNaive.bias)}, minus 3 ${fmt(gate.oracleMinus3.mae)} / ${fmt(gate.oracleMinus3.bias)} (n = ${String(gate.oracleNaive.n)})`,
    },
    {
      id: 2,
      label: "simulated MAE below the oracle naive MAE",
      pass: scored.simulated.mae < gate.oracleNaive.mae,
      detail: `${fmt(scored.simulated.mae)} < ${fmt(gate.oracleNaive.mae)} (simulated n = ${String(scored.simulated.n)})`,
    },
    {
      id: 3,
      label: "simulated MAE at most 0.75 x the same position naive MAE",
      pass: scored.simulated.mae <= 0.75 * scored.sameNaive.mae,
      detail: `${fmt(scored.simulated.mae)} <= 0.75 x ${fmt(scored.sameNaive.mae)} = ${fmt(0.75 * scored.sameNaive.mae)}`,
    },
    {
      id: 4,
      label: "|simulated bias| below |same position naive bias|",
      pass: Math.abs(scored.simulated.bias) < Math.abs(scored.sameNaive.bias),
      detail: `|${fmt(scored.simulated.bias)}| < |${fmt(scored.sameNaive.bias)}|`,
    },
    {
      id: 5,
      label: `printed 10 to 90 range covers the published line in 72% to 88% of the ${String(gate.seasons)} seasons`,
      pass: gate.seasons > 0 && coverageInBand(scored.covered, gate.seasons),
      detail: `${String(scored.covered)} of ${String(gate.seasons)} (${gate.seasons === 0 ? "n/a" : ((100 * scored.covered) / gate.seasons).toFixed(1)}%)${
        scored.n < gate.seasons ? `; ${String(gate.seasons - scored.n)} season(s) printed no range and count as not covered` : ""
      }`,
    },
  ];
  return { conditions, go: conditions.every((condition) => condition.pass) };
}

// ---------------------------------------------------------------------------
// The walk-forward run over the whole grid
// ---------------------------------------------------------------------------

export interface GridResults {
  /** `grid index -> districtKey -> outcome`, for every backtestable district from 2017 on. */
  readonly byIndex: readonly ReadonlyMap<string, DistrictBacktestOutcome>[];
  readonly artifacts: readonly DistrictArtifact[];
}

export function runGrid(artifacts: readonly DistrictArtifact[], options: BacktestOptions = {}): GridResults {
  const candidates = artifacts.filter((artifact) => artifact.year >= 2017 && isBacktestable(artifact));
  const byIndex = CHAMP_CUTOFF_TUNING_GRID.map((setting) => {
    const map = new Map<string, DistrictBacktestOutcome>();
    for (const artifact of candidates) map.set(artifact.districtKey, backtestDistrict(artifact, setting, options));
    return map;
  });
  return { byIndex, artifacts: candidates };
}

function fitScore(results: GridResults, index: number, fitKeys: readonly string[]): FitScore {
  let n = 0;
  let covered = 0;
  let absErrorSum = 0;
  for (const key of fitKeys) {
    const outcome = results.byIndex[index]!.get(key);
    if (outcome === undefined || !outcome.ok) continue;
    n += 1;
    if (outcome.row.covered) covered += 1;
    absErrorSum += Math.abs(outcome.row.simulated - outcome.row.published);
  }
  return { n, covered, absErrorSum };
}

/** The walk-forward selection for every season in `TUNING_SEASONS`: fit only on district seasons strictly before it. */
export function selectTuning(results: GridResults): ChampCutoffTuningEntry[] {
  return TUNING_SEASONS.map((season) => {
    const fit = results.artifacts.filter((artifact) => artifact.year < season);
    const fitKeys = fit.map((artifact) => artifact.districtKey);
    const fitSeasons = [...new Set(fit.map((artifact) => artifact.year))].sort((a, b) => a - b);
    const scores = CHAMP_CUTOFF_TUNING_GRID.map((_, index) => fitScore(results, index, fitKeys));
    const chosen = fitKeys.length === 0 ? 0 : selectSetting(scores);
    const score = scores[chosen]!;
    return {
      season,
      setting: CHAMP_CUTOFF_TUNING_GRID[chosen]!,
      fitSeasons,
      fitCount: score.n,
      fitCoverage: score.n === 0 ? null : score.covered / score.n,
      fitMae: score.n === 0 ? null : score.absErrorSum / score.n,
    };
  });
}


/**
 * The last timeline position of each distinct week, in week order: the
 * measurement points the retired rewind slider's jump chips used to supply
 * (quick task 260929-ttp removed `DistrictTimeline.chips` with the slider).
 * The derivation is the same one, kept here because this script is its only
 * remaining reader. TBA weeks are zero indexed; the label prints one based.
 */
function weekEndPositions(timeline: ReturnType<typeof buildDistrictTimeline>): { index: number; label: string }[] {
  const lastIndexByWeek = new Map<number, number>();
  timeline.positions.forEach((position, index) => {
    if (position.step === undefined || position.week === null) return;
    lastIndexByWeek.set(position.week, index);
  });
  return [...lastIndexByWeek.keys()].sort((a, b) => a - b).map((week) => ({ index: lastIndexByWeek.get(week)!, label: `After week ${String(week + 1)}` }));
}
function gridIndexOf(setting: ChampCutoffSetting): number {
  return CHAMP_CUTOFF_TUNING_GRID.findIndex(
    (entry) => entry.weighting === setting.weighting && entry.countMode === setting.countMode && entry.spreadScale === setting.spreadScale
  );
}

// ---------------------------------------------------------------------------
// Earlier positions: 2026 PNW only, from the committed phase 10 fixtures
// ---------------------------------------------------------------------------

export interface EarlierPositionObservation {
  readonly positionId: string;
  readonly label: string;
  readonly simulated: number | null;
  readonly p10: number | null;
  readonly p90: number | null;
  readonly hit: boolean | null;
  readonly note: string;
}

/**
 * 2026 PNW at season start and after each district week, from the eight
 * committed event artifacts: every event still open at the position is
 * simulated through `buildDistrictEventSimulationInput` and
 * `simulateDistrictEvent` from the first row after the position
 * (`startMatchKeyAtPosition`). That is the RETIRED stored odds rewind, the
 * calls the tab's data hook made when rewound before quick task 261005-5g0:
 * each row after the position carries the prediction stored when it was
 * played, made after every result before it. The tab no longer rewinds this
 * way (a rewound stop prices from the as-of state, `asOfRewind.ts`), so these
 * numbers measure the retired path, not what a rewound tab shows. n = 1
 * season, not gated.
 */
export function earlierPositionsPnw2026(artifact: DistrictArtifact, setting: ChampCutoffSetting, fixtureDir: string = PHASE10_FIXTURE_DIR): EarlierPositionObservation[] {
  const eventArtifacts = new Map<string, EventArtifact>();
  for (const file of readdirSync(fixtureDir).sort()) {
    const match = /^event-(.+)\.json$/.exec(file);
    if (match === null) continue;
    eventArtifacts.set(match[1]!, EventArtifactSchema.parse(JSON.parse(readFileSync(join(fixtureDir, file), "utf8"))));
  }
  const events = champTierEvents(artifact);
  const timeline = buildDistrictTimeline({ events, eventArtifacts });
  const nowStageByEvent = nowStageByEventOf(artifact);
  const dcmpEventKeys = dcmpEventKeysFor(artifact);
  const tierByEvent = new Map(events.map((event) => [event.eventKey, event.tier] as const));
  const positions = [
    { index: 0, label: "Season start" },
    ...weekEndPositions(timeline),
  ].filter(({ index }) => !dcmpEventKeys.some((key) => eventStartedAtPosition(timeline, index, key)));

  return positions.map(({ index, label }) => {
    const stageByEvent = districtStageAtPosition(timeline, index, nowStageByEvent);
    const distributions = new Map<string, DistrictEventDistributions>();
    for (const [eventKey, eventArtifact] of eventArtifacts) {
      const stage = stageByEvent.get(eventKey);
      if (stage === undefined || (stage.qual && stage.alliance && stage.elim && stage.award)) continue;
      const built = buildDistrictEventSimulationInput({
        eventKey,
        season: artifact.year,
        eventArtifact,
        districtArtifact: artifact,
        stage,
        startMatchKey: startMatchKeyAtPosition(timeline, index, eventKey),
        conditionOnPlayedElims: false,
        tier: tierByEvent.get(eventKey) ?? "district",
      });
      if (!built.ok) continue;
      // PER EVENT FAILURE IS ISOLATED, as `runDistrictSimulationJob` isolates
      // it: an event the core refuses prices nothing and its cells read
      // unavailable.
      try {
        distributions.set(eventKey, distributionsFromResult(simulateDistrictEvent(built.input, SIMULATION_DRAWS, DEFAULT_SIMULATION_SEED)));
      } catch {
        continue;
      }
    }
    const run = runAtPosition(artifact, setting, timeline, index, nowStageByEvent, distributions, SIMULATION_DRAWS, DEFAULT_SIMULATION_SEED).outcome;
    const positionId = timeline.positions[index]!.id;
    if (!run.ok) return { positionId, label, simulated: null, p10: null, p90: null, hit: null, note: run.reason };
    return { positionId, label, simulated: run.row.simulated, p10: run.row.p10, p90: run.row.p90, hit: run.row.covered, note: "" };
  });
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

function reportBlock(title: string, rows: readonly DistrictBacktestRow[]): void {
  const small = rows.filter((row) => row.cmpSlots <= SMALL_DISTRICT_SLOTS);
  const large = rows.filter((row) => row.cmpSlots > SMALL_DISTRICT_SLOTS);
  console.log(title);
  const line = (name: string, pick: (row: DistrictBacktestRow) => number | null): void => {
    const all = lineStats(rows, pick);
    const s = lineStats(small, pick);
    const l = lineStats(large, pick);
    console.log(
      `  ${name.padEnd(30)} all n=${pad(all.n, 2)} MAE ${pad(num(all.mae, 1), 5)} bias ${pad(num(all.bias, 1), 6)}` +
        `   small n=${pad(s.n, 2)} MAE ${pad(num(s.mae, 1), 5)} bias ${pad(num(s.bias, 1), 6)}` +
        `   large n=${pad(l.n, 2)} MAE ${pad(num(l.mae, 1), 5)} bias ${pad(num(l.bias, 1), 6)}`
    );
  };
  line("simulated (median of runs)", (row) => row.simulated);
  line("same position naive", (row) => row.sameNaive);
  line("same position cmpSlots - 3", (row) => row.sameMinus3);
  line("oracle naive (final points)", (row) => row.oracleNaive);
  line("oracle cmpSlots - 3 (final)", (row) => row.oracleMinus3);
  const summary = summarize(rows);
  console.log(
    `  printed range coverage         ${String(summary.covered)} of ${String(summary.n)} (${summary.n === 0 ? "n/a" : ((100 * summary.covered) / summary.n).toFixed(1)}%)`
  );
  console.log(
    `  mean drawn award slots         ${num(summary.meanAwardSlots, 2)} (measured ${MEASURED_AWARD_SLOTS.toFixed(1)})   mean outside slots ${num(summary.meanOutsideSlots, 2)} (measured ${MEASURED_OUTSIDE_SLOTS.toFixed(1)})`
  );
  console.log("");
}

function scoredRows(results: GridResults, pickIndex: (year: number) => number): { rows: DistrictBacktestRow[]; skipped: { key: string; reason: string }[] } {
  const rows: DistrictBacktestRow[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const artifact of results.artifacts) {
    if (!SCORED_SEASONS.includes(artifact.year)) continue;
    const outcome = results.byIndex[pickIndex(artifact.year)]!.get(artifact.districtKey)!;
    if (outcome.ok) rows.push(outcome.row);
    else skipped.push({ key: artifact.districtKey, reason: outcome.reason });
  }
  return { rows, skipped };
}

function settingText(setting: ChampCutoffSetting): string {
  return `${setting.weighting}/${setting.countMode}/${setting.spreadScale.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function stripGeneratedDate(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(GENERATED_DATE_PREFIX))
    .join("\n");
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const artifacts = loadDistrictArtifacts();

  if (argv.includes("--write-history")) {
    writeFileSync(HISTORY_MODULE, renderHistoryModule(buildDcmpHistory(artifacts)));
    console.log(`wrote ${HISTORY_MODULE}`);
    return;
  }

  if (argv.includes("--write-tuning")) {
    const results = runGrid(artifacts);
    writeFileSync(TUNING_MODULE, renderTuningModule(selectTuning(results)));
    console.log(`wrote ${TUNING_MODULE}`);
    return;
  }

  if (argv.includes("--check-history")) {
    const history = renderHistoryModule(buildDcmpHistory(artifacts));
    const tuning = renderTuningModule(selectTuning(runGrid(artifacts)));
    let drift = false;
    for (const [path, expected] of [
      [HISTORY_MODULE, history],
      [TUNING_MODULE, tuning],
    ] as const) {
      const committed = readFileSync(path, "utf8");
      if (stripGeneratedDate(committed) !== stripGeneratedDate(expected)) {
        console.log(`DRIFT: ${path} differs from a fresh regeneration`);
        drift = true;
      } else {
        console.log(`no drift: ${path}`);
      }
    }
    if (drift) process.exitCode = 1;
    return;
  }

  const results = runGrid(artifacts);
  const tuning = selectTuning(results);
  const tuningBySeason = new Map(tuning.map((entry) => [entry.season, entry] as const));
  const tunedIndex = (year: number): number => gridIndexOf(tuningBySeason.get(year)!.setting);
  const tuned = scoredRows(results, tunedIndex);
  const untuned = scoredRows(results, () => gridIndexOf(CHAMP_CUTOFF_DEFAULT_SETTING));
  const summary = summarize(tuned.rows);
  const scoredArtifacts = results.artifacts.filter((artifact) => SCORED_SEASONS.includes(artifact.year));
  const oracle = oracleStats(scoredArtifacts);
  const gate: GateSummary = { seasons: scoredArtifacts.length, scored: summary, ...oracle };
  const verdict = gateVerdict(gate);
  const leakCounts = {
    awardQualifiedEmpty: tuned.rows.filter((row) => row.leaks.awardQualifiedEmpty).length,
    noMembershipFact: tuned.rows.filter((row) => row.leaks.noMembershipFact).length,
    everyDcmpRowEstimated: tuned.rows.filter((row) => row.leaks.everyDcmpRowEstimated).length,
    noDcmpTierCandidate: tuned.rows.filter((row) => row.leaks.noDcmpTierCandidate).length,
  };
  const pnw = artifacts.find((artifact) => artifact.districtKey === "2026pnw");
  let earlier: EarlierPositionObservation[] | string;
  try {
    earlier = pnw === undefined ? "2026pnw is not on disk" : earlierPositionsPnw2026(pnw, tuningBySeason.get(2026)!.setting);
  } catch (error) {
    earlier = `could not be computed offline: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ gate, verdict, tuning, leakCounts, tuned: tuned.rows, skipped: tuned.skipped, untuned: summarize(untuned.rows), earlier }, null, 2));
    return;
  }

  console.log("");
  console.log("CHAMP CUTOFF BACKTEST: the simulated line at the end of each district season, walk-forward (quick task 260927-6bf)");
  console.log(`  source: ${LOCAL_DISTRICT_DIR} (read-only, no network)`);
  console.log(`  draws ${String(SIMULATION_DRAWS)}, seed ${String(DEFAULT_SIMULATION_SEED)}; scored seasons ${SCORED_SEASONS.join(", ")}`);
  console.log("");
  console.log("PER DISTRICT (walk-forward tuned)");
  console.log("  district  position                    slots  pub   sim (p10 to p90)    naive  n-3    or.naive  or.n-3  awardSlots  outside  noLine");
  for (const row of tuned.rows) {
    console.log(
      `  ${row.districtKey.padEnd(9)} ${row.positionId.padEnd(27)} ${pad(row.cmpSlots, 5)} ${pad(row.published, 4)}  ${pad(row.simulated, 4)} (${pad(row.p10, 3)} to ${pad(row.p90, 3)})${row.covered ? " " : "*"}  ${pad(num(row.sameNaive), 5)}  ${pad(num(row.sameMinus3), 5)}  ${pad(row.oracleNaive, 8)}  ${pad(row.oracleMinus3, 6)}  ${pad(row.meanAwardSlots.toFixed(2), 10)}  ${pad(row.meanOutsideSlots.toFixed(2), 7)}  ${pad(row.runsWithoutLine, 6)}`
    );
  }
  console.log("  (* the printed range misses the published line; noLine = runs of 1000 with no points slot left, read over the rest)");
  const withNoLineRuns = tuned.rows.filter((row) => row.runsWithoutLine > 0);
  console.log(
    `  seasons with at least one run without a line: ${String(withNoLineRuns.length)}` +
      (withNoLineRuns.length === 0 ? "" : ` (${withNoLineRuns.map((row) => `${row.districtKey} ${String(row.runsWithoutLine)}`).join(", ")})`)
  );
  if (tuned.skipped.length > 0) {
    console.log(`  SKIPPED ${String(tuned.skipped.length)}:`);
    for (const skip of tuned.skipped) console.log(`    ${skip.key}: ${skip.reason}`);
  } else {
    console.log("  skipped: 0");
  }
  console.log("");
  reportBlock(`WALK-FORWARD TUNED LINES (what the gate judges), n = ${String(tuned.rows.length)}`, tuned.rows);
  reportBlock(`UNTUNED DEFAULT SETTING (${settingText(CHAMP_CUTOFF_DEFAULT_SETTING)}), n = ${String(untuned.rows.length)}`, untuned.rows);

  console.log("SETTING PER SEASON (selected on fit seasons strictly before it)");
  for (const entry of tuning) {
    console.log(
      `  ${String(entry.season)}  ${settingText(entry.setting).padEnd(24)} fit n=${pad(entry.fitCount, 2)} seasons [${entry.fitSeasons.join(", ")}]` +
        `  coverage ${entry.fitCoverage === null ? "-" : (100 * entry.fitCoverage).toFixed(1) + "%"}  MAE ${entry.fitMae === null ? "-" : entry.fitMae.toFixed(2)}`
    );
  }
  console.log("");

  console.log("EARLIER POSITIONS (2026 PNW only, n = 1 season, not gated)");
  if (typeof earlier === "string") {
    console.log(`  none backtestable offline: ${earlier}`);
  } else {
    for (const observation of earlier) {
      console.log(
        `  ${observation.label.padEnd(16)} ${observation.positionId.padEnd(28)} ` +
          (observation.simulated === null
            ? `no line: ${observation.note}`
            : `${String(observation.simulated)} (${String(observation.p10)} to ${String(observation.p90)}) vs published ${String(pnw!.insights.cmpCutLinePoints)}: ${observation.hit === true ? "hit" : "miss"}`)
      );
    }
    console.log("  Every other season's earlier positions need event artifacts the local set lacks: a live observation, not a measured number.");
  }
  console.log("");

  console.log(`LEAK CHECKS (districts passing, of ${String(tuned.rows.length)})`);
  console.log(`  awardQualified empty at the position        ${String(leakCounts.awardQualifiedEmpty)}`);
  console.log(`  no membership "in" or "out"                  ${String(leakCounts.noMembershipFact)}`);
  console.log(`  every DCMP row estimated                     ${String(leakCounts.everyDcmpRowEstimated)}`);
  console.log(`  no dcmp tier award among the candidates      ${String(leakCounts.noDcmpTierCandidate)}`);
  console.log("");

  console.log(`ORACLE LINES OVER ALL ${String(gate.seasons)} BACKTESTABLE SEASONS (final points; no position involved)`);
  console.log(`  oracle naive          MAE ${num(gate.oracleNaive.mae, 2)}  bias ${num(gate.oracleNaive.bias, 2)}`);
  console.log(`  oracle cmpSlots - 3   MAE ${num(gate.oracleMinus3.mae, 2)}  bias ${num(gate.oracleMinus3.bias, 2)}`);
  console.log(
    `  (not gated) coverage over the ${String(summary.n)} seasons with a line alone: ${String(summary.covered)} of ${String(summary.n)} (${summary.n === 0 ? "n/a" : ((100 * summary.covered) / summary.n).toFixed(1)}%)`
  );
  console.log("");
  console.log("GATE (registered before the run)");
  for (const condition of verdict.conditions) {
    console.log(`  ${String(condition.id)}. ${condition.pass ? "PASS" : "FAIL"}  ${condition.label}: ${condition.detail}`);
  }
  const leaksClean = Object.values(leakCounts).every((count) => count === tuned.rows.length);
  if (!leaksClean) console.log("  LEAK CHECK FAILED: a DCMP fact reached the position");
  console.log("");
  console.log(verdict.go && leaksClean ? "GO" : "NO-GO");
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:champ-cutoff failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

