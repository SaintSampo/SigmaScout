/**
 * THE MONOTONE PROPERTY of the Champ Locks joint lock proof (quick task
 * 261010-d7r).
 *
 * THE RULE, Jacob's: "it is mission critical that no team is told they are
 * locked at any stop, and then later they are not locked. but also once a
 * team is locked, we should know it as soon as we can."
 *
 * WHAT THE SWEEPS DID NOT HAVE. `scripts/measureChampJointLocks.ts` checks
 * that every team shown Locked at a stop ends up qualified, and its take back
 * count compares one sweep stop with the next. A District Championship does
 * not arrive in sweep stops. Its facts land one at a time and in no fixed
 * order: one division's awards flag turns true before another's, a division
 * finishes while another is still in Round 2. A Locked given at one of those
 * in between readings and not held at the next is a Locked taken back, and
 * no sweep stop sits there to see it. Quick task 261010-66y measured eleven
 * such teams by hand. This file holds the property instead.
 *
 * AN EDGE (planner reading R9). Every reading of a championship is a point of
 * a lattice: which facts are in. An EDGE is two readings that differ by
 * exactly one fact, with everything else fixed:
 *
 *   - a FLAG EDGE: one more key's Awards read final (a division's, or one
 *     championship's of two); in the live walks of group D, one more level
 *     of one key's awards (its Winner listed, its award points landed, its
 *     flag true);
 *   - a STOP EDGE: the same flags, one stop of the sweep further on;
 *   - a STEP EDGE (group D only): one more tick of a live walk, which is one
 *     more real fact through the merge's own two entry points.
 *
 * Every order in which the facts can arrive is a path of edges, so checking
 * every edge covers every order. Over each edge three things must hold:
 *
 *   1. NO HELD TEAM IS LOST: a team shown Locked (or prequalified) before the
 *      edge is shown Locked (or prequalified) after it. This is read off the
 *      tab's own status code (`computeChampLedgerStatuses`), ceiling test and
 *      joint proof together.
 *   2. NO MARGIN DROPS: where the joint proof is applied on both sides, no
 *      pool team's margin (the points slots minus its joint bound) is smaller
 *      after the edge. A margin that drops is a bound that rose, which is the
 *      mechanism of a take back whether or not a Locked team sits on it yet.
 *   3. NO BOUND RISES (quick task 261010-l0s): where the joint proof is
 *      applied on both sides, no pool team's joint bound is higher after the
 *      edge, Locked or not. The points slots never rise over an edge of this
 *      file, so at this file's reading 3 follows from 2; it is counted on its
 *      own, by team bounds compared, so that a bound that rose is named as
 *      one. The last group of this file holds the counts.
 *
 * THE BOUNDS ARE READ EXACTLY UP TO 12 ABOVE THE POINTS SLOTS (planner reading
 * R8): `jointLockBound` is asked with that stop and the answer capped there.
 * A bound that high locks nobody on either side of an edge, so two bounds at
 * or above the cap read as equal. The figure is a cost limit, not a tolerance:
 * it is never widened or narrowed to make a test pass.
 *
 * WHAT THAT READING DOES NOT SEE. A bound that rises wholly ABOVE the cap,
 * under a team more than 12 from its points slots on both sides of an edge,
 * reads as equal here. The planner of quick task 261010-l0s read every
 * rules on edge of groups A to D once with every bound exact, the FIM
 * seasons and the walks with the finals key registered included: 8,785
 * edges with the proof running on both sides and 2,712,435 team bounds
 * (the same bounds the last group of this file counts at its own reading).
 * Before that task's two changes two things showed, neither under a team
 * shown Locked on any walk. With both changes no bound is higher over any
 * of those edges.
 *
 *   - 22 bounds rose by one over 22 edges, every one frc9710 at 2024 NE (65
 *     or more above its points slots), each at the edge where its OWN
 *     division award posts: its floor passed rivals the proof then counted
 *     twice. That task made every rival count once, and those read none.
 *     The last group of this file holds that lattice exact.
 *   - 20 bounds rose by one over 5 edges of the one event walks, each 14 or
 *     more above its points slots: 2024fnc 1, 2025fin 2, 2026fnc 1, and
 *     2026ca 8 at each of two edges. Every one is the tick a key's PLAYOFF
 *     POINTS LAND after its playoffs are done, where the decided winner
 *     lists a team that holds no alliance selection points and TBA then pays
 *     that team for the winner's playoffs. Until the tick the proof counts
 *     it through the winner's one fill in. After it the team was ahead of
 *     some teams by its own floor and the winner's spare seat still counted
 *     as open, since a pick was confirmed by its alliance selection points
 *     alone. The status code now also confirms a pick TBA has paid for its
 *     alliance's playoffs (`packages/core/districts/champJointLock.ts`, "A
 *     PICK TBA HAS PAID FOR AN ALLIANCE'S PLAYOFFS IS ON THAT ALLIANCE"),
 *     and those read none. Group E of this file holds the one event walks
 *     exact, with that rule on and with it switched off.
 *
 * THE GROUPS OF THIS FILE:
 *   A. THE AWARDS ORDER TEST. Every divisioned championship of 2023 to 2026,
 *      every stop of the joint sweep but Now, every subset of its divisions
 *      read with Awards final (the season's real posted award points) and the
 *      others with Awards open. Every flag edge and every stop edge. One more
 *      reading follows the sweep's last stop: the FINALS' Awards final too,
 *      every division's flag still free, which is where the finals' awards
 *      flag turns true before a division's.
 *   B. DIVISIONS OUT OF STEP. Some divisions (the set AHEAD) have finished
 *      their playoffs, every one of their rows played, while the others stand
 *      at a sweep stop before "Divisions final". Every subset of the ahead
 *      divisions is read with its Awards final. For the two division
 *      championships every ahead set is read; for the four FIM seasons one
 *      division ahead at a time, each of the four in turn (every ahead set
 *      there costs about 280 seconds a season; the planner of this task ran
 *      it once and read no Locked lost and no margin drop).
 *   C. TWO CHAMPIONSHIPS, ONE FINISHING FIRST (2026 California). One
 *      championship has finished its playoffs, every row played, while the
 *      other stands at each stop of the sweep in turn; the finished one's
 *      Awards read open and then final. And at the sweep's "Playoffs final,
 *      awards open" stop, every subset of the two championships read with
 *      Awards final.
 *   D. THE MICRO STEP LIVE WALKS. Groups A to C rewind a finished artifact:
 *      every reading there has the season's final rows under it. Group D
 *      walks a championship LIVE, from an artifact with no championship row,
 *      one real fact at a time through the merge's two entry points
 *      (`applyDistrictRankings`, `applyDistrictEventState`), and reads the
 *      tab's own row builder and status code at Now after every tick: each
 *      played playoff row, each category's points landing, each awards flag
 *      in every order, the finals facts before, between and after the flags.
 *      Its own header (above the group) lists the edges it walks and the
 *      ones it does not.
 *   E. THE PAID PICK RULE (quick task 261010-l0s, finding F2). The 32 one
 *      event walks of group D read again with EVERY bound exact, with the
 *      rules on and with the paid pick rule switched off; and one
 *      championship built by hand on the committed 2026 PNW fixture, where
 *      the tick the playoff points land takes a Locked back with the rule
 *      off and keeps it with the rule on.
 *
 * IT PROVES SOMETHING. Each group also runs with its rule switched off inside
 * this file and must then LOSE Locked teams. The switches are one module mock
 * of the core proof (`packages/core/districts/champJointLock.ts`), the module
 * the status code itself imports:
 *
 *   - while `awardedRuleOff` is set every input is handed to the proof
 *     without its `awardedRivals`, which is the proof of before quick task
 *     261010-d7r (a rival that already holds a posted award may be given a
 *     second judged award);
 *   - while `stopRuleOff` is set `jointProofStillRuns` answers as the code
 *     read before that task: the proof stops at the first key whose Awards
 *     read final (a divisioned championship's at its finals' Awards, two
 *     championships' at either one's);
 *   - while `listedRuleOff` is set every input is handed to the proof with
 *     no `listedOnly` on any pool rival, which is the proof of before that
 *     task's finding F-D (a listed pick that is not confirmed is read at its
 *     placed alliance's settled value AND on another alliance's seat);
 *   - while `paidRuleOff` is set `confirmedPicks` is told TBA paid nobody,
 *     which is the status code of before quick task 261010-l0s's paid pick
 *     rule (a pick is confirmed by its alliance selection points alone, so
 *     a backup TBA has paid for the winner's playoffs stays off the winner
 *     and the seat it holds stays open).
 *
 * The Locked teams lost in those runs are read off the status code's own
 * verdicts, so they show the mock reaches the import the tab uses. The
 * switched off totals are PINNED AS THE RUN SHOWS: they are a measurement of
 * the old reading, not a requirement, except that they must be above 0.
 *
 * WHAT EACH SWITCH COSTS IS NOT THE SAME THING, and the tests say which:
 * the awarded rule off and the stop rule off LOSE LOCKED TEAMS. The listed
 * rule off loses NO Locked team on any walk of group D, the only group it
 * reaches (a rewound reading carries no `listedOnly`): it only drops margins
 * (a bound rises under a team that stays Locked, or under a team that was
 * not Locked). A margin that drops is the mechanism of a take back, so the
 * rule is kept and held by a test, but no measured Locked rests on it. The
 * paid pick rule off loses no Locked team on any real walk either: every
 * bound it raises sits 14 or more above its points slots, which only group
 * E's exact reading sees. On the championship group E builds by hand it
 * does take a Locked back.
 *
 * A RULES ON FAILURE IS A FINDING, never a pin to move: a Locked lost or a
 * margin dropped with the rules on means the proof took a guarantee back.
 * Stop and report the edge, the team and both bounds.
 *
 * EVERY GROUP READS GITIGNORED LOCAL DATA (`data/local-publish/districts` and
 * `data/corpus.sqlite`, opened read only) and skips, with a message naming
 * what is absent, where the data is not there. With `REQUIRE_LOCAL_DATA=1` in
 * the environment the same group FAILS instead, so a verify step cannot pass
 * on a machine that silently ran nothing. No network, no credential. Group
 * E's hand built championship alone reads a committed fixture and always
 * runs.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../packages/harness/pageArtifacts.js";
import { applyDistrictEventState, applyDistrictRankings, recomputeDistrictVerdicts, type DistrictEventAwardInput } from "../packages/harness/districtRankingsMerge.js";
import { championshipShape } from "../packages/core/districts/finalsBracket.js";
import type { PlayedBracketMatch } from "../packages/core/districts/bracket.js";
import { jointLockBound, jointLockBoundMultiple } from "../packages/core/districts/champJointLock.js";
import { fieldFixingDcmpKeys } from "../packages/core/districts/dcmpFieldProof.js";
import { maxEventPoints } from "../packages/core/districts/pointModel.js";
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
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildChampLedgerRows, champFieldProofAtNow, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses, type ChampLedgerStatusModel } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { CORPUS_PATH, LOCAL_DISTRICT_DIR, bracketFromCorpus, bracketsFromCorpus, championshipStops, statusesAtChampionshipStop, type ChampionshipStop } from "./measureChampJointLocks.js";

/**
 * THE SWITCHES. The row builders and the status code run as shipped; only the
 * core proof is handed a different input while a switch is set.
 *
 * While `awardedRuleOff` is set the proof never learns which rivals already
 * hold a posted award: every input reaches it without `awardedRivals`.
 *
 * While `stopRuleOff` is set the one rule for when a proof stops answers "not
 * once the championship's own Awards are final", whatever the other keys
 * read: the reading before quick task 261010-d7r.
 *
 * While `listedRuleOff` is set the proof never learns which rivals hold a
 * settled Playoffs value only as a listed pick that is not confirmed: every
 * pool rival reaches it without `listedOnly`, its `extra` unchanged.
 *
 * While `paidRuleOff` is set the status code never learns which picks TBA has
 * paid for their alliance's playoffs: `confirmedPicks` is handed "nobody",
 * so a pick is confirmed by its alliance selection points alone.
 */
const ruleSwitch = vi.hoisted(() => ({ awardedRuleOff: false, stopRuleOff: false, listedRuleOff: false, paidRuleOff: false }));

vi.mock("../packages/core/districts/champJointLock.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/champJointLock.js")>();
  type Input = Parameters<typeof original.jointLockBoundAt>[0];
  /** An input with no `listedOnly` on any pool rival, built once per input (the proof is asked once per team). */
  const withoutListedOnly = new WeakMap<Input, Input>();
  /** The input the proof is handed: as given, or without what the switched off rule reads. Each switch drops exactly one thing. */
  const handed = (input: Input): Input => {
    if (ruleSwitch.awardedRuleOff && input.awardedRivals !== undefined) {
      return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "awardedRivals")) as unknown as Input;
    }
    if (ruleSwitch.listedRuleOff && input.pool.some((rival) => rival.listedOnly !== undefined)) {
      let stripped = withoutListedOnly.get(input);
      if (stripped === undefined) {
        stripped = { ...input, pool: input.pool.map((rival) => ({ teamKey: rival.teamKey, floor: rival.floor, extra: rival.extra })) };
        withoutListedOnly.set(input, stripped);
      }
      return stripped;
    }
    return input;
  };
  return {
    ...original,
    jointLockedTeams: (input: Input) => original.jointLockedTeams(handed(input)),
    jointLockBound: (input: Input, teamKey: string, stopAt?: number) => original.jointLockBound(handed(input), teamKey, stopAt),
    jointLockBoundAt: (input: Input, teamKey: string, floor: number, stopAt?: number) => original.jointLockBoundAt(handed(input), teamKey, floor, stopAt),
    jointLockedTeamsMultiple: (championships: readonly Input[], pointsSlots: number) => original.jointLockedTeamsMultiple(championships.map(handed), pointsSlots),
    jointLockBoundMultiple: (championships: readonly Input[], teamKey: string, stopAt?: number) => original.jointLockBoundMultiple(championships.map(handed), teamKey, stopAt),
    jointProofStillRuns: (championshipAwardsFinal: boolean, anotherKeysAwardsOpen: boolean) =>
      ruleSwitch.stopRuleOff ? !championshipAwardsFinal : original.jointProofStillRuns(championshipAwardsFinal, anotherKeysAwardsOpen),
    confirmedPicks: (listed: readonly string[], holdsAllianceSelectionPoints: (teamKey: string) => boolean, paidForItsPlayoffs: (teamKey: string) => boolean) =>
      original.confirmedPicks(listed, holdsAllianceSelectionPoints, ruleSwitch.paidRuleOff ? () => false : paidForItsPlayoffs),
  };
});

afterEach(() => {
  ruleSwitch.awardedRuleOff = false;
  ruleSwitch.stopRuleOff = false;
  ruleSwitch.listedRuleOff = false;
  ruleSwitch.paidRuleOff = false;
});

/** Which rules a run has on. `"on"` is the shipped proof; each other mode switches exactly one rule off. */
type RuleMode = "on" | "awardedRuleOff" | "stopRuleOff" | "listedRuleOff" | "paidRuleOff";

/** Runs `body` under a rule mode, and switches every rule back on whatever happens. */
function underRules<T>(mode: RuleMode, body: () => T): T {
  ruleSwitch.awardedRuleOff = mode === "awardedRuleOff";
  ruleSwitch.stopRuleOff = mode === "stopRuleOff";
  ruleSwitch.listedRuleOff = mode === "listedRuleOff";
  ruleSwitch.paidRuleOff = mode === "paidRuleOff";
  try {
    return body();
  } finally {
    ruleSwitch.awardedRuleOff = false;
    ruleSwitch.stopRuleOff = false;
    ruleSwitch.listedRuleOff = false;
    ruleSwitch.paidRuleOff = false;
  }
}

/**
 * A local data gated group whose data is absent: one skipped test naming what
 * is missing, or with `REQUIRE_LOCAL_DATA=1` one FAILING test.
 */
function localDataAbsent(what: string): void {
  if (process.env.REQUIRE_LOCAL_DATA === "1") {
    it(`REQUIRE_LOCAL_DATA=1 and the local data is absent: ${what}`, () => {
      throw new Error(`REQUIRE_LOCAL_DATA=1, but this local data gated group cannot run: ${what}`);
    });
    return;
  }
  it.skip(`skipped: ${what}`, () => {});
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DISTRICT_ABSOLUTE = join(REPO_ROOT, LOCAL_DISTRICT_DIR);
const CORPUS_ABSOLUTE = join(REPO_ROOT, CORPUS_PATH);
/** The district DETAIL files alone: `v1__districts__2026.json` is the per year index and carries no teams. */
const DISTRICT_DETAIL_FILE = /^v1__district__(\d{4})[a-z0-9]+\.json$/;
const LOCAL_DISTRICT_FILES = existsSync(LOCAL_DISTRICT_ABSOLUTE) ? readdirSync(LOCAL_DISTRICT_ABSOLUTE).filter((name) => DISTRICT_DETAIL_FILE.test(name)).sort() : [];
const TEST_TIMEOUT_MS = 600_000;

/**
 * THE DIVISIONED CHAMPIONSHIPS OF 2023 TO 2026, by district key: the joint
 * sweep's own set. Named here so each can be its own test; the first test of
 * group A holds the list EQUAL to what the local artifacts carry, so a new
 * season or district fails loudly instead of being silently left out.
 */
const FOUR_DIVISION = ["2023fim", "2024fim", "2025fim", "2026fim"] as const;
const TWO_DIVISION = ["2023fit", "2023ne", "2023ont", "2024fit", "2024ne", "2024ont", "2025fit", "2025ne", "2025ont", "2026fit", "2026ne", "2026ont"] as const;
const DIVISIONED = [...FOUR_DIVISION, ...TWO_DIVISION].sort();
const MISSING_DIVISIONED = DIVISIONED.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));

/** Bounds are read exactly up to this many above the points slots (planner reading R8). */
const BOUND_SLACK = 12;

interface DivisionedChampionship {
  readonly artifact: DistrictArtifact;
  readonly finalsKey: string;
  readonly divisionKeys: readonly string[];
  readonly brackets: Map<string, BracketSourceEvent>;
}

const artifactCache = new Map<string, DistrictArtifact>();
function localArtifact(fileName: string): DistrictArtifact {
  let artifact = artifactCache.get(fileName);
  if (artifact === undefined) {
    artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(LOCAL_DISTRICT_ABSOLUTE, fileName), "utf8")));
    artifactCache.set(fileName, artifact);
  }
  return artifact;
}

const championshipCache = new Map<string, DivisionedChampionship>();
/** One divisioned championship with its corpus bracket at every key. */
function divisionedChampionship(districtKey: string): DivisionedChampionship {
  let championship = championshipCache.get(districtKey);
  if (championship === undefined) {
    const artifact = localArtifact(`v1__district__${districtKey}.json`);
    const shape = championshipShape(dcmpEventKeysFor(artifact));
    if (shape.kind !== "divisioned") throw new Error(`${districtKey} is not a divisioned championship (${shape.kind})`);
    const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
    try {
      const found = bracketsFromCorpus(db, new Map(), artifact);
      if ("missing" in found) throw new Error(`the corpus carries no bracket for ${found.missing}`);
      championship = { artifact, finalsKey: shape.finalsKey, divisionKeys: shape.divisionKeys, brackets: found.brackets };
    } finally {
      db.close();
    }
    championshipCache.set(districtKey, championship);
  }
  return championship;
}

/** Every local district artifact of 2023 on with a published capacity whose championship is divisioned, by district key. */
function divisionedDistrictKeysOnDisk(): string[] {
  const keys: string[] = [];
  for (const fileName of LOCAL_DISTRICT_FILES) {
    const year = Number(DISTRICT_DETAIL_FILE.exec(fileName)?.[1]);
    if (!(year >= 2023)) continue;
    const artifact = localArtifact(fileName);
    if (artifact.cmpSlots === null) continue;
    if (championshipShape(dcmpEventKeysFor(artifact)).kind === "divisioned") keys.push(artifact.districtKey);
  }
  return keys.sort();
}

// ---------------------------------------------------------------------------
// One reading, and one edge
// ---------------------------------------------------------------------------

/** What one reading of the tab's own status code shows, as far as an edge is concerned. */
interface Reading {
  /** `applied`, or the reason the joint proof did not run. */
  readonly joint: string;
  readonly pointsSlots: number;
  /** The teams shown Locked or prequalified. */
  readonly held: ReadonlySet<string>;
  readonly model: ChampLedgerStatusModel;
  /** Each pool team's joint bound, exact up to `BOUND_SLACK` above the points slots and capped there. Empty where the proof did not run. */
  readonly bound: ReadonlyMap<string, number>;
}

