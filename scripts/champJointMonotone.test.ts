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
 *   - a FLAG EDGE: one more division's Awards read final;
 *   - a STOP EDGE: the same flags, one stop of the sweep further on.
 *
 * Every order in which the facts can arrive is a path of edges, so checking
 * every edge covers every order. Over each edge two things must hold:
 *
 *   1. NO HELD TEAM IS LOST: a team shown Locked (or prequalified) before the
 *      edge is shown Locked (or prequalified) after it. This is read off the
 *      tab's own status code (`computeChampLedgerStatuses`), ceiling test and
 *      joint proof together.
 *   2. NO MARGIN DROPS: where the joint proof is applied on both sides, no
 *      pool team's margin (the points slots minus its joint bound) is smaller
 *      after the edge. A margin that drops is a bound that rose, which is the
 *      mechanism of a take back whether or not a Locked team sits on it yet.
 *
 * THE BOUNDS ARE READ EXACTLY UP TO 12 ABOVE THE POINTS SLOTS (planner reading
 * R8): `jointLockBound` is asked with that stop and the answer capped there.
 * A bound that high locks nobody on either side of an edge, so two bounds at
 * or above the cap read as equal. The figure is a cost limit, not a tolerance:
 * it is never widened or narrowed to make a test pass.
 *
 * THE GROUPS OF THIS FILE:
 *   A. THE AWARDS ORDER TEST. Every divisioned championship of 2023 to 2026,
 *      every stop of the joint sweep but Now, every subset of its divisions
 *      read with Awards final (the season's real posted award points) and the
 *      others with Awards open. Every flag edge and every stop edge.
 *   B. DIVISIONS OUT OF STEP. Some divisions (the set AHEAD) have finished
 *      their playoffs, every one of their rows played, while the others stand
 *      at a sweep stop before "Divisions final". Every subset of the ahead
 *      divisions is read with its Awards final. For the two division
 *      championships every ahead set is read; for the four FIM seasons one
 *      division ahead at a time, each of the four in turn (every ahead set
 *      there costs about 280 seconds a season; the planner of this task ran
 *      it once and read no Locked lost and no margin drop).
 *
 * IT PROVES SOMETHING. Each group also runs with its rule switched off inside
 * this file and must then LOSE Locked teams. The switch is one module mock of
 * the core proof (`packages/core/districts/champJointLock.ts`), the module the
 * status code itself imports: while `awardedRuleOff` is set every input is
 * handed to the proof without its `awardedRivals`, which is the proof of
 * before quick task 261010-d7r (a rival that already holds a posted award may
 * be given a second judged award). The Locked teams lost in those runs are
 * read off the status code's own verdicts, so they show the mock reaches the
 * import the tab uses. The switched off totals are PINNED AS THE RUN SHOWS:
 * they are a measurement of the old reading, not a requirement, except that
 * they must be above 0.
 *
 * A RULES ON FAILURE IS A FINDING, never a pin to move: a Locked lost or a
 * margin dropped with the rules on means the proof took a guarantee back.
 * Stop and report the edge, the team and both bounds.
 *
 * EVERY GROUP READS GITIGNORED LOCAL DATA (`data/local-publish/districts` and
 * `data/corpus.sqlite`, opened read only) and skips, with a message naming
 * what is absent, where the data is not there. With `REQUIRE_LOCAL_DATA=1` in
 * the environment the same group FAILS instead, so a verify step cannot pass
 * on a machine that silently ran nothing. No network, no credential.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import { championshipShape } from "../packages/core/districts/finalsBracket.js";
import { jointLockBound, jointLockBoundMultiple } from "../packages/core/districts/champJointLock.js";
import type { BracketSourceEvent, DistrictStageFinality } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import type { ChampLedgerStatusModel } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { CORPUS_PATH, LOCAL_DISTRICT_DIR, bracketsFromCorpus, championshipStops, statusesAtChampionshipStop, type ChampionshipStop } from "./measureChampJointLocks.js";

/**
 * THE SWITCHES. The row builders and the status code run as shipped; only the
 * core proof is handed a different input while a switch is set.
 *
 * While `awardedRuleOff` is set the proof never learns which rivals already
 * hold a posted award: every input reaches it without `awardedRivals`.
 */
const ruleSwitch = vi.hoisted(() => ({ awardedRuleOff: false }));

vi.mock("../packages/core/districts/champJointLock.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/champJointLock.js")>();
  type Input = Parameters<typeof original.jointLockBoundAt>[0];
  /** The input the proof is handed: as given, or without the awarded rivals while that rule is switched off. */
  const handed = (input: Input): Input => {
    if (!ruleSwitch.awardedRuleOff || input.awardedRivals === undefined) return input;
    return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "awardedRivals")) as unknown as Input;
  };
  return {
    ...original,
    jointLockedTeams: (input: Input) => original.jointLockedTeams(handed(input)),
    jointLockBound: (input: Input, teamKey: string, stopAt?: number) => original.jointLockBound(handed(input), teamKey, stopAt),
    jointLockBoundAt: (input: Input, teamKey: string, floor: number, stopAt?: number) => original.jointLockBoundAt(handed(input), teamKey, floor, stopAt),
    jointLockedTeamsMultiple: (championships: readonly Input[], pointsSlots: number) => original.jointLockedTeamsMultiple(championships.map(handed), pointsSlots),
    jointLockBoundMultiple: (championships: readonly Input[], teamKey: string, stopAt?: number) => original.jointLockBoundMultiple(championships.map(handed), teamKey, stopAt),
  };
});

