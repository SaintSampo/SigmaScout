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
 * Exit code 1 on any tenet A violation, or on any team the shipped run locks
 * that the combined run does not.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DistrictArtifactSchema, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import { bracketRoundOfSet, bracketSetIdFor } from "../packages/core/districts/bracket.js";
import { championshipStemOf } from "../packages/core/districts/champReservedSlots.js";
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
  readonly kind: "tenetA" | "shippedLostLock";
  readonly districtKey: string;
  readonly stop: string;
  readonly teamKey: string;
  readonly pointsSlots: number;
  readonly bound: number | null;
  readonly finalStatus: LockStatus;
}

export interface JointFirstLock {
  readonly districtKey: string;
  readonly teamKey: string;
  readonly before: string;
  readonly after: string;
}

export interface JointSweep {
  readonly districtKey: string;
  readonly dcmpKey: string;
  readonly stops: readonly JointStopRecord[];
  readonly violations: readonly JointViolation[];
  readonly earlier: readonly JointFirstLock[];
  readonly qualifiers: number;
}

const lockedOnPoints = (model: ChampLedgerStatusModel): string[] =>
  [...model.byTeam.values()].filter((result) => result.status === "locked" && !result.byAward).map((result) => result.teamKey);

export function sweepJoint(artifact: DistrictArtifact, bracket: BracketSourceEvent): JointSweep {
  const finalStatus = new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const));
  const stops = dcmpStops(artifact, bracket);
  const records: JointStopRecord[] = [];
  const violations: JointViolation[] = [];
  const firstBefore = new Map<string, number>();
  const firstAfter = new Map<string, number>();

  stops.forEach((stop, stopIndex) => {
    const shipped = statusesAtStop(artifact, stop, bracket, false);
    const combined = statusesAtStop(artifact, stop, bracket, true);
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
      violations.push({
        kind: "shippedLostLock",
        districtKey: artifact.districtKey,
        stop: stop.label,
        teamKey,
        pointsSlots: combined.pointsSlots,
        bound: null,
        finalStatus: finalStatus.get(teamKey) ?? "unknown",
      });
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
    earlier.push({
      districtKey: artifact.districtKey,
      teamKey: team.teamKey,
      before: before === undefined ? "never" : stops[before]!.label,
      after: stops[after]!.label,
    });
  }

  return { districtKey: artifact.districtKey, dcmpKey: stops[0]?.context.dcmpKey ?? "", stops: records, violations, earlier, qualifiers: qualifiers.length };
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

/** The 2023 to 2026 district artifacts the proof can run on, and every other one with its reason. */
export function loadJointDistricts(dir: string = LOCAL_DISTRICT_DIR): LoadedJointDistricts {
  const kept: DistrictArtifact[] = [];
  const skipped: SkippedDistrict[] = [];
  for (const file of readdirSync(dir).sort()) {
    const match = DISTRICT_DETAIL_FILE.exec(file);
    if (match === null || !SWEPT_SEASONS.includes(Number(match[1]))) continue;
    const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    const keys = dcmpEventKeysFor(artifact);
    if (artifact.cmpSlots === null) skipped.push({ districtKey: artifact.districtKey, reason: "no capacity (cmpSlots null)" });
    else if (keys.length === 0) skipped.push({ districtKey: artifact.districtKey, reason: "no District Championship on the artifact" });
    else if (keys.length > 1) {
      const stems = new Set(keys.map(championshipStemOf));
      skipped.push({ districtKey: artifact.districtKey, reason: stems.size === 1 ? `divisions (${keys.join(", ")})` : `two championships (${keys.join(", ")})` });
    } else if (!artifact.teams.some((team) => team.qualifyingAwards.some((award) => award.awardType === AWARD_TYPE_WINNER && award.eventKey === keys[0]))) {
      skipped.push({ districtKey: artifact.districtKey, reason: "winner award not posted" });
    } else kept.push(artifact);
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

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function reportSweep(sweep: JointSweep): void {
  console.log(``);
  console.log(`${sweep.districtKey} (${sweep.dcmpKey}), ${String(sweep.qualifiers)} eventual qualifiers`);
  console.log(`  ${"stop".padEnd(28)} ${pad("S'", 3)} ${"joint".padEnd(18)} ${pad("shipped", 7)} ${pad("joint only", 10)} ${pad("combined", 8)} ${pad("viol", 4)}`);
  for (const stop of sweep.stops) {
    console.log(
      `  ${stop.label.padEnd(28)} ${pad(stop.pointsSlots, 3)} ${stop.joint.padEnd(18)} ${pad(stop.shippedLocked, 7)} ${pad(stop.jointOnly, 10)} ${pad(stop.combinedLocked, 8)} ${pad(stop.violations, 4)}`
    );
  }
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
      const dcmpKey = dcmpEventKeysFor(artifact)[0]!;
      const bracket = bracketFromCorpus(db, alliancesBySeason, artifact.year, dcmpKey);
      if (bracket === undefined) {
        skipped.push({ districtKey: artifact.districtKey, reason: `no corpus alliances for ${dcmpKey}` });
        continue;
      }
      sweeps.push(sweepJoint(artifact, bracket));
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
    console.log(`  sources:    ${LOCAL_DISTRICT_DIR}, ${CORPUS_PATH} (read only, no network, no credential)`);
    for (const sweep of sweeps) reportSweep(sweep);
    const sum = (pick: (stop: JointStopRecord) => number): number => sweeps.reduce((acc, sweep) => acc + sweep.stops.reduce((inner, stop) => inner + pick(stop), 0), 0);
    console.log(``);
    console.log(`TOTALS`);
    console.log(`  championships swept                  ${String(sweeps.length)}`);
    console.log(`  stops                                ${String(sweeps.reduce((acc, sweep) => acc + sweep.stops.length, 0))}`);
    console.log(`  stops where the proof ran            ${String(sweeps.reduce((acc, sweep) => acc + sweep.stops.filter((stop) => stop.joint === "applied").length, 0))}`);
    console.log(`  Locked on points, shipped            ${String(sum((stop) => stop.shippedLocked))}`);
    console.log(`  Locked by the joint proof alone      ${String(sum((stop) => stop.jointOnly))}`);
    console.log(`  Locked on points, combined           ${String(sum((stop) => stop.combinedLocked))}`);
    console.log(`  qualifiers locked at an earlier stop ${String(earlier.length)}`);
    console.log(`  time                                 ${seconds.toFixed(1)} s`);
    console.log(``);
    console.log(`FIRST LOCK MOVED EARLIER (${String(earlier.length)})`);
    for (const move of earlier) console.log(`  ${move.districtKey.padEnd(9)} ${move.teamKey.padEnd(9)} ${move.before.padEnd(28)} -> ${move.after}`);
    console.log(``);
    console.log(`SKIPPED (${String(skipped.length)})`);
    for (const entry of skipped) console.log(`  ${entry.districtKey.padEnd(9)} ${entry.reason}`);
    console.log(``);
    if (violations.length === 0) console.log(`VIOLATIONS: none`);
    else {
      console.log(`VIOLATIONS (${String(violations.length)})`);
      for (const v of violations) {
        console.log(`  ${v.kind.padEnd(16)} ${v.districtKey.padEnd(9)} ${v.teamKey.padEnd(9)} at ${v.stop} pointsSlots ${String(v.pointsSlots)} bound ${v.bound === null ? "n/a" : String(v.bound)} -> final ${v.finalStatus}`);
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