function readingOf(model: ChampLedgerStatusModel, slack = BOUND_SLACK): Reading {
  const proof = model.jointProof;
  const held = new Set<string>();
  for (const result of model.byTeam.values()) if (result.status === "locked" || result.status === "prequalified") held.add(result.teamKey);
  const bound = new Map<string, number>();
  if (proof?.applied === true) {
    const cap = model.pointsSlots + slack;
    if (proof.shape === "multiple") {
      const teamKeys = new Set(proof.championships.flatMap((input) => input.pool.map((rival) => rival.teamKey)));
      for (const teamKey of teamKeys) bound.set(teamKey, Math.min(cap, jointLockBoundMultiple(proof.championships, teamKey, cap)));
    } else {
      for (const rival of proof.input.pool) bound.set(rival.teamKey, Math.min(cap, jointLockBound(proof.input, rival.teamKey, cap)));
    }
  }
  return { joint: proof?.applied === true ? "applied" : (proof?.reason ?? "no proof"), pointsSlots: model.pointsSlots, held, model, bound };
}

type EdgeKind = "flag" | "stop" | "step";
const EDGE_KINDS: readonly EdgeKind[] = ["flag", "stop", "step"];

/** What a set of edges showed. */
interface EdgeTally {
  readings: number;
  /** Readings by what the joint proof said: `applied`, or the reason it did not run. */
  readonly joint: Record<string, number>;
  readonly edges: Record<EdgeKind, number>;
  /** Held teams lost over an edge, by edge kind. */
  readonly lost: Record<EdgeKind, number>;
  /** Edges over which at least one pool team's margin dropped, by edge kind. */
  readonly edgesWithADrop: Record<EdgeKind, number>;
  /** Team margins dropped, over every edge. */
  marginDrops: number;
  largestDrop: number;
  /** Team bounds compared: every pool team on both sides of an edge where the proof is applied on both (quick task 261010-l0s). */
  boundComparisons: number;
  /** Team bounds HIGHER after an edge than before it, Locked or not. */
  boundRises: number;
  /** Edges over which the proof went from applied to not applied. */
  appliedThenRefused: number;
  /** The first lines of each finding, for the failure message and the log. */
  readonly lostLines: string[];
  readonly dropLines: string[];
  readonly riseLines: string[];
  /** The distinct teams lost. */
  readonly lostTeams: Set<string>;
}

function newTally(): EdgeTally {
  return {
    readings: 0,
    joint: {},
    edges: { flag: 0, stop: 0, step: 0 },
    lost: { flag: 0, stop: 0, step: 0 },
    edgesWithADrop: { flag: 0, stop: 0, step: 0 },
    marginDrops: 0,
    largestDrop: 0,
    boundComparisons: 0,
    boundRises: 0,
    appliedThenRefused: 0,
    lostLines: [],
    dropLines: [],
    riseLines: [],
    lostTeams: new Set(),
  };
}

const LINES_KEPT = 40;

function countReading(tally: EdgeTally, reading: Reading): Reading {
  tally.readings += 1;
  tally.joint[reading.joint] = (tally.joint[reading.joint] ?? 0) + 1;
  return reading;
}

/** One edge: no held team lost, no margin dropped. Findings go to the tally; nothing is asserted here. */
function checkEdge(tally: EdgeTally, kind: EdgeKind, where: string, before: Reading, after: Reading): void {
  tally.edges[kind] += 1;
  if (before.joint === "applied" && after.joint !== "applied") tally.appliedThenRefused += 1;
  for (const teamKey of before.held) {
    if (after.held.has(teamKey)) continue;
    tally.lost[kind] += 1;
    tally.lostTeams.add(teamKey);
    if (tally.lostLines.length < LINES_KEPT) {
      tally.lostLines.push(
        `${kind} edge, ${where}: ${teamKey} ${String(before.model.byTeam.get(teamKey)?.lockedBy)} then ${String(after.model.byTeam.get(teamKey)?.status)} | bound ${String(before.bound.get(teamKey))} then ${String(after.bound.get(teamKey))} against ${String(before.pointsSlots)} then ${String(after.pointsSlots)} points slots | joint ${before.joint} then ${after.joint}`
      );
    }
  }
  if (before.joint !== "applied" || after.joint !== "applied") return;
  let dropped = 0;
  for (const [teamKey, was] of before.bound) {
    const now = after.bound.get(teamKey);
    if (now === undefined) continue;
    tally.boundComparisons += 1;
    if (now > was) {
      tally.boundRises += 1;
      if (tally.riseLines.length < LINES_KEPT) tally.riseLines.push(`${kind} edge, ${where}: ${teamKey} bound ${String(was)} then ${String(now)} against ${String(before.pointsSlots)} then ${String(after.pointsSlots)} points slots`);
    }
    const marginBefore = before.pointsSlots - was;
    const marginAfter = after.pointsSlots - now;
    if (marginAfter >= marginBefore) continue;
    dropped += 1;
    tally.largestDrop = Math.max(tally.largestDrop, marginBefore - marginAfter);
    if (tally.dropLines.length < LINES_KEPT) {
      tally.dropLines.push(`${kind} edge, ${where}: ${teamKey} bound ${String(was)} then ${String(now)} against ${String(before.pointsSlots)} then ${String(after.pointsSlots)} points slots`);
    }
  }
  tally.marginDrops += dropped;
  if (dropped > 0) tally.edgesWithADrop[kind] += 1;
}

function addTally(into: EdgeTally, from: EdgeTally): void {
  into.readings += from.readings;
  for (const [key, count] of Object.entries(from.joint)) into.joint[key] = (into.joint[key] ?? 0) + count;
  for (const kind of EDGE_KINDS) {
    into.edges[kind] += from.edges[kind];
    into.lost[kind] += from.lost[kind];
    into.edgesWithADrop[kind] += from.edgesWithADrop[kind];
  }
  into.marginDrops += from.marginDrops;
  into.largestDrop = Math.max(into.largestDrop, from.largestDrop);
  into.boundComparisons += from.boundComparisons;
  into.boundRises += from.boundRises;
  into.appliedThenRefused += from.appliedThenRefused;
  for (const line of from.lostLines) if (into.lostLines.length < LINES_KEPT) into.lostLines.push(line);
  for (const line of from.dropLines) if (into.dropLines.length < LINES_KEPT) into.dropLines.push(line);
  for (const line of from.riseLines) if (into.riseLines.length < LINES_KEPT) into.riseLines.push(line);
}

/** The assertion of a rules on run: nothing lost, nothing dropped, no bound higher, with the findings in the message. */
function expectMonotone(label: string, tally: EdgeTally): void {
  const findings = [...tally.lostLines, ...tally.dropLines, ...tally.riseLines];
  expect(
    { label, lostOverFlagEdges: tally.lost.flag, lostOverStopEdges: tally.lost.stop, lostOverStepEdges: tally.lost.step, marginDrops: tally.marginDrops, boundRises: tally.boundRises, findings },
    `${label}: a Locked team was lost, a margin dropped or a bound rose with the rules ON. This is a finding, never a pin to move.`
  ).toEqual({ label, lostOverFlagEdges: 0, lostOverStopEdges: 0, lostOverStepEdges: 0, marginDrops: 0, boundRises: 0, findings: [] });
}

const shortKey = (eventKey: string): string => eventKey.slice(4);

// ---------------------------------------------------------------------------
// GROUP A. The awards order test
// ---------------------------------------------------------------------------

interface LatticeResult {
  readonly districtKey: string;
  readonly stops: number;
  readonly tally: EdgeTally;
}

const latticeCache = new Map<string, LatticeResult>();

const ALL_FINAL_STAGE: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
/** The sweep's last stop before Now, and the one reading this file adds after it. */
const FINALS_DECIDED_STOP = "Finals decided, awards open";
const FINALS_AWARDS_FINAL_READING = "Finals awards final";

/**
 * THE AWARDS ORDER LATTICE of one divisioned championship: at every stop of
 * the joint sweep but Now, every subset of its divisions is read with Awards
 * FINAL (the season's real posted award points, which then sit in the floors)
 * and the others with Awards OPEN. A flag edge is one more division's flag at
 * the same stop; a stop edge is the same flags one stop on.
 *
 * At the stops from "Divisions final" on the sweep itself reads every
 * division's Awards final, so the subsets below it are readings the sweep
 * never takes: the divisions' playoffs done, the finals under way, and one or
 * more divisions' awards flags not yet true.
 *
 * ONE MORE READING follows the sweep's last stop ("Finals decided, awards
 * open"): the FINALS' Awards final too, every division's flag still free.
 * It is the finals' awards flag turning true before a division's (finding F-B
 * of quick task 261010-d7r). There the proof still runs while some division's
 * Awards are open, and is refused only at the one reading where every flag is
 * true, which is the artifact's own finished state.
 *
 * `scope` "intoTheFinalsAwards" reads the sweep's last stop and that one
 * reading alone: the only readings the stop rule changes.
 */
function awardsOrderLattice(districtKey: string, mode: RuleMode, scope: "whole" | "intoTheFinalsAwards" = "whole", slack = BOUND_SLACK): LatticeResult {
  const cacheKey = `${districtKey}|${mode}|${scope}|${String(slack)}`;
  const cached = latticeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = underRules(mode, (): LatticeResult => {
    const { artifact, finalsKey, divisionKeys, brackets } = divisionedChampionship(districtKey);
    const divisionCount = divisionKeys.length;
    const masks = Array.from({ length: 1 << divisionCount }, (_, mask) => mask);
    const sweepStops: ChampionshipStop[] = championshipStops(artifact, brackets).filter((stop) => !stop.atNow);
    const lastStop = sweepStops.at(-1);
    if (lastStop === undefined || lastStop.label !== FINALS_DECIDED_STOP) throw new Error(`${districtKey}: the sweep's last stop is not "${FINALS_DECIDED_STOP}"`);
    const finalsAwardsFinal: ChampionshipStop = {
      ...lastStop,
      label: FINALS_AWARDS_FINAL_READING,
      stageByKey: new Map([...lastStop.stageByKey].map(([key, stage]) => [key, key === finalsKey ? ALL_FINAL_STAGE : stage] as const)),
    };
    const stops = scope === "whole" ? [...sweepStops, finalsAwardsFinal] : [lastStop, finalsAwardsFinal];
    const tally = newTally();
    const read = (stop: ChampionshipStop, mask: number): Reading => {
      const stageByKey = new Map(stop.stageByKey);
      divisionKeys.forEach((key, index) => {
        const base = stop.stageByKey.get(key);
        if (base === undefined) throw new Error(`${districtKey} "${stop.label}" carries no stage for ${key}`);
        stageByKey.set(key, { ...base, award: (mask & (1 << index)) !== 0 });
      });
      return countReading(tally, readingOf(statusesAtChampionshipStop(artifact, { ...stop, stageByKey }, brackets, true), slack));
    };
    const flagsOf = (mask: number): string => `{${divisionKeys.filter((_, index) => (mask & (1 << index)) !== 0).map(shortKey).join(",")}}`;
    let previous: Map<number, Reading> | undefined;
    for (const stop of stops) {
      const byMask = new Map(masks.map((mask) => [mask, read(stop, mask)] as const));
      if (previous !== undefined) {
        for (const mask of masks) checkEdge(tally, "stop", `${districtKey} awards final at ${flagsOf(mask)}, into "${stop.label}"`, previous.get(mask)!, byMask.get(mask)!);
      }
      for (const mask of masks) {
        for (let division = 0; division < divisionCount; division++) {
          if ((mask & (1 << division)) !== 0) continue;
          checkEdge(tally, "flag", `${districtKey} "${stop.label}" awards final at ${flagsOf(mask)} then ${shortKey(divisionKeys[division]!)}`, byMask.get(mask)!, byMask.get(mask | (1 << division))!);
        }
      }
      previous = byMask;
    }
    return { districtKey, stops: stops.length, tally };
  });
  latticeCache.set(cacheKey, result);
  return result;
}

function latticeTotals(mode: RuleMode, scope: "whole" | "intoTheFinalsAwards" = "whole"): { stops: number; tally: EdgeTally; lostByDistrict: Record<string, number> } {
  const tally = newTally();
  const lostByDistrict: Record<string, number> = {};
  let stops = 0;
  for (const districtKey of DIVISIONED) {
    const result = awardsOrderLattice(districtKey, mode, scope);
    stops += result.stops;
    addTally(tally, result.tally);
    for (const teamKey of result.tally.lostTeams) tally.lostTeams.add(`${districtKey} ${teamKey}`);
    lostByDistrict[districtKey] = result.tally.lost.flag + result.tally.lost.stop;
  }
  return { stops, tally, lostByDistrict };
}

