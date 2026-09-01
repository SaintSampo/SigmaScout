/**
 * 08-14-PLAN.md Task 2 — the mock-before-build pass. Discharges
 * `chart-craft.md`'s mock-against-the-real-distribution obligation FOR REAL:
 * fetches real published `EventArtifact` bytes from the same public origin
 * the browser reads, assembles inputs through the SHIPPED
 * `apps/web/src/lib/simulationInputs.ts`, runs the SHIPPED `simulateRanks`
 * at 1000 draws with a fixed seed, computes every band edge through the
 * SHIPPED `continuousQuantile()` and positions every mark through the
 * SHIPPED `rankBandExtent`/`medianTickLeft`/`histBarExtent`, and joins rows
 * through the SHIPPED `buildRankDistributionRows` (Task 1) — never a second,
 * hand-rolled implementation of any of the above. A mock that recomputed its
 * own medians and band edges would validate a chart the app does not render,
 * which is exactly the failure this rule exists to prevent.
 *
 * CREDENTIAL-FREE BY CONSTRUCTION (this project's own secrets convention —
 * `.claude/CLAUDE.md`). This script imports `DEFAULT_ARTIFACT_ORIGIN`,
 * `resolvePublishedVersions` and `fetchArtifactFresh` from
 * `scripts/verifySubsetPublish.ts` rather than restating any of them,
 * inheriting that script's cache-busting discipline and its rule that the
 * published version is resolved from the public algorithms manifest rather
 * than hardcoded. It never reads any environment variable of any kind, never
 * invokes the runtime's dotfile-loading mechanism, never imports
 * `packages/harness/r2Client.ts` or any signing helper, and its
 * `package.json` script entry carries NO environment-file flag —
 * deliberately, because this script cannot leak a credential it never has.
 * The dotfile holding live credentials is never `Read`, `cat`'d, `echo`'d or
 * interpolated by this file. (This paragraph deliberately avoids typing the
 * two literal constructs a code-level gate checks for, the same discipline
 * `rankRows.ts` applies to the plus-minus glyph — a comment containing
 * either substring would fail its own rule.)
 *
 * Two sampling rules are binding, both come from mistakes actually made in
 * sketch 005's own session: MEASURE EVERY ROW (sampling the first 12 rows of
 * a 39-row table was wrong about the field by a factor of three), and SAMPLE
 * A REWIND EVENT WHERE `EventTeamSchema.rp` IS ABSENT (`2024auwarp`, so
 * D-12's summed-fallback baseline path is exercised against real published
 * bytes, not only against well-ranked events).
 *
 * Standalone-script shape matching `scripts/replayRig.ts`/
 * `scripts/measureRewindGap.ts`: a long explanatory header, `parseArgs`, an
 * `async function main()`, an entry-point guard, deep relative imports with
 * explicit `.js` suffixes.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh, resolvePublishedVersions } from "./verifySubsetPublish.js";
import { artifactKey, EventArtifactSchema, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { mulberry32, simulateRanks, type SimMatchInput, type SimResult, type SimTeamBaseline } from "../packages/core/algorithms/simulation/rankSimulation.js";
import { buildQualRows, buildSimulationInputs, SIMULATION_DRAWS } from "../apps/web/src/lib/simulationInputs.js";
import { histBarExtent, medianTickLeft, PLOT_W, rankBandExtent, rankSlotWidth, SIM_GEOMETRY, x } from "../apps/web/src/lib/simAxis.js";
import { buildRankDistributionRows, histBarHeight, rankBandLabel, type RankDistributionRow } from "../apps/web/src/components/event/rankRows.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The mock-run's fixed Monte Carlo seed — reproducible run to run, matching
 * this project's other committed-measurement scripts' own seeded-determinism
 * convention (`measureRewindGap.ts`'s `DEFAULT_SEED`).
 */
export const MOCK_SEED = 20260831;

/**
 * The event selection (Decision, 08-14-PLAN.md Task 2), each entry carrying
 * its own reason:
 *
 * - `2023nhgrs`: the event sketch 005 measured its recorded decisions
 *   against, so this run's output is comparable to a published reference
 *   rather than free-floating.
 * - `2024auwarp`: 08-05 identified it as the one published object carrying
 *   played `qm` rows with actual RP and ZERO teams carrying `rp` — D-12's
 *   summed-fallback state.
 * - `2023cur`: the largest-roster pmf-bearing event 08-05's own
 *   `## Republish ledger` (08-05-SUMMARY.md) reports at execution time — 78
 *   ranked teams, 130/130 played `qm` rows carrying both pmfs, the same
 *   figure 08-13's own SC-2 measurement independently confirmed live. No
 *   fallback substitution was needed; the ledger named a real entry.
 */
export const MOCK_EVENT_KEYS: readonly string[] = ["2023nhgrs", "2024auwarp", "2023cur"];

