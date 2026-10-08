/**
 * Measures Jacob's two Locks tenets at the CHAMP tier, over every published
 * district season, at every stop the Champ Locks tab's rewind rail can land on.
 *
 *   "No team that ever is displayed as 'locked' should ever fail to qualify on
 *   points; no team that is ever displayed as 'locked out' should ever end up
 *   qualifying on points."                                  (2026-09-25)
 *
 *   "It is critical that at any point a team is only locked if it is
 *   impossible for them to not qualify."                    (2026-10-06)
 *
 * `scripts/measureLedgerTenets.ts` is the district tier's sweep; this is the
 * same promise against the FIRST Championship slot pool. It builds the champ
 * tab's own rows and statuses at every position exactly as `ChampLocksLedger`
 * does — `champTierEvents`, `buildDistrictTimeline`, the district pass for the
 * locked-out set, `buildChampLedgerRows`, `computeChampLedgerStatuses` — with
 * no distributions and no estimate. Since quick task 261008-26o the statuses
 * do read one thing from distributions, the settled playoffs set (a decided
 * bracket placement's points, `settledElim`); this sweep has no event
 * artifacts and passes none, so it measures the blunt Playoffs ceiling at
 * every stop, which is the more conservative side.
 *
 * THE YARDSTICK is the artifact's own published `champLock.status` at now: the
 * all tier standing with every event final, which is the right standing at
 * this tier. `lockedAward` and `prequalified` at now are indeterminate on
 * points and counted on their own, as the district sweep counts them.
 *
 * WHY THIS SWEEP EXISTS. The champ tier reserved nothing for the DCMP's own
 * consuming qualifications until quick task 261006-3gg. Its first run, before
 * the reservation was wired, is the baseline recorded in that task's SUMMARY;
 * its run after is what licenses the `Locked` chip at a position where the
 * DCMP's playoffs or awards are still open. The reservation census below is
 * reported so a reader can watch it fire rather than infer it from an absence
 * of failures.
 *
 * Source: `data/local-publish/districts` (read-only, no network, no credential).
 * Exit code 1 when either tenet is violated anywhere, so a CI step can gate on it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DistrictArtifactSchema, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  tierEvents,
  type DistrictEventDistributions,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import { buildDistrictTimeline, districtStageAtPosition, eventStartedAtPosition } from "../apps/web/src/components/districts/districtTimeline.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildChampLedgerRows, champTierEvents, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { outcomeForLockedOutShown, outcomeForLockedShown, type LedgerTenet, type LedgerTenetOutcome } from "./measureLedgerTenets.js";

export const LOCAL_DISTRICT_DIR = "data/local-publish/districts";
const DISTRICT_DETAIL_FILE = /^v1__district__\d{4}[a-z0-9]+\.json$/;
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();
const NO_EVENT_ARTIFACTS: ReadonlyMap<string, EventArtifact> = new Map();

export interface LoadedChampDistricts {
  readonly artifacts: DistrictArtifact[];
  /** District keys skipped because `cmpSlots` is null: TBA published no capacity, `locks.ts` reports `unknown`, no promise is displayed. */
  readonly skippedNoCapacity: string[];
}

export function loadDistrictArtifacts(dir: string): LoadedChampDistricts {
  const artifacts: DistrictArtifact[] = [];
  const skippedNoCapacity: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!DISTRICT_DETAIL_FILE.test(file)) continue;
    const parsed = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    if (parsed.cmpSlots === null) {
      skippedNoCapacity.push(parsed.districtKey);
      continue;
    }
    artifacts.push(parsed);
  }
  return { artifacts, skippedNoCapacity };
}

export interface ChampTenetViolation {
  readonly tenet: LedgerTenet;
  readonly districtKey: string;
  readonly year: number;
  readonly positionId: string;
  readonly positionLabel: string;
  readonly teamKey: string;
  readonly reservedSlots: number;
  readonly pointsSlots: number;
  readonly finalStatus: LockStatus;
}