describe("GROUP A, the awards order test: the 16 divisioned championships of 2023 to 2026, every sweep stop and the finals' Awards final, every subset of divisions read with Awards final (quick task 261010-d7r, D3)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (MISSING_DIVISIONED.length > 0) {
    localDataAbsent(`${MISSING_DIVISIONED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it("the championships named in this file are exactly the divisioned championships the local artifacts carry", () => {
    expect(divisionedDistrictKeysOnDisk()).toEqual(DIVISIONED);
    for (const districtKey of FOUR_DIVISION) expect(divisionedChampionship(districtKey).divisionKeys).toHaveLength(4);
    for (const districtKey of TWO_DIVISION) expect(divisionedChampionship(districtKey).divisionKeys).toHaveLength(2);
  });

  for (const districtKey of DIVISIONED) {
    it(
      `${districtKey}: over every flag edge and every stop edge no held team is lost and no margin drops`,
      () => {
        const { tally } = awardsOrderLattice(districtKey, "on");
        expectMonotone(districtKey, tally);
        // The proof is applied at every reading but one: the finals' Awards final with every division's Awards final
        // too, where every key's Awards are final and the proof stops.
        expect(tally.joint).toEqual({ applied: tally.readings - 1, stageNotEligible: 1 });
      },
      TEST_TIMEOUT_MS
    );
  }

  it(
    "the whole lattice, rules on: nothing lost and nothing dropped, counts pinned as the run shows",
    () => {
      const { stops, tally } = latticeTotals("on");
      console.log(
        `[261010-d7r group A, rules on] championships ${String(DIVISIONED.length)} | stops ${String(stops)} | readings ${String(tally.readings)} (${JSON.stringify(tally.joint)}) | flag edges ${String(tally.edges.flag)} | stop edges ${String(tally.edges.stop)} | Locked lost ${String(tally.lost.flag + tally.lost.stop)} | margin drops ${String(tally.marginDrops)} | applied then refused ${String(tally.appliedThenRefused)}`
      );
      expectMonotone("every divisioned championship", tally);
      // `stops` counts the reading added after the sweep's last stop. The proof goes from applied to refused only
      // over the edges into the one reading where every key's Awards are final: one flag edge per division and one
      // stop edge, per championship.
      expect({ championships: DIVISIONED.length, stops, readings: tally.readings, joint: tally.joint, flagEdges: tally.edges.flag, stopEdges: tally.edges.stop, appliedThenRefused: tally.appliedThenRefused }).toEqual({
        championships: 16,
        stops: 156,
        readings: 1200,
        joint: { applied: 1184, stageNotEligible: 16 },
        flagEdges: 1968,
        stopEdges: 1088,
        appliedThenRefused: 56,
      });
    },
    TEST_TIMEOUT_MS
  );

  for (const districtKey of DIVISIONED) {
    it(`${districtKey} with the awarded rule switched OFF: the lattice is read (its findings are pinned in the next test)`, () => void awardsOrderLattice(districtKey, "awardedRuleOff"), TEST_TIMEOUT_MS);
  }

  it(
    "THE TEST BITES: with the awarded rule switched off (a rival that holds a posted award may take a second judged award) Locked teams are lost over flag edges, pinned as the run shows",
    () => {
      const { tally, lostByDistrict } = latticeTotals("awardedRuleOff");
      console.log(
        `[261010-d7r group A, awarded rule OFF] readings ${String(tally.readings)} | Locked lost over flag edges ${String(tally.lost.flag)}, over stop edges ${String(tally.lost.stop)} | distinct district and team pairs lost ${String(tally.lostTeams.size)} | flag edges with a margin drop ${String(tally.edgesWithADrop.flag)}, stop edges ${String(tally.edgesWithADrop.stop)} | team margins dropped ${String(tally.marginDrops)}, the largest by ${String(tally.largestDrop)} | by district ${JSON.stringify(lostByDistrict)}\n${tally.lostLines.slice(0, 12).map((line) => `  ${line}`).join("\n")}`
      );
      // THE REQUIREMENT: the mutation is caught, through the status code's own verdicts.
      expect(tally.lost.flag).toBeGreaterThan(0);
      expect(tally.edgesWithADrop.flag).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r. Pinned as the run shows; not a requirement.
      // Quick task 261010-l0s (every rival counted once) moved it: the proof holds a little more at some readings
      // and a little less is lost at others. Until then: 957 lost, 163 pairs, 1776 flag edges with a drop, 33,355
      // team margins, and by district 118 at 2023fim, 4 at 2023fit and 239 at 2024fim. The paid pick rule of the
      // same task then moved the team margins once more, 33,385 to 33,388, and nothing else here: from the stop a
      // division's Playoffs are final, a backup TBA has paid is its alliance's confirmed pick.
      expect({
        readings: tally.readings,
        lostOverFlagEdges: tally.lost.flag,
        lostOverStopEdges: tally.lost.stop,
        distinctPairsLost: tally.lostTeams.size,
        flagEdgesWithADrop: tally.edgesWithADrop.flag,
        stopEdgesWithADrop: tally.edgesWithADrop.stop,
        teamMarginsDropped: tally.marginDrops,
        largestDrop: tally.largestDrop,
      }).toEqual({
        readings: 1200,
        lostOverFlagEdges: 952,
        lostOverStopEdges: 0,
        distinctPairsLost: 161,
        flagEdgesWithADrop: 1786,
        stopEdgesWithADrop: 0,
        teamMarginsDropped: 33_388,
        largestDrop: 4,
      });
      expect(lostByDistrict).toEqual({
        "2023fim": 116,
        "2023fit": 3,
        "2023ne": 6,
        "2023ont": 10,
        "2024fim": 237,
        "2024fit": 7,
        "2024ne": 9,
        "2024ont": 10,
        "2025fim": 215,
        "2025fit": 9,
        "2025ne": 0,
        "2025ont": 15,
        "2026fim": 287,
        "2026fit": 13,
        "2026ne": 10,
        "2026ont": 5,
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "THE TEST BITES: with the stop rule switched off (the proof stops at the finals' Awards whatever the divisions read) Locked teams are lost, every one over the stop edge into the finals' Awards final, pinned as the run shows",
    () => {
      // The stop rule changes a reading only where the finals' Awards are final, so the sweep's last stop and the
      // one reading after it are all that is read here. Every other reading is the rules on reading above.
      const on = latticeTotals("on", "intoTheFinalsAwards");
      const { tally, lostByDistrict } = latticeTotals("stopRuleOff", "intoTheFinalsAwards");
      console.log(
        `[261010-d7r group A, stop rule OFF] readings ${String(tally.readings)} (${JSON.stringify(tally.joint)}) | Locked lost over flag edges ${String(tally.lost.flag)}, over stop edges ${String(tally.lost.stop)} | distinct district and team pairs lost ${String(tally.lostTeams.size)} | by district ${JSON.stringify(lostByDistrict)}\n${tally.lostLines.slice(0, 8).map((line) => `  ${line}`).join("\n")}`
      );
      // With the rules on these two stops lose nothing.
      expectMonotone("every divisioned championship, into the finals' Awards final", on.tally);
      // THE REQUIREMENT: the mutation is caught, through the status code's own verdicts.
      expect(tally.lost.stop).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r (finding F-B). Pinned as the run shows.
      expect({ readings: tally.readings, joint: tally.joint, lostOverFlagEdges: tally.lost.flag, lostOverStopEdges: tally.lost.stop, distinctPairsLost: tally.lostTeams.size }).toEqual({
        readings: 224,
        joint: { applied: 112, stageNotEligible: 112 },
        lostOverFlagEdges: 0,
        lostOverStopEdges: 306,
        distinctPairsLost: 129,
      });
      // 63 over the 12 two division championships; the four FIM seasons 24, 80, 49 and 90.
      expect(lostByDistrict).toEqual({
        "2023fim": 24,
        "2023fit": 8,
        "2023ne": 4,
        "2023ont": 6,
        "2024fim": 80,
        "2024fit": 2,
        "2024ne": 8,
        "2024ont": 4,
        "2025fim": 49,
        "2025fit": 7,
        "2025ne": 4,
        "2025ont": 1,
        "2026fim": 90,
        "2026fit": 1,
        "2026ne": 16,
        "2026ont": 2,
      });
    },
    TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP B. Divisions out of step
// ---------------------------------------------------------------------------

const DIVISION_PLAYOFFS_FINAL_AWARDS_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };
const DIVISION_ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const DIVISIONS_FINAL_STOP = "Divisions final, finals not started";
/** The sweep's stops before "Divisions final": the others stand at one of these while the ahead divisions have finished. */
const beforeDivisionsFinal = (label: string): boolean => label === "Alliances final" || label.startsWith("Round ");

interface OutOfStepResult {
  readonly districtKey: string;
  readonly aheadSets: number;
  readonly tally: EdgeTally;
}

const outOfStepCache = new Map<string, OutOfStepResult>();

/**
 * DIVISIONS OUT OF STEP at one championship. For each set of divisions AHEAD
 * (never none, never all), those divisions have finished their playoffs with
 * every one of their rows played, while the others stand at each of the
 * sweep's stops before "Divisions final" in turn. Every subset of the ahead
 * divisions is read with its Awards final. A flag edge is one more ahead
 * division's flag at the same stop of the others; a stop edge is the others
 * one stop on at the same flags.
 *
 * `everyAheadSet` false reads one division ahead at a time, each in turn.
 */
function outOfStep(districtKey: string, everyAheadSet: boolean, mode: RuleMode): OutOfStepResult {
  const cacheKey = `${districtKey}|${String(everyAheadSet)}|${mode}`;
  const cached = outOfStepCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = underRules(mode, (): OutOfStepResult => {
    const { artifact, divisionKeys, brackets } = divisionedChampionship(districtKey);
    const divisionCount = divisionKeys.length;
    const sweepStops = championshipStops(artifact, brackets);
    const early = sweepStops.filter((stop) => beforeDivisionsFinal(stop.label));
    const divisionsFinal = sweepStops.find((stop) => stop.label === DIVISIONS_FINAL_STOP);
    if (divisionsFinal === undefined) throw new Error(`${districtKey} has no "${DIVISIONS_FINAL_STOP}" stop`);
    const tally = newTally();
    const read = (ahead: number, flags: number, stop: ChampionshipStop): Reading => {
      const stageByKey = new Map(stop.stageByKey);
      const playedKeysByKey = new Map(stop.playedKeysByKey);
      divisionKeys.forEach((key, index) => {
        if ((ahead & (1 << index)) === 0) return;
        stageByKey.set(key, (flags & (1 << index)) !== 0 ? DIVISION_ALL_FINAL : DIVISION_PLAYOFFS_FINAL_AWARDS_OPEN);
        const played = divisionsFinal.playedKeysByKey.get(key);
        if (played === undefined) throw new Error(`${districtKey} "${DIVISIONS_FINAL_STOP}" carries no played rows for ${key}`);
        playedKeysByKey.set(key, played);
      });
      return countReading(tally, readingOf(statusesAtChampionshipStop(artifact, { ...stop, stageByKey, playedKeysByKey }, brackets, true)));
    };
    const aheadSets: number[] = [];
    for (let ahead = 1; ahead < (1 << divisionCount) - 1; ahead++) {
      const size = divisionKeys.filter((_, index) => (ahead & (1 << index)) !== 0).length;
      if (everyAheadSet || size === 1) aheadSets.push(ahead);
    }
    for (const ahead of aheadSets) {
      const aheadKeys = divisionKeys.filter((_, index) => (ahead & (1 << index)) !== 0);
      const subsets: number[] = [];
      for (let flags = 0; flags < 1 << divisionCount; flags++) if ((flags & ~ahead) === 0) subsets.push(flags);
      let previous: Map<number, Reading> | undefined;
      for (const stop of early) {
        const byFlags = new Map(subsets.map((flags) => [flags, read(ahead, flags, stop)] as const));
        const where = `${districtKey} ahead {${aheadKeys.map(shortKey).join(",")}}, the others at "${stop.label}"`;
        for (const flags of subsets) {
          for (let division = 0; division < divisionCount; division++) {
            if ((ahead & (1 << division)) === 0 || (flags & (1 << division)) !== 0) continue;
            checkEdge(tally, "flag", `${where}, flags ${String(flags)} then ${shortKey(divisionKeys[division]!)}`, byFlags.get(flags)!, byFlags.get(flags | (1 << division))!);
          }
          if (previous !== undefined) checkEdge(tally, "stop", `${where}, flags ${String(flags)}`, previous.get(flags)!, byFlags.get(flags)!);
        }
        previous = byFlags;
      }
    }
    return { districtKey, aheadSets: aheadSets.length, tally };
  });
  outOfStepCache.set(cacheKey, result);
  return result;
}

function outOfStepTotals(districtKeys: readonly string[], everyAheadSet: boolean, mode: RuleMode): { aheadSets: number; tally: EdgeTally } {
  const tally = newTally();
  let aheadSets = 0;
  for (const districtKey of districtKeys) {
    const result = outOfStep(districtKey, everyAheadSet, mode);
    aheadSets += result.aheadSets;
    addTally(tally, result.tally);
    for (const teamKey of result.tally.lostTeams) tally.lostTeams.add(`${districtKey} ${teamKey}`);
  }
  return { aheadSets, tally };
}

describe("GROUP B, divisions out of step: some divisions finished, their awards flags turning true in every order, while the others are still in their playoffs (quick task 261010-d7r, D3)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (MISSING_DIVISIONED.length > 0) {
    localDataAbsent(`${MISSING_DIVISIONED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  for (const districtKey of TWO_DIVISION) {
    it(
      `${districtKey}, every ahead set: no held team is lost and no margin drops`,
      () => {
        const { tally } = outOfStep(districtKey, true, "on");
        expectMonotone(districtKey, tally);
        expect(tally.joint).toEqual({ applied: tally.readings });
      },
      TEST_TIMEOUT_MS
    );
  }

  for (const districtKey of FOUR_DIVISION) {
    it(
      `${districtKey}, one division ahead at a time, each of the four in turn: no held team is lost and no margin drops`,
      () => {
        const { tally } = outOfStep(districtKey, false, "on");
        expectMonotone(districtKey, tally);
        expect(tally.joint).toEqual({ applied: tally.readings });
      },
      TEST_TIMEOUT_MS
    );
  }

  it(
    "the whole of group B, rules on: nothing lost and nothing dropped, counts pinned as the run shows",
    () => {
      const two = outOfStepTotals(TWO_DIVISION, true, "on");
      const four = outOfStepTotals(FOUR_DIVISION, false, "on");
      console.log(
        `[261010-d7r group B, rules on] two division championships ${String(TWO_DIVISION.length)}: readings ${String(two.tally.readings)}, flag edges ${String(two.tally.edges.flag)}, stop edges ${String(two.tally.edges.stop)}, Locked lost ${String(two.tally.lost.flag + two.tally.lost.stop)}, margin drops ${String(two.tally.marginDrops)} | FIM seasons ${String(FOUR_DIVISION.length)}, one division ahead: readings ${String(four.tally.readings)}, flag edges ${String(four.tally.edges.flag)}, stop edges ${String(four.tally.edges.stop)}, Locked lost ${String(four.tally.lost.flag + four.tally.lost.stop)}, margin drops ${String(four.tally.marginDrops)}`
      );
      expectMonotone("the two division championships", two.tally);
      expectMonotone("the FIM seasons", four.tally);
      expect({
        two: { aheadSets: two.aheadSets, readings: two.tally.readings, flagEdges: two.tally.edges.flag, stopEdges: two.tally.edges.stop, appliedThenRefused: two.tally.appliedThenRefused },
        four: { aheadSets: four.aheadSets, readings: four.tally.readings, flagEdges: four.tally.edges.flag, stopEdges: four.tally.edges.stop, appliedThenRefused: four.tally.appliedThenRefused },
      }).toEqual({
        two: { aheadSets: 24, readings: 288, flagEdges: 144, stopEdges: 240, appliedThenRefused: 0 },
        four: { aheadSets: 16, readings: 192, flagEdges: 96, stopEdges: 160, appliedThenRefused: 0 },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "THE TEST BITES: with the awarded rule switched off, the two division championships lose Locked teams and drop margins, pinned as the run shows",
    () => {
      const { tally } = outOfStepTotals(TWO_DIVISION, true, "awardedRuleOff");
      console.log(
        `[261010-d7r group B, awarded rule OFF] two division championships: readings ${String(tally.readings)} | Locked lost over flag edges ${String(tally.lost.flag)}, over stop edges ${String(tally.lost.stop)} | team margins dropped ${String(tally.marginDrops)}, the largest by ${String(tally.largestDrop)}\n${tally.lostLines.slice(0, 8).map((line) => `  ${line}`).join("\n")}`
      );
      // THE REQUIREMENT: the mutation is caught.
      expect(tally.lost.flag + tally.lost.stop).toBeGreaterThan(0);
      expect(tally.marginDrops).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r. Pinned as the run shows; not a requirement.
      // Quick task 261010-l0s (every rival counted once) moved it from 49 lost and 772 margins: with the rule off
      // the proof holds more before a flag turns true, so more is lost when it does.
      expect({ readings: tally.readings, lostOverFlagEdges: tally.lost.flag, lostOverStopEdges: tally.lost.stop, marginDrops: tally.marginDrops, largestDrop: tally.largestDrop }).toEqual({
        readings: 288,
        lostOverFlagEdges: 54,
        lostOverStopEdges: 0,
        marginDrops: 777,
        largestDrop: 3,
      });
    },
    TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP C. Two championships, one finishing first (2026 California)
// ---------------------------------------------------------------------------

const TWO_CHAMPIONSHIP_DISTRICT = "2026ca";
const TWO_CHAMPIONSHIP_FILE = `v1__district__${TWO_CHAMPIONSHIP_DISTRICT}.json`;
const PLAYOFFS_FINAL_AWARDS_OPEN_STOP = "Playoffs final, awards open";
/** A championship whose playoffs are done and whose Awards are open. */
const PLAYOFFS_FINAL_AWARDS_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };

interface TwoChampionships {
  readonly artifact: DistrictArtifact;
  readonly keys: readonly string[];
  readonly brackets: Map<string, BracketSourceEvent>;
}

let twoChampionshipsCache: TwoChampionships | undefined;
/** The one district with two championships, with its corpus bracket at each key. */
function twoChampionships(): TwoChampionships {
  if (twoChampionshipsCache !== undefined) return twoChampionshipsCache;
  const artifact = localArtifact(TWO_CHAMPIONSHIP_FILE);
  const shape = championshipShape(dcmpEventKeysFor(artifact));
  if (shape.kind !== "multiple") throw new Error(`${TWO_CHAMPIONSHIP_DISTRICT} is not a two championship district (${shape.kind})`);
  const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
  try {
    const found = bracketsFromCorpus(db, new Map(), artifact);
    if ("missing" in found) throw new Error(`the corpus carries no bracket for ${found.missing}`);
    twoChampionshipsCache = { artifact, keys: [...shape.keys], brackets: found.brackets };
  } finally {
    db.close();
  }
  return twoChampionshipsCache;
}

interface TwoChampionshipResult {
  readonly stops: number;
  readonly tally: EdgeTally;
  /** One line per flag edge: what the proof said on each side and what was held. */
  readonly lines: string[];
}

const twoChampionshipCache = new Map<string, TwoChampionshipResult>();

/**
 * ONE CHAMPIONSHIP FINISHING FIRST. For each championship A in turn, A has
 * finished its playoffs with every one of its rows played, while the other, B,
 * stands at each stop of the sweep but Now. A is read with its Awards OPEN
 * and then FINAL (its real posted award points then sit in the floors). A flag
 * edge is A's awards flag at the same stop of B; a stop edge is B one stop on
 * with A's flag unchanged.
 */
function oneFinishingFirst(mode: RuleMode): TwoChampionshipResult {
  const cacheKey = `finishing|${mode}`;
  const cached = twoChampionshipCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = underRules(mode, (): TwoChampionshipResult => {
    const { artifact, keys, brackets } = twoChampionships();
    const stops = championshipStops(artifact, brackets).filter((stop) => !stop.atNow);
    const lastStop = stops.at(-1);
    if (lastStop === undefined || lastStop.label !== PLAYOFFS_FINAL_AWARDS_OPEN_STOP) throw new Error(`the sweep's last stop is not "${PLAYOFFS_FINAL_AWARDS_OPEN_STOP}"`);
    const tally = newTally();
    const lines: string[] = [];
    for (const finished of keys) {
      const other = keys.find((key) => key !== finished);
      if (other === undefined) throw new Error("a two championship district with one key");
      const everyRow = lastStop.playedKeysByKey.get(finished);
      if (everyRow === undefined) throw new Error(`no played rows for ${finished}`);
      let previous: { open: Reading; final: Reading } | undefined;
      for (const stop of stops) {
        const stageOfOther = stop.stageByKey.get(other);
        const rowsOfOther = stop.playedKeysByKey.get(other);
        if (stageOfOther === undefined || rowsOfOther === undefined) throw new Error(`"${stop.label}" carries nothing for ${other}`);
        const read = (stageOfFinished: DistrictStageFinality): Reading =>
          countReading(
            tally,
            readingOf(
              statusesAtChampionshipStop(
                artifact,
                {
                  ...stop,
                  stageByKey: new Map([
                    [finished, stageOfFinished],
                    [other, stageOfOther],
                  ]),
                  playedKeysByKey: new Map([
                    [finished, everyRow],
                    [other, rowsOfOther],
                  ]),
                },
                brackets,
                true
              )
            )
          );
        const open = read(PLAYOFFS_FINAL_AWARDS_OPEN);
        const final = read(ALL_FINAL_STAGE);
        const where = `${shortKey(finished)} finished while ${shortKey(other)} is at "${stop.label}"`;
        checkEdge(tally, "flag", `${where}, its Awards open then final`, open, final);
        lines.push(`${where}: joint ${open.joint} then ${final.joint} | held ${String(open.held.size)} then ${String(final.held.size)}`);
        if (previous !== undefined) {
          checkEdge(tally, "stop", `${where}, its Awards open`, previous.open, open);
          checkEdge(tally, "stop", `${where}, its Awards final`, previous.final, final);
        }
        previous = { open, final };
      }
    }
    return { stops: stops.length, tally, lines };
  });
  twoChampionshipCache.set(cacheKey, result);
  return result;
}

/**
 * THE AWARDS LATTICE OF THE TWO CHAMPIONSHIPS at the sweep's "Playoffs final,
 * awards open" stop: every subset of the two read with Awards final. A flag
 * edge is one more championship's flag. With both final every key's Awards
 * are final and the proof stops, which is the artifact's own finished state.
 */
function twoChampionshipLattice(mode: RuleMode): TwoChampionshipResult {
  const cacheKey = `lattice|${mode}`;
  const cached = twoChampionshipCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = underRules(mode, (): TwoChampionshipResult => {
    const { artifact, keys, brackets } = twoChampionships();
    const stop = championshipStops(artifact, brackets).find((entry) => entry.label === PLAYOFFS_FINAL_AWARDS_OPEN_STOP);
    if (stop === undefined) throw new Error(`no "${PLAYOFFS_FINAL_AWARDS_OPEN_STOP}" stop`);
    const tally = newTally();
    const lines: string[] = [];
    const masks = Array.from({ length: 1 << keys.length }, (_, mask) => mask);
    const flagsOf = (mask: number): string => `{${keys.filter((_, index) => (mask & (1 << index)) !== 0).map(shortKey).join(",")}}`;
    const byMask = new Map(
      masks.map((mask) => {
        const stageByKey = new Map(stop.stageByKey);
        keys.forEach((key, index) => {
          const base = stop.stageByKey.get(key);
          if (base === undefined) throw new Error(`"${stop.label}" carries no stage for ${key}`);
          stageByKey.set(key, { ...base, award: (mask & (1 << index)) !== 0 });
        });
        return [mask, countReading(tally, readingOf(statusesAtChampionshipStop(artifact, { ...stop, stageByKey }, brackets, true)))] as const;
      })
    );
    for (const mask of masks) {
      for (let index = 0; index < keys.length; index++) {
        if ((mask & (1 << index)) !== 0) continue;
        const before = byMask.get(mask)!;
        const after = byMask.get(mask | (1 << index))!;
        checkEdge(tally, "flag", `"${stop.label}" awards final at ${flagsOf(mask)} then ${shortKey(keys[index]!)}`, before, after);
        lines.push(`awards final at ${flagsOf(mask)} then ${shortKey(keys[index]!)}: joint ${before.joint} then ${after.joint} | held ${String(before.held.size)} then ${String(after.held.size)}`);
      }
    }
    return { stops: 1, tally, lines };
  });
  twoChampionshipCache.set(cacheKey, result);
  return result;
}

describe("GROUP C, two championships with one finishing first: 2026 California, one championship's Awards final while the other is still playing (quick task 261010-d7r, finding F-C)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (!LOCAL_DISTRICT_FILES.includes(TWO_CHAMPIONSHIP_FILE)) {
    localDataAbsent(`${TWO_CHAMPIONSHIP_FILE} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it("2026 California is the one two championship district of 2023 on that the local artifacts carry", () => {
    const multiple: string[] = [];
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const year = Number(DISTRICT_DETAIL_FILE.exec(fileName)?.[1]);
      if (!(year >= 2023)) continue;
      const artifact = localArtifact(fileName);
      if (artifact.cmpSlots !== null && championshipShape(dcmpEventKeysFor(artifact)).kind === "multiple") multiple.push(artifact.districtKey);
    }
    expect(multiple).toEqual([TWO_CHAMPIONSHIP_DISTRICT]);
    expect(twoChampionships().keys).toHaveLength(2);
  });

  it(
    "one championship finished while the other stands at each sweep stop: the proof is applied on both sides of every edge, no held team is lost and no margin drops",
    () => {
      const { stops, tally, lines } = oneFinishingFirst("on");
      console.log(`[261010-d7r group C, rules on] one championship finishing first\n${lines.map((line) => `  ${line}`).join("\n")}\n  flag edges ${String(tally.edges.flag)} | stop edges ${String(tally.edges.stop)} | Locked lost ${String(tally.lost.flag + tally.lost.stop)} | margin drops ${String(tally.marginDrops)}`);
      expectMonotone("2026 California, one championship finishing first", tally);
      // Applied at every reading: the finished championship needs no bracket facts once its Awards are final.
      expect(tally.joint).toEqual({ applied: tally.readings });
      // Pinned as the run shows: seven stops, each championship finished in turn.
      expect({ stops, readings: tally.readings, flagEdges: tally.edges.flag, stopEdges: tally.edges.stop, appliedThenRefused: tally.appliedThenRefused }).toEqual({
        stops: 7,
        readings: 28,
        flagEdges: 14,
        stopEdges: 24,
        appliedThenRefused: 0,
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "the awards lattice at \"Playoffs final, awards open\": every subset of the two championships read with Awards final, no held team is lost and no margin drops",
    () => {
      const { tally, lines } = twoChampionshipLattice("on");
      console.log(`[261010-d7r group C, rules on] the awards lattice of the two championships\n${lines.map((line) => `  ${line}`).join("\n")}`);
      expectMonotone("2026 California, the awards lattice", tally);
      // Applied with neither or one championship's Awards final; with both final the proof stops, and it refuses as
      // it always has there (no facts are built for a championship whose Awards are final).
      expect(tally.joint).toEqual({ applied: 3, noBracketFacts: 1 });
      expect({ readings: tally.readings, flagEdges: tally.edges.flag, appliedThenRefused: tally.appliedThenRefused }).toEqual({ readings: 4, flagEdges: 4, appliedThenRefused: 2 });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "THE TEST BITES: with the stop rule switched off the proof refuses the moment one championship's Awards read final, and Locked teams are lost, pinned as the run shows",
    () => {
      const finishing = oneFinishingFirst("stopRuleOff");
      const lattice = twoChampionshipLattice("stopRuleOff");
      console.log(
        `[261010-d7r group C, stop rule OFF] one finishing first: readings ${String(finishing.tally.readings)} (${JSON.stringify(finishing.tally.joint)}) | Locked lost over flag edges ${String(finishing.tally.lost.flag)}, over stop edges ${String(finishing.tally.lost.stop)} | applied then refused ${String(finishing.tally.appliedThenRefused)}\n${finishing.lines.map((line) => `  ${line}`).join("\n")}\n  the lattice: ${JSON.stringify(lattice.tally.joint)} | Locked lost ${String(lattice.tally.lost.flag)}\n${finishing.tally.lostLines.slice(0, 8).map((line) => `  ${line}`).join("\n")}`
      );
      // THE REQUIREMENT: the mutation is caught, through the status code's own verdicts.
      expect(finishing.tally.lost.flag).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r (finding F-C). Pinned as the run shows.
      expect({
        joint: finishing.tally.joint,
        lostOverFlagEdges: finishing.tally.lost.flag,
        lostOverStopEdges: finishing.tally.lost.stop,
        appliedThenRefused: finishing.tally.appliedThenRefused,
        latticeJoint: lattice.tally.joint,
        latticeLost: lattice.tally.lost.flag,
      }).toEqual({ joint: { applied: 14, noBracketFacts: 14 }, lostOverFlagEdges: 91, lostOverStopEdges: 0, appliedThenRefused: 14, latticeJoint: { applied: 1, noBracketFacts: 3 }, latticeLost: 1 });
    },
    TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP D. The micro step live walks
// ---------------------------------------------------------------------------

/**
 * THE MICRO STEP LIVE WALK of one championship (quick task 261010-d7r, D3
 * second half, and the further edges of CONTEXT D7).
 *
 * THE WORLD. The season's own artifact (`source`) is rewound to before its
 * championship: every dcmp row, its points and the awards given there leave
 * it. What TBA has posted so far is then walked forward one fact at a time:
 * per key how much of its points the district rankings carry (`posted`), the
 * state the match feed shows (`states`), how many played playoff rows the tab
 * holds per key (`rows`, `finalsRows`, from the corpus bracket), and the
 * awards lists handed so far (`awards`, `settled`). A tick is one call of a
 * merge entry point, exactly as the Worker makes it: `applyDistrictRankings`
 * with the rankings payload, or `applyDistrictEventState` with the states of
 * the events the artifact already carries a row for. A played playoff row is
 * a fact of the field alone and moves no artifact.
 *
 * THE READING after every tick is the tab's own: `buildChampLedgerRows` at
 * the live position and `computeChampLedgerStatuses` with the rows' own
 * `fieldProven`, the calendar year set to the artifact's year, and
 * `finalsMayBeAbsent` handed exactly as the tab hands it: at every tick where
 * the field proof is complete BY CAPACITY (`champFieldProofAtNow`,
 * `completeBy === "capacity"`), in every variant. (The merges' published
 * verdict pass reads the real clock; the tab reads none of what it writes
 * but `prequalified`, which no tick changes.)
 *
 * THE MAIN LINE: per key its rows posted and its state written, qualification
 * done, alliances picked, alliance points per key, every played playoff row
 * one at a time with the keys interleaved, then per key its playoffs done and
 * its playoff points.
 *
 * THE LATTICE from there. Each key rises through its awards LEVELS: a
 * division has one (its award points landed and its flag true); a single
 * championship, and each championship of two, has three (its Winner listed,
 * its award points landed with every award listed, its flag true). A
 * divisioned championship also walks the FINALS CHAIN, and every tuple of
 * key levels is read at every position of the chain. A flag edge is one more
 * level of one key; a step edge is one more fact of the chain. That covers
 * every order of the flags and the finals facts before, between and after
 * them. Two finals variants:
 *
 *   - `finalsOnNoRow`: the finals key is on no row until the finals pay. Its
 *     chain: the finals rows post with their playoff points and NO STATE
 *     BLOCK, the state is written with the finals facts in hand, the Winner
 *     is listed, the finals' award points land, the finals' flag turns true.
 *     Since Task 4 of the quick task (its D2) this variant's proof runs from
 *     the tick the last division's alliance points land: the tab reads the
 *     division keys alone as a divisioned championship whose finals have not
 *     started, while the field is proven by capacity. Before it the proof
 *     read `unsupportedShape` up to the finals rows.
 *   - `finalsRegistered`: every team of the field holds a registration at
 *     the finals key from the start. Its chain: the finals start on the
 *     field, every finals row is played one at a time, the finals' playoffs
 *     are done, their points land, the Winner, the award points, the flag.
 *
 * THE CORNER (everything in) is read by the other order of ticks as well and
 * must read the same, and the last edge is into the source artifact itself.
 *
 * THE FURTHER EDGES (CONTEXT D7), each with the rules on and asserted to lose
 * no Locked team and drop no margin:
 *
 *   1. A FINALS ROW POSTING WITH NO STATE BLOCK: the first fact of the
 *      `finalsOnNoRow` chain, at every tuple of division flags.
 *   2. A WINNER LISTED BEFORE THE PLAYOFF POINTS: at a single championship
 *      and at each of two, the Winner is listed between "playoffs done" and
 *      "playoff points land"; at a divisioned one, at every tuple of
 *      division flags, between the finals' "playoffs done" and their points
 *      (`finalsRegistered`), and before the finals rows post at all
 *      (`finalsOnNoRow`).
 *   3. A DIVISION'S AWARDS BEFORE ITS PLAYOFF POINTS, through the merge's own
 *      flag rule: the division's award points are on the rows and its awards
 *      list has stood unchanged for an hour, and no playoff point is on any
 *      row there yet. The rule (`packages/core/districts/eventAwards.ts`)
 *      keeps the flag FALSE until a playoff point lands, and the test holds
 *      it to that. See "what is forced" below for the flag itself.
 *   4. THE FIELD PROOF TURNING TRUE MID PLAYOFFS: the last field fixing key's
 *      rows arrive only once the other keys are half way through their
 *      playoffs (a second walk from the start, read against the main line's
 *      end, which must read the same). Asserted to turn the field proof from
 *      not proven to proven on the tick that key's state is written. For a
 *      `finalsOnNoRow` championship this is THE TICK THAT SWITCHES THE ABSENT
 *      FINALS READING ON (D2 of the quick task): the proof refuses
 *      `fieldNotProven` before it and reads the division keys alone as a
 *      divisioned championship after it. Asserted per walk to switch on at
 *      exactly that tick, and over that edge a lock may only be added.
 *   Over every edge of the walk and of these, the field proof never goes
 *   from proven to not proven: asserted, on the core proof's own `proven`
 *   (`champFieldProofAtNow`). The row model's flag `fieldProven` is a
 *   different thing: it reads true before any field fixing key has started
 *   (nothing is unproven "after a start" yet) and false from the first key's
 *   state tick until the proof holds, by design.
 *
 * WHAT IS FORCED, MEASURED AND NOT REQUIRED (the product's own rules exclude
 * each; pinned as the run shows, under its own title):
 *
 *   - A DIVISION'S AWARDS FLAG TRUE BEFORE ITS PLAYOFF POINTS, by writing the
 *     flag by hand. A true flag closes every category of the event, so the
 *     playoff points landing after it are points no reading allowed for.
 *     `eventAwards.ts` states this limit and waits for a playoff point
 *     because of it (quick task 261009-vp9). Not a rule of this task. That
 *     wait is the LIVE vantage of the flag rule, the Worker's. The offline
 *     publisher reads the same rule at its hindsight vantage, which asks for
 *     a judged award listed or award points and reads no playoff point, so
 *     a district publish run from a corpus taken DURING a live championship
 *     could raise a division's flag this way. Since quick task 261010-jyn
 *     that publisher skips a district while one of its events is live (and
 *     for the rest of the Worker's watch when it would raise a flag the
 *     published file holds false); not walked here.
 *   - A PROVEN FIELD READING NOT PROVEN AGAIN, by doubling the artifact's
 *     published championship capacity under the same rows. The joint proof
 *     then refuses (`fieldNotProven`) and whatever it alone held is lost.
 *     What excludes it is the field proof's own design
 *     (`packages/core/districts/dcmpFieldProof.ts`: the count asked for never
 *     rises while rows are only added), and the assertion above that it
 *     never happens on a walked path. THIS IS ALSO THE ONE WAY D2's OPTION
 *     CAN SWITCH OFF while the finals key is on no row: the option is handed
 *     while the field is proven by capacity, and with no finals row nothing
 *     else proves a live field, so "capacity no longer proves it" and "the
 *     field is not proven" are the same reading there. D2 has no switch in
 *     this file's rule mock: it is an earliness rule, and what holds it is
 *     the equivalence gate (group 13 of
 *     `scripts/champFieldStagedWalk.test.ts`) and these walks, two separate
 *     proofs.
 *
 * NOT WALKED, stated rather than implied:
 *
 *   - the published capacities (`dcmpSlots`, `cmpSlots`) changing during a
 *     championship (the capacity is doubled above only as the lever that
 *     forces the field proof);
 *   - an alliance list changing after a pick is made;
 *   - a row or a point being withdrawn;
 *   - a key's playoff points landing IN PART beside its award points (some
 *     on the rows, the deciding match's not). Every tick here lands a key's
 *     playoff points whole. The merge's flag rule asks for ANY playoff point
 *     on a row, and `eventAwards.ts` states its remaining assumption, not
 *     verified against a live event: TBA computes an event's point
 *     categories together;
 *   - a further recipient of an award type already listed, added after the
 *     list has settled (the first of the flag rule's stated limits);
 *   - the FIM seasons of 2023 to 2025 (about 40 seconds each per variant;
 *     the planner of the quick task ran them once and read nothing lost).
 */
type MicroTeam = DistrictArtifact["teams"][number];
type MicroRow = MicroTeam["eventPoints"][number];
/**
 * How much of a championship key's points the district rankings carry so far.
 * `awardsBeforePlayoffs` is the order further edge 3 walks: qualification,
 * alliance selection and AWARD points on the rows, no playoff point yet.
 */
type PointsStage = "qual" | "alliance" | "elim" | "all" | "awardsBeforePlayoffs";
type StatePhase = "started" | "qualDone" | "picked" | "done";
type MicroVariant = "oneEvent" | "finalsOnNoRow" | "finalsRegistered";

interface World {
  readonly artifact: DistrictArtifact;
  readonly posted: ReadonlyMap<string, PointsStage>;
  readonly states: ReadonlyMap<string, DistrictEventState>;
  /** Played playoff rows the tab holds per field fixing key, in the order played. Absent: no bracket facts in hand at all. */
  readonly rows: ReadonlyMap<string, number> | undefined;
  /** Played finals rows the tab holds. Absent: no finals facts in hand. */
  readonly finalsRows: number | undefined;
  /** The awards lists handed so far, per event key. */
  readonly awards: ReadonlyMap<string, readonly DistrictEventAwardInput[]>;
  /** The keys whose awards list has stood unchanged for an hour, as the Worker would measure it. */
  readonly settled: ReadonlySet<string>;
}

const MICRO_STAMP = { generation: "champ-joint-monotone-micro", computedAt: "2026-04-18T00:00:00.000Z" } as const;
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();
/** TBA's award types: the Winner, and the three consuming judged awards of a championship (Impact, Engineering Inspiration, Rookie All Star). */
const WINNER_ONLY = [1] as const;
const EVERY_CHAMPIONSHIP_AWARD = [1, 0, 9, 10] as const;
/** Any judged award type will do for a division's list: the flag rule reads only that it is neither Winner nor Finalist. */
const A_JUDGED_AWARD_TYPE = 20;

interface MicroChampionship {
  /** The season's own artifact at the verdict pass's fixed point. */
  readonly source: DistrictArtifact;
  readonly keys: readonly string[];
  readonly fieldFixingKeys: readonly string[];
  /** The finals key of a divisioned championship. */
  readonly finalsKey: string | undefined;
  readonly brackets: ReadonlyMap<string, BracketSourceEvent | undefined>;
}

const microChampionshipCache = new Map<string, MicroChampionship>();
function microChampionship(districtKey: string): MicroChampionship {
  let championship = microChampionshipCache.get(districtKey);
  if (championship === undefined) {
    const file = localArtifact(`v1__district__${districtKey}.json`);
    const source = recomputeDistrictVerdicts(file, { nowYear: file.year });
    const keys = dcmpEventKeysFor(source);
    const fieldFixingKeys = fieldFixingDcmpKeys(keys);
    const finalsKeys = keys.filter((key) => !fieldFixingKeys.includes(key));
    if (finalsKeys.length > 1) throw new Error(`${districtKey}: more than one finals key`);
    const brackets = new Map<string, BracketSourceEvent | undefined>();
    const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
    try {
      const alliancesBySeason = new Map();
      for (const key of keys) brackets.set(key, bracketFromCorpus(db, alliancesBySeason, source.year, key));
    } finally {
      db.close();
    }
    for (const key of fieldFixingKeys) if (brackets.get(key)?.alliances === undefined) throw new Error(`${districtKey}: the corpus carries no bracket for ${key}`);
    championship = { source, keys, fieldFixingKeys, finalsKey: finalsKeys[0], brackets };
    microChampionshipCache.set(districtKey, championship);
  }
  return championship;
}

/** One reading of a tick: what an edge compares, and what the walk's own assertions read. */
interface MicroReading extends Reading {
  readonly label: string;
  /** The core field proof's own `proven` at Now (`champFieldProofAtNow`). */
  readonly proven: boolean;
  readonly shownLocked: number;
  readonly jointLocked: number;
  /** D2: the tab read the finals as not started with the finals key on no row (`finalsMayBeAbsent` handed, and the key on no row). */
  readonly finalsReadAbsent: boolean;
}

/** Further edge 4 at a `finalsOnNoRow` championship: what the late key's state tick did to the absent finals reading. */
interface AbsentFinalsSwitch {
  /** The absent finals reading was off before the tick and on after it. */
  readonly turnedOn: boolean;
  readonly jointBefore: string;
  readonly jointAfter: string;
  readonly shownLockedBefore: number;
  readonly shownLockedAfter: number;
  /** Held teams lost over that one edge. The requirement is 0: the switch may only add locks. */
  readonly lost: number;
}

interface MicroResult {
  readonly districtKey: string;
  readonly variant: MicroVariant;
  /** THE WALK: the main line, the lattice, the corner by the other order, and the end. */
  readonly walk: EdgeTally;
  /** The step edges of the main line alone. */
  readonly mainLineEdges: number;
  /** The corner read the same by both orders of ticks. */
  readonly cornerPathIndependent: boolean;
  /** THE FURTHER EDGES of CONTEXT D7 (2 to 4 above; 1 is part of the walk). Empty tallies when the walk ran with a rule off. */
  readonly winnerFirst: EdgeTally;
  readonly awardsFirst: EdgeTally;
  readonly lateRows: EdgeTally;
  /** A further edge's last reading that did not read the same as the walk's reading of the same facts. Empty is the requirement. */
  readonly cornerMismatches: string[];
  /** Edges of the walk and of the further edges over which the field proof went from proven to not proven. Empty is the requirement. */
  readonly fieldProofTakenBack: string[];
  /** Further edge 4: the field proof read not proven before the last key's state was written and proven after. `undefined` where there is one field fixing key. */
  readonly fieldProofTurnedTrueMidPlayoffs: boolean | undefined;
  /** Further edge 4, `finalsOnNoRow` only: D2's absent finals reading over the same tick. `undefined` in the other variants and in a rule off run. */
  readonly absentFinalsSwitch: AbsentFinalsSwitch | undefined;
  /** Readings of the walk (not of the further or forced edges) where the finals were read absent. */
  readonly walkReadingsWithFinalsReadAbsent: number;
  /** Further edge 3: the divisions whose flag the merge's rule kept false with no playoff point on a row, and raised on the tick the playoff points landed. */
  readonly flagHeldWithoutPlayoffPoints: number;
  readonly flagRaisedWithPlayoffPoints: number;
  readonly divisionsWalkedAwardsFirst: number;
  /** FORCED, measured and not required. */
  readonly forcedFlag: EdgeTally;
  /** FORCED: held teams lost over the edge that writes a division's flag by hand, as against the edge where the points land after it. */
  readonly forcedFlagLostWritingTheFlag: number;
  readonly unprovenAgain: EdgeTally;
  /** The main line's end: every key's playoff points landed, no award level up. */
  readonly atMainLineEnd: { readonly joint: string; readonly jointLocked: number; readonly shownLocked: number };
  readonly endShownLocked: number;
}

const microCache = new Map<string, MicroResult>();

function microWalk(districtKey: string, variant: MicroVariant, mode: RuleMode, slack = BOUND_SLACK): MicroResult {
  const cacheKey = `${districtKey}|${variant}|${mode}|${String(slack)}`;
  const cached = microCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = underRules(mode, (): MicroResult => {
    const { source, keys, fieldFixingKeys: ff, finalsKey, brackets } = microChampionship(districtKey);
    const divisioned = finalsKey !== undefined;
    if (divisioned === (variant === "oneEvent")) throw new Error(`${districtKey}: the variant ${variant} does not fit a ${divisioned ? "divisioned" : "single or two"} championship`);
    const registered = variant === "finalsRegistered";
    const nowYear = source.year;
    /**
     * The further edges and the forced edges are read with the rules on, and with the paid pick rule off (group E:
     * some of what that rule closes sits on a further edge). Every other rule off run is the ported walk alone.
     */
    const furtherEdges = mode === "on" || mode === "paidRuleOff";
    const where = `${districtKey} ${variant}`;

    const playedOf = (key: string): BracketSourceEvent["matches"] => (brackets.get(key)?.matches ?? []).filter((match) => match.actualWinner !== undefined);
    const finalRow = new Map<string, Map<string, MicroRow>>(keys.map((key) => [key, new Map<string, MicroRow>()] as const));
    for (const team of source.teams) for (const row of team.eventPoints) if (row.tier === "dcmp") finalRow.get(row.eventKey)?.set(team.teamKey, row);
    const fieldTeams = new Set<string>();
    for (const key of ff) for (const teamKey of finalRow.get(key)!.keys()) fieldTeams.add(teamKey);
    const dcmpMaxima = maxEventPoints(source.year, "dcmp");
    const dcmpEventMaxTotal = dcmpMaxima.qual + dcmpMaxima.alliance + dcmpMaxima.elim + dcmpMaxima.award;
    const dcmpTotal = (team: MicroTeam): number => team.eventPoints.filter((row) => row.tier === "dcmp").reduce((sum, row) => sum + row.total, 0);
    const finalsMeta = finalsKey === undefined ? undefined : source.teams.flatMap((team) => team.eventPoints).find((row) => row.eventKey === finalsKey);
    if (registered && finalsMeta === undefined) throw new Error(`${districtKey}: no row at the finals key to register the field at`);

    // Before the first tick: no dcmp row anywhere, and the verdict pass is told a championship is still ahead.
    const startArtifact: DistrictArtifact = recomputeDistrictVerdicts(
      DistrictArtifactSchema.parse({
        ...source,
        teams: source.teams.map((team) => ({
          ...team,
          pointTotal: team.pointTotal - dcmpTotal(team),
          eventPoints: team.eventPoints.filter((row) => row.tier !== "dcmp"),
          remainingEvents: [
            ...team.remainingEvents.filter((row) => row.tier !== "dcmp"),
            ...(registered && finalsKey !== undefined && finalsMeta !== undefined && fieldTeams.has(team.teamKey)
              ? [{ eventKey: finalsKey, eventName: finalsMeta.eventName, week: finalsMeta.week, tier: "dcmp" as const, maxPoints: dcmpEventMaxTotal }]
              : []),
          ],
          qualifyingAwards: team.qualifyingAwards.filter((award) => !keys.includes(award.eventKey)),
        })),
      }),
      { nowYear, dcmpStillAhead: true }
    );

    /** An awards list from the season's own records: each named type with the teams that hold it at the key. */
    const awardListAt = (eventKey: string, types: readonly number[]): DistrictEventAwardInput[] =>
      types
        .map((type) => ({
          award_type: type,
          recipient_list: source.teams.filter((team) => team.qualifyingAwards.some((award) => award.eventKey === eventKey && award.awardType === type)).map((team) => ({ team_key: team.teamKey })),
        }))
        .filter((entry) => entry.recipient_list.length > 0);
    /** A division's judged awards: the artifact records none by type, so one judged entry naming every team that carries award points there. */
    const judgedListAt = (eventKey: string): DistrictEventAwardInput[] => {
      const recipients = [...finalRow.get(eventKey)!.entries()].filter(([, row]) => row.award > 0).map(([teamKey]) => ({ team_key: teamKey }));
      return recipients.length === 0 ? [] : [{ award_type: A_JUDGED_AWARD_TYPE, recipient_list: recipients }];
    };

    const pointsAt = (row: MicroRow, stage: PointsStage) => ({
      qual: row.qual,
      alliance: stage === "qual" ? 0 : row.alliance,
      elim: stage === "elim" || stage === "all" ? row.elim : 0,
      award: stage === "all" || stage === "awardsBeforePlayoffs" ? row.award : 0,
    });
    /** A TBA shaped rankings payload: every district tier row as published, and the championship rows posted so far at the points they carry so far. */
    const payload = (world: World) =>
      source.teams.map((team) => {
        const others = team.eventPoints
          .filter((row) => row.tier !== "dcmp")
          .map((row) => ({ event_key: row.eventKey, district_cmp: false, qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: row.award, total: row.total }));
        let total = team.pointTotal - dcmpTotal(team);
        const championship: { event_key: string; district_cmp: boolean; qual_points: number; alliance_points: number; elim_points: number; award_points: number; total: number }[] = [];
        for (const [key, stage] of world.posted) {
          const row = finalRow.get(key)?.get(team.teamKey);
          if (row === undefined) continue;
          const points = pointsAt(row, stage);
          const sum = points.qual + points.alliance + points.elim + points.award;
          // TBA writes a finals row only for a team it pays there.
          if (sum === 0 && key === finalsKey) continue;
          total += sum;
          championship.push({ event_key: key, district_cmp: true, qual_points: points.qual, alliance_points: points.alliance, elim_points: points.elim, award_points: points.award, total: sum });
        }
        return { team_key: team.teamKey, rank: team.rank, point_total: total, rookie_bonus: team.rookieBonus, adjustments: team.adjustments, event_points: [...others, ...championship] };
      });
    const stateFor = (key: string, phase: StatePhase): DistrictEventState => {
      const total = [...finalRow.get(key)!.values()][0]?.state?.qualMatchesTotal ?? 60;
      return {
        qualMatchesPlayed: phase === "started" ? Math.max(1, total - 10) : total,
        qualMatchesTotal: total,
        alliancesPicked: phase === "picked" || phase === "done",
        playoffsDone: phase === "done",
        awardsPosted: false,
      };
    };
    const finalsState = (playoffsDone: boolean, awardsPosted = false): DistrictEventState => ({ qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: true, playoffsDone, awardsPosted });

    const withPosted = (world: World, key: string, stage: PointsStage): World => ({ ...world, posted: new Map(world.posted).set(key, stage) });
    const withState = (world: World, key: string, state: DistrictEventState): World => ({ ...world, states: new Map(world.states).set(key, state) });
    const withRows = (world: World, key: string, count: number): World => ({ ...world, rows: new Map(world.rows ?? []).set(key, count) });
    const withAwards = (world: World, key: string, list: readonly DistrictEventAwardInput[]): World => ({ ...world, awards: new Map(world.awards).set(key, list) });
    const withSettled = (world: World, key: string): World => ({ ...world, settled: new Set(world.settled).add(key) });

    const carries = (artifact: DistrictArtifact, key: string): boolean =>
      artifact.teams.some((team) => team.eventPoints.some((row) => row.eventKey === key) || team.remainingEvents.some((row) => row.eventKey === key));
    /** As the Worker does: the state of an event is handed only once the artifact already carries a row for it. */
    const statesInHand = (world: World): Map<string, DistrictEventState> => new Map([...world.states].filter(([key]) => carries(world.artifact, key)));
    const awardsInHand = (world: World) => ({
      ...(world.awards.size === 0 ? {} : { eventAwards: world.awards }),
      ...(world.settled.size === 0 ? {} : { settledAwardEvents: world.settled }),
    });
    /** A rankings tick: the payload merged, with the states in hand and the awards lists handed so far. */
    const rowsTick = (world: World): World => ({
      ...world,
      artifact: applyDistrictRankings({ artifact: world.artifact, rankings: payload(world), ...MICRO_STAMP, eventState: statesInHand(world), ...awardsInHand(world) }),
    });
    /** A state tick: the states in hand written, with the awards lists handed so far. Nothing happens while no state is in hand. */
    const stateTick = (world: World): World => {
      const inHand = statesInHand(world);
      if (inHand.size === 0) return world;
      return { ...world, artifact: applyDistrictEventState({ artifact: world.artifact, eventState: inHand, ...MICRO_STAMP, ...awardsInHand(world) }) };
    };

    /** THE WALK's own tally (the main line, the lattice, the corner by the other order, the end). */
    const walk = newTally();
    let walkReadingsWithFinalsReadAbsent = 0;
    /** The tab's own reading of a world at Now. */
    const read = (label: string, world: World, tally: EdgeTally): MicroReading => {
      const { artifact } = world;
      const districtRows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, tier: "district" });
      const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
      const districtLockedOut = new Set<string>();
      for (const [teamKey, status] of districtStatuses.byTeam) if (status.status === "lockedOut") districtLockedOut.add(teamKey);
      const started = new Set<string>();
      // The FIELD's reading of each key: the state alone. A key on no row has no stage at all.
      const fieldStage = new Map<string, DistrictStageFinality | undefined>();
      for (const team of artifact.teams) {
        for (const entry of tierEvents(team, "dcmp")) {
          const stage = deriveStageFromState(entry.state);
          if (stage.started) started.add(entry.eventKey);
          if (!fieldStage.has(entry.eventKey) || (fieldStage.get(entry.eventKey) === undefined && entry.state !== undefined)) fieldStage.set(entry.eventKey, entry.state === undefined ? undefined : stage.final);
        }
      }
      const startedKeys = new Set(dcmpEventKeysFor(artifact).filter((key) => started.has(key)));
      const distributions = new Map<string, DistrictEventDistributions>();
      if (world.rows !== undefined) {
        for (const [key, count] of world.rows) {
          const bracket = brackets.get(key);
          if (bracket === undefined) throw new Error(`${districtKey}: no bracket for ${key}`);
          const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
          const played = playedBracketMatchesFor(bracket, new Set(playedOf(key).slice(0, count).map((match) => match.matchKey)));
          const dcmpBracket = dcmpBracketFactsFor({
            eventKey: key,
            season: source.year,
            tier: "dcmp",
            stage: fieldStage.get(key),
            alliances,
            playedMatches: played.matches,
            unresolvedMatchCount: played.unresolvedMatchKeys.length,
            fieldBackups: played.fieldBackups,
            role: divisioned ? "division" : "championship",
          });
          distributions.set(key, { eventKey: key, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches), ...(dcmpBracket === undefined ? {} : { dcmpBracket }) });
        }
      }
      if (finalsKey !== undefined && world.finalsRows !== undefined) {
        const bracket = brackets.get(finalsKey);
        if (bracket !== undefined) {
          const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
          const played = playedBracketMatchesFor(bracket, new Set(playedOf(finalsKey).slice(0, world.finalsRows).map((match) => match.matchKey)));
          const dcmpBracket = dcmpBracketFactsFor({
            eventKey: finalsKey,
            season: source.year,
            tier: "dcmp",
            stage: fieldStage.get(finalsKey),
            alliances,
            playedMatches: played.matches,
            unresolvedMatchCount: played.unresolvedMatchKeys.length,
            fieldBackups: played.fieldBackups,
            role: "finals",
            expectedAllianceCount: ff.length,
          });
          distributions.set(finalsKey, { eventKey: finalsKey, byTeam: new Map(), ...(dcmpBracket === undefined ? {} : { dcmpBracket }) });
        }
      }
      const champRows = buildChampLedgerRows({ artifact, distributions, startedDcmpEventKeys: startedKeys, atLivePosition: true, nowYear });
      const fieldProof = champFieldProofAtNow(artifact, startedKeys, nowYear);
      // As the tab passes it (`ChampLocksLedger.tsx`, D2 of the quick task): at the live position, and only while
      // the field is proven by capacity. Handed in every variant; it changes a reading only where the finals key is
      // on no row.
      const finalsMayBeAbsent = fieldProof.completeBy === "capacity";
      const model = computeChampLedgerStatuses({
        artifact,
        teams: champRows.teams,
        districtLockedOut,
        nowYear,
        ...(distributions.size === 0 ? {} : { distributions }),
        fieldProven: champRows.fieldProven,
        ...(finalsMayBeAbsent ? { finalsMayBeAbsent } : {}),
      });
      let shownLocked = 0;
      for (const status of model.byTeam.values()) if (status.status === "locked") shownLocked += 1;
      const reading: MicroReading = {
        ...countReading(tally, readingOf(model, slack)),
        label,
        proven: fieldProof.proven,
        shownLocked,
        jointLocked: model.jointProof?.applied === true ? model.jointProof.locked.size : 0,
        finalsReadAbsent: finalsMayBeAbsent && finalsKey !== undefined && !dcmpEventKeysFor(artifact).includes(finalsKey),
      };
      if (tally === walk && reading.finalsReadAbsent) walkReadingsWithFinalsReadAbsent += 1;
      return reading;
    };

    const winnerFirst = newTally();
    const awardsFirst = newTally();
    const lateRows = newTally();
    const forcedFlag = newTally();
    const unprovenAgain = newTally();
    const fieldProofTakenBack: string[] = [];
    const cornerMismatches: string[] = [];
    let absentFinalsSwitch: AbsentFinalsSwitch | undefined;
    /** One edge. `required` edges also hold the field proof to never going from proven to not proven. */
    const edge = (tally: EdgeTally, kind: EdgeKind, before: MicroReading, after: MicroReading, required = true): void => {
      checkEdge(tally, kind, `${where}: "${before.label}" then "${after.label}"`, before, after);
      if (required && before.proven && !after.proven) fieldProofTakenBack.push(`${where}: "${before.label}" then "${after.label}"`);
    };
    /** Whether two readings of the same facts read the same: every team's status, what the proof said, the points slots. */
    const readsTheSame = (a: MicroReading, b: MicroReading): boolean => {
      if (a.joint !== b.joint || a.pointsSlots !== b.pointsSlots || a.model.byTeam.size !== b.model.byTeam.size) return false;
      for (const [teamKey, status] of a.model.byTeam) {
        const other = b.model.byTeam.get(teamKey);
        if (other === undefined || other.status !== status.status || other.byAward !== status.byAward) return false;
      }
      return true;
    };
    const expectSameCorner = (what: string, further: MicroReading, walked: MicroReading): void => {
      if (!readsTheSame(further, walked)) cornerMismatches.push(`${where}, ${what}: "${further.label}" does not read as "${walked.label}"`);
    };
    /** FORCED: the field read not proven again, by doubling the published championship capacity under the same rows. */
    const readUnprovenAgain = (from: World, proven: MicroReading): void => {
      if (!furtherEdges || from.artifact.dcmpSlots === null || !proven.proven) return;
      const doubled = read(`${proven.label}, the capacity doubled (FORCED)`, { ...from, artifact: { ...from.artifact, dcmpSlots: from.artifact.dcmpSlots * 2 } }, unprovenAgain);
      if (doubled.proven) throw new Error(`${where}: doubling the capacity left the field proven at "${proven.label}"`);
      edge(unprovenAgain, "step", proven, doubled, false);
    };

    const short = (key: string): string => shortKey(key);
    const playedLabel = (key: string, index: number): string => `${short(key)} played ${playedOf(key)[index]!.matchKey.split("_")[1] ?? ""}`;
    const emptyWorld: World = { artifact: startArtifact, posted: new Map(), states: new Map(), rows: undefined, finalsRows: undefined, awards: new Map(), settled: new Set() };

    // ---- THE MAIN LINE
    let world = emptyWorld;
    let previous = read(registered ? "every field team registered at the finals key" : "no dcmp row", world, walk);
    const step = (label: string, next: World): void => {
      const reading = read(label, next, walk);
      edge(walk, "step", previous, reading);
      previous = reading;
      world = next;
    };
    for (const key of ff) {
      step(`${short(key)} rows posted`, rowsTick(withPosted(withState(world, key, stateFor(key, "started")), key, "qual")));
      step(`${short(key)} state written`, stateTick(world));
    }
    step(
      "qualification done everywhere",
      stateTick(ff.reduce((next, key) => withState(next, key, stateFor(key, "qualDone")), world))
    );
    for (const key of ff) {
      step(`${short(key)} alliances picked, no alliance points`, stateTick({ ...withState(world, key, stateFor(key, "picked")), rows: new Map(ff.map((other) => [other, 0] as const)) }));
    }
    for (const key of ff) step(`${short(key)} alliance points land`, rowsTick(withPosted(world, key, "alliance")));
    const mostRows = Math.max(...ff.map((key) => playedOf(key).length));
    for (let index = 0; index < mostRows; index++) {
      for (const key of ff) {
        if (index >= playedOf(key).length) continue;
        step(playedLabel(key, index), withRows(world, key, index + 1));
      }
    }
    /** The readings further edges 2 and 3 end on, to be read against the lattice once it is built. */
    const againstTheLattice: { what: string; reading: MicroReading; key: string; level: number }[] = [];
    let flagHeldWithoutPlayoffPoints = 0;
    let flagRaisedWithPlayoffPoints = 0;
    let divisionsWalkedAwardsFirst = 0;
    let forcedFlagLostWritingTheFlag = 0;
    const flagTrueAt = (artifact: DistrictArtifact, key: string): boolean => artifact.teams.some((team) => team.eventPoints.some((row) => row.eventKey === key && row.state?.awardsPosted === true));
    for (const key of ff) {
      step(`${short(key)} playoffs done, no playoff points`, stateTick(withState(world, key, stateFor(key, "done"))));
      const playoffsDone = world;
      const playoffsDoneReading = previous;
      const lastKey = key === ff.at(-1);
      if (furtherEdges && !divisioned) {
        // FURTHER EDGE 2: the Winner is listed before the playoff points land.
        const listed = stateTick(withAwards(playoffsDone, key, awardListAt(key, WINNER_ONLY)));
        const listedReading = read(`${short(key)} playoffs done, the Winner listed, no playoff points`, listed, winnerFirst);
        edge(winnerFirst, "step", playoffsDoneReading, listedReading);
        const paid = read(`${short(key)} playoff points land after the Winner`, rowsTick(withPosted(listed, key, "elim")), winnerFirst);
        edge(winnerFirst, "step", listedReading, paid);
        if (lastKey) againstTheLattice.push({ what: "the Winner before the playoff points", reading: paid, key, level: 1 });
      }
      if (furtherEdges && divisioned) {
        const judged = judgedListAt(key);
        if (judged.length > 0) {
          divisionsWalkedAwardsFirst += 1;
          // FURTHER EDGE 3: the division's award points and its settled awards list arrive before its playoff points.
          const awardsIn = rowsTick(withSettled(withAwards(withPosted(playoffsDone, key, "awardsBeforePlayoffs"), key, judged), key));
          if (!flagTrueAt(awardsIn.artifact, key)) flagHeldWithoutPlayoffPoints += 1;
          const awardsInReading = read(`${short(key)} award points and a settled awards list, no playoff points`, awardsIn, awardsFirst);
          edge(awardsFirst, "step", playoffsDoneReading, awardsInReading);
          const playoffsIn = rowsTick(withPosted(awardsIn, key, "all"));
          if (flagTrueAt(playoffsIn.artifact, key)) flagRaisedWithPlayoffPoints += 1;
          const playoffsInReading = read(`${short(key)} playoff points land after the award points, the flag raised by the merge's rule`, playoffsIn, awardsFirst);
          edge(awardsFirst, "step", awardsInReading, playoffsInReading);
          if (lastKey) againstTheLattice.push({ what: "the award points before the playoff points", reading: playoffsInReading, key, level: 1 });
          // FORCED: the flag written true by hand with no playoff point on any row, then the points landing.
          const forced = stateTick(withState(playoffsDone, key, { ...stateFor(key, "done"), awardsPosted: true }));
          const forcedReading = read(`${short(key)} awards flag true, no playoff points (FORCED)`, forced, forcedFlag);
          edge(forcedFlag, "step", playoffsDoneReading, forcedReading, false);
          for (const teamKey of playoffsDoneReading.held) if (!forcedReading.held.has(teamKey)) forcedFlagLostWritingTheFlag += 1;
          const forcedPaid = read(`${short(key)} playoff and award points land after the flag (FORCED)`, rowsTick(withPosted(forced, key, "all")), forcedFlag);
          edge(forcedFlag, "step", forcedReading, forcedPaid, false);
        }
      }
      step(`${short(key)} playoff points land`, rowsTick(withPosted(world, key, "elim")));
    }
    const mainLineEnd = world;
    const mainLineEndReading = previous;
    const mainLineEdges = walk.edges.step;
    readUnprovenAgain(mainLineEnd, mainLineEndReading);

    // ---- THE LATTICE: every key's award levels times the finals' own chain
    interface ChainFact {
      readonly id: "started" | "played" | "done" | "points" | "rowsNoState" | "stateWritten" | "winner" | "awardPoints" | "flag";
      readonly label: string;
      readonly apply: (from: World) => World;
    }
    const chain: ChainFact[] = [];
    if (finalsKey !== undefined) {
      const finalsPlayed = playedOf(finalsKey).length;
      const finalsAwards = (types: readonly number[]): DistrictEventAwardInput[] => awardListAt(finalsKey, types);
      if (registered) {
        chain.push({ id: "started", label: "finals started on the field (state on the registrations), no finals row played", apply: (from) => stateTick({ ...withState(from, finalsKey, finalsState(false)), finalsRows: 0 }) });
        for (let index = 0; index < finalsPlayed; index++) {
          chain.push({ id: "played", label: `finals played ${playedOf(finalsKey)[index]!.matchKey.split("_")[1] ?? ""}`, apply: (from) => ({ ...from, finalsRows: index + 1 }) });
        }
        chain.push({ id: "done", label: "finals playoffs done, no finals points", apply: (from) => stateTick(withState(from, finalsKey, finalsState(true))) });
        chain.push({ id: "points", label: "finals playoff points land", apply: (from) => rowsTick(withPosted(from, finalsKey, "elim")) });
      } else {
        chain.push({ id: "rowsNoState", label: "finals rows posted with their playoff points, no state", apply: (from) => rowsTick(withPosted(from, finalsKey, "elim")) });
        chain.push({ id: "stateWritten", label: "finals state written, finals facts in hand", apply: (from) => stateTick({ ...withState(from, finalsKey, finalsState(true)), finalsRows: finalsPlayed }) });
      }
      chain.push({ id: "winner", label: "the Winner is listed", apply: (from) => stateTick(withAwards(from, finalsKey, finalsAwards(WINNER_ONLY))) });
      chain.push({ id: "awardPoints", label: "finals award points land, every finals award listed, flag not yet true", apply: (from) => rowsTick(withAwards(withPosted(from, finalsKey, "all"), finalsKey, finalsAwards(EVERY_CHAMPIONSHIP_AWARD))) });
      chain.push({ id: "flag", label: "finals awards flag true", apply: (from) => stateTick(withState(from, finalsKey, { ...(from.states.get(finalsKey) ?? finalsState(true)), awardsPosted: true })) });
    }
    /** A division's one level: its award points landed and its awards flag true. */
    const divisionFlag = (from: World, key: string): World => stateTick(withState(rowsTick(withPosted(from, key, "all")), key, { ...stateFor(key, "done"), awardsPosted: true }));
    // PER KEY LEVELS. A division has one. A championship key that is not divisioned has three: its Winner listed, its
    // award points landed with every award listed, its awards flag true.
    const levels = divisioned ? 1 : 3;
    const levelNames = divisioned ? ["flag"] : ["winner", "award points", "flag"];
    const levelUp = (from: World, key: string, level: number): World => {
      if (divisioned) return divisionFlag(from, key);
      if (level === 1) return stateTick(withAwards(from, key, awardListAt(key, WINNER_ONLY)));
      if (level === 2) return rowsTick(withAwards(withPosted(from, key, "all"), key, awardListAt(key, EVERY_CHAMPIONSHIP_AWARD)));
      return stateTick(withState(from, key, { ...stateFor(key, "done"), awardsPosted: true }));
    };
    const base = levels + 1;
    const tuples = base ** ff.length;
    const levelOf = (index: number, keyIndex: number): number => Math.floor(index / base ** keyIndex) % base;
    const raised = (from: World, index: number): World => {
      let next = from;
      ff.forEach((key, keyIndex) => {
        for (let level = 1; level <= levelOf(index, keyIndex); level++) next = levelUp(next, key, level);
      });
      return next;
    };
    const chainWorlds: World[] = [mainLineEnd];
    for (const fact of chain) chainWorlds.push(fact.apply(chainWorlds.at(-1)!));
    const positionAfter = (id: ChainFact["id"]): number => chain.findIndex((fact) => fact.id === id) + 1;
    const positionLabel = (position: number): string => (!divisioned ? "one event" : position === 0 ? (registered ? "finals not started" : "finals on no row") : chain[position - 1]!.label);
    const flagsLabel = (index: number): string =>
      `flags {${ff
        .map((key, keyIndex) => (levelOf(index, keyIndex) === 0 ? "" : `${short(key)}${divisioned ? "" : `:${levelNames[levelOf(index, keyIndex) - 1]!}`}`))
        .filter((text) => text !== "")
        .join(",")}}`;
    const grid: MicroReading[][] = [];
    /** Further edge 2 at a divisioned championship: per tuple, the reading the Winner first order ends on, to be read against the chain's own. */
    const winnerFirstCorners: { index: number; reading: MicroReading }[] = [];
    for (let index = 0; index < tuples; index++) {
      const row: MicroReading[] = [];
      for (let position = 0; position < chainWorlds.length; position++) {
        const cell = raised(chainWorlds[position]!, index);
        const reading = read(`${flagsLabel(index)} | ${positionLabel(position)}`, cell, walk);
        row.push(reading);
        if (!furtherEdges || finalsKey === undefined) continue;
        const winnerList = awardListAt(finalsKey, WINNER_ONLY);
        if (registered && position === positionAfter("done")) {
          // FURTHER EDGE 2: the Winner is listed before the finals' playoff points land.
          const listed = stateTick(withAwards(cell, finalsKey, winnerList));
          const listedReading = read(`${flagsLabel(index)} | finals playoffs done, the Winner listed, no finals points`, listed, winnerFirst);
          edge(winnerFirst, "step", reading, listedReading);
          const paid = read(`${flagsLabel(index)} | finals playoff points land after the Winner`, rowsTick(withPosted(listed, finalsKey, "elim")), winnerFirst);
          edge(winnerFirst, "step", listedReading, paid);
          winnerFirstCorners.push({ index, reading: paid });
        }
        if (!registered && position === 0) {
          // FURTHER EDGE 2: the Winner is listed before the finals rows post at all.
          const listed = stateTick(withAwards(cell, finalsKey, winnerList));
          const listedReading = read(`${flagsLabel(index)} | finals on no row, the Winner listed`, listed, winnerFirst);
          edge(winnerFirst, "step", reading, listedReading);
          const posted = rowsTick(withPosted(listed, finalsKey, "elim"));
          const postedReading = read(`${flagsLabel(index)} | finals rows posted with their playoff points after the Winner, no state`, posted, winnerFirst);
          edge(winnerFirst, "step", listedReading, postedReading);
          const written = stateTick({ ...withState(posted, finalsKey, finalsState(true)), finalsRows: playedOf(finalsKey).length });
          const writtenReading = read(`${flagsLabel(index)} | finals state written after the Winner, finals facts in hand`, written, winnerFirst);
          edge(winnerFirst, "step", postedReading, writtenReading);
          winnerFirstCorners.push({ index, reading: writtenReading });
        }
      }
      grid.push(row);
    }
    for (let index = 0; index < tuples; index++) {
      for (let position = 0; position < chainWorlds.length; position++) {
        const here = grid[index]![position]!;
        if (position + 1 < chainWorlds.length) edge(walk, "step", here, grid[index]![position + 1]!);
        for (let keyIndex = 0; keyIndex < ff.length; keyIndex++) if (levelOf(index, keyIndex) < levels) edge(walk, "flag", here, grid[index + base ** keyIndex]![position]!);
      }
    }
    for (const corner of winnerFirstCorners) expectSameCorner("the Winner before the finals' playoff points", corner.reading, grid[corner.index]![positionAfter("winner")]!);
    for (const entry of againstTheLattice) expectSameCorner(entry.what, entry.reading, grid[entry.level * base ** ff.indexOf(entry.key)]![0]!);

    // The end: the source artifact, from the last corner of the grid.
    const corner = grid[tuples - 1]![chainWorlds.length - 1]!;
    const end = read("the source artifact", { ...emptyWorld, artifact: source }, walk);
    edge(walk, "step", corner, end);
    // Path independence: the corner read by the key levels first and the chain after, against the chain first.
    let otherOrder = mainLineEnd;
    for (const key of ff) for (let level = 1; level <= levels; level++) otherOrder = levelUp(otherOrder, key, level);
    for (const fact of chain) otherOrder = fact.apply(otherOrder);
    const cornerPathIndependent = readsTheSame(read("key levels first, then the finals chain", otherOrder, walk), corner);

    // ---- FURTHER EDGE 4: the last field fixing key's rows arrive only once the others are half way through their playoffs
    let fieldProofTurnedTrueMidPlayoffs: boolean | undefined;
    if (furtherEdges && ff.length >= 2) {
      const late = ff.at(-1)!;
      const early = ff.slice(0, -1);
      const halfOf = (key: string): number => Math.ceil(playedOf(key).length / 2);
      let lateWorld = emptyWorld;
      let latePrevious = read(`${registered ? "every field team registered at the finals key" : "no dcmp row"} (the last key's rows arrive late)`, lateWorld, lateRows);
      const lateStep = (label: string, next: World): void => {
        const reading = read(label, next, lateRows);
        edge(lateRows, "step", latePrevious, reading);
        latePrevious = reading;
        lateWorld = next;
      };
      for (const key of early) {
        lateStep(`${short(key)} rows posted, ${short(late)} on no row`, rowsTick(withPosted(withState(lateWorld, key, stateFor(key, "started")), key, "qual")));
        lateStep(`${short(key)} state written, ${short(late)} on no row`, stateTick(lateWorld));
      }
      lateStep(
        `qualification done at every posted key, ${short(late)} on no row`,
        stateTick(early.reduce((next, key) => withState(next, key, stateFor(key, "qualDone")), lateWorld))
      );
      for (const key of early) lateStep(`${short(key)} alliances picked, no alliance points, ${short(late)} on no row`, stateTick({ ...withState(lateWorld, key, stateFor(key, "picked")), rows: new Map(early.map((other) => [other, 0] as const)) }));
      for (const key of early) lateStep(`${short(key)} alliance points land, ${short(late)} on no row`, rowsTick(withPosted(lateWorld, key, "alliance")));
      const mostEarly = Math.max(...early.map(halfOf));
      for (let index = 0; index < mostEarly; index++) {
        for (const key of early) {
          if (index >= halfOf(key)) continue;
          lateStep(`${playedLabel(key, index)}, ${short(late)} on no row`, withRows(lateWorld, key, index + 1));
        }
      }
      // The late key arrives: its rows with qualification and alliance points and no state, then its state.
      lateStep(`${short(late)} rows posted with qualification and alliance points, no state, the others mid playoffs`, rowsTick(withPosted(lateWorld, late, "alliance")));
      const beforeState = latePrevious;
      lateStep(`${short(late)} state written, alliances picked, the others mid playoffs`, stateTick(withRows(withState(lateWorld, late, stateFor(late, "picked")), late, 0)));
      fieldProofTurnedTrueMidPlayoffs = !beforeState.proven && latePrevious.proven;
      if (variant === "finalsOnNoRow") {
        // D2's SWITCH TURNING ON: the same tick, read on its own. Before it the proof refuses (the field is not
        // proven); after it the division keys alone are read as a divisioned championship whose finals have not
        // started. A lock may only be added over it.
        let lost = 0;
        for (const teamKey of beforeState.held) if (!latePrevious.held.has(teamKey)) lost += 1;
        absentFinalsSwitch = {
          turnedOn: !beforeState.finalsReadAbsent && latePrevious.finalsReadAbsent,
          jointBefore: beforeState.joint,
          jointAfter: latePrevious.joint,
          shownLockedBefore: beforeState.shownLocked,
          shownLockedAfter: latePrevious.shownLocked,
          lost,
        };
      }
      readUnprovenAgain(lateWorld, latePrevious);
      // The rest of the playoffs, the keys interleaved, each from where it stands.
      const remaining = Math.max(...ff.map((key) => playedOf(key).length - (lateWorld.rows?.get(key) ?? 0)));
      for (let more = 0; more < remaining; more++) {
        for (const key of ff) {
          const index = lateWorld.rows?.get(key) ?? 0;
          if (index >= playedOf(key).length) continue;
          lateStep(`${playedLabel(key, index)} (late rows)`, withRows(lateWorld, key, index + 1));
        }
      }
      for (const key of ff) {
        lateStep(`${short(key)} playoffs done, no playoff points (late rows)`, stateTick(withState(lateWorld, key, stateFor(key, "done"))));
        lateStep(`${short(key)} playoff points land (late rows)`, rowsTick(withPosted(lateWorld, key, "elim")));
      }
      expectSameCorner("the last key's rows arriving mid playoffs", latePrevious, mainLineEndReading);
    }

    return {
      districtKey,
      variant,
      walk,
      mainLineEdges,
      cornerPathIndependent,
      winnerFirst,
      awardsFirst,
      lateRows,
      cornerMismatches,
      fieldProofTakenBack,
      fieldProofTurnedTrueMidPlayoffs,
      absentFinalsSwitch,
      walkReadingsWithFinalsReadAbsent,
      flagHeldWithoutPlayoffPoints,
      flagRaisedWithPlayoffPoints,
      divisionsWalkedAwardsFirst,
      forcedFlag,
      forcedFlagLostWritingTheFlag,
      unprovenAgain,
      atMainLineEnd: { joint: mainLineEndReading.joint, jointLocked: mainLineEndReading.jointLocked, shownLocked: mainLineEndReading.shownLocked },
      endShownLocked: end.shownLocked,
    };
  });
  microCache.set(cacheKey, result);
  return result;
}

/** The single championships of 2023 to 2026 with a published capacity, by district key. The first test of group D holds the list EQUAL to what the local artifacts carry. */
const SINGLE = [
  "2023chs",
  "2023fin",
  "2023fma",
  "2023fnc",
  "2023isr",
  "2023pch",
  "2023pnw",
  "2024chs",
  "2024fin",
  "2024fma",
  "2024fnc",
  "2024isr",
  "2024pch",
  "2024pnw",
  "2025chs",
  "2025fin",
  "2025fma",
  "2025fnc",
  "2025fsc",
  "2025isr",
  "2025pch",
  "2025pnw",
  "2026fch",
  "2026fin",
  "2026fma",
  "2026fnc",
  "2026fsc",
  "2026isr",
  "2026pch",
  "2026pnw",
  "2026win",
] as const;
const MISSING_SINGLE = SINGLE.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));
/** The FIM season the committed walks cover (planner reading R10: the other three run about 40 seconds each per variant). */
const MICRO_FIM = "2026fim";
const FINALS_VARIANTS = ["finalsOnNoRow", "finalsRegistered"] as const;