/** The published algorithm id every sampled event is fetched under — the only algorithm this simulation ever runs on (D-04). */
const ALGORITHM_ID = "vpr";

/**
 * Mirrors the axis-tick selection Task 3's `rankAxisTicks` (`simAxis.ts`)
 * will implement — computed inline here because Task 3 has not landed yet
 * (this task's own action text: "If Task 3 has not yet added that function,
 * compute the same check inline and note it — Task 3 then makes it a
 * call"). Identical algorithm: the smallest step from the ladder
 * `1, 2, 5, 10, 20, 25, 50` whose pixel pitch is at least
 * `RANK_TICK_MIN_GAP_PX`, keeping rank 1 and `teamCount` unconditionally and
 * dropping any interior candidate too close to its neighbour.
 */
const RANK_TICK_MIN_GAP_PX = 28;
const RANK_TICK_STEP_LADDER = [1, 2, 5, 10, 20, 25, 50] as const;

function rankAxisTicksInline(teamCount: number): number[] {
  if (!(teamCount > 1)) return [1];
  let step = RANK_TICK_STEP_LADDER[RANK_TICK_STEP_LADDER.length - 1]!;
  for (const candidate of RANK_TICK_STEP_LADDER) {
    if (x(1 + candidate, teamCount) - x(1, teamCount) >= RANK_TICK_MIN_GAP_PX) {
      step = candidate;
      break;
    }
  }
  const candidates: number[] = [1];
  for (let rank = step + 1; rank < teamCount; rank += step) candidates.push(rank);
  candidates.push(teamCount);

  const kept: number[] = [];
  for (const candidate of candidates) {
    if (candidate === 1 || candidate === teamCount) {
      kept.push(candidate);
      continue;
    }
    const last = kept[kept.length - 1]!;
    if (x(candidate, teamCount) - x(last, teamCount) >= RANK_TICK_MIN_GAP_PX) kept.push(candidate);
  }
  // Drop the last interior candidate if it sits too close to the trailing anchor (teamCount).
  if (kept.length >= 2) {
    const lastInteriorIdx = kept.length - 2;
    const lastInterior = kept[lastInteriorIdx]!;
    const anchor = kept[kept.length - 1]!;
    if (lastInterior !== 1 && x(anchor, teamCount) - x(lastInterior, teamCount) < RANK_TICK_MIN_GAP_PX) {
      kept.splice(lastInteriorIdx, 1);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankMockRowMeasurement {
  readonly teamKey: string;
  readonly teamNumber: number;
  readonly medianRank: number;
  readonly medianDisplay: number;
  readonly medianDivergence: number;
  readonly p10: number;
  readonly p90: number;
  readonly bandWidthRankUnits: number;
  readonly bandLeftPx: number;
  readonly bandWidthPx: number;
  readonly medianTickLeftPx: number;
  readonly occupiedRankCount: number;
  readonly visibleBarCount: number;
  readonly maxBinCount: number;
  readonly totalBarElementCount: number;
  readonly isLocked: boolean;
}

export interface RankMockEventMeasurement {
  readonly eventKey: string;
  readonly canRunDrawLoop: boolean;
  readonly cannotRunReason: string | undefined;
  readonly rosterSize: number;
  readonly playedQmCount: number;
  readonly scheduledQmCount: number;
  readonly playedQmBothPmfCount: number;
  readonly playedQmActualRpBothKeyCount: number;
  readonly playedQmActualRpAnyNullCount: number;
  readonly teamsWithRpCount: number;
  readonly rosterCompleteness: { readonly appearingTeamKeyCount: number; readonly missingFromTeamsCount: number; readonly missingTeamKeys: readonly string[] };
  readonly baselineSourceCounts: Readonly<Record<string, number>>;
  /** Count of team keys whose LAST-played-row baseline (above) is marked known-incomplete by a null per-match actual RP (D-12's own PD-04 field). */
  readonly incompleteBaselineTeamKeyCount: number;
  readonly perTeamFallbackCase: { readonly count: number; readonly teamKeys: readonly string[] };
  readonly rows: readonly RankMockRowMeasurement[] | undefined;
  readonly bandWidthAllRows: { readonly min: number; readonly median: number; readonly max: number } | undefined;
  readonly bandWidthTop12: { readonly min: number; readonly median: number; readonly max: number } | undefined;
  readonly lockedRowCount: number | undefined;
  readonly lockedRowAlignment: readonly { readonly teamKey: string; readonly barCentre: number; readonly bandCentre: number; readonly tickCentre: number; readonly maxCentreDelta: number }[] | undefined;
  readonly sketchConventionOffsetPx: number | undefined;
  readonly containmentPositionsChecked: number | undefined;
  readonly encoding: { readonly mostLockedVisibleBarCount: number; readonly mostSpreadVisibleBarCount: number; readonly falsificationPassed: boolean } | undefined;
  readonly nodeCountBudget: { readonly totalBars: number; readonly bands: number; readonly ticks: number; readonly axisTicks: number; readonly total: number } | undefined;
  readonly axisTickNonCollision: { readonly ticks: readonly number[]; readonly minGapPx: number; readonly passed: boolean } | undefined;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MockFetchError extends Error {
  constructor(reason: string) {
    super(`mockRankDistribution: ${reason}`);
    this.name = "MockFetchError";
  }
}

export class RowCountMismatchError extends Error {
  constructor(eventKey: string, expected: number, actual: number) {
    super(`mockRankDistribution: ${eventKey} — emitted ${actual} row measurement(s), expected ${expected} (the simulated team count). Every row must be measured.`);
    this.name = "RowCountMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Pure measurement helpers (unit-testable in isolation, no network)
// ---------------------------------------------------------------------------

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function bandWidthStats(rows: readonly RankDistributionRow[]): { min: number; median: number; max: number } {
  const widths = rows.map((row) => row.p90 - row.p10);
  return { min: Math.min(...widths), median: median(widths), max: Math.max(...widths) };
}

/** True when every one of a row's draws landed on a single rank — `maxBinCount === draws`. */
function isLockedRow(row: RankDistributionRow): boolean {
  return row.maxBinCount === row.draws;
}

function lockedRankOf(row: RankDistributionRow): number {
  const idx = Array.from(row.histogram).findIndex((count) => count === row.maxBinCount);
  return idx + 1;
}

function occupiedRankCount(row: RankDistributionRow): number {
  let count = 0;
  for (const value of row.histogram) if (value > 0) count++;
  return count;
}

function visibleBarCount(row: RankDistributionRow): number {
  let count = 0;
  for (const value of row.histogram) if (histBarHeight(value, row.maxBinCount) >= 1) count++;
  return count;
}

/**
 * Measures one already-built row into a `RankMockRowMeasurement`, consuming
 * ONLY the shipped geometry/row-builder functions — no positional literal is
 * computed by this script itself.
 */
function measureRow(row: RankDistributionRow): RankMockRowMeasurement {
  const band = rankBandExtent(row.p10, row.p90, row.teamCount);
  const tickLeft = medianTickLeft(row.medianRank, row.teamCount);
  return {
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    medianRank: row.medianRank,
    medianDisplay: row.medianDisplay,
    medianDivergence: Math.abs(row.medianDisplay - row.medianRank),
    p10: row.p10,
    p90: row.p90,
    bandWidthRankUnits: row.p90 - row.p10,
    bandLeftPx: band.left,
    bandWidthPx: band.width,
    medianTickLeftPx: tickLeft,
    occupiedRankCount: occupiedRankCount(row),
    visibleBarCount: visibleBarCount(row),
    maxBinCount: row.maxBinCount,
    totalBarElementCount: visibleBarCount(row),
    isLocked: isLockedRow(row),
  };
}

// ---------------------------------------------------------------------------
// Network + assembly
// ---------------------------------------------------------------------------

async function fetchEventArtifact(origin: string, eventKey: string, algorithmVersion: string, runId: string): Promise<EventArtifact> {
  const key = artifactKey({ page: "event", eventKey, algorithmId: ALGORITHM_ID, version: algorithmVersion });
  const fetched = await fetchArtifactFresh(origin, key, runId);
  if (fetched.status !== 200 || fetched.body === undefined) {
    throw new MockFetchError(`GET ${origin}/${key} -> HTTP ${fetched.status} (expected 200) — cannot substitute synthetic data for a network failure`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fetched.body);
  } catch (err) {
    throw new MockFetchError(`${eventKey}: response body did not parse as JSON — ${err instanceof Error ? err.message : String(err)}`);
  }
  // A parse failure is a hard stop, not a warning (this task's own action text) — `.parse`, never `.safeParse`.
  return EventArtifactSchema.parse(parsedJson);
}

function hasBothPmfs(row: { compLevel: string; redRpPmf?: readonly number[]; blueRpPmf?: readonly number[] }): boolean {
  return row.compLevel === "qm" && (row.redRpPmf?.length ?? 0) > 0 && (row.blueRpPmf?.length ?? 0) > 0;
}

/** Every team key appearing in any `qm` row's red or blue alliance, across both `matches[]` and `upcoming[]`. */
function qmAppearingTeamKeys(artifact: EventArtifact): Set<string> {
  const keys = new Set<string>();
  const collect = (rows: readonly { compLevel: string; redTeams: readonly string[]; blueTeams: readonly string[] }[]) => {
    for (const row of rows) {
      if (row.compLevel !== "qm") continue;
      for (const k of row.redTeams) keys.add(k);
      for (const k of row.blueTeams) keys.add(k);
    }
  };
  collect(artifact.matches);
  collect(artifact.upcoming);
  return keys;
}

/**
 * The per-team fallback search (D-12): a team with played `qm` matches and
 * no `EventTeamSchema.rp` while OTHER teams at the same event carry one —
 * the shape in which D-12's fallback stays reachable in production even on
 * an otherwise pmf-bearing, well-ranked event.
 */
function findPerTeamFallbackCase(artifact: EventArtifact): { count: number; teamKeys: string[] } {
  const playedQmAppearance = new Set<string>();
  for (const row of artifact.matches) {
    if (row.compLevel !== "qm") continue;
    for (const k of row.redTeams) playedQmAppearance.add(k);
    for (const k of row.blueTeams) playedQmAppearance.add(k);
  }
  const teamsByKey = new Map(artifact.teams.map((t) => [t.teamKey, t]));
  const someTeamHasRp = artifact.teams.some((t) => t.rp !== undefined);
  if (!someTeamHasRp) return { count: 0, teamKeys: [] };

  const teamKeys: string[] = [];
  for (const teamKey of playedQmAppearance) {
    const team = teamsByKey.get(teamKey);
    if (team?.rp === undefined) teamKeys.push(teamKey);
  }
  teamKeys.sort();
  return { count: teamKeys.length, teamKeys };
}

/**
 * Runs the D-12 baseline assembly (08-11's `buildSimulationInputs`) against
 * the event's LAST PLAYED `qm` row — deliberately NOT the array's literal
 * last element (`compareEventMatchRows` sorts an untimed row LAST
 * regardless of chronological position, so a scheduled-but-unplayed row can
 * sit after every played one) and deliberately NOT the first row point 4
 * below uses for the draw-loop simulation. Starting at the first row leaves
 * an EMPTY prefix (nothing played before it), so every team would trivially
 * fall into D-12 rule 3 ("no-played-matches") regardless of whether TBA
 * published a Ranking Score — the exact opposite of what this finding needs
 * to show. Starting at the LAST PLAYED row maximizes the played prefix
 * (every played qm row but that one contributes to the sum), which is what
 * actually exercises D-12 rule 2 (the summed-actual-RP fallback) on
 * `2024auwarp`, where every team's `rp` is absent — this is the real
 * published object the summed-fallback precedence path is falsifiable
 * against. This assembly's OWN `remainingMatches`/`baselines` are returned
 * only for this baseline-provenance report; the draw-loop simulation below
 * performs its OWN, entirely separate `buildSimulationInputs` call at the
 * first chronological row and never reuses this one.
 */
function assembleBaselineOnly(artifact: EventArtifact): { baselineSourceCounts: Record<string, number>; incompleteBaselineTeamKeyCount: number } {
  const qualRows = buildQualRows(artifact);
  const lastPlayedRow = [...qualRows].reverse().find((row) => row.played);
  if (lastPlayedRow === undefined) {
    return { baselineSourceCounts: {}, incompleteBaselineTeamKeyCount: 0 };
  }
  const inputs = buildSimulationInputs(artifact, lastPlayedRow.matchKey);
  if (inputs === null) {
    return { baselineSourceCounts: {}, incompleteBaselineTeamKeyCount: 0 };
  }
  const counts: Record<string, number> = {};
  for (const source of inputs.baselineSources.values()) {
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return { baselineSourceCounts: counts, incompleteBaselineTeamKeyCount: inputs.incompleteBaselineTeamKeys.length };
}

/** The draw-loop simulation's OWN input assembly: the full-event rewind from the FIRST chronological `qm` row (point 4) — entirely separate from `assembleBaselineOnly`'s last-played-row assembly above. */
function assembleDrawLoopInputs(artifact: EventArtifact): { remainingMatches: readonly SimMatchInput[]; baselines: readonly SimTeamBaseline[] } | null {
  const qualRows = buildQualRows(artifact);
  if (qualRows.length === 0) return null;
  const inputs = buildSimulationInputs(artifact, qualRows[0]!.matchKey);
  if (inputs === null) return null;
  return { remainingMatches: inputs.remainingMatches, baselines: inputs.baselines };
}

// ---------------------------------------------------------------------------
// Per-event measurement
// ---------------------------------------------------------------------------

export async function measureEvent(origin: string, eventKey: string, algorithmVersion: string, runId: string): Promise<{ artifact: EventArtifact; measurement: RankMockEventMeasurement; rows: readonly RankDistributionRow[] | undefined }> {
  const artifact = await fetchEventArtifact(origin, eventKey, algorithmVersion, runId);

  const playedQm = artifact.matches.filter((m) => m.compLevel === "qm");
  const scheduledQm = artifact.upcoming.filter((m) => m.compLevel === "qm");
  const playedQmBothPmfCount = playedQm.filter(hasBothPmfs).length;
  const playedQmActualRpBothKeyCount = playedQm.filter((m) => "actualRedRp" in m && "actualBlueRp" in m).length;
  const playedQmActualRpAnyNullCount = playedQm.filter((m) => m.actualRedRp === null || m.actualBlueRp === null).length;
  const teamsWithRpCount = artifact.teams.filter((t) => t.rp !== undefined).length;

  const appearing = qmAppearingTeamKeys(artifact);
  const teamKeysInRoster = new Set(artifact.teams.map((t) => t.teamKey));
  const missingFromTeams = [...appearing].filter((k) => !teamKeysInRoster.has(k)).sort();

  const hasAnyPmfQmRow = playedQm.some(hasBothPmfs) || scheduledQm.some(hasBothPmfs);
  const perTeamFallback = hasAnyPmfQmRow ? findPerTeamFallbackCase(artifact) : { count: 0, teamKeys: [] };

  const { baselineSourceCounts, incompleteBaselineTeamKeyCount } = assembleBaselineOnly(artifact);

  if (!hasAnyPmfQmRow) {
    const measurement: RankMockEventMeasurement = {
      eventKey,
      canRunDrawLoop: false,
      cannotRunReason: "no qm row (played or scheduled) carries both redRpPmf and blueRpPmf — the usual reason (08-05's ledger) is an RP-ineligible event type (e.g. offseason, TBA event_type 99), which sigma1/index.ts's isRpEligibleEventType excludes from pmf production",
      rosterSize: artifact.teams.length,
      playedQmCount: playedQm.length,
      scheduledQmCount: scheduledQm.length,
      playedQmBothPmfCount,
      playedQmActualRpBothKeyCount,
      playedQmActualRpAnyNullCount,
      teamsWithRpCount,
      rosterCompleteness: { appearingTeamKeyCount: appearing.size, missingFromTeamsCount: missingFromTeams.length, missingTeamKeys: missingFromTeams },
      baselineSourceCounts,
      incompleteBaselineTeamKeyCount,
      perTeamFallbackCase: perTeamFallback,
      rows: undefined,
      bandWidthAllRows: undefined,
      bandWidthTop12: undefined,
      lockedRowCount: undefined,
      lockedRowAlignment: undefined,
      sketchConventionOffsetPx: undefined,
      containmentPositionsChecked: undefined,
      encoding: undefined,
      nodeCountBudget: undefined,
      axisTickNonCollision: undefined,
    };
    return { artifact, measurement, rows: undefined };
  }

  // --- The draw loop CAN run: the full-event rewind from the first chronological qm row (point 4) — a SEPARATE input assembly from the last-played-row baseline finding above. ---
  const drawLoopInputs = assembleDrawLoopInputs(artifact);
  if (drawLoopInputs === null) {
    throw new MockFetchError(`${eventKey}: has at least one pmf-bearing qm row but buildSimulationInputs returned null for its first chronological qm row — this should be unreachable`);
  }
  const result: SimResult = simulateRanks(drawLoopInputs.remainingMatches, drawLoopInputs.baselines, SIMULATION_DRAWS, mulberry32(MOCK_SEED));
  const rows = buildRankDistributionRows(result, artifact.teams);
  const teamCount = result.rankHistograms.size;

  if (rows.length !== teamCount) {
    throw new RowCountMismatchError(eventKey, teamCount, rows.length);
  }

  const rowMeasurements = rows.map(measureRow);
  if (rowMeasurements.length !== teamCount) {
    throw new RowCountMismatchError(eventKey, teamCount, rowMeasurements.length);
  }

  const top12 = rows.slice(0, Math.min(12, rows.length));
  const bandWidthAllRows = bandWidthStats(rows);
  const bandWidthTop12 = bandWidthStats(top12);

  const lockedRows = rows.filter(isLockedRow);
  const lockedRowAlignment = lockedRows.map((row) => {
    const rank = lockedRankOf(row);
    const barExtent = histBarExtent(rank, teamCount);
    const bandExtent = rankBandExtent(row.p10, row.p90, teamCount);
    const tickLeft = medianTickLeft(row.medianRank, teamCount);
    const barCentre = barExtent.left + barExtent.width / 2;
    const bandCentre = bandExtent.left + bandExtent.width / 2;
    const tickCentre = tickLeft + SIM_GEOMETRY.MEDIAN_TICK_W / 2;
    const maxCentreDelta = Math.max(Math.abs(barCentre - bandCentre), Math.abs(barCentre - tickCentre), Math.abs(bandCentre - tickCentre));
    return { teamKey: row.teamKey, barCentre, bandCentre, tickCentre, maxCentreDelta };
  });

  // --- Containment + finiteness, over every mark of every row. ---
  let positionsChecked = 0;
  for (const row of rows) {
    for (const rank of Array.from({ length: teamCount }, (_, i) => i + 1)) {
      const value = row.histogram[rank - 1]!;
      if (value <= 0) continue;
      const bar = histBarExtent(rank, teamCount);
      if (!(Number.isFinite(bar.left) && Number.isFinite(bar.width))) throw new MockFetchError(`${eventKey}: non-finite bar extent at rank ${rank} for ${row.teamKey}`);
      if (!(bar.left >= 0 && bar.left + bar.width <= PLOT_W + 1e-6)) throw new MockFetchError(`${eventKey}: bar for ${row.teamKey} rank ${rank} overflows the plot cell`);
      positionsChecked++;
    }
    const band = rankBandExtent(row.p10, row.p90, teamCount);
    if (!(Number.isFinite(band.left) && Number.isFinite(band.width))) throw new MockFetchError(`${eventKey}: non-finite band extent for ${row.teamKey}`);
    if (!(band.left >= 0 && band.left + band.width <= PLOT_W + 1e-6)) throw new MockFetchError(`${eventKey}: band for ${row.teamKey} overflows the plot cell`);
    positionsChecked++;
    const tick = medianTickLeft(row.medianRank, teamCount);
    if (!Number.isFinite(tick)) throw new MockFetchError(`${eventKey}: non-finite median tick for ${row.teamKey}`);
    if (!(tick >= 0 && tick + SIM_GEOMETRY.MEDIAN_TICK_W <= PLOT_W + 1e-6)) throw new MockFetchError(`${eventKey}: median tick for ${row.teamKey} overflows the plot cell`);
    positionsChecked++;
  }

  const sortedByVisibleBars = [...rowMeasurements].sort((a, b) => a.visibleBarCount - b.visibleBarCount);
  const mostLocked = sortedByVisibleBars[0]!;
  const mostSpread = sortedByVisibleBars[sortedByVisibleBars.length - 1]!;
  const encoding = {
    mostLockedVisibleBarCount: mostLocked.visibleBarCount,
    mostSpreadVisibleBarCount: mostSpread.visibleBarCount,
    falsificationPassed: mostSpread.visibleBarCount - mostLocked.visibleBarCount > 1,
  };

  const totalBars = rowMeasurements.reduce((sum, r) => sum + r.totalBarElementCount, 0);
  const axisTicks = rankAxisTicksInline(teamCount);
  const nodeCountBudget = {
    totalBars,
    bands: rows.length,
    ticks: rows.length,
    axisTicks: axisTicks.length,
    total: totalBars + rows.length * 2 + axisTicks.length,
  };

  let axisMinGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < axisTicks.length; i++) {
    const gap = x(axisTicks[i]!, teamCount) - x(axisTicks[i - 1]!, teamCount);
    axisMinGap = Math.min(axisMinGap, gap);
  }
  const axisTickNonCollision = { ticks: axisTicks, minGapPx: axisTicks.length > 1 ? axisMinGap : Number.POSITIVE_INFINITY, passed: axisTicks.length <= 1 || axisMinGap >= RANK_TICK_MIN_GAP_PX - 1e-6 };

  const measurement: RankMockEventMeasurement = {
    eventKey,
    canRunDrawLoop: true,
    cannotRunReason: undefined,
    rosterSize: artifact.teams.length,
    playedQmCount: playedQm.length,
    scheduledQmCount: scheduledQm.length,
    playedQmBothPmfCount,
    playedQmActualRpBothKeyCount,
    playedQmActualRpAnyNullCount,
    teamsWithRpCount,
    rosterCompleteness: { appearingTeamKeyCount: appearing.size, missingFromTeamsCount: missingFromTeams.length, missingTeamKeys: missingFromTeams },
    baselineSourceCounts,
    incompleteBaselineTeamKeyCount,
    perTeamFallbackCase: perTeamFallback,
    rows: rowMeasurements,
    bandWidthAllRows,
    bandWidthTop12,
    lockedRowCount: lockedRows.length,
    lockedRowAlignment,
    sketchConventionOffsetPx: rankSlotWidth(teamCount),
    containmentPositionsChecked: positionsChecked,
    encoding,
    nodeCountBudget,
    axisTickNonCollision,
  };

  return { artifact, measurement, rows };
}

// ---------------------------------------------------------------------------
// HTML mock (Task 2's "render it and look at it" deliverable)
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMockHtml(eventKey: string, rows: readonly RankDistributionRow[], teamCount: number): string {
  const axisTicks = rankAxisTicksInline(teamCount);
  const axisHtml = axisTicks
    .map((tick) => `<span class="tick" style="left:${x(tick, teamCount).toFixed(2)}px">${tick}</span>`)
    .join("\n");

  const rowsHtml = rows
    .map((row) => {
      const bars = Array.from(row.histogram)
        .map((count, i) => {
          if (count <= 0) return "";
          const rank = i + 1;
          const extent = histBarExtent(rank, teamCount);
          const height = histBarHeight(count, row.maxBinCount);
          return `<div class="bar" style="left:${extent.left.toFixed(2)}px;width:${extent.width.toFixed(2)}px;height:${height.toFixed(2)}px"></div>`;
        })
        .join("\n");
      const band = rankBandExtent(row.p10, row.p90, teamCount);
      const tick = medianTickLeft(row.medianRank, teamCount);
      return `
        <tr>
          <td class="numeric-cell">${row.teamNumber}</td>
          <td>${escapeHtml(row.nickname ?? "—")}</td>
          <td class="numeric-cell">${row.medianDisplay}</td>
          <td>
            <div class="plot" style="width:${PLOT_W}px;height:${SIM_GEOMETRY.ROW_PLOT_H}px">
              ${bars}
              <div class="band" style="left:${band.left.toFixed(2)}px;width:${band.width.toFixed(2)}px"></div>
              <div class="tick" style="left:${tick.toFixed(2)}px;width:${SIM_GEOMETRY.MEDIAN_TICK_W}px"></div>
            </div>
            <div class="label">${escapeHtml(rankBandLabel(row.p10, row.p90))}</div>
          </td>
        </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>rank-distribution-mock: ${escapeHtml(eventKey)}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #fff; color: #111827; padding: 24px; }
  table { border-collapse: collapse; }
  td, th { padding: 4px 8px; vertical-align: top; text-align: left; }
  .numeric-cell { font-variant-numeric: tabular-nums; text-align: right; }
  .plot { position: relative; background: #f8fafc; }
  .bar { position: absolute; bottom: 0; background: color-mix(in srgb, #111827 55%, transparent); }
  .band { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, #111827 18%, transparent); }
  .tick { position: absolute; top: 0; bottom: 0; background: #111827; }
  .label { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .axis { position: relative; height: 16px; width: ${PLOT_W}px; }
  .axis .tick { position: absolute; transform: translateX(-50%); font-size: 11px; color: #6b7280; background: none; }
</style>
</head>
<body>
<h1>rank-distribution-mock: ${escapeHtml(eventKey)}</h1>
<table>
<thead>
<tr>
  <th>Team #</th><th>Nickname</th><th>Median</th>
  <th><div class="axis">${axisHtml}</div></th>
</tr>
</thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly eventKeys: readonly string[];
}

function parseOptions(): CliOptions {
  const { values } = parseArgs({ options: { event: { type: "string", multiple: true } } });
  return { eventKeys: values.event && values.event.length > 0 ? values.event : MOCK_EVENT_KEYS };
}

function printRowTable(rows: readonly RankMockRowMeasurement[]): void {
  for (const row of rows) {
    console.log(
      `  team=${row.teamKey} #${row.teamNumber} medianRank=${row.medianRank.toFixed(4)} medianDisplay=${row.medianDisplay} ` +
        `p10=${row.p10.toFixed(4)} p90=${row.p90.toFixed(4)} bandWidth=${row.bandWidthRankUnits.toFixed(4)} ` +
        `bandPx=[${row.bandLeftPx.toFixed(2)},${(row.bandLeftPx + row.bandWidthPx).toFixed(2)}] tickPx=${row.medianTickLeftPx.toFixed(2)} ` +
        `occupiedRanks=${row.occupiedRankCount} visibleBars=${row.visibleBarCount} maxBinCount=${row.maxBinCount} locked=${row.isLocked}`
    );
  }
}

export async function main(): Promise<void> {
  const options = parseOptions();
  const runId = randomUUID();
  const versions = await resolvePublishedVersions(DEFAULT_ARTIFACT_ORIGIN);
  const algorithmVersion = versions.get(ALGORITHM_ID);
  if (algorithmVersion === undefined) {
    throw new MockFetchError(`the public algorithms manifest at ${DEFAULT_ARTIFACT_ORIGIN} does not resolve a published version for algorithm "${ALGORITHM_ID}"`);
  }
  console.log(`mockRankDistribution: origin=${DEFAULT_ARTIFACT_ORIGIN} algorithm=${ALGORITHM_ID}@${algorithmVersion} seed=${MOCK_SEED} draws=${SIMULATION_DRAWS}`);

  const reportsDir = join("reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const eventMeasurements: RankMockEventMeasurement[] = [];

  for (const eventKey of options.eventKeys) {
    console.log(`\n=== ${eventKey} ===`);
    const { measurement, rows } = await measureEvent(DEFAULT_ARTIFACT_ORIGIN, eventKey, algorithmVersion, runId);
    eventMeasurements.push(measurement);

    console.log(`rosterSize=${measurement.rosterSize} playedQm=${measurement.playedQmCount} scheduledQm=${measurement.scheduledQmCount} playedQmBothPmf=${measurement.playedQmBothPmfCount}`);
    console.log(`playedQmActualRpBothKeyCount=${measurement.playedQmActualRpBothKeyCount} playedQmActualRpAnyNullCount=${measurement.playedQmActualRpAnyNullCount} teamsWithRpCount=${measurement.teamsWithRpCount}`);
    console.log(`assumption-A2 roster completeness: ${measurement.rosterCompleteness.appearingTeamKeyCount} qm-appearing team keys, ${measurement.rosterCompleteness.missingFromTeamsCount} absent from teams[]: ${JSON.stringify(measurement.rosterCompleteness.missingTeamKeys)}`);
    console.log(
      `08-11 baseline source counts (D-12, measured at the LAST PLAYED qm row — maximal played prefix, never the draw loop's own first-row-start baselines below): ${JSON.stringify(measurement.baselineSourceCounts)}, incompleteBaselineTeamKeyCount=${measurement.incompleteBaselineTeamKeyCount}`
    );
    console.log(`D-12 per-team fallback case count (this event): ${measurement.perTeamFallbackCase.count}, teams: ${JSON.stringify(measurement.perTeamFallbackCase.teamKeys)}`);

    if (!measurement.canRunDrawLoop) {
      console.log(`canRunDrawLoop=false reason: ${measurement.cannotRunReason}`);
      continue;
    }

    console.log(`canRunDrawLoop=true — printing all ${measurement.rows!.length} row(s) (row count is asserted equal to the simulated team count before this point is reached — see RowCountMismatchError above):`);
    printRowTable(measurement.rows!);

    console.log(`bandWidth all-rows: min=${measurement.bandWidthAllRows!.min.toFixed(4)} median=${measurement.bandWidthAllRows!.median.toFixed(4)} max=${measurement.bandWidthAllRows!.max.toFixed(4)}`);
    console.log(`bandWidth top-12: min=${measurement.bandWidthTop12!.min.toFixed(4)} median=${measurement.bandWidthTop12!.median.toFixed(4)} max=${measurement.bandWidthTop12!.max.toFixed(4)}`);

    if (measurement.lockedRowCount === 0) {
      console.log(
        `locked-row alignment: no locked row found at this event — reporting explicitly rather than a vacuous pass. ` +
          `The sketch-convention offset at N=${measurement.rosterSize} (would have applied to any locked row) is ${measurement.sketchConventionOffsetPx!.toFixed(2)}px.`
      );
    } else {
      console.log(`locked-row alignment: ${measurement.lockedRowCount} locked row(s), sketch-convention offset at N=${measurement.rosterSize} would have been ${measurement.sketchConventionOffsetPx!.toFixed(2)}px`);
      for (const triple of measurement.lockedRowAlignment!) {
        console.log(`  ${triple.teamKey}: barCentre=${triple.barCentre.toFixed(4)} bandCentre=${triple.bandCentre.toFixed(4)} tickCentre=${triple.tickCentre.toFixed(4)} maxDelta=${triple.maxCentreDelta.toFixed(6)}px (<=0.01px required)`);
        if (triple.maxCentreDelta > 0.01) {
          throw new MockFetchError(`${eventKey}: locked row ${triple.teamKey}'s three centres disagree by ${triple.maxCentreDelta.toFixed(6)}px, exceeding the 0.01px tolerance`);
        }
      }
    }

    console.log(`containment+finiteness: ${measurement.containmentPositionsChecked} position(s) checked, all inside [0, ${PLOT_W}] and finite`);
    console.log(
      `histogram-encoding falsification: mostLockedVisibleBars=${measurement.encoding!.mostLockedVisibleBarCount} mostSpreadVisibleBars=${measurement.encoding!.mostSpreadVisibleBarCount} falsificationPassed=${measurement.encoding!.falsificationPassed}`
    );
    const medianDivergenceCount = measurement.rows!.filter((r) => r.medianDivergence > 0.25).length;
    console.log(`median-display divergence (>0.25 rank): ${medianDivergenceCount} of ${measurement.rows!.length} rows`);
    console.log(`node-count budget: totalBars=${measurement.nodeCountBudget!.totalBars} bands=${measurement.nodeCountBudget!.bands} ticks=${measurement.nodeCountBudget!.ticks} axisTicks=${measurement.nodeCountBudget!.axisTicks} total=${measurement.nodeCountBudget!.total}`);
    console.log(
      `axis tick non-collision: ticks=${JSON.stringify(measurement.axisTickNonCollision!.ticks)} minGapPx=${measurement.axisTickNonCollision!.minGapPx.toFixed(2)} passed=${measurement.axisTickNonCollision!.passed}`
    );

    const html = renderMockHtml(eventKey, rows!, measurement.rosterSize >= 1 ? measurement.rows!.length : 0);
    const htmlPath = join(reportsDir, `rank-distribution-mock-${eventKey}.html`);
    writeFileSync(htmlPath, html, "utf8");
    console.log(`wrote ${htmlPath}`);
  }

  console.log("\nmockRankDistribution: complete.");
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("mockRankDistribution failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