export interface ChampTenetSweep {
  readonly districtKey: string;
  readonly year: number;
  readonly teamCount: number;
  readonly positions: number;
  readonly teamPositions: number;
  readonly lockedPointsShown: number;
  readonly lockedKept: number;
  readonly lockedAwardQualifiedAtNow: number;
  readonly lockedViolations: number;
  readonly lockedAwardShown: number;
  readonly lockedOutShown: number;
  readonly lockedOutKept: number;
  readonly lockedOutAwardQualifiedAtNow: number;
  readonly lockedOutUnresolvedTieAtNow: number;
  readonly lockedOutViolations: number;
  readonly otherShown: number;
  /** Sum of the champ-tier reservation over every position, and the positions where it was above zero. */
  readonly reservedSlotsTotal: number;
  readonly positionsWithReservedSlots: number;
  readonly violations: ChampTenetViolation[];
}

/** The artifact's own published champ verdict per team, the all tier standing at now. */
export function publishedChampVerdicts(artifact: DistrictArtifact): ReadonlyMap<string, LockStatus> {
  return new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const));
}

export function sweepChamp(artifact: DistrictArtifact, finalVerdicts: ReadonlyMap<string, LockStatus> = publishedChampVerdicts(artifact)): ChampTenetSweep {
  const events = champTierEvents(artifact);
  const dcmpEventKeys = dcmpEventKeysFor(artifact);

  // The tab's own three memos: the now stage per event, the started set, and the DCMP's started flag at now.
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
  const startedDcmpKeysNow = new Set(dcmpEventKeys.filter((key) => startedKeys.has(key)));

  const timeline = buildDistrictTimeline({ events, eventArtifacts: NO_EVENT_ARTIFACTS });

  const violations: ChampTenetViolation[] = [];
  let teamPositions = 0;
  let lockedPointsShown = 0;
  let lockedKept = 0;
  let lockedAwardQualifiedAtNow = 0;
  let lockedViolations = 0;
  let lockedAwardShown = 0;
  let lockedOutShown = 0;
  let lockedOutKept = 0;
  let lockedOutAwardQualifiedAtNow = 0;
  let lockedOutUnresolvedTieAtNow = 0;
  let lockedOutViolations = 0;
  let otherShown = 0;
  let reservedSlotsTotal = 0;
  let positionsWithReservedSlots = 0;

  for (let index = 0; index < timeline.positions.length; index++) {
    const position = timeline.positions[index]!;
    const atNow = index >= timeline.nowIndex;
    const stageByEvent = districtStageAtPosition(timeline, index, nowStageByEvent);
    const passOptions = { artifact, distributions: NO_DISTRIBUTIONS, stageByEvent: atNow ? undefined : stageByEvent };

    const districtRows = buildDistrictLedgerRows({ ...passOptions, tier: "district" });
    const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
    const districtLockedOut = new Set<string>();
    for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);

    const startedDcmpEventKeys = atNow ? startedDcmpKeysNow : new Set(dcmpEventKeys.filter((key) => eventStartedAtPosition(timeline, index, key)));
    const rows = buildChampLedgerRows({ ...passOptions, startedDcmpEventKeys, atLivePosition: atNow });
    const statuses = computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut });
    reservedSlotsTotal += statuses.reservedSlots;
    if (statuses.reservedSlots > 0) positionsWithReservedSlots += 1;

    for (const team of rows.teams) {
      const status = statuses.byTeam.get(team.teamKey);
      if (status === undefined) continue;
      teamPositions += 1;
      const finalStatus = finalVerdicts.get(team.teamKey) ?? "unknown";
      let tenet: LedgerTenet;
      let outcome: LedgerTenetOutcome;

      if (status.status === "locked" && status.byAward) {
        lockedAwardShown += 1;
        continue;
      } else if (status.status === "locked") {
        lockedPointsShown += 1;
        tenet = "A-locked-must-qualify-on-points";
        outcome = outcomeForLockedShown(finalStatus);
        if (outcome === "kept") lockedKept += 1;
        else if (outcome === "award-qualified-at-now") lockedAwardQualifiedAtNow += 1;
        else lockedViolations += 1;
      } else if (status.status === "lockedOut") {
        lockedOutShown += 1;
        tenet = "B-locked-out-must-not-qualify-on-points";
        outcome = outcomeForLockedOutShown(finalStatus);
        if (outcome === "kept") lockedOutKept += 1;
        else if (outcome === "award-qualified-at-now") lockedOutAwardQualifiedAtNow += 1;
        else if (outcome === "unresolved-tie-at-now") lockedOutUnresolvedTieAtNow += 1;
        else lockedOutViolations += 1;
      } else {
        otherShown += 1;
        continue;
      }

      if (outcome !== "violation") continue;
      violations.push({
        tenet,
        districtKey: artifact.districtKey,
        year: artifact.year,
        positionId: position.id,
        positionLabel: position.label,
        teamKey: team.teamKey,
        reservedSlots: statuses.reservedSlots,
        pointsSlots: statuses.pointsSlots,
        finalStatus,
      });
    }
  }

  return {
    districtKey: artifact.districtKey,
    year: artifact.year,
    teamCount: artifact.teams.length,
    positions: timeline.positions.length,
    teamPositions,
    lockedPointsShown,
    lockedKept,
    lockedAwardQualifiedAtNow,
    lockedViolations,
    lockedAwardShown,
    lockedOutShown,
    lockedOutKept,
    lockedOutAwardQualifiedAtNow,
    lockedOutUnresolvedTieAtNow,
    lockedOutViolations,
    otherShown,
    reservedSlotsTotal,
    positionsWithReservedSlots,
    violations,
  };
}