type MicroWalkId = readonly [districtKey: string, variant: MicroVariant];
const ONE_EVENT_WALKS: readonly MicroWalkId[] = [...SINGLE, TWO_CHAMPIONSHIP_DISTRICT].map((districtKey) => [districtKey, "oneEvent"] as const);
const SINGLE_WALKS: readonly MicroWalkId[] = SINGLE.map((districtKey) => [districtKey, "oneEvent"] as const);
const twoDivisionWalks = (variant: MicroVariant): MicroWalkId[] => TWO_DIVISION.map((districtKey) => [districtKey, variant] as const);

interface MicroTotals {
  readonly walk: EdgeTally;
  readonly mainLineEdges: number;
  readonly winnerFirst: EdgeTally;
  readonly awardsFirst: EdgeTally;
  readonly lateRows: EdgeTally;
  readonly forcedFlag: EdgeTally;
  readonly forcedFlagLostWritingTheFlag: number;
  readonly unprovenAgain: EdgeTally;
  readonly notPathIndependent: string[];
  readonly cornerMismatches: string[];
  readonly fieldProofTakenBack: string[];
  /** Further edge 4: the walks where the field proof turned true on the late key's state tick, and those where it did not. */
  readonly fieldProofTurnedTrue: number;
  readonly fieldProofDidNotTurnTrue: string[];
  /** Further edge 4 at the `finalsOnNoRow` walks: D2's absent finals reading over the late key's state tick. */
  readonly absentFinalsSwitch: { walks: number; turnedOn: number; lost: number; lockedAdded: number; joint: Record<string, number> };
  /** Readings of the walks where the finals were read absent (the finals key on no row, the option handed). */
  readonly walkReadingsWithFinalsReadAbsent: number;
  readonly divisionsWalkedAwardsFirst: number;
  readonly flagHeldWithoutPlayoffPoints: number;
  readonly flagRaisedWithPlayoffPoints: number;
  /** Per district key: Locked lost over the walk's edges, and team margins dropped. Districts at 0 are left out. */
  readonly lostByDistrict: Record<string, number>;
  readonly dropsByDistrict: Record<string, number>;
}