afterEach(() => {
  ruleSwitch.awardedRuleOff = false;
});

/** Which rules a run has on. `"on"` is the shipped proof. */
type RuleMode = "on" | "awardedRuleOff";

/** Runs `body` under a rule mode, and switches every rule back on whatever happens. */
function underRules<T>(mode: RuleMode, body: () => T): T {
  ruleSwitch.awardedRuleOff = mode === "awardedRuleOff";
  try {
    return body();
  } finally {
    ruleSwitch.awardedRuleOff = false;
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

function readingOf(model: ChampLedgerStatusModel): Reading {
  const proof = model.jointProof;
  const held = new Set<string>();
  for (const result of model.byTeam.values()) if (result.status === "locked" || result.status === "prequalified") held.add(result.teamKey);
  const bound = new Map<string, number>();
  if (proof?.applied === true) {
    const cap = model.pointsSlots + BOUND_SLACK;
    if (proof.shape === "multiple") {
      const teamKeys = new Set(proof.championships.flatMap((input) => input.pool.map((rival) => rival.teamKey)));
      for (const teamKey of teamKeys) bound.set(teamKey, Math.min(cap, jointLockBoundMultiple(proof.championships, teamKey, cap)));
    } else {
      for (const rival of proof.input.pool) bound.set(rival.teamKey, Math.min(cap, jointLockBound(proof.input, rival.teamKey, cap)));
    }
  }
  return { joint: proof?.applied === true ? "applied" : (proof?.reason ?? "no proof"), pointsSlots: model.pointsSlots, held, model, bound };
}

type EdgeKind = "flag" | "stop";

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
  /** Edges over which the proof went from applied to not applied. */
  appliedThenRefused: number;
  /** The first lines of each finding, for the failure message and the log. */
  readonly lostLines: string[];
  readonly dropLines: string[];
  /** The distinct teams lost. */
  readonly lostTeams: Set<string>;
}

function newTally(): EdgeTally {
  return {
    readings: 0,
    joint: {},
    edges: { flag: 0, stop: 0 },
    lost: { flag: 0, stop: 0 },
    edgesWithADrop: { flag: 0, stop: 0 },
    marginDrops: 0,
    largestDrop: 0,
    appliedThenRefused: 0,
    lostLines: [],
    dropLines: [],
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
  for (const kind of ["flag", "stop"] as const) {
    into.edges[kind] += from.edges[kind];
    into.lost[kind] += from.lost[kind];
    into.edgesWithADrop[kind] += from.edgesWithADrop[kind];
  }
  into.marginDrops += from.marginDrops;
  into.largestDrop = Math.max(into.largestDrop, from.largestDrop);
  into.appliedThenRefused += from.appliedThenRefused;
  for (const line of from.lostLines) if (into.lostLines.length < LINES_KEPT) into.lostLines.push(line);
  for (const line of from.dropLines) if (into.dropLines.length < LINES_KEPT) into.dropLines.push(line);
}

/** The assertion of a rules on run: nothing lost, nothing dropped, with the findings in the message. */
function expectMonotone(label: string, tally: EdgeTally): void {
  const findings = [...tally.lostLines, ...tally.dropLines];
  expect(
    { label, lostOverFlagEdges: tally.lost.flag, lostOverStopEdges: tally.lost.stop, marginDrops: tally.marginDrops, findings },
    `${label}: a Locked team was lost or a margin dropped with the rules ON. This is a finding, never a pin to move.`
  ).toEqual({ label, lostOverFlagEdges: 0, lostOverStopEdges: 0, marginDrops: 0, findings: [] });
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
 */
function awardsOrderLattice(districtKey: string, mode: RuleMode): LatticeResult {
  const cacheKey = `${districtKey}|${mode}`;
  const cached = latticeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = underRules(mode, (): LatticeResult => {
    const { artifact, divisionKeys, brackets } = divisionedChampionship(districtKey);
    const divisionCount = divisionKeys.length;
    const masks = Array.from({ length: 1 << divisionCount }, (_, mask) => mask);
    const stops: ChampionshipStop[] = championshipStops(artifact, brackets).filter((stop) => !stop.atNow);
    const tally = newTally();
    const read = (stop: ChampionshipStop, mask: number): Reading => {
      const stageByKey = new Map(stop.stageByKey);
      divisionKeys.forEach((key, index) => {
        const base = stop.stageByKey.get(key);
        if (base === undefined) throw new Error(`${districtKey} "${stop.label}" carries no stage for ${key}`);
        stageByKey.set(key, { ...base, award: (mask & (1 << index)) !== 0 });
      });
      return countReading(tally, readingOf(statusesAtChampionshipStop(artifact, { ...stop, stageByKey }, brackets, true)));
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

function latticeTotals(mode: RuleMode): { stops: number; tally: EdgeTally; lostByDistrict: Record<string, number> } {
  const tally = newTally();
  const lostByDistrict: Record<string, number> = {};
  let stops = 0;
  for (const districtKey of DIVISIONED) {
    const result = awardsOrderLattice(districtKey, mode);
    stops += result.stops;
    addTally(tally, result.tally);
    for (const teamKey of result.tally.lostTeams) tally.lostTeams.add(`${districtKey} ${teamKey}`);
    lostByDistrict[districtKey] = result.tally.lost.flag + result.tally.lost.stop;
  }
  return { stops, tally, lostByDistrict };
}

describe("GROUP A, the awards order test: the 16 divisioned championships of 2023 to 2026, every sweep stop, every subset of divisions read with Awards final (quick task 261010-d7r, D3)", () => {
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
        // Every reading has the proof applied: each of these stops is one the sweep runs it at.
        expect(tally.joint).toEqual({ applied: tally.readings });
      },
      TEST_TIMEOUT_MS
    );
  }

  it(
    "the whole lattice, rules on: nothing lost and nothing dropped, counts pinned as the run shows",
    () => {
      const { stops, tally } = latticeTotals("on");
      console.log(
        `[261010-d7r group A, rules on] championships ${String(DIVISIONED.length)} | stops ${String(stops)} | readings ${String(tally.readings)} (${JSON.stringify(tally.joint)}) | flag edges ${String(tally.edges.flag)} | stop edges ${String(tally.edges.stop)} | Locked lost ${String(tally.lost.flag + tally.lost.stop)} | margin drops ${String(tally.marginDrops)}`
      );
      expectMonotone("every divisioned championship", tally);
      expect({ championships: DIVISIONED.length, stops, readings: tally.readings, flagEdges: tally.edges.flag, stopEdges: tally.edges.stop, appliedThenRefused: tally.appliedThenRefused }).toEqual({
        championships: 16,
        stops: 140,
        readings: 1088,
        flagEdges: 1792,
        stopEdges: 976,
        appliedThenRefused: 0,
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
        readings: 1088,
        lostOverFlagEdges: 924,
        lostOverStopEdges: 0,
        distinctPairsLost: 148,
        flagEdgesWithADrop: 1640,
        stopEdgesWithADrop: 0,
        teamMarginsDropped: 29_359,
        largestDrop: 4,
      });
      expect(lostByDistrict).toEqual({
        "2023fim": 118,
        "2023fit": 4,
        "2023ne": 2,
        "2023ont": 10,
        "2024fim": 223,
        "2024fit": 4,
        "2024ne": 6,
        "2024ont": 9,
        "2025fim": 213,
        "2025fit": 9,
        "2025ne": 0,
        "2025ont": 15,
        "2026fim": 285,
        "2026fit": 13,
        "2026ne": 10,
        "2026ont": 3,
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
      expect({ readings: tally.readings, lostOverFlagEdges: tally.lost.flag, lostOverStopEdges: tally.lost.stop, marginDrops: tally.marginDrops, largestDrop: tally.largestDrop }).toEqual({
        readings: 288,
        lostOverFlagEdges: 49,
        lostOverStopEdges: 0,
        marginDrops: 772,
        largestDrop: 3,
      });
    },
    TEST_TIMEOUT_MS
  );
});