export interface ChampTenetCensus {
  readonly seasons: number;
  readonly positions: number;
  readonly teamPositions: number;
  readonly lockedPointsShown: number;
  readonly lockedKept: number;
  readonly lockedAwardQualifiedAtNow: number;
  readonly lockedViolations: number;
  readonly lockedAwardShown: number;
  readonly lockedOutShown: number;
  readonly lockedOutKept: number;
  readonly lockedOutAwardQualifiedAtNow: number;
  readonly lockedOutUnresolvedTieAtNow: number;
  readonly lockedOutViolations: number;
  readonly reservedSlotsTotal: number;
  readonly positionsWithReservedSlots: number;
}

export function censusOf(sweeps: readonly ChampTenetSweep[]): ChampTenetCensus {
  const sum = (pick: (s: ChampTenetSweep) => number): number => sweeps.reduce((acc, s) => acc + pick(s), 0);
  return {
    seasons: sweeps.length,
    positions: sum((s) => s.positions),
    teamPositions: sum((s) => s.teamPositions),
    lockedPointsShown: sum((s) => s.lockedPointsShown),
    lockedKept: sum((s) => s.lockedKept),
    lockedAwardQualifiedAtNow: sum((s) => s.lockedAwardQualifiedAtNow),
    lockedViolations: sum((s) => s.lockedViolations),
    lockedAwardShown: sum((s) => s.lockedAwardShown),
    lockedOutShown: sum((s) => s.lockedOutShown),
    lockedOutKept: sum((s) => s.lockedOutKept),
    lockedOutAwardQualifiedAtNow: sum((s) => s.lockedOutAwardQualifiedAtNow),
    lockedOutUnresolvedTieAtNow: sum((s) => s.lockedOutUnresolvedTieAtNow),
    lockedOutViolations: sum((s) => s.lockedOutViolations),
    reservedSlotsTotal: sum((s) => s.reservedSlotsTotal),
    positionsWithReservedSlots: sum((s) => s.positionsWithReservedSlots),
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function reportSeasonTable(sweeps: readonly ChampTenetSweep[]): void {
  console.log(`  ${"district".padEnd(10)} ${pad("teams", 5)} ${pad("stops", 5)} ${pad("locked", 7)} ${pad("A viol", 6)} ${pad("lockout", 8)} ${pad("B viol", 6)} ${pad("reserved", 8)}`);
  for (const s of sweeps) {
    console.log(
      `  ${s.districtKey.padEnd(10)} ${pad(s.teamCount, 5)} ${pad(s.positions, 5)} ${pad(s.lockedPointsShown, 7)} ${pad(s.lockedViolations, 6)} ${pad(s.lockedOutShown, 8)} ${pad(s.lockedOutViolations, 6)} ${pad(s.reservedSlotsTotal, 8)}`
    );
  }
}

function reportTotals(census: ChampTenetCensus, loaded: LoadedChampDistricts): void {
  console.log(``);
  console.log(`TOTALS`);
  console.log(`  seasons swept                        ${census.seasons}`);
  console.log(`  seasons skipped (cmpSlots null)      ${loaded.skippedNoCapacity.length}${loaded.skippedNoCapacity.length === 0 ? "" : ` — ${loaded.skippedNoCapacity.join(", ")}`}`);
  console.log(`  positions                            ${census.positions}`);
  console.log(`  team positions                       ${census.teamPositions}`);
  console.log(`  Locked on points shown               ${census.lockedPointsShown} (kept ${census.lockedKept}, award qualified at now ${census.lockedAwardQualifiedAtNow}, VIOLATIONS ${census.lockedViolations})`);
  console.log(`  Locked · award shown                 ${census.lockedAwardShown}`);
  console.log(`  Locked out shown                     ${census.lockedOutShown} (kept ${census.lockedOutKept}, award qualified at now ${census.lockedOutAwardQualifiedAtNow}, unresolved tie ${census.lockedOutUnresolvedTieAtNow}, VIOLATIONS ${census.lockedOutViolations})`);
  console.log(`  reservation: slots held back, total  ${census.reservedSlotsTotal} over ${census.positionsWithReservedSlots} positions`);
}

function reportViolations(sweeps: readonly ChampTenetSweep[]): void {
  const violations = sweeps.flatMap((s) => s.violations);
  console.log(``);
  if (violations.length === 0) {
    console.log(`VIOLATIONS: none`);
    return;
  }
  console.log(`VIOLATIONS (${violations.length})`);
  for (const v of violations) {
    console.log(`  ${v.tenet === "A-locked-must-qualify-on-points" ? "A" : "B"}  ${v.districtKey.padEnd(9)} ${v.teamKey.padEnd(9)} at ${v.positionLabel} (${v.positionId}) reserved ${v.reservedSlots} pointsSlots ${v.pointsSlots} -> final ${v.finalStatus}`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const asJson = argv.includes("--json");
  const dirFlag = argv.indexOf("--dir");
  const dir = dirFlag === -1 ? LOCAL_DISTRICT_DIR : (argv[dirFlag + 1] ?? LOCAL_DISTRICT_DIR);

  const loaded = loadDistrictArtifacts(dir);
  const sweeps = loaded.artifacts.map((artifact) => sweepChamp(artifact));
  const census = censusOf(sweeps);
  const violations = sweeps.flatMap((s) => s.violations);

  if (asJson) {
    console.log(JSON.stringify({ dir, census, skippedNoCapacity: loaded.skippedNoCapacity, sweeps, violations }, null, 2));
  } else {
    console.log(``);
    console.log(`CHAMP TENETS — the Champ Locks tab's own status code, at every stop on its rail.`);
    console.log(`  tenet A:    a team shown "Locked" on points is inside the final Championship qualified set on points`);
    console.log(`  tenet B:    a team shown "Locked out" is outside it`);
    console.log(`  outcome:    the artifact's own published champLock.status at now (all tier points, every event final)`);
    console.log(`  source:     ${dir} (read-only, no network, no credential)`);
    console.log(``);
    reportSeasonTable(sweeps);
    reportTotals(census, loaded);
    reportViolations(sweeps);
  }

  if (violations.length > 0) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:champ-tenets failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