function microTotals(walks: readonly MicroWalkId[], mode: RuleMode): MicroTotals {
  const totals: MicroTotals = {
    walk: newTally(),
    mainLineEdges: 0,
    winnerFirst: newTally(),
    awardsFirst: newTally(),
    lateRows: newTally(),
    forcedFlag: newTally(),
    forcedFlagLostWritingTheFlag: 0,
    unprovenAgain: newTally(),
    notPathIndependent: [],
    cornerMismatches: [],
    fieldProofTakenBack: [],
    fieldProofTurnedTrue: 0,
    fieldProofDidNotTurnTrue: [],
    absentFinalsSwitch: { walks: 0, turnedOn: 0, lost: 0, lockedAdded: 0, joint: {} },
    walkReadingsWithFinalsReadAbsent: 0,
    divisionsWalkedAwardsFirst: 0,
    flagHeldWithoutPlayoffPoints: 0,
    flagRaisedWithPlayoffPoints: 0,
    lostByDistrict: {},
    dropsByDistrict: {},
  };
  const sums = { mainLineEdges: 0, fieldProofTurnedTrue: 0, divisionsWalkedAwardsFirst: 0, flagHeldWithoutPlayoffPoints: 0, flagRaisedWithPlayoffPoints: 0, walkReadingsWithFinalsReadAbsent: 0, forcedFlagLostWritingTheFlag: 0 };
  for (const [districtKey, variant] of walks) {
    const result = microWalk(districtKey, variant, mode);
    addTally(totals.walk, result.walk);
    addTally(totals.winnerFirst, result.winnerFirst);
    addTally(totals.awardsFirst, result.awardsFirst);
    addTally(totals.lateRows, result.lateRows);
    addTally(totals.forcedFlag, result.forcedFlag);
    addTally(totals.unprovenAgain, result.unprovenAgain);
    for (const teamKey of result.walk.lostTeams) totals.walk.lostTeams.add(`${districtKey} ${teamKey}`);
    for (const teamKey of result.forcedFlag.lostTeams) totals.forcedFlag.lostTeams.add(`${districtKey} ${teamKey}`);
    for (const teamKey of result.unprovenAgain.lostTeams) totals.unprovenAgain.lostTeams.add(`${districtKey} ${teamKey}`);
    sums.mainLineEdges += result.mainLineEdges;
    if (!result.cornerPathIndependent) totals.notPathIndependent.push(`${districtKey} ${variant}`);
    totals.cornerMismatches.push(...result.cornerMismatches);
    totals.fieldProofTakenBack.push(...result.fieldProofTakenBack);
    if (result.fieldProofTurnedTrueMidPlayoffs === true) sums.fieldProofTurnedTrue += 1;
    if (result.fieldProofTurnedTrueMidPlayoffs === false) totals.fieldProofDidNotTurnTrue.push(`${districtKey} ${variant}`);
    if (result.absentFinalsSwitch !== undefined) {
      const at = result.absentFinalsSwitch;
      const transition = `${at.jointBefore} then ${at.jointAfter}`;
      totals.absentFinalsSwitch.walks += 1;
      if (at.turnedOn) totals.absentFinalsSwitch.turnedOn += 1;
      totals.absentFinalsSwitch.lost += at.lost;
      totals.absentFinalsSwitch.lockedAdded += at.shownLockedAfter - at.shownLockedBefore;
      totals.absentFinalsSwitch.joint[transition] = (totals.absentFinalsSwitch.joint[transition] ?? 0) + 1;
    }
    sums.walkReadingsWithFinalsReadAbsent += result.walkReadingsWithFinalsReadAbsent;
    sums.forcedFlagLostWritingTheFlag += result.forcedFlagLostWritingTheFlag;
    sums.divisionsWalkedAwardsFirst += result.divisionsWalkedAwardsFirst;
    sums.flagHeldWithoutPlayoffPoints += result.flagHeldWithoutPlayoffPoints;
    sums.flagRaisedWithPlayoffPoints += result.flagRaisedWithPlayoffPoints;
    const lost = result.walk.lost.flag + result.walk.lost.step;
    if (lost > 0) totals.lostByDistrict[districtKey] = (totals.lostByDistrict[districtKey] ?? 0) + lost;
    if (result.walk.marginDrops > 0) totals.dropsByDistrict[districtKey] = (totals.dropsByDistrict[districtKey] ?? 0) + result.walk.marginDrops;
  }
  return { ...totals, ...sums };
}

/** What one rules on walk must show. */
function expectMicroWalk(result: MicroResult, fieldFixingKeyCount: number): void {
  const label = `${result.districtKey} ${result.variant}`;
  expectMonotone(`${label}, the walk`, result.walk);
  expectMonotone(`${label}, the Winner before the playoff points`, result.winnerFirst);
  expectMonotone(`${label}, a division's award points before its playoff points`, result.awardsFirst);
  expectMonotone(`${label}, the last key's rows arriving mid playoffs`, result.lateRows);
  expect({ label, cornerPathIndependent: result.cornerPathIndependent, cornerMismatches: result.cornerMismatches, fieldProofTakenBack: result.fieldProofTakenBack }).toEqual({
    label,
    cornerPathIndependent: true,
    cornerMismatches: [],
    fieldProofTakenBack: [],
  });
  // Further edge 4 is a real edge only where the field proof turns true on it.
  expect(result.fieldProofTurnedTrueMidPlayoffs, `${label}: the field proof over the late key's state tick`).toBe(fieldFixingKeyCount >= 2 ? true : undefined);
  // D2's SWITCH (the finals key on no row only): the absent finals reading turns on at exactly that tick, the proof
  // refuses `fieldNotProven` before it, and no held team is lost over it: a lock may only be added.
  if (result.variant === "finalsOnNoRow") {
    expect(
      { label, turnedOn: result.absentFinalsSwitch?.turnedOn, jointBefore: result.absentFinalsSwitch?.jointBefore, lost: result.absentFinalsSwitch?.lost },
      `${label}: D2's absent finals reading over the late key's state tick`
    ).toEqual({ label, turnedOn: true, jointBefore: "fieldNotProven", lost: 0 });
    // Not vacuous: the walk itself read the finals absent somewhere.
    expect(result.walkReadingsWithFinalsReadAbsent, `${label}: readings of the walk with the finals read absent`).toBeGreaterThan(0);
  } else {
    expect({ label, absentFinalsSwitch: result.absentFinalsSwitch, readAbsent: result.walkReadingsWithFinalsReadAbsent }).toEqual({ label, absentFinalsSwitch: undefined, readAbsent: 0 });
  }
  // Further edge 3: at every division the merge's own rule kept the flag false with no playoff point on a row, and raised it once they landed.
  const divisions = result.variant === "oneEvent" ? 0 : fieldFixingKeyCount;
  expect({ walked: result.divisionsWalkedAwardsFirst, held: result.flagHeldWithoutPlayoffPoints, raised: result.flagRaisedWithPlayoffPoints }, `${label}: the awards flag rule`).toEqual({ walked: divisions, held: divisions, raised: divisions });
  // Every further edge was walked.
  expect(result.winnerFirst.edges.step, `${label}: the Winner first edges`).toBeGreaterThan(0);
  expect(result.lateRows.edges.step > 0, `${label}: the late rows edges`).toBe(fieldFixingKeyCount >= 2);
}

const tallyLine = (tally: EdgeTally): string =>
  `readings ${String(tally.readings)} (${JSON.stringify(tally.joint)}) | step edges ${String(tally.edges.step)}, flag edges ${String(tally.edges.flag)} | Locked lost ${String(tally.lost.step + tally.lost.flag)} | margin drops ${String(tally.marginDrops)} | applied then refused ${String(tally.appliedThenRefused)}`;
const microPin = (tally: EdgeTally) => ({ readings: tally.readings, edges: tally.edges.step + tally.edges.flag });

describe("GROUP D, the micro step live walks: a championship walked live one fact at a time through the merge's two entry points and the tab's own status code (quick task 261010-d7r, D3 second half, finding F-D, CONTEXT D7)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  const missing = [...MISSING_DIVISIONED, ...MISSING_SINGLE, ...(LOCAL_DISTRICT_FILES.includes(TWO_CHAMPIONSHIP_FILE) ? [] : [TWO_CHAMPIONSHIP_DISTRICT])];
  if (missing.length > 0) {
    localDataAbsent(`${missing.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it("the single championships named in this file are exactly the single championships of 2023 on that the local artifacts carry", () => {
    const single: string[] = [];
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const year = Number(DISTRICT_DETAIL_FILE.exec(fileName)?.[1]);
      if (!(year >= 2023)) continue;
      const artifact = localArtifact(fileName);
      if (artifact.cmpSlots !== null && championshipShape(dcmpEventKeysFor(artifact)).kind === "single") single.push(artifact.districtKey);
    }
    expect(single.sort()).toEqual([...SINGLE]);
  });

  for (const [districtKey, variant] of ONE_EVENT_WALKS) {
    it(
      `${districtKey}: over every tick of the live walk and every level of its awards no held team is lost and no margin drops, the Winner listed before the playoff points included`,
      () => expectMicroWalk(microWalk(districtKey, variant, "on"), microChampionship(districtKey).fieldFixingKeys.length),
      TEST_TIMEOUT_MS
    );
  }

  for (const variant of FINALS_VARIANTS) {
    for (const districtKey of [...TWO_DIVISION, MICRO_FIM]) {
      it(
        `${districtKey}, ${variant === "finalsOnNoRow" ? "the finals key on no row until the finals pay" : "the finals key registered from the start"}: over every tick, every order of the division flags and every finals fact no held team is lost and no margin drops`,
        () => expectMicroWalk(microWalk(districtKey, variant, "on"), microChampionship(districtKey).fieldFixingKeys.length),
        TEST_TIMEOUT_MS
      );
    }
  }

  it(
    "the walks, rules on: nothing lost and nothing dropped, counts pinned as the run shows",
    () => {
      const oneEvent = microTotals(ONE_EVENT_WALKS, "on");
      const twoNoRow = microTotals(twoDivisionWalks("finalsOnNoRow"), "on");
      const twoRegistered = microTotals(twoDivisionWalks("finalsRegistered"), "on");
      const fimNoRow = microTotals([[MICRO_FIM, "finalsOnNoRow"]], "on");
      const fimRegistered = microTotals([[MICRO_FIM, "finalsRegistered"]], "on");
      console.log(
        `[261010-d7r group D, rules on, the walk]\n  the 31 single championships and California: ${tallyLine(oneEvent.walk)}\n  the 12 two division championships, finals on no row: ${tallyLine(twoNoRow.walk)}\n  the 12 two division championships, finals registered: ${tallyLine(twoRegistered.walk)}\n  2026 FIM, finals on no row: ${tallyLine(fimNoRow.walk)}\n  2026 FIM, finals registered: ${tallyLine(fimRegistered.walk)}`
      );
      for (const [label, totals] of [
        ["the single championships and California", oneEvent],
        ["the two division championships, finals on no row", twoNoRow],
        ["the two division championships, finals registered", twoRegistered],
        ["2026 FIM, finals on no row", fimNoRow],
        ["2026 FIM, finals registered", fimRegistered],
      ] as const) {
        expectMonotone(label, totals.walk);
        expect({ label, notPathIndependent: totals.notPathIndependent, fieldProofTakenBack: totals.fieldProofTakenBack }).toEqual({ label, notPathIndependent: [], fieldProofTakenBack: [] });
      }
      // Readings and edges of the walk (the main line, the lattice, the corner by the other order, the end).
      expect({
        oneEvent: microPin(oneEvent.walk),
        twoNoRow: microPin(twoNoRow.walk),
        twoRegistered: microPin(twoRegistered.walk),
        fimNoRow: microPin(fimNoRow.walk),
        fimRegistered: microPin(fimRegistered.walk),
      }).toEqual({
        oneEvent: { readings: 970, edges: 883 },
        twoNoRow: { readings: 848, edges: 1064 },
        twoRegistered: { readings: 1012, edges: 1392 },
        fimNoRow: { readings: 184, edges: 358 },
        fimRegistered: { readings: 312, edges: 742 },
      });
      // What the proof said over the walk. Since Task 4 of the quick task (its D2) a divisioned championship whose
      // finals key is on no row is read as one whose finals have not started, once the field is proven by capacity.
      // `unsupportedShape` is read at NO reading of these walks any more (before that task: 512 readings over the
      // two division walks and 92 at 2026 FIM, every one up to the finals rows). The two finals variants now refuse
      // for the same reasons the same number of times; the registered one only has more readings, its finals being
      // played row by row. The proof goes from applied to refused only into the corner where every key's Awards are
      // final (one edge per key and, at a divisioned championship, one finals edge), which loses nobody: the
      // ceiling test holds what the proof held there.
      //
      // How many readings of each walk read the finals ABSENT (the option handed and the finals key on no row):
      // none where the finals key is registered or there is no finals key. Pinned as the run shows.
      expect({
        oneEvent: oneEvent.walkReadingsWithFinalsReadAbsent,
        twoNoRow: twoNoRow.walkReadingsWithFinalsReadAbsent,
        twoRegistered: twoRegistered.walkReadingsWithFinalsReadAbsent,
        fimNoRow: fimNoRow.walkReadingsWithFinalsReadAbsent,
        fimRegistered: fimRegistered.walkReadingsWithFinalsReadAbsent,
      }).toEqual({ oneEvent: 0, twoNoRow: 536, twoRegistered: 0, fimNoRow: 94, fimRegistered: 0 });
      expect({
        oneEvent: { joint: oneEvent.walk.joint, appliedThenRefused: oneEvent.walk.appliedThenRefused },
        twoNoRow: { joint: twoNoRow.walk.joint, appliedThenRefused: twoNoRow.walk.appliedThenRefused },
        twoRegistered: { joint: twoRegistered.walk.joint, appliedThenRefused: twoRegistered.walk.appliedThenRefused },
        fimNoRow: { joint: fimNoRow.walk.joint, appliedThenRefused: fimNoRow.walk.appliedThenRefused },
        fimRegistered: { joint: fimRegistered.walk.joint, appliedThenRefused: fimRegistered.walk.appliedThenRefused },
      }).toEqual({
        oneEvent: { joint: { noDistributions: 162, stageNotEligible: 33, applied: 710, noBracketFacts: 65 }, appliedThenRefused: 33 },
        twoNoRow: { joint: { noDistributions: 84, noBracketFacts: 12, stageNotEligible: 48, applied: 704 }, appliedThenRefused: 36 },
        twoRegistered: { joint: { noDistributions: 84, noBracketFacts: 12, stageNotEligible: 48, applied: 868 }, appliedThenRefused: 36 },
        fimNoRow: { joint: { noDistributions: 11, noBracketFacts: 3, stageNotEligible: 6, applied: 164 }, appliedThenRefused: 5 },
        fimRegistered: { joint: { noDistributions: 11, noBracketFacts: 3, stageNotEligible: 6, applied: 292 }, appliedThenRefused: 5 },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "the further edges of CONTEXT D7, rules on: the Winner before the playoff points, a division's award points before its playoff points through the merge's own flag rule, and the last key's rows arriving mid playoffs lose nothing and drop nothing, counts pinned as the run shows",
    () => {
      const all = microTotals([...ONE_EVENT_WALKS, ...twoDivisionWalks("finalsOnNoRow"), ...twoDivisionWalks("finalsRegistered"), [MICRO_FIM, "finalsOnNoRow"], [MICRO_FIM, "finalsRegistered"]], "on");
      console.log(
        `[261010-d7r group D, rules on, the further edges]\n  the Winner before the playoff points: ${tallyLine(all.winnerFirst)}\n  a division's award points before its playoff points: ${tallyLine(all.awardsFirst)} | divisions walked ${String(all.divisionsWalkedAwardsFirst)}, flag held false with no playoff point ${String(all.flagHeldWithoutPlayoffPoints)}, flag raised once they landed ${String(all.flagRaisedWithPlayoffPoints)}\n  the last key's rows arriving mid playoffs: ${tallyLine(all.lateRows)} | the field proof turned true at ${String(all.fieldProofTurnedTrue)} walks, did not at ${JSON.stringify(all.fieldProofDidNotTurnTrue)}`
      );
      expectMonotone("the Winner before the playoff points", all.winnerFirst);
      expectMonotone("a division's award points before its playoff points", all.awardsFirst);
      expectMonotone("the last key's rows arriving mid playoffs", all.lateRows);
      expect({ cornerMismatches: all.cornerMismatches, fieldProofTakenBack: all.fieldProofTakenBack, fieldProofDidNotTurnTrue: all.fieldProofDidNotTurnTrue }).toEqual({ cornerMismatches: [], fieldProofTakenBack: [], fieldProofDidNotTurnTrue: [] });
      expect({
        winnerFirst: microPin(all.winnerFirst),
        awardsFirst: { ...microPin(all.awardsFirst), divisions: all.divisionsWalkedAwardsFirst, flagHeld: all.flagHeldWithoutPlayoffPoints, flagRaised: all.flagRaisedWithPlayoffPoints },
        lateRows: { ...microPin(all.lateRows), walksWhereTheFieldProofTurnedTrue: all.fieldProofTurnedTrue, joint: all.lateRows.joint },
        absentFinalsSwitch: all.absentFinalsSwitch,
      }).toEqual({
        winnerFirst: { readings: 386, edges: 386 },
        // 56 divisions: 12 championships of two and one of four, each in both finals variants.
        awardsFirst: { readings: 112, edges: 112, divisions: 56, flagHeld: 56, flagRaised: 56 },
        // 27 walks: California, and the 13 divisioned championships in both finals variants. `fieldNotProven` is the
        // proof refusing while the last key is on no row or has no state. With the finals key on no row the proof
        // read `unsupportedShape` after that tick too (377 readings) until Task 4 of the quick task; it now runs
        // there, on the division keys alone.
        lateRows: { readings: 1235, edges: 1208, walksWhereTheFieldProofTurnedTrue: 27, joint: { noDistributions: 116, fieldNotProven: 337, applied: 782 } },
        // D2's SWITCH TURNING ON, the 13 walks with the finals key on no row (the 12 two division championships and
        // 2026 FIM): on at exactly the tick the field proof turns true in every one, the proof refusing
        // `fieldNotProven` before it and applied after it, no held team lost over it, and 4 more teams shown Locked
        // after it than before over the 13. Pinned as the run shows.
        absentFinalsSwitch: { walks: 13, turnedOn: 13, lost: 0, lockedAdded: 4, joint: { "fieldNotProven then applied": 13 } },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "THE TEST BITES: with the awarded rule switched off the two division championships lose Locked teams over the live walk, pinned as the run shows",
    () => {
      const noRow = microTotals(twoDivisionWalks("finalsOnNoRow"), "awardedRuleOff");
      const registered = microTotals(twoDivisionWalks("finalsRegistered"), "awardedRuleOff");
      console.log(`[261010-d7r group D, awarded rule OFF] finals on no row: ${tallyLine(noRow.walk)} | by district ${JSON.stringify(noRow.lostByDistrict)}\n  finals registered: ${tallyLine(registered.walk)} | by district ${JSON.stringify(registered.lostByDistrict)}\n${registered.walk.lostLines.slice(0, 8).map((line) => `  ${line}`).join("\n")}`);
      // THE REQUIREMENT: the mutation is caught, through the status code's own verdicts.
      expect(registered.walk.lost.step + registered.walk.lost.flag).toBeGreaterThan(0);
      expect(registered.walk.marginDrops).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r. Pinned as the run shows; not a requirement.
      // Every one is lost over a FLAG edge (a division's awards flag turning true), none over a step. With the finals
      // key on no row the proof ran only from the finals rows on until Task 4 of the quick task, and fewer were lost
      // then (94, and 1666 margins); it now runs from the alliance points on, so more of the flag edges have a proof
      // on both sides. Quick task 261010-l0s's paid pick rule moved the margins dropped and nothing else here, 2029
      // to 2035 and 3236 to 3245: no Locked more or fewer is lost.
      const pin = (totals: MicroTotals) => ({ ...microPin(totals.walk), lostOverStepEdges: totals.walk.lost.step, lostOverFlagEdges: totals.walk.lost.flag, marginDrops: totals.walk.marginDrops, largestDrop: totals.walk.largestDrop });
      expect({ noRow: pin(noRow), registered: pin(registered) }).toEqual({
        noRow: { readings: 848, edges: 1064, lostOverStepEdges: 0, lostOverFlagEdges: 121, marginDrops: 2035, largestDrop: 4 },
        registered: { readings: 1012, edges: 1392, lostOverStepEdges: 0, lostOverFlagEdges: 202, marginDrops: 3245, largestDrop: 4 },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "THE TEST BITES: with the stop rule switched off the two division championships lose Locked teams over the live walk, at the finals' awards flag turning true before a division's, pinned as the run shows",
    () => {
      const noRow = microTotals(twoDivisionWalks("finalsOnNoRow"), "stopRuleOff");
      const registered = microTotals(twoDivisionWalks("finalsRegistered"), "stopRuleOff");
      console.log(`[261010-d7r group D, stop rule OFF] finals on no row: ${tallyLine(noRow.walk)} | by district ${JSON.stringify(noRow.lostByDistrict)}\n  finals registered: ${tallyLine(registered.walk)} | by district ${JSON.stringify(registered.lostByDistrict)}\n${registered.walk.lostLines.slice(0, 8).map((line) => `  ${line}`).join("\n")}`);
      // THE REQUIREMENT: the mutation is caught, through the status code's own verdicts.
      expect(noRow.walk.lost.step + noRow.walk.lost.flag).toBeGreaterThan(0);
      expect(registered.walk.lost.step + registered.walk.lost.flag).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r (finding F-B). Pinned as the run shows.
      // Every one is lost over a STEP edge, the finals' awards flag turning true, and the same 63 in both variants
      // (the awards order lattice of group A reads the same 63 over these twelve championships).
      const pin = (totals: MicroTotals) => ({ ...microPin(totals.walk), lostOverStepEdges: totals.walk.lost.step, lostOverFlagEdges: totals.walk.lost.flag, marginDrops: totals.walk.marginDrops, lostByDistrict: totals.lostByDistrict });
      const lostByDistrict = { "2023fit": 8, "2023ne": 4, "2023ont": 6, "2024fit": 2, "2024ne": 8, "2024ont": 4, "2025fit": 7, "2025ne": 4, "2025ont": 1, "2026fit": 1, "2026ne": 16, "2026ont": 2 };
      expect({ noRow: pin(noRow), registered: pin(registered) }).toEqual({
        noRow: { readings: 848, edges: 1064, lostOverStepEdges: 63, lostOverFlagEdges: 0, marginDrops: 0, lostByDistrict },
        registered: { readings: 1012, edges: 1392, lostOverStepEdges: 63, lostOverFlagEdges: 0, marginDrops: 0, lostByDistrict },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "THE LISTED RULE SWITCHED OFF LOSES NO LOCKED TEAM AND ONLY DROPS MARGINS: over the single championships a bound rises at the played row that places an alliance listing four teams, pinned as the run shows",
    () => {
      const single = microTotals(SINGLE_WALKS, "listedRuleOff");
      const california = microTotals([[TWO_CHAMPIONSHIP_DISTRICT, "oneEvent"]], "listedRuleOff");
      const twoNoRow = microTotals(twoDivisionWalks("finalsOnNoRow"), "listedRuleOff");
      const twoRegistered = microTotals(twoDivisionWalks("finalsRegistered"), "listedRuleOff");
      const fim = microTotals([[MICRO_FIM, "finalsOnNoRow"], [MICRO_FIM, "finalsRegistered"]], "listedRuleOff");
      console.log(
        `[261010-d7r group D, listed rule OFF] the 31 single championships: ${tallyLine(single.walk)} | margins dropped by district ${JSON.stringify(single.dropsByDistrict)}, the largest by ${String(single.walk.largestDrop)}\n  California: ${tallyLine(california.walk)}\n  two division, finals on no row: ${tallyLine(twoNoRow.walk)}\n  two division, finals registered: ${tallyLine(twoRegistered.walk)}\n  2026 FIM, both finals variants: ${tallyLine(fim.walk)}\n${single.walk.dropLines.slice(0, 30).map((line) => `  ${line}`).join("\n")}`
      );
      // THE REQUIREMENT: the mutation is caught. WHAT IT COSTS, IN WORDS: a margin drops, and no Locked team is lost
      // on any walk of this file. The rule keeps a bound from rising; no measured Locked rests on it.
      expect(single.walk.marginDrops).toBeGreaterThan(0);
      // The measurement of the reading before quick task 261010-d7r (finding F-D). Pinned as the run shows.
      const pin = (totals: MicroTotals) => ({ lost: totals.walk.lost.step + totals.walk.lost.flag, marginDrops: totals.walk.marginDrops, dropsByDistrict: totals.dropsByDistrict });
      // NO LOCKED TEAM IS LOST with this rule off, over every walk of this group.
      for (const totals of [single, california, twoNoRow, twoRegistered, fim]) expect(totals.walk.lost.step + totals.walk.lost.flag).toBe(0);
      // 25 team margins over five of the 31 single championships, each by 1, each at the played row that places an
      // alliance listing four teams (2023pnw at the second Finals match). None at California, at a two division
      // championship or at 2026 FIM. The planner of the quick task read the same 25, and one more at 2025 FIM, which
      // is not walked here.
      expect({ single: { ...pin(single), largestDrop: single.walk.largestDrop }, california: pin(california), twoNoRow: pin(twoNoRow), twoRegistered: pin(twoRegistered), fim: pin(fim) }).toEqual({
        single: { lost: 0, marginDrops: 25, dropsByDistrict: { "2023pnw": 17, "2024fnc": 1, "2024pch": 2, "2026fnc": 3, "2026win": 2 }, largestDrop: 1 },
        california: { lost: 0, marginDrops: 0, dropsByDistrict: {} },
        twoNoRow: { lost: 0, marginDrops: 0, dropsByDistrict: {} },
        twoRegistered: { lost: 0, marginDrops: 0, dropsByDistrict: {} },
        fim: { lost: 0, marginDrops: 0, dropsByDistrict: {} },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "FORCED, MEASURED AND NOT REQUIRED: a division's awards flag written true by hand before its playoff points (the merge's flag rule never does this: it waits for a playoff point, and `eventAwards.ts` states why), pinned as the run shows",
    () => {
      const noRow = microTotals([...twoDivisionWalks("finalsOnNoRow"), [MICRO_FIM, "finalsOnNoRow"]], "on");
      const registered = microTotals([...twoDivisionWalks("finalsRegistered"), [MICRO_FIM, "finalsRegistered"]], "on");
      console.log(
        `[261010-d7r group D, FORCED awards flag before the playoff points] finals on no row: ${tallyLine(noRow.forcedFlag)} | distinct district and team pairs lost ${String(noRow.forcedFlag.lostTeams.size)}\n  finals registered: ${tallyLine(registered.forcedFlag)} | distinct district and team pairs lost ${String(registered.forcedFlag.lostTeams.size)}\n${registered.forcedFlag.lostLines.slice(0, 12).map((line) => `  ${line}`).join("\n")}`
      );
      // What excludes this edge is asserted above: the merge's own rule kept the flag false at every division.
      expect(noRow.flagHeldWithoutPlayoffPoints).toBe(noRow.divisionsWalkedAwardsFirst);
      expect(registered.flagHeldWithoutPlayoffPoints).toBe(registered.divisionsWalkedAwardsFirst);
      // 28 divisions in each finals variant, two forced edges each. The Locked lost here are lost when the playoff
      // points land AFTER a flag that had closed the division's Playoffs with none on a row: points no reading
      // allowed for. None is lost over the edge that writes the flag itself (counted edge by edge in the walk; the
      // tally's own lines are capped, so the count is not read off them).
      expect({ noRow: noRow.forcedFlagLostWritingTheFlag, registered: registered.forcedFlagLostWritingTheFlag }).toEqual({ noRow: 0, registered: 0 });
      for (const totals of [noRow, registered]) expect(totals.forcedFlag.lostLines.filter((line) => !line.includes('(FORCED)" then "'))).toEqual([]);
      // Pinned as the run shows. Until Task 4 of the quick task (its D2) the two variants together read 34 lost, 28
      // distinct pairs and 498 margins: with the finals key on no row the proof did not run at these ticks, so only
      // the ceiling test's locks could be lost there. The proof now runs in both variants and they read the same.
      const pin = (totals: MicroTotals) => ({ ...microPin(totals.forcedFlag), lost: totals.forcedFlag.lost.step, distinctPairsLost: totals.forcedFlag.lostTeams.size, marginDrops: totals.forcedFlag.marginDrops });
      expect({ noRow: pin(noRow), registered: pin(registered) }).toEqual({
        noRow: { readings: 56, edges: 56, lost: 28, distinctPairsLost: 22, marginDrops: 498 },
        registered: { readings: 56, edges: 56, lost: 28, distinctPairsLost: 22, marginDrops: 498 },
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "FORCED, MEASURED AND NOT REQUIRED: a proven field read not proven again, by doubling the published capacity under the same rows (the field proof never goes from proven to not proven on any walked path, asserted above), pinned as the run shows",
    () => {
      const all = microTotals([...ONE_EVENT_WALKS, ...twoDivisionWalks("finalsOnNoRow"), ...twoDivisionWalks("finalsRegistered"), [MICRO_FIM, "finalsOnNoRow"], [MICRO_FIM, "finalsRegistered"]], "on");
      console.log(`[261010-d7r group D, FORCED field proof not proven again] ${tallyLine(all.unprovenAgain)} | distinct district and team pairs lost ${String(all.unprovenAgain.lostTeams.size)}\n${all.unprovenAgain.lostLines.slice(0, 12).map((line) => `  ${line}`).join("\n")}`);
      expect(all.fieldProofTakenBack).toEqual([]);
      // 85 forced readings: the main line's end of all 58 walks, and the tick the field proof turned true in the 27
      // walks whose last key's rows arrive mid playoffs. The proof refuses at every one.
      //
      // Pinned as the run shows. Until Task 4 of the quick task (its D2) this read 596 lost and the proof went from
      // applied to refused at 59 of the 85: with the finals key on no row the proof did not run at these ticks. It
      // now runs there, so it goes from applied to refused at all 85 and what it held is lost with it: 765, the same
      // 510 distinct pairs. THIS IS ALSO D2's OWN SWITCH TURNING OFF (the group's header): the cost of the earlier
      // lock is that a proven field read unproven again, which no walked path does, would take more back.
      //
      // Quick task 261010-l0s's paid pick rule moved it to 770 and 515: at the main line's end of five one event
      // walks the decided winner's paid backup is now held by the proof (2023pnw frc1983, 2024fnc frc6639, 2025fin
      // frc1747, 2026ca frc3512, 2026fnc frc6639: each is on the winning alliance and holds its Winner award at the
      // season's end), so this forced reading loses those five as well.
      expect({ ...microPin(all.unprovenAgain), lost: all.unprovenAgain.lost.step, distinctPairsLost: all.unprovenAgain.lostTeams.size, joint: all.unprovenAgain.joint, appliedThenRefused: all.unprovenAgain.appliedThenRefused }).toEqual({
        readings: 85,
        edges: 85,
        lost: 770,
        distinctPairsLost: 515,
        joint: { fieldNotProven: 85 },
        appliedThenRefused: 85,
      });
    },
    TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP E: the paid pick rule (quick task 261010-l0s, finding F2)
// ---------------------------------------------------------------------------

/**
 * WHAT GROUP E HOLDS. The tick a key's playoff points land after its playoffs
 * are done, in the window before the Winner award is listed. A team the
 * decided winner lists with no alliance selection points is counted through
 * the winner's fill in until that tick. At the tick TBA's payment enters its
 * floor, and the status code must then read it as the winner's member and
 * close the seat it holds (`confirmedPicks`). Before that rule it stayed off
 * the winner, the seat stayed open, and the fill in covered one rival more:
 * a bound rose by one under every team the paid pick had just passed.
 *
 * Groups A to D read a bound only up to 12 above the points slots, and every
 * one of those rises sat 14 or more above them on the real walks. So this
 * group reads the 32 one event walks again with EVERY bound exact, and by
 * hand builds the one championship where the rise does sit on a Locked team.
 *
 * `paidRuleOff` hands `confirmedPicks` "TBA paid nobody", which is the status
 * code of before the rule.
 */
const EXACT = Infinity;
/** The one event walks where the tick raised a bound before the rule (the planner's exact reading of all 32). */
const PAID_PICK_DISTRICTS = ["2024fnc", "2025fin", "2026ca", "2026fnc"] as const;

describe("GROUP E, the paid pick rule on the live walks: the tick a key's playoff points land, with EVERY bound read exactly (quick task 261010-l0s, finding F2)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  const missing = [...MISSING_SINGLE, ...(LOCAL_DISTRICT_FILES.includes(TWO_CHAMPIONSHIP_FILE) ? [] : [TWO_CHAMPIONSHIP_DISTRICT])];
  if (missing.length > 0) {
    localDataAbsent(`${missing.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it(
    "the 32 one event walks, rules on, every bound exact: no pool team's bound is higher after any walked edge than before it, no held team is lost and no margin drops",
    () => {
      const tally = newTally();
      for (const [districtKey, variant] of ONE_EVENT_WALKS) {
        const result = microWalk(districtKey, variant, "on", EXACT);
        for (const part of [result.walk, result.winnerFirst, result.awardsFirst, result.lateRows]) addTally(tally, part);
      }
      console.log(`[261010-l0s group E, one event walks read exactly] ${tallyLine(tally)} | team bounds compared ${String(tally.boundComparisons)}, higher ${String(tally.boundRises)}`);
      // THE REQUIREMENT. A bound that rose with the rules on is a finding, never a pin to move.
      expectMonotone("the 32 one event walks read exactly", tally);
      // Not vacuous. Pinned as the run shows.
      expect({ readings: tally.readings, edges: tally.edges.step + tally.edges.flag, compared: tally.boundComparisons }).toEqual({ readings: 1079, edges: 991, compared: 84_991 });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "the paid pick rule switched OFF, every bound exact: bounds rise again at the tick the playoff points land, by district, pinned as the run shows",
    () => {
      // The walk and its further edges, as the rules on test above reads them (a paid pick rule off run walks both).
      const partsOf = (result: MicroResult): EdgeTally[] => [result.walk, result.winnerFirst, result.awardsFirst, result.lateRows];
      const rises: Record<string, number> = {};
      const onTheWalkItself: Record<string, number> = {};
      const lines: string[] = [];
      let lost = 0;
      let edgesWithARise = 0;
      let largestRise = 0;
      for (const districtKey of PAID_PICK_DISTRICTS) {
        const result = microWalk(districtKey, "oneEvent", "paidRuleOff", EXACT);
        onTheWalkItself[districtKey] = result.walk.boundRises;
        rises[districtKey] = 0;
        for (const part of partsOf(result)) {
          rises[districtKey] += part.boundRises;
          lost += part.lost.step + part.lost.flag;
          edgesWithARise += part.edgesWithADrop.step + part.edgesWithADrop.flag;
          largestRise = Math.max(largestRise, part.largestDrop);
        }
        lines.push(...result.walk.riseLines.slice(0, 2));
      }
      console.log(`[261010-l0s group E, paid pick rule OFF] bounds higher ${JSON.stringify(rises)}, of them on the walk itself ${JSON.stringify(onTheWalkItself)} | edges ${String(edgesWithARise)} | Locked lost ${String(lost)}\n${lines.map((line) => `  ${line}`).join("\n")}`);
      // IT PROVES SOMETHING: with the rule off the bounds rise. A measurement of the old reading, pinned as the run
      // shows, except that it must be above 0. No Locked team is lost on these walks (every rise sits well above its
      // points slots); the hand built championship below is where one is.
      const total = Object.values(rises).reduce((sum, count) => sum + count, 0);
      expect(total).toBeGreaterThan(0);
      // The planner of the quick task read these same 20, over these same 5 edges, on the code of before the rule.
      expect({ rises, onTheWalkItself, total, edgesWithARise, lost, largestRise }).toEqual({
        rises: { "2024fnc": 1, "2025fin": 2, "2026ca": 16, "2026fnc": 1 },
        onTheWalkItself: { "2024fnc": 1, "2025fin": 2, "2026ca": 8, "2026fnc": 1 },
        total: 20,
        edgesWithARise: 5,
        lost: 0,
        largestRise: 1,
      });
      // The same four walks with the rule ON read none, on the walk and on its further edges (the test above read all 32).
      for (const districtKey of PAID_PICK_DISTRICTS) for (const part of partsOf(microWalk(districtKey, "oneEvent", "on", EXACT))) expect(part.boundRises, districtKey).toBe(0);
    },
    TEST_TIMEOUT_MS
  );
});

/** The committed 2026 PNW artifact (`data/fixtures/phase10`): a finished single championship, in the repository, so the group below needs no local data. */
const PNW_FIXTURE_FILE = join(REPO_ROOT, "data", "fixtures", "phase10", "district-2026pnw.json");

describe("GROUP E by hand, on the committed 2026 PNW fixture: the tick takes a Locked back with the paid pick rule off, and keeps it with the rule on (quick task 261010-l0s, finding F2)", () => {
  const DCMP_KEY = "2026pncmp";
  /** A pool team with a championship row that no alliance picked: listed here as the winner's fourth, paid 60 by TBA. */
  const FOURTH = "frc492";
  const PAID = 60;
  /** The team whose Locked rests on the joint proof alone at this position. */
  const HELD = "frc6696";
  const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };

  const read = (mode: RuleMode, playoffPointsLanded: boolean): ChampLedgerStatusModel =>
    underRules(mode, () => {
      const fixture = DistrictArtifactSchema.parse(JSON.parse(readFileSync(PNW_FIXTURE_FILE, "utf8")));
      // The window between the playoff points and the awards: no Winner listed yet, and the fourth paid for the
      // winner's playoffs. With the Playoffs open at the position those points are in no floor.
      const artifact: DistrictArtifact = DistrictArtifactSchema.parse({
        ...fixture,
        teams: fixture.teams.map((team) => {
          const noWinner = { ...team, qualifyingAwards: team.qualifyingAwards.filter((award) => !(award.eventKey === DCMP_KEY && award.awardType === 1)) };
          if (team.teamKey !== FOURTH) return noWinner;
          return { ...noWinner, pointTotal: team.pointTotal + PAID, eventPoints: team.eventPoints.map((row) => (row.eventKey === DCMP_KEY ? { ...row, elim: row.elim + PAID, total: row.total + PAID } : row)) };
        }),
      });
      // The eight alliances, rebuilt from the fixture's own alliance selection points, and the winner listing the fourth.
      const picks = new Map<number, string[]>();
      for (const team of fixture.teams) {
        const row = team.eventPoints.find((entry) => entry.eventKey === DCMP_KEY);
        if (row === undefined || row.alliance <= 0) continue;
        const base = row.alliance / 3;
        const allianceNumber = base >= 9 ? 17 - base : base;
        const list = picks.get(allianceNumber) ?? [];
        if (base >= 9) list.unshift(team.teamKey);
        else list.push(team.teamKey);
        picks.set(allianceNumber, list);
      }
      const alliances = [...picks.entries()].sort((a, b) => a[0] - b[0]).map(([allianceNumber, list]) => ({ allianceNumber, picks: allianceNumber === 1 ? [...list, FOURTH] : list }));
      // The whole bracket played, as the fixture's own placements have it: alliance 1 won, 5 second, 3 third, 2 fourth.
      const upper = [1, 5, 2, 3, 4, 6, 1, 3, 5, 2, 1, 5, 5];
      const playedMatches: PlayedBracketMatch[] = [
        ...upper.map((winningAllianceNumber, index) => ({ compLevel: "sf" as const, setNumber: index + 1, matchNumber: 1, winningAllianceNumber })),
        ...[1, 2].map((matchNumber) => ({ compLevel: "f" as const, setNumber: 1, matchNumber, winningAllianceNumber: 1 })),
      ];
      const stage: DistrictStageFinality = { qual: true, alliance: true, elim: playoffPointsLanded, award: false };
      const eventKeys = new Set<string>();
      for (const team of artifact.teams) {
        for (const row of team.eventPoints) eventKeys.add(row.eventKey);
        for (const row of team.remainingEvents) eventKeys.add(row.eventKey);
      }
      const stageByEvent = new Map([...eventKeys].map((key) => [key, key === DCMP_KEY ? stage : ALL_FINAL] as const));
      const facts = dcmpBracketFactsFor({ eventKey: DCMP_KEY, season: 2026, tier: "dcmp", stage, alliances, playedMatches, unresolvedMatchCount: 0 });
      if (facts === undefined) throw new Error("no bracket facts for the hand built championship");
      const distributions = new Map<string, DistrictEventDistributions>([[DCMP_KEY, { eventKey: DCMP_KEY, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, playedMatches), dcmpBracket: facts }]]);
      const rows = buildChampLedgerRows({ artifact, distributions, stageByEvent, dcmpStarted: true });
      return computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026, distributions });
    });
  const view = (model: ChampLedgerStatusModel) => {
    if (model.jointProof?.applied !== true || model.jointProof.shape !== "single") throw new Error("the joint proof did not run on the hand built championship");
    const { input } = model.jointProof;
    const winner = input.alliances.find((alliance) => alliance.allianceNumber === 1)!;
    return {
      status: model.byTeam.get(HELD)?.status,
      lockedBy: model.byTeam.get(HELD)?.lockedBy,
      bound: jointLockBound(input, HELD),
      pointsSlots: input.pointsSlots,
      winnerMembers: winner.members.length,
      winnerSpareSeats: winner.spareSeats,
      fourthIsAMember: winner.members.includes(FOURTH),
    };
  };

  it("rules on: Locked before the tick and Locked after it, the paid pick the winner's fourth member and its seat closed", () => {
    expect(view(read("on", false))).toEqual({ status: "locked", lockedBy: "joint", bound: 20, pointsSlots: 21, winnerMembers: 3, winnerSpareSeats: 1, fourthIsAMember: false });
    expect(view(read("on", true))).toEqual({ status: "locked", lockedBy: "joint", bound: 20, pointsSlots: 21, winnerMembers: 4, winnerSpareSeats: 0, fourthIsAMember: true });
  });

  it("the paid pick rule switched OFF: the same tick, read by the status code itself, takes the Locked back (the bound reads 21 of 21 points slots)", () => {
    // Before the tick the switch changes nothing: nobody is paid while the Playoffs are open at the position.
    expect(view(read("paidRuleOff", false))).toEqual(view(read("on", false)));
    const after = view(read("paidRuleOff", true));
    expect({ bound: after.bound, pointsSlots: after.pointsSlots, winnerMembers: after.winnerMembers, winnerSpareSeats: after.winnerSpareSeats, fourthIsAMember: after.fourthIsAMember }).toEqual({
      bound: 21,
      pointsSlots: 21,
      winnerMembers: 3,
      winnerSpareSeats: 1,
      fourthIsAMember: false,
    });
    // THE TAKE BACK: shown Locked a tick earlier, and no longer.
    expect(after.status).not.toBe("locked");
  });
});

// ---------------------------------------------------------------------------
// NO BOUND RISES, Locked or not (quick task 261010-l0s)
// ---------------------------------------------------------------------------

describe("EVERY RULES ON EDGE OF THIS FILE: no pool team's joint bound is higher after an edge than before it, Locked or not (quick task 261010-l0s)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  const missing = [...MISSING_DIVISIONED, ...MISSING_SINGLE, ...(LOCAL_DISTRICT_FILES.includes(TWO_CHAMPIONSHIP_FILE) ? [] : [TWO_CHAMPIONSHIP_DISTRICT])];
  if (missing.length > 0) {
    localDataAbsent(`${missing.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it(
    "over every flag edge, stop edge and step edge of groups A to D with the rules on, bounds compared and none higher, the counts pinned as the run shows",
    () => {
      // Every tally below is the one its own group already built and asserted on (they are cached): this test adds
      // no reading. It names the property on its own and holds how much was compared.
      const walks = microTotals([...ONE_EVENT_WALKS, ...twoDivisionWalks("finalsOnNoRow"), ...twoDivisionWalks("finalsRegistered"), [MICRO_FIM, "finalsOnNoRow"], [MICRO_FIM, "finalsRegistered"]], "on");
      const tallies: Record<string, EdgeTally> = {
        "A, the awards order lattice": latticeTotals("on").tally,
        "B, two division championships out of step": outOfStepTotals(TWO_DIVISION, true, "on").tally,
        "B, the FIM seasons out of step": outOfStepTotals(FOUR_DIVISION, false, "on").tally,
        "C, one championship finishing first": oneFinishingFirst("on").tally,
        "C, the awards lattice of two championships": twoChampionshipLattice("on").tally,
        "D, the live walks": walks.walk,
        "D, the Winner before the playoff points": walks.winnerFirst,
        "D, award points before playoff points": walks.awardsFirst,
        "D, the last key's rows arriving mid playoffs": walks.lateRows,
      };
      const compared = Object.fromEntries(Object.entries(tallies).map(([label, tally]) => [label, tally.boundComparisons]));
      const total = Object.values(compared).reduce((sum, count) => sum + count, 0);
      console.log(`[261010-l0s no bound rises] ${Object.entries(tallies).map(([label, tally]) => `${label}: ${String(tally.boundComparisons)} compared, ${String(tally.boundRises)} higher`).join(" | ")} | in all ${String(total)}`);
      // THE REQUIREMENT. A bound that rose with the rules on is a finding, never a pin to move.
      expect(Object.fromEntries(Object.entries(tallies).map(([label, tally]) => [label, { higher: tally.boundRises, lines: tally.riseLines }]))).toEqual(
        Object.fromEntries(Object.keys(tallies).map((label) => [label, { higher: 0, lines: [] }]))
      );
      // Not vacuous: how many team bounds were compared, pinned as the run shows.
      expect({ ...compared, total }).toEqual({
        "A, the awards order lattice": 1_253_848,
        "B, two division championships out of step": 63_616,
        "B, the FIM seasons out of step": 130_048,
        "C, one championship finishing first": 10_990,
        "C, the awards lattice of two championships": 570,
        "D, the live walks": 979_948,
        "D, the Winner before the playoff points": 88_361,
        "D, award points before playoff points": 24_368,
        "D, the last key's rows arriving mid playoffs": 160_686,
        total: 2_712_435,
      });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "2024 NE, the awards order lattice with EVERY bound read exactly: a team's own division award no longer raises its own bound (frc9710, at nine edges before quick task 261010-l0s), and no bound is higher over any edge",
    () => {
      // THE ONE REAL CHAMPIONSHIP WHERE THE DEFECT OF THAT TASK SHOWS, and only above this file's own reading:
      // frc9710, 85 above its points slots at "Alliances final". Its floor rises from 66 to 81 as necmp2's Awards
      // turn final (its own judged award), which carries it past rivals the old proof then counted twice. At each of
      // the nine stops, over the edge from no division's Awards final to necmp2's, its bound read one higher (116
      // then 117 at "Alliances final", 87 then 88 at "Finals awards final"). With every rival counted once: none.
      const { tally } = awardsOrderLattice("2024ne", "on", "whole", Infinity);
      console.log(`[261010-l0s 2024 NE read exactly] readings ${String(tally.readings)} | flag edges ${String(tally.edges.flag)}, stop edges ${String(tally.edges.stop)} | team bounds compared ${String(tally.boundComparisons)}, higher ${String(tally.boundRises)}`);
      expect({ higher: tally.boundRises, lines: tally.riseLines }).toEqual({ higher: 0, lines: [] });
      // Pinned as the run shows.
      expect({ readings: tally.readings, flagEdges: tally.edges.flag, stopEdges: tally.edges.stop, compared: tally.boundComparisons }).toEqual({ readings: 36, flagEdges: 36, stopEdges: 32, compared: 11_761 });
    },
    TEST_TIMEOUT_MS
  );
});
