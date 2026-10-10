/**
 * The staged LIVE walk of a District Championship whose rows arrive one event
 * at a time, through the shared merge and the Champ Locks tab's own code
 * (quick task 261010-66y).
 *
 * THE RULE, Jacob's: "it is mission critical that no team is told they are
 * locked at any stop, and then later they are not locked. but also once a
 * team is locked, we should know it as soon as we can."
 *
 * THE GAP this file holds closed. A district artifact carries no event list:
 * it learns a championship key only from team rows. So when TBA posts one
 * division, or one of two championships, before the others, every key the
 * artifact knows has started while most of the field is on no row. Before
 * this task every team of the unposted events read OUT of the field, lost its
 * whole championship ceiling, and a team of the posted event read Locked
 * until the other rows landed. A team with no row now reads out only once the
 * field is PROVEN (`packages/core/districts/dcmpFieldProof.ts`).
 *
 * WHAT IS WALKED. A source artifact (a finished season, or a synthetic one)
 * is rewound to before its championship: every dcmp row, its points and its
 * dcmp awards are removed. Then, as the live Worker would write it:
 *
 *   - no dcmp row;
 *   - per field fixing key, "rows posted" (the rows arrive with NO state
 *     block, because the Worker drops the state of an event the artifact it
 *     read carried no row for) and then "state written";
 *   - qualification done everywhere;
 *   - alliances picked, no alliance points;
 *   - alliance points land;
 *   - playoffs done, no playoff points;
 *   - playoff points land;
 *   - the source artifact itself.
 *
 * A rows tick goes through `applyDistrictRankings` and a state tick through
 * `applyDistrictEventState`, the two entry points the live Worker calls. The
 * state of an event is handed only once the artifact already carries a row
 * for it. After each tick the Champ Locks tab is read at Now with
 * `buildChampLedgerRows` and `computeChampLedgerStatuses`, the rows' own
 * `fieldProven` handed on as the tab hands it, and the District Locks tab
 * with `computeDistrictLedgerStatuses` and its Live field overlay
 * (`applyChampionshipFieldOverlay`).
 *
 * THE SECOND WALK: THE POINTS ARRIVE ONLY AS EACH EVENT ENDS. When TBA posts
 * district points during an event is not verified, so the other case is
 * walked too. Some of the field fixing keys start wholly final, as published
 * (none of them, or the first one, two and so on), and the others are on no
 * row. Then each further key's rows post with every point they end on and
 * no state block, then its state is written with its playoffs done and its
 * awards flag not yet true, and last comes the source artifact. This is the
 * walk in which teams read Locked while most of the field is on no row, so
 * it is the one that shows whether a team with no row carries enough.
 *
 * THE GROUPS OF THIS FILE:
 *   1. a synthetic championship in four divisions, built from the committed
 *      2026 PNW fixture. Always on.
 *   2. the Now census: every local district artifact reads at Now what it
 *      read before this task.
 *   3. the subset test: with any proper subset of an artifact's field fixing
 *      keys on its rows, the field reads NOT proven.
 *   4. the real walks of 2026 FIM, NE, ONT, TX and CA.
 *   5. the same five with the points arriving only as each event ends: the
 *      states with part of the field wholly final and the rest on no row,
 *      and the walk on from each of them.
 *   6. the PUBLISHED verdicts (`champLock` and `maxRemainingChamp` on the
 *      artifact itself) walked through the finals: two synthetic
 *      championships, always on, and 2026 FIM, NE, ONT, TX, CA and PNW from
 *      both starts (no dcmp row first, and every attending team registered
 *      first).
 *   7. the convention the finals reading rests on: a points paying award at a
 *      finals event is a consuming award, and a team whose only championship
 *      row is the finals row earned nothing else there.
 * Groups 2 to 5, the real walks of group 6 and group 7 read gitignored local
 * data.
 *
 * THE FINALS TICKS (group 6). After the playoff points land the finals rows
 * post with their Playoffs points and no state, then the finals' state is
 * written with its playoffs done, then the finals' award points land while
 * the awards flag is not yet true. The Champ Locks tab's own series is
 * recorded at those ticks and NOT asserted there yet: its ceiling test reads
 * the finals differently for a team with a finals row and a team without
 * one, which the last step of this quick task closes.
 *
 * IT PROVES SOMETHING. The same walk runs with the rule switched off inside
 * this file (the core proof answering as the code read the field before this
 * task, through a module mock, everything else left on) and must then take a
 * Locked back. The second walk also runs with the finals part of a rowless
 * team's hypothetical championship switched off
 * (`hypotheticalFinalsCeiling`), and the published walks with a
 * championship's stateless first rows read as hindsight again
 * (`statelessChampionshipRowReadsOpen`). The switched off totals are PINNED
 * AS THE RUN SHOWS: they are a measurement of the old reading, not a
 * requirement.
 *
 * A GROUP THAT READS GITIGNORED LOCAL DATA skips, with a message naming what
 * is absent, where the data is not there. With `REQUIRE_LOCAL_DATA=1` in the
 * environment the same group FAILS instead, so a verify step cannot pass on a
 * machine that silently ran nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDistrictEventState, applyDistrictRankings, recomputeDistrictVerdicts } from "../packages/harness/districtRankingsMerge.js";
import { DistrictArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../packages/harness/pageArtifacts.js";
import { maxEventPoints } from "../packages/core/districts/pointModel.js";
import { fieldFixingDcmpKeys } from "../packages/core/districts/dcmpFieldProof.js";
import { finalsChampionMaximum } from "../packages/core/districts/categoryCorroboration.js";
import { championshipShape } from "../packages/core/districts/finalsBracket.js";
import { buildDistrictLedgerRows, deriveStageFromState, tierEvents, type DistrictEventDistributions } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { applyChampionshipFieldOverlay } from "../apps/web/src/components/districts/districtFieldOverlay.js";
import { buildChampLedgerRows, champFieldProofAtNow, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { LOCAL_DISTRICT_DIR } from "./measureChampJointLocks.js";

/**
 * THE SWITCHES. The merge, the row builders and the status code all run as
 * shipped; only the core rule named is answered differently.
 *
 * While `fieldRuleOff` is set the core proof answers as the code read the
 * field before this task: proven as soon as every field fixing key the
 * artifact knows has started, and never "unproven after a start".
 *
 * While `finalsAllowanceOff` is set a team with no championship row carries
 * one whole hypothetical championship and no finals on top, while the field
 * is not proven.
 *
 * While `statelessRowsOff` is set the published verdict pass reads a
 * championship row with no state block as a hindsight row on every path, as
 * it did before this task.
 */
const ruleSwitch = vi.hoisted(() => ({ fieldRuleOff: false, finalsAllowanceOff: false, statelessRowsOff: false }));

vi.mock("../packages/core/districts/dcmpFieldProof.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/dcmpFieldProof.js")>();
  return {
    ...original,
    dcmpFieldProof: (...args: Parameters<typeof original.dcmpFieldProof>) => {
      const real = original.dcmpFieldProof(...args);
      if (!ruleSwitch.fieldRuleOff) return real;
      return { ...real, proven: real.started, completeBy: real.started ? ("capacity" as const) : null, unprovenAfterStart: false };
    },
    hypotheticalFinalsCeiling: (...args: Parameters<typeof original.hypotheticalFinalsCeiling>) => (ruleSwitch.finalsAllowanceOff ? 0 : original.hypotheticalFinalsCeiling(...args)),
    statelessChampionshipRowReadsOpen: (...args: Parameters<typeof original.statelessChampionshipRowReadsOpen>) => (ruleSwitch.statelessRowsOff ? false : original.statelessChampionshipRowReadsOpen(...args)),
  };
});

afterEach(() => {
  ruleSwitch.fieldRuleOff = false;
  ruleSwitch.finalsAllowanceOff = false;
  ruleSwitch.statelessRowsOff = false;
});

/** Runs `body` with a championship's stateless first rows read as hindsight again, and switches the rule back on whatever happens. */
function withStatelessRowsOff<T>(body: () => T): T {
  ruleSwitch.statelessRowsOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.statelessRowsOff = false;
  }
}

/** Runs `body` with the field rule switched off, and switches it back on whatever happens. */
function withFieldRuleOff<T>(body: () => T): T {
  ruleSwitch.fieldRuleOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.fieldRuleOff = false;
  }
}

/** Runs `body` with the finals part of the hypothetical championship switched off, and switches it back on whatever happens. */
function withFinalsAllowanceOff<T>(body: () => T): T {
  ruleSwitch.finalsAllowanceOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.finalsAllowanceOff = false;
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

type Team = DistrictArtifact["teams"][number];
type Row = Team["eventPoints"][number];

const NOW_YEAR = 2026;
const STAMP = { generation: "champ-field-walk", computedAt: "2026-04-18T00:00:00.000Z" } as const;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(REPO_ROOT, "data", "fixtures", "phase10");
const fixtureFile: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, "district-2026pnw.json"), "utf8")));

const QUAL_TOTAL = 60;
const FINISHED_STATE: DistrictEventState = { qualMatchesPlayed: QUAL_TOTAL, qualMatchesTotal: QUAL_TOTAL, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();

/** The fixture with a finished state block on every row, at the verdict pass's fixed point. */
const baseline: DistrictArtifact = recomputeDistrictVerdicts(
  DistrictArtifactSchema.parse({ ...fixtureFile, teams: fixtureFile.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => ({ ...row, state: { ...FINISHED_STATE } })) })) }),
  { nowYear: NOW_YEAR }
);

/** A tab status of `locked` covers Locked on points and Locked by an award. */
const champTabHeld = (status: string): boolean => status === "locked" || status === "prequalified";

// ---------------------------------------------------------------------------
// What one tick left behind
// ---------------------------------------------------------------------------

interface WalkStep {
  readonly label: string;
  /** The Champ Locks status of every team, from the tab's own status code at Now. */
  readonly champTab: ReadonlyMap<string, string>;
  /** The teams the Champ Locks tab reads Locked by an award (the winning alliance or a judged award). */
  readonly champByAward: ReadonlySet<string>;
  /** Every team's place in the field as the tab's row model reads it at Now. */
  readonly membership: ReadonlyMap<string, string>;
  /** The one flag the tab hands every reader of the field. */
  readonly fieldProven: boolean;
  /** The core proof's own `proven` at Now. */
  readonly proven: boolean;
  /** The champ tier reservation the Champ Locks status code computed. */
  readonly champReserved: number;
  /** How many dcmp keys the artifact knows at this tick. */
  readonly dcmpKeys: number;
  /** What the District Locks tab SHOWS for every team at Live: the raw status, or the field overlay's where it applies. */
  readonly districtTab: ReadonlyMap<string, string>;
  /** Whether the District Locks tab's Live field overlay applied at this tick. */
  readonly overlayActive: boolean;
  /** The PUBLISHED `champLock.status` of every team, on the artifact itself. */
  readonly published: ReadonlyMap<string, string>;
  /** The PUBLISHED `maxRemainingChamp` of every team. */
  readonly publishedCeiling: ReadonlyMap<string, number>;
  /** The teams the PUBLISHED district verdict reads eliminated: below the district cut line. */
  readonly publishedDistrictEliminated: ReadonlySet<string>;
}

interface Walk {
  readonly steps: readonly WalkStep[];
  /** The teams that end with a row at a field fixing key: the field. */
  readonly fieldTeams: ReadonlySet<string>;
  readonly fieldFixingKeys: readonly string[];
}

/** The dcmp keys the state says have started, as the tab reads them at Now. */
function startedDcmpKeys(artifact: DistrictArtifact): Set<string> {
  const started = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) if (deriveStageFromState(entry.state).started) started.add(entry.eventKey);
  return new Set(dcmpEventKeysFor(artifact).filter((key) => started.has(key)));
}

/** Reads the Champ Locks tab at Now, as `scripts/measureChampTenets.ts` reads it, with the rows' own field flag handed on. */
function snapshot(label: string, artifact: DistrictArtifact): WalkStep {
  const districtRows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);

  // The District Locks tab at Live: the raw statuses under the field overlay.
  const districtShown = applyChampionshipFieldOverlay(districtStatuses, artifact, { atLive: true, nowYear: NOW_YEAR });

  const started = startedDcmpKeys(artifact);
  const champRows = buildChampLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, startedDcmpEventKeys: started, atLivePosition: true, nowYear: NOW_YEAR });
  const champStatuses = computeChampLedgerStatuses({ artifact, teams: champRows.teams, districtLockedOut, nowYear: NOW_YEAR, fieldProven: champRows.fieldProven });

  return {
    label,
    champTab: new Map([...champStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    champByAward: new Set([...champStatuses.byTeam].filter(([, result]) => result.byAward).map(([teamKey]) => teamKey)),
    membership: new Map(champRows.teams.map((team) => [team.teamKey, team.membership] as const)),
    fieldProven: champRows.fieldProven,
    proven: champFieldProofAtNow(artifact, started, NOW_YEAR).proven,
    champReserved: champStatuses.reservedSlots,
    dcmpKeys: dcmpEventKeysFor(artifact).length,
    districtTab: new Map([...districtShown.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    overlayActive: districtShown.fieldOverlay,
    published: new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const)),
    publishedCeiling: new Map(artifact.teams.map((team) => [team.teamKey, team.maxRemainingChamp] as const)),
    publishedDistrictEliminated: new Set(artifact.teams.filter((team) => team.districtLock.status === "eliminated").map((team) => team.teamKey)),
  };
}

/** Every team that held a place at one step and did not at a later one, with both statuses and both steps named. */
function takeBacks(steps: readonly WalkStep[], series: (step: WalkStep) => ReadonlyMap<string, string>, held: (status: string) => boolean): string[] {
  const lost: string[] = [];
  for (const teamKey of series(steps[0]!).keys()) {
    let heldAt = -1;
    for (let index = 0; index < steps.length; index++) {
      const status = series(steps[index]!).get(teamKey) ?? "absent";
      if (held(status)) {
        if (heldAt === -1) heldAt = index;
      } else if (heldAt !== -1) {
        lost.push(`${teamKey} ${series(steps[heldAt]!).get(teamKey)!} at "${steps[heldAt]!.label}", ${status} at "${steps[index]!.label}"`);
        break;
      }
    }
  }
  return lost;
}

/** Every team of the field that the row model reads `out` at some tick, with the first such tick. */
function fieldTeamsReadOut(walk: Walk): string[] {
  const out: string[] = [];
  for (const teamKey of [...walk.fieldTeams].sort()) {
    const step = walk.steps.find((entry) => entry.membership.get(teamKey) === "out");
    if (step !== undefined) out.push(`${teamKey} out at "${step.label}"`);
  }
  return out;
}

/** Every team the row model reads `out` at one tick and `in` at a later one. */
function outThenIn(walk: Walk): string[] {
  const found: string[] = [];
  for (const teamKey of walk.steps[0]!.membership.keys()) {
    let wasOut = false;
    for (const step of walk.steps) {
      const membership = step.membership.get(teamKey);
      if (membership === "out") wasOut = true;
      else if (wasOut && membership === "in") {
        found.push(teamKey);
        break;
      }
    }
  }
  return found.sort();
}

/**
 * THE DISTRICT LOCKS TAB: every team of the field that the tab shows Locked at
 * one tick and Declined or Locked out at a later one, with both ticks named.
 * A team of the field earned or was given its place and is playing, so
 * either reading after Locked is a Locked taken back.
 */
function districtLockedThenLost(walk: Walk): string[] {
  const lost: string[] = [];
  for (const teamKey of [...walk.fieldTeams].sort()) {
    let lockedAt = -1;
    for (let index = 0; index < walk.steps.length; index++) {
      const status = walk.steps[index]!.districtTab.get(teamKey) ?? "absent";
      if (status === "locked") {
        if (lockedAt === -1) lockedAt = index;
      } else if (lockedAt !== -1 && (status === "declined" || status === "lockedOut")) {
        lost.push(`${teamKey} locked at "${walk.steps[lockedAt]!.label}", ${status} at "${walk.steps[index]!.label}"`);
        break;
      }
    }
  }
  return lost;
}

/** How many teams of the field the District Locks tab shows Locked, then Declined, then Locked again. */
function districtLockedDeclinedLocked(walk: Walk): number {
  let count = 0;
  for (const teamKey of walk.fieldTeams) {
    let phase = 0;
    for (const step of walk.steps) {
      const status = step.districtTab.get(teamKey);
      if (phase === 0 && status === "locked") phase = 1;
      else if (phase === 1 && status === "declined") phase = 2;
      else if (phase === 2 && status === "locked") {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** The labels of the ticks at which any team reads Declined while the core proof does not read proven. */
function declinedWhileUnproven(steps: readonly WalkStep[]): string[] {
  return steps.filter((step) => !step.proven && [...step.districtTab.values()].includes("declined")).map((step) => step.label);
}

/** A published champ verdict that holds a place. */
const publishedHeld = (status: string): boolean => status === "locked" || status === "lockedAward" || status === "prequalified";

/**
 * Every team whose published `maxRemainingChamp` DROPS at one tick and RISES
 * at a later one, with the rise named. A ceiling that only ever falls is the
 * season being played; one that falls and comes back is a ceiling the pass
 * took away too early.
 */
function publishedCeilingDropsThenRises(steps: readonly WalkStep[]): string[] {
  const found: string[] = [];
  for (const teamKey of steps[0]!.publishedCeiling.keys()) {
    let dropped = false;
    let previous = steps[0]!.publishedCeiling.get(teamKey)!;
    for (let index = 1; index < steps.length; index++) {
      const value = steps[index]!.publishedCeiling.get(teamKey) ?? previous;
      if (value < previous) dropped = true;
      else if (dropped && value > previous) {
        found.push(`${teamKey} ${String(previous)} to ${String(value)} at "${steps[index]!.label}"`);
        break;
      }
      previous = value;
    }
  }
  return found;
}

/** One published ceiling that rose at the tick after one at which the field read unproven after a start. */
interface UnprovenCeilingRise {
  readonly teamKey: string;
  readonly line: string;
  /** Whether the published district verdict read the team eliminated (below the district cut line) at the tick before. */
  readonly belowTheDistrictLine: boolean;
}

/**
 * Every team whose published `maxRemainingChamp` RISES at the tick after one
 * at which the field read unproven after a start. While the field is
 * unproven a team with no row carries what it will carry the moment its
 * rows land, so nothing should rise out of such a tick: not when a division's
 * rows land, not when its state does, not when the field proves.
 *
 * ONE STATED LIMIT REMAINS, and each rise says whether it is that one. A
 * team the district tier reads eliminated carries no hypothetical
 * championship, here and on the Champ Locks tab alike, and a few such teams
 * attend all the same (a place given up and handed down). Their ceiling goes
 * from nothing to a whole championship when their row lands.
 */
function publishedCeilingRisesWhileUnproven(steps: readonly WalkStep[]): UnprovenCeilingRise[] {
  const rises: UnprovenCeilingRise[] = [];
  for (let index = 1; index < steps.length; index++) {
    const before = steps[index - 1]!;
    if (before.fieldProven) continue;
    for (const [teamKey, value] of steps[index]!.publishedCeiling) {
      const previous = before.publishedCeiling.get(teamKey) ?? value;
      if (value > previous) {
        rises.push({ teamKey, line: `${teamKey} ${String(previous)} to ${String(value)} at "${steps[index]!.label}"`, belowTheDistrictLine: before.publishedDistrictEliminated.has(teamKey) });
      }
    }
  }
  return rises;
}

/** The rises that are NOT the stated limit: a team that could still attend, whose ceiling rose all the same. */
const unexplainedCeilingRises = (steps: readonly WalkStep[]): string[] => publishedCeilingRisesWhileUnproven(steps).filter((rise) => !rise.belowTheDistrictLine).map((rise) => rise.line);
/** How many teams below the district line attended all the same and gained their ceiling only when their row landed. */
const belowTheLineAttendees = (steps: readonly WalkStep[]): number => new Set(publishedCeilingRisesWhileUnproven(steps).filter((rise) => rise.belowTheDistrictLine).map((rise) => rise.teamKey)).size;

/** The labels of the ticks at which the Champ Locks reservation is above the tick before it. */
function reservationRises(steps: readonly WalkStep[]): string[] {
  const rises: string[] = [];
  for (let index = 1; index < steps.length; index++) {
    if (steps[index]!.champReserved > steps[index - 1]!.champReserved) rises.push(`${steps[index]!.label}: ${String(steps[index - 1]!.champReserved)} to ${String(steps[index]!.champReserved)}`);
  }
  return rises;
}

/** The labels of the ticks at which the core proof read proven after an earlier tick read it and a tick between did not: the D11 property. */
function provenTakenBack(steps: readonly WalkStep[]): string[] {
  const lost: string[] = [];
  let wasProven = false;
  for (const step of steps) {
    if (wasProven && !step.proven) lost.push(step.label);
    wasProven = wasProven || step.proven;
  }
  return lost;
}

// ---------------------------------------------------------------------------
// The walker: one source artifact rewound to before its championship
// ---------------------------------------------------------------------------

type PointsStage = "qual" | "alliance" | "elim" | "all";
type StatePhase = "started" | "qualDone" | "picked" | "done";

interface FieldWalkOptions {
  /**
   * The other start: every attending team carries a registration (a
   * `remainingEvents` row with no state) at its own field fixing key before
   * anything is played, as after an offline district publish that ran once
   * registrations were open. An event's state can then be written before its
   * rows post, and it is: one "started on the field" tick per key.
   */
  readonly registeredFirst?: boolean;
  /** Walk on through the finals: their rows with no state, their state, their award points. */
  readonly finalsTicks?: boolean;
}

const shortKey = (eventKey: string): string => eventKey.slice(4);

/**
 * Walks `source` from "no dcmp row" (or from every attending team
 * registered) to the source artifact itself, one field fixing key at a time,
 * through the two merge entry points.
 */
function walkChampionshipField(source: DistrictArtifact, options: FieldWalkOptions = {}): Walk {
  const dcmpKeys = dcmpEventKeysFor(source);
  const fieldFixingKeys = fieldFixingDcmpKeys(dcmpKeys);
  const finalsKeys = dcmpKeys.filter((key) => !fieldFixingKeys.includes(key));
  const dcmpMaxima = maxEventPoints(source.year, "dcmp");
  const dcmpEventMaxTotal = dcmpMaxima.qual + dcmpMaxima.alliance + dcmpMaxima.elim + dcmpMaxima.award;
  const finalRow = new Map<string, Map<string, Row>>(dcmpKeys.map((key) => [key, new Map<string, Row>()] as const));
  for (const team of source.teams) for (const row of team.eventPoints) if (row.tier === "dcmp") finalRow.get(row.eventKey)!.set(team.teamKey, row);
  const fieldTeams = new Set<string>();
  for (const key of fieldFixingKeys) for (const teamKey of finalRow.get(key)!.keys()) fieldTeams.add(teamKey);
  const dcmpTotal = (team: Team): number => team.eventPoints.filter((row) => row.tier === "dcmp").reduce((sum, row) => sum + row.total, 0);

  // Before the first tick: no dcmp row anywhere. Every championship row, its
  // points and the awards given there leave the artifact, and the verdict
  // pass is told a championship is still ahead, as the offline publisher's
  // calendar would tell it.
  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...source,
      teams: source.teams.map((team) => {
        const own = team.eventPoints.find((row) => fieldFixingKeys.includes(row.eventKey));
        const stripped = team.remainingEvents.filter((row) => row.tier !== "dcmp");
        return {
          ...team,
          pointTotal: team.pointTotal - dcmpTotal(team),
          eventPoints: team.eventPoints.filter((row) => row.tier !== "dcmp"),
          remainingEvents:
            options.registeredFirst === true && own !== undefined
              ? [...stripped, { eventKey: own.eventKey, eventName: own.eventName, week: own.week, tier: "dcmp" as const, maxPoints: dcmpEventMaxTotal }]
              : stripped,
          qualifyingAwards: team.qualifyingAwards.filter((award) => !dcmpKeys.includes(award.eventKey)),
        };
      }),
    }),
    { nowYear: NOW_YEAR, dcmpStillAhead: true }
  );

  // What TBA has posted so far, per key, and the state the match feed shows.
  const posted = new Map<string, PointsStage>();
  const states = new Map<string, DistrictEventState>();
  const pointsAt = (row: Row, stage: PointsStage) => ({
    qual: row.qual,
    alliance: stage === "qual" ? 0 : row.alliance,
    elim: stage === "elim" || stage === "all" ? row.elim : 0,
    award: stage === "all" ? row.award : 0,
  });

  /** A TBA shaped rankings payload: every district tier row as published, and the championship rows posted so far at the points they carry so far. */
  const payload = () =>
    source.teams.map((team) => {
      const others = team.eventPoints
        .filter((row) => row.tier !== "dcmp")
        .map((row) => ({ event_key: row.eventKey, district_cmp: false, qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: row.award, total: row.total }));
      let total = team.pointTotal - dcmpTotal(team);
      const championship: { event_key: string; district_cmp: boolean; qual_points: number; alliance_points: number; elim_points: number; award_points: number; total: number }[] = [];
      for (const [key, stage] of posted) {
        const row = finalRow.get(key)!.get(team.teamKey);
        if (row === undefined) continue;
        const points = pointsAt(row, stage);
        const sum = points.qual + points.alliance + points.elim + points.award;
        // TBA writes a finals row only for a team it pays there, so a finals
        // row with nothing to show yet has not been posted yet.
        if (sum === 0 && finalsKeys.includes(key)) continue;
        total += sum;
        championship.push({ event_key: key, district_cmp: true, qual_points: points.qual, alliance_points: points.alliance, elim_points: points.elim, award_points: points.award, total: sum });
      }
      return { team_key: team.teamKey, rank: team.rank, point_total: total, rookie_bonus: team.rookieBonus, adjustments: team.adjustments, event_points: [...others, ...championship] };
    });

  const stateFor = (key: string, phase: StatePhase): DistrictEventState => {
    const total = [...finalRow.get(key)!.values()][0]?.state?.qualMatchesTotal ?? QUAL_TOTAL;
    return {
      qualMatchesPlayed: phase === "started" ? Math.max(1, total - 10) : total,
      qualMatchesTotal: total,
      alliancesPicked: phase === "picked" || phase === "done",
      playoffsDone: phase === "done",
      awardsPosted: false,
    };
  };
  const carries = (key: string): boolean => artifact.teams.some((team) => team.eventPoints.some((row) => row.eventKey === key) || team.remainingEvents.some((row) => row.eventKey === key));
  /** As the Worker does: the state of an event is handed only once the artifact already carries a row for it. */
  const statesInHand = (): Map<string, DistrictEventState> => new Map([...states].filter(([key]) => carries(key)));

  const steps: WalkStep[] = [];
  const record = (label: string): void => {
    steps.push(snapshot(label, artifact));
  };
  const rowsTick = (label: string): void => {
    artifact = applyDistrictRankings({ artifact, rankings: payload(), ...STAMP, eventState: statesInHand() });
    record(label);
  };
  const stateTick = (label: string): void => {
    const inHand = statesInHand();
    if (inHand.size > 0) artifact = applyDistrictEventState({ artifact, eventState: inHand, ...STAMP });
    record(label);
  };

  record(options.registeredFirst === true ? "every attending team registered" : "no dcmp row");
  for (const key of fieldFixingKeys) {
    states.set(key, stateFor(key, "started"));
    // With a registration on the artifact the Worker has a row to write the state on before any points post.
    if (options.registeredFirst === true) stateTick(`${shortKey(key)} started on the field, state only`);
    posted.set(key, "qual");
    rowsTick(`${shortKey(key)} rows posted`);
    stateTick(`${shortKey(key)} state written`);
  }
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "qualDone"));
  stateTick("qualification done everywhere");
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "picked"));
  stateTick("alliances picked, no alliance points");
  for (const key of fieldFixingKeys) posted.set(key, "alliance");
  rowsTick("alliance points land");
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "done"));
  stateTick("playoffs done, no playoff points");
  for (const key of fieldFixingKeys) posted.set(key, "elim");
  rowsTick("playoff points land");
  if (options.finalsTicks === true && finalsKeys.length > 0) {
    // The finals rows post with their Playoffs points: first with no state
    // block (the Worker has nowhere to put it), then the state, then the
    // finals' award points while the awards flag is not yet true.
    for (const key of finalsKeys) posted.set(key, "elim");
    rowsTick("finals rows posted, no state");
    for (const key of finalsKeys) states.set(key, { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: true, playoffsDone: true, awardsPosted: false });
    stateTick("finals state written");
    for (const key of finalsKeys) posted.set(key, "all");
    rowsTick("finals award points land");
  }
  artifact = source;
  record("the source artifact");

  return { steps, fieldTeams, fieldFixingKeys };
}

/**
 * THE SECOND WALK: the points arrive only as each event ends. The first
 * `finalAtStart` field fixing keys start wholly final, exactly as `source`
 * publishes them (rows, state and the awards given there). Every other dcmp
 * key is on no row. Each further field fixing key then posts its rows with
 * every point they end on and no state block, and has its state written
 * with its playoffs done and its awards flag not yet true. The last entry is
 * the source artifact itself.
 */
function walkPointsAtEventEnd(source: DistrictArtifact, finalAtStart: number): Walk {
  const dcmpKeys = dcmpEventKeysFor(source);
  const fieldFixingKeys = fieldFixingDcmpKeys(dcmpKeys);
  const kept = fieldFixingKeys.slice(0, finalAtStart);
  const later = fieldFixingKeys.slice(finalAtStart);
  const hiddenAtStart = new Set(dcmpKeys.filter((key) => !kept.includes(key)));
  const fieldTeams = new Set<string>();
  for (const team of source.teams) if (team.eventPoints.some((row) => fieldFixingKeys.includes(row.eventKey))) fieldTeams.add(team.teamKey);
  const totalAt = (team: Team, keys: ReadonlySet<string>): number => team.eventPoints.filter((row) => keys.has(row.eventKey)).reduce((sum, row) => sum + row.total, 0);

  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...source,
      teams: source.teams.map((team) => ({
        ...team,
        pointTotal: team.pointTotal - totalAt(team, hiddenAtStart),
        eventPoints: team.eventPoints.filter((row) => !hiddenAtStart.has(row.eventKey)),
        remainingEvents: team.remainingEvents.filter((row) => !hiddenAtStart.has(row.eventKey)),
        qualifyingAwards: team.qualifyingAwards.filter((award) => !hiddenAtStart.has(award.eventKey)),
      })),
    }),
    { nowYear: NOW_YEAR, dcmpStillAhead: true }
  );

  const steps: WalkStep[] = [];
  const startLabel = finalAtStart === 0 ? "no dcmp row" : `${kept.map(shortKey).join(", ")} wholly final, the others on no row`;
  steps.push(snapshot(startLabel, artifact));
  const hidden = new Set(hiddenAtStart);
  for (const key of later) {
    hidden.delete(key);
    // The key's rows post with every point they end on. No state is handed:
    // the artifact the Worker read carried no row for this event.
    const rankings = source.teams.map((team) => ({
      team_key: team.teamKey,
      rank: team.rank,
      point_total: team.pointTotal - totalAt(team, hidden),
      rookie_bonus: team.rookieBonus,
      adjustments: team.adjustments,
      event_points: team.eventPoints
        .filter((row) => !hidden.has(row.eventKey))
        .map((row) => ({ event_key: row.eventKey, district_cmp: row.tier === "dcmp", qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: row.award, total: row.total })),
    }));
    artifact = applyDistrictRankings({ artifact, rankings, ...STAMP });
    steps.push(snapshot(`${shortKey(key)} rows posted with every point, no state`, artifact));
    const published = source.teams.flatMap((team) => team.eventPoints).find((row) => row.eventKey === key)!.state;
    const total = published?.qualMatchesTotal ?? QUAL_TOTAL;
    const state: DistrictEventState = { qualMatchesPlayed: total, qualMatchesTotal: total, alliancesPicked: true, playoffsDone: true, awardsPosted: false };
    artifact = applyDistrictEventState({ artifact, eventState: new Map([[key, state]]), ...STAMP });
    steps.push(snapshot(`${shortKey(key)} state written, awards flag not yet true`, artifact));
  }
  steps.push(snapshot("the source artifact", source));
  return { steps, fieldTeams, fieldFixingKeys };
}

/** One line per tick of a walk, for the printed tables. */
function tickTable(walk: Walk): string[] {
  return walk.steps.map(
    (step) => `  ${step.label.padEnd(58)} fieldProven=${String(step.fieldProven).padEnd(5)} reserved=${String(step.champReserved).padStart(2)} held=${String([...step.champTab.values()].filter(champTabHeld).length)}`
  );
}

// ---------------------------------------------------------------------------
// GROUP 1. A synthetic championship in four divisions
// ---------------------------------------------------------------------------

const SYNTHETIC_STEM = "2026pncmp";
/** The award points of a consuming judged award at a 2026 championship. */
const SYNTHETIC_FINALS_AWARD = 30;

interface SyntheticDivisioned {
  /** How many divisions the championship is played in. */
  readonly divisions: number;
  /** How many teams each division holds. */
  readonly divisionSize: number;
  /** How many teams the district has in all: the field first, the rest on no championship row. */
  readonly teamCount: number;
  readonly cmpSlots: number;
  /**
   * Whether the championship has a finals event (the parent key). Division
   * one's winning alliance is the champion and is paid the finals champion
   * value there, division two's the finalist value, and the first team
   * outside the field is given a consuming award at the finals without
   * having played in a division.
   */
  readonly withFinals?: boolean;
}

/**
 * A championship in divisions over the fixture's first teams. Team `index`
 * below the field size plays division `index % divisions`, so every division
 * holds a spread of strengths, and the district points fall steeply enough
 * that the strongest teams do lock before the walk ends; the others carry
 * one finished district row
 * and no championship row. In each division the three strongest are the
 * winning alliance. Identity fields and award profiles are the fixture's
 * own. Only the numbers are synthetic. No award is given.
 */
function syntheticDivisioned(shape: SyntheticDivisioned): DistrictArtifact {
  const districtRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "district")!;
  const dcmpRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "dcmp")!;
  const fieldSize = shape.divisions * shape.divisionSize;
  const finalsChampion = finalsChampionMaximum(NOW_YEAR, shape.divisions);
  const finalsFinalist = Math.floor(finalsChampion / 2);
  const teams = baseline.teams.slice(0, shape.teamCount).map((team, index) => {
    const inField = index < fieldSize;
    const district = inField ? 150 - 8 * index : 20 - (index - fieldSize);
    const base = { ...team, rank: index + 1, rookieBonus: 0, adjustments: 0, remainingEvents: [], qualifyingAwards: [] };
    const districtPoints = { ...districtRow, qual: district, alliance: 0, elim: 0, award: 0, total: district, state: { ...FINISHED_STATE } };
    const finalsRow = (elim: number, award: number) => ({ ...dcmpRow, eventKey: SYNTHETIC_STEM, eventName: `${dcmpRow.eventName} Finals`, qual: 0, alliance: 0, elim, award, total: elim + award, state: { ...FINISHED_STATE } });
    if (!inField) {
      // The first team outside the field: a consuming award at the finals, and nothing else there.
      if (shape.withFinals === true && index === fieldSize) {
        return {
          ...base,
          pointTotal: district + SYNTHETIC_FINALS_AWARD,
          eventPoints: [districtPoints, finalsRow(0, SYNTHETIC_FINALS_AWARD)],
          qualifyingAwards: [{ eventKey: SYNTHETIC_STEM, awardType: 9, label: "Engineering Inspiration", awardOnly: false }],
        };
      }
      return { ...base, pointTotal: district, eventPoints: [districtPoints] };
    }
    const division = index % shape.divisions;
    const place = Math.floor(index / shape.divisions);
    const qual = 60 - 6 * place;
    const alliance = place < 3 ? 48 - 8 * place : 0;
    const elim = place < 3 ? 90 : 0;
    const total = qual + alliance + elim;
    const divisionPoints = { ...dcmpRow, eventKey: `${SYNTHETIC_STEM}${String(division + 1)}`, eventName: `${dcmpRow.eventName} Division ${String(division + 1)}`, qual, alliance, elim, award: 0, total, state: { ...FINISHED_STATE } };
    // The finals: division one's winners are the champions, division two's the finalists.
    const finalsElim = shape.withFinals === true && place < 3 ? (division === 0 ? finalsChampion : division === 1 ? finalsFinalist : 0) : 0;
    // The Impact award goes to the strongest team, at the finals.
    const finalsAward = shape.withFinals === true && index === 0 ? SYNTHETIC_FINALS_AWARD : 0;
    return {
      ...base,
      pointTotal: district + total + finalsElim + finalsAward,
      eventPoints: finalsElim + finalsAward > 0 ? [districtPoints, divisionPoints, finalsRow(finalsElim, finalsAward)] : [districtPoints, divisionPoints],
      qualifyingAwards: [
        ...(finalsElim === finalsChampion && finalsChampion > 0 ? [{ eventKey: SYNTHETIC_STEM, awardType: 1, label: "Winner", awardOnly: false }] : []),
        ...(finalsAward > 0 ? [{ eventKey: SYNTHETIC_STEM, awardType: 0, label: "Impact", awardOnly: false }] : []),
      ],
    };
  });
  return recomputeDistrictVerdicts(DistrictArtifactSchema.parse({ ...baseline, dcmpSlots: fieldSize, cmpSlots: shape.cmpSlots, teams }), { nowYear: NOW_YEAR });
}

/** The premise's numbers: 16 teams in four divisions of four, 30 teams in the district, 21 Championship slots. */
const FOUR_DIVISIONS: SyntheticDivisioned = { divisions: 4, divisionSize: 4, teamCount: 30, cmpSlots: 21 };
const S4 = syntheticDivisioned(FOUR_DIVISIONS);
const S4_KEYS = [1, 2, 3, 4].map((n) => `${SYNTHETIC_STEM}${String(n)}`);

describe("the staged live walk: a synthetic championship in four divisions, one division posted at a time (quick task 261010-66y)", () => {
  it("premise: four field fixing keys on one stem and no parent row, 16 teams in divisions of 4, 16 championship places, 21 Championship slots, and the other teams on no championship row", () => {
    expect(dcmpEventKeysFor(S4)).toEqual(S4_KEYS);
    expect(fieldFixingDcmpKeys(dcmpEventKeysFor(S4))).toEqual(S4_KEYS);
    expect(championshipShape(dcmpEventKeysFor(S4)).kind).toBe("unsupported");
    expect(S4.teams).toHaveLength(30);
    expect(S4.dcmpSlots).toBe(16);
    expect(S4.cmpSlots).toBe(21);
    for (const key of S4_KEYS) expect(S4.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === key))).toHaveLength(4);
    const rowless = S4.teams.filter((team) => team.eventPoints.every((row) => row.tier !== "dcmp") && team.remainingEvents.every((row) => row.tier !== "dcmp"));
    expect(rowless).toHaveLength(14);
  });

  it("rules on: no Locked is taken back, no team of the field ever reads out, and the field reads unproven from the first state written until the last division's", () => {
    const walk = walkChampionshipField(S4);
    expect(walk.steps.map((step) => step.label)).toEqual([
      "no dcmp row",
      "pncmp1 rows posted",
      "pncmp1 state written",
      "pncmp2 rows posted",
      "pncmp2 state written",
      "pncmp3 rows posted",
      "pncmp3 state written",
      "pncmp4 rows posted",
      "pncmp4 state written",
      "qualification done everywhere",
      "alliances picked, no alliance points",
      "alliance points land",
      "playoffs done, no playoff points",
      "playoff points land",
      "the source artifact",
    ]);
    expect(walk.fieldTeams.size).toBe(16);
    expect(takeBacks(walk.steps, (step) => step.champTab, champTabHeld)).toEqual([]);
    expect(fieldTeamsReadOut(walk)).toEqual([]);
    expect(outThenIn(walk)).toEqual([]);
    // The District Locks tab: its overlay applies exactly while the field is proven, and no team of the field loses a Locked.
    expect(districtLockedThenLost(walk)).toEqual([]);
    expect(declinedWhileUnproven(walk.steps)).toEqual([]);
    expect(walk.steps.map((step) => step.overlayActive)).toEqual(walk.steps.map((step) => step.proven));

    // The one flag: true while nothing has started, false from the first
    // division's state until the last division's, true from then on.
    const firstState = walk.steps.findIndex((step) => step.label === "pncmp1 state written");
    const lastState = walk.steps.findIndex((step) => step.label === "pncmp4 state written");
    expect(walk.steps.map((step) => step.fieldProven)).toEqual(walk.steps.map((_, index) => index < firstState || index >= lastState));

    // The walk is not vacuous: places are held by its end, and some are held before it.
    const heldAt = (label: string): number => [...walk.steps.find((step) => step.label === label)!.champTab.values()].filter(champTabHeld).length;
    expect(heldAt("the source artifact")).toBeGreaterThan(0);
    expect(heldAt("playoff points land")).toBeGreaterThan(0);
    console.log(
      ["[261010-66y group 1] rules on, synthetic four divisions:", ...walk.steps.map((step) => `  ${step.label.padEnd(38)} fieldProven=${String(step.fieldProven).padEnd(5)} reserved=${String(step.champReserved).padStart(2)} held=${String([...step.champTab.values()].filter(champTabHeld).length)}`)].join("\n")
    );
  });

  it("D11: the core proof never goes from proven to not proven while rows are only added, and the reservation never rises once the first division has started", () => {
    const walk = walkChampionshipField(S4);
    expect(provenTakenBack(walk.steps)).toEqual([]);
    expect(walk.steps.some((step) => step.proven)).toBe(true);
    const fromFirstState = walk.steps.slice(walk.steps.findIndex((step) => step.label === "pncmp1 state written"));
    for (let index = 1; index < fromFirstState.length; index++) {
      expect({ label: fromFirstState[index]!.label, rises: fromFirstState[index]!.champReserved > fromFirstState[index - 1]!.champReserved }).toEqual({ label: fromFirstState[index]!.label, rises: false });
    }
  });

  it("rule off: the same walk takes Locked back and reads teams of the field out, pinned as the run shows", () => {
    const walk = withFieldRuleOff(() => walkChampionshipField(S4));
    const lost = takeBacks(walk.steps, (step) => step.champTab, champTabHeld);
    const readOut = fieldTeamsReadOut(walk);
    console.log(`[261010-66y group 1] rule off, synthetic four divisions: Locked taken back ${String(lost.length)}, teams of the field read out ${String(readOut.length)}`);
    for (const line of lost) console.log(`  ${line}`);
    expect(lost.length).toBeGreaterThan(0);
    expect(readOut.length).toBeGreaterThan(0);
    // PINNED AS THE RUN SHOWS, with the premise's sizes unchanged: nine teams
    // read Locked once the first division's state is written (three of
    // them in divisions that are on no row yet, and so read out of the
    // field with no ceiling), and every one loses it when the second
    // division's rows post. The twelve teams of the other three divisions
    // all read out of the field at that first state.
    expect({ lockedTakenBack: lost.length, fieldTeamsReadOut: readOut.length }).toEqual({ lockedTakenBack: 9, fieldTeamsReadOut: 12 });
    expect(new Set(lost.map((line) => /at "([^"]*)"$/.exec(line)![1]))).toEqual(new Set(["pncmp2 rows posted"]));
    // The District Locks tab with the rule off, pinned as the run shows:
    // teams of the field shown Locked and then Declined, and of them the
    // ones shown Locked again later.
    expect({ districtLockedThenLost: districtLockedThenLost(walk).length, lockedDeclinedLocked: districtLockedDeclinedLocked(walk) }).toEqual({ districtLockedThenLost: 12, lockedDeclinedLocked: 12 });
  });

  /** The second walk from every start: no division final, then the first one, two and three. */
  const STARTS = [0, 1, 2, 3] as const;

  it("the points arriving only as each division ends, rules on: no Locked is taken back from any start, no team of the field reads out, and the proof never goes back", () => {
    const table: string[] = [];
    for (const finalAtStart of STARTS) {
      const walk = walkPointsAtEventEnd(S4, finalAtStart);
      expect(walk.steps).toHaveLength(2 + 2 * (4 - finalAtStart));
      expect({ finalAtStart, lost: takeBacks(walk.steps, (step) => step.champTab, champTabHeld) }).toEqual({ finalAtStart, lost: [] });
      expect({ finalAtStart, out: fieldTeamsReadOut(walk) }).toEqual({ finalAtStart, out: [] });
      expect({ finalAtStart, proofLost: provenTakenBack(walk.steps) }).toEqual({ finalAtStart, proofLost: [] });
      table.push(`  start: ${String(finalAtStart)} of 4 divisions final`, ...tickTable(walk));
    }
    console.log(["[261010-66y group 1] the points arriving only as each division ends, rules on, synthetic four divisions:", ...table].join("\n"));
  });

  it("the points arriving only as each division ends, each rule off in turn, pinned as the run shows", () => {
    const measure = (run: (finalAtStart: number) => Walk) => STARTS.map((finalAtStart) => takeBacks(run(finalAtStart).steps, (step) => step.champTab, champTabHeld).length);
    const fieldOff = measure((finalAtStart) => withFieldRuleOff(() => walkPointsAtEventEnd(S4, finalAtStart)));
    const allowanceOff = measure((finalAtStart) => withFinalsAllowanceOff(() => walkPointsAtEventEnd(S4, finalAtStart)));
    console.log(`[261010-66y group 1] the points arriving only as each division ends, synthetic four divisions, Locked taken back from 0, 1, 2 and 3 final divisions: field rule off ${fieldOff.join(", ")}; finals part of the hypothetical championship off ${allowanceOff.join(", ")}`);
    // PINNED AS THE RUN SHOWS. With the field rule off every start takes
    // Locked back. With only the finals part of the hypothetical
    // championship off this synthetic takes NONE back, said plainly: while
    // its field is unproven the championships held back (44, 33, 22 and 11
    // places) leave at most ten of its 21 Championship slots, so nobody reads Locked in
    // that window and there is nothing to take back. The walk that does show
    // it is the real 2026 FIM one in the local data group below, and the
    // ceiling itself is held by a unit test
    // (`champLedgerStatus.test.ts`: a team's ceiling cannot rise when its
    // division's rows land).
    expect({ fieldOff, allowanceOff }).toEqual({ fieldOff: [12, 11, 9, 6], allowanceOff: [0, 0, 0, 0] });
  });
});

// ---------------------------------------------------------------------------
// The local district artifacts (gitignored)
// ---------------------------------------------------------------------------

const LOCAL_DISTRICT_ABSOLUTE = join(REPO_ROOT, LOCAL_DISTRICT_DIR);
/** The district DETAIL files alone: `v1__districts__2026.json` is the per year index and carries no teams. */
const DISTRICT_DETAIL_FILE = /^v1__district__\d{4}[a-z0-9]+\.json$/;
const LOCAL_DISTRICT_FILES = existsSync(LOCAL_DISTRICT_ABSOLUTE) ? readdirSync(LOCAL_DISTRICT_ABSOLUTE).filter((name) => DISTRICT_DETAIL_FILE.test(name)).sort() : [];
const NO_LOCAL_DISTRICTS = `no district artifact under ${LOCAL_DISTRICT_DIR} (gitignored local data)`;

const localArtifactCache = new Map<string, DistrictArtifact>();
function localArtifact(fileName: string): DistrictArtifact {
  let artifact = localArtifactCache.get(fileName);
  if (artifact === undefined) {
    artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(LOCAL_DISTRICT_ABSOLUTE, fileName), "utf8")));
    localArtifactCache.set(fileName, artifact);
  }
  return artifact;
}

/** The real proof at Now, as the tab computes it, at the given calendar year. */
const proofAtNow = (artifact: DistrictArtifact, nowYear: number) => champFieldProofAtNow(artifact, startedDcmpKeys(artifact), nowYear);

// ---------------------------------------------------------------------------
// GROUP 2. The Now census
// ---------------------------------------------------------------------------

describe("the Now census: no finished season reads unproven after a start (quick task 261010-66y, D7 and D8)", () => {
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it("every local district artifact reads proven or has no championship key, and none reads unproven after a start, in 2026", () => {
    const completeBy = { capacity: [] as string[], finals: [] as string[], seasonOver: [] as string[] };
    const noDcmpKey: string[] = [];
    const unprovenAfterStart: string[] = [];
    const notProven: string[] = [];
    let closestPass = Number.POSITIVE_INFINITY;
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const artifact = localArtifact(fileName);
      const proof = proofAtNow(artifact, NOW_YEAR);
      if (proof.unprovenAfterStart) unprovenAfterStart.push(artifact.districtKey);
      if (proof.dcmpEventKeys.length === 0) noDcmpKey.push(artifact.districtKey);
      else if (!proof.proven) notProven.push(artifact.districtKey);
      if (proof.completeBy !== null) completeBy[proof.completeBy].push(artifact.districtKey);
      if (proof.completeBy === "capacity") closestPass = Math.min(closestPass, proof.postedTeams - (artifact.dcmpSlots! - proof.tolerance));
    }
    // DERIVED, never typed in: the seasons that need the season over line are
    // the ones with a championship key whose season is 2020.
    const seasons2020 = LOCAL_DISTRICT_FILES.map(localArtifact).filter((artifact) => artifact.year === 2020 && dcmpEventKeysFor(artifact).length > 0).map((artifact) => artifact.districtKey);
    console.log(
      `[261010-66y group 2] artifacts ${String(LOCAL_DISTRICT_FILES.length)} | proven by capacity ${String(completeBy.capacity.length)}, by a finals row ${String(completeBy.finals.length)}, by the season over line ${String(completeBy.seasonOver.length)} (${completeBy.seasonOver.join(", ")}) | no championship key: ${noDcmpKey.join(", ")} | unproven after a start ${String(unprovenAfterStart.length)} | closest capacity pass: ${String(closestPass)} teams above the count asked for`
    );
    expect(unprovenAfterStart).toEqual([]);
    expect(notProven).toEqual([]);
    expect(completeBy.seasonOver).toEqual(seasons2020);
    expect(completeBy.finals).toEqual([]);
    expect(noDcmpKey).toEqual(["2020isr"]);
    // The counts, as the run shows.
    expect({ artifacts: LOCAL_DISTRICT_FILES.length, capacity: completeBy.capacity.length, seasonOver: completeBy.seasonOver.length, noDcmpKey: noDcmpKey.length }).toEqual({ artifacts: 109, capacity: 98, seasonOver: 10, noDcmpKey: 1 });
  });
});

// ---------------------------------------------------------------------------
// GROUP 3. The subset test
// ---------------------------------------------------------------------------

/** Every non empty proper subset of `items`. */
function properSubsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < (1 << items.length) - 1; mask++) out.push(items.filter((_, index) => ((mask >> index) & 1) === 1));
  return out;
}

/** The artifact with every row and every award at the given keys removed, as it would be before TBA posted them. */
function withoutKeys(artifact: DistrictArtifact, drop: ReadonlySet<string>): DistrictArtifact {
  return {
    ...artifact,
    teams: artifact.teams.map((team) => ({
      ...team,
      eventPoints: team.eventPoints.filter((row) => !drop.has(row.eventKey)),
      remainingEvents: team.remainingEvents.filter((row) => !drop.has(row.eventKey)),
      qualifyingAwards: team.qualifyingAwards.filter((award) => !drop.has(award.eventKey)),
    })),
  };
}

describe("the subset test: part of the field on the rows never reads proven (quick task 261010-66y, D7)", () => {
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it("for every artifact with two or more field fixing keys, every proper subset reads NOT proven and every key together reads proven, in the artifact's own year", () => {
    const several = LOCAL_DISTRICT_FILES.map(localArtifact).filter((artifact) => fieldFixingDcmpKeys(dcmpEventKeysFor(artifact)).length >= 2);
    let subsets = 0;
    let provenByTheSeasonOverLineAlone = 0;
    let closestMiss = Number.POSITIVE_INFINITY;
    const provenSubsets: string[] = [];
    const wholeNotProven: string[] = [];
    for (const artifact of several) {
      const dcmpKeys = dcmpEventKeysFor(artifact);
      const fieldFixing = fieldFixingDcmpKeys(dcmpKeys);
      const finalsKeys = dcmpKeys.filter((key) => !fieldFixing.includes(key));
      if (!proofAtNow(artifact, artifact.year).proven) wholeNotProven.push(artifact.districtKey);
      for (const subset of properSubsets(fieldFixing)) {
        subsets += 1;
        const staged = withoutKeys(artifact, new Set([...fieldFixing.filter((key) => !subset.includes(key)), ...finalsKeys]));
        const proof = proofAtNow(staged, artifact.year);
        if (proof.proven) provenSubsets.push(`${artifact.districtKey} keep ${subset.join(",")} by ${String(proof.completeBy)}`);
        if (artifact.dcmpSlots !== null) closestMiss = Math.min(closestMiss, artifact.dcmpSlots - proof.tolerance - proof.postedTeams);
        // The year one above the artifact's: the season over line alone.
        if (proofAtNow(staged, artifact.year + 1).completeBy === "seasonOver") provenByTheSeasonOverLineAlone += 1;
      }
    }
    console.log(
      `[261010-66y group 3] artifacts with two or more field fixing keys ${String(several.length)} | proper subsets ${String(subsets)} | read proven ${String(provenSubsets.length)} | closest miss: ${String(closestMiss)} teams below the count asked for | subsets the season over line alone would call proven, one year on: ${String(provenByTheSeasonOverLineAlone)}`
    );
    expect(provenSubsets).toEqual([]);
    expect(wholeNotProven).toEqual([]);
    // The counts, as the run shows. The last is why the season over line
    // counts only once the season is over: read in the artifact's own
    // season it would call every one of these subsets proven.
    expect({ artifacts: several.length, subsets, provenByTheSeasonOverLineAlone }).toEqual({ artifacts: 25, subsets: 146, provenByTheSeasonOverLineAlone: 146 });
    expect(closestMiss).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GROUPS 4 and 5. The real 2026 championships
// ---------------------------------------------------------------------------

/** FIM in four divisions, NE, ONT and TX in two, and the two championships of California. */
const WALKED_DISTRICTS = ["2026fim", "2026ne", "2026ont", "2026fit", "2026ca"] as const;
type WalkedDistrict = (typeof WALKED_DISTRICTS)[number];
const MISSING_WALKED = WALKED_DISTRICTS.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));
const WALK_TIMEOUT_MS = 600_000;

const walkedSourceCache = new Map<string, DistrictArtifact>();
/** The published artifact at the verdict pass's fixed point, as the walks' source and end. */
function walkedSource(districtKey: WalkedDistrict): DistrictArtifact {
  let source = walkedSourceCache.get(districtKey);
  if (source === undefined) {
    source = recomputeDistrictVerdicts(localArtifact(`v1__district__${districtKey}.json`), { nowYear: NOW_YEAR });
    walkedSourceCache.set(districtKey, source);
  }
  return source;
}

/** DERIVED: the teams whose only championship row is at a finals key (an award given at the finals to a team that played in no division). */
function finalsOnlyTeams(source: DistrictArtifact): string[] {
  const fieldFixing = new Set(fieldFixingDcmpKeys(dcmpEventKeysFor(source)));
  return source.teams
    .filter((team) => {
      const dcmpRows = team.eventPoints.filter((row) => row.tier === "dcmp");
      return dcmpRows.length > 0 && dcmpRows.every((row) => !fieldFixing.has(row.eventKey));
    })
    .map((team) => team.teamKey)
    .sort();
}

type RuleMode = "on" | "fieldRuleOff" | "finalsAllowanceOff";
function inMode<T>(mode: RuleMode, body: () => T): T {
  return mode === "on" ? body() : mode === "fieldRuleOff" ? withFieldRuleOff(body) : withFinalsAllowanceOff(body);
}

const realWalkCache = new Map<string, Walk>();
/** The first walk of a real district: its points lagging its matches by ticks. */
function realWalk(districtKey: WalkedDistrict, mode: RuleMode): Walk {
  const cacheKey = `lag ${districtKey} ${mode}`;
  let walk = realWalkCache.get(cacheKey);
  if (walk === undefined) {
    walk = inMode(mode, () => walkChampionshipField(walkedSource(districtKey)));
    realWalkCache.set(cacheKey, walk);
  }
  return walk;
}
/** The second walk of a real district: its points arriving only as each event ends, from a start with `finalAtStart` keys wholly final. */
function realEventEndWalk(districtKey: WalkedDistrict, finalAtStart: number, mode: RuleMode): Walk {
  const cacheKey = `end ${districtKey} ${String(finalAtStart)} ${mode}`;
  let walk = realWalkCache.get(cacheKey);
  if (walk === undefined) {
    walk = inMode(mode, () => walkPointsAtEventEnd(walkedSource(districtKey), finalAtStart));
    realWalkCache.set(cacheKey, walk);
  }
  return walk;
}

const lockedTakenBack = (walk: Walk): string[] => takeBacks(walk.steps, (step) => step.champTab, champTabHeld);

describe("the staged live walk: the real 2026 FIM, NE, ONT, TX and CA championships, one event posted at a time (quick task 261010-66y, D7)", () => {
  if (MISSING_WALKED.length > 0) {
    localDataAbsent(`${MISSING_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it(
    "rules on: no Locked is taken back, no team that ends with a field fixing row ever reads out, and the proof never goes back",
    () => {
      const table: string[] = [];
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "on");
        expect({ districtKey, lost: lockedTakenBack(walk) }).toEqual({ districtKey, lost: [] });
        expect({ districtKey, out: fieldTeamsReadOut(walk) }).toEqual({ districtKey, out: [] });
        expect({ districtKey, proofLost: provenTakenBack(walk.steps) }).toEqual({ districtKey, proofLost: [] });
        // The one flag is false exactly from the first key's state until the last key's.
        const firstState = walk.steps.findIndex((step) => step.label === `${shortKey(walk.fieldFixingKeys[0]!)} state written`);
        const lastState = walk.steps.findIndex((step) => step.label === `${shortKey(walk.fieldFixingKeys.at(-1)!)} state written`);
        expect({ districtKey, fieldProven: walk.steps.map((step) => step.fieldProven) }).toEqual({ districtKey, fieldProven: walk.steps.map((_, index) => index < firstState || index >= lastState) });
        expect({ districtKey, rises: reservationRises(walk.steps.slice(firstState)) }).toEqual({ districtKey, rises: [] });
        // The District Locks tab: no team of the field reads Declined or Locked out after reading Locked.
        expect({ districtKey, districtLost: districtLockedThenLost(walk) }).toEqual({ districtKey, districtLost: [] });
        expect({ districtKey, declinedWhileUnproven: declinedWhileUnproven(walk.steps) }).toEqual({ districtKey, declinedWhileUnproven: [] });
        table.push(`  ${districtKey}: ${String(walk.fieldTeams.size)} teams in the field at ${String(walk.fieldFixingKeys.length)} field fixing keys`, ...tickTable(walk));
      }
      console.log(["[261010-66y group 4] rules on, the real walks:", ...table].join("\n"));
    },
    WALK_TIMEOUT_MS
  );

  it(
    "rules on: the only teams that read out and later in are the teams whose only championship row is at a finals key, and each ends Locked by an award",
    () => {
      const counts: Record<string, number> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const source = walkedSource(districtKey);
        const walk = realWalk(districtKey, "on");
        const finalsOnly = finalsOnlyTeams(source);
        expect({ districtKey, outThenIn: outThenIn(walk) }).toEqual({ districtKey, outThenIn: finalsOnly });
        const end = walk.steps.at(-1)!;
        for (const teamKey of finalsOnly) {
          expect({ districtKey, teamKey, status: end.champTab.get(teamKey), byAward: end.champByAward.has(teamKey) }).toEqual({ districtKey, teamKey, status: "locked", byAward: true });
        }
        counts[districtKey] = finalsOnly.length;
      }
      console.log(`[261010-66y group 4] teams whose only championship row is at a finals key: ${JSON.stringify(counts)}`);
      // The counts, as the run shows.
      expect(counts).toEqual({ "2026fim": 1, "2026ne": 2, "2026ont": 0, "2026fit": 0, "2026ca": 0 });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "rules on, the District Locks tab: the teams that end Declined read Declined at exactly the ticks the field is proven, and at no other",
    () => {
      const counts: Record<string, number> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "on");
        const end = walk.steps.at(-1)!;
        expect({ districtKey, overlayAtTheEnd: end.overlayActive }).toEqual({ districtKey, overlayAtTheEnd: true });
        // DERIVED from the end state: the teams that earned a place and are not in the field.
        const endDeclined = [...end.districtTab].filter(([, status]) => status === "declined").map(([teamKey]) => teamKey).sort();
        for (const step of walk.steps) {
          const declined = [...step.districtTab].filter(([, status]) => status === "declined").map(([teamKey]) => teamKey).sort();
          expect({ districtKey, label: step.label, overlay: step.overlayActive, declined }).toEqual({ districtKey, label: step.label, overlay: step.proven, declined: step.proven ? endDeclined : [] });
        }
        counts[districtKey] = endDeclined.length;
      }
      console.log(`[261010-66y group 4] the District Locks tab, teams that end Declined: ${JSON.stringify(counts)}`);
      // The counts, as the run shows.
      expect(counts).toEqual({ "2026fim": 0, "2026ne": 8, "2026ont": 9, "2026fit": 5, "2026ca": 4 });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "field rule off, the District Locks tab: teams of the field shown Locked and then Declined or Locked out, pinned as the run shows",
    () => {
      const measured: Record<string, { lockedThenLost: number; lockedDeclinedLocked: number }> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "fieldRuleOff");
        measured[districtKey] = { lockedThenLost: districtLockedThenLost(walk).length, lockedDeclinedLocked: districtLockedDeclinedLocked(walk) };
      }
      console.log(`[261010-66y group 4] field rule off, the District Locks tab: ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. With the rule off the overlay applied as
      // soon as every key the artifact knew had started, and every team of
      // an event TBA had not posted yet, having earned its place, read
      // Declined (or Locked out, for a team that got in from below the
      // line after reading Locked on a tie) until its rows landed.
      expect(measured).toEqual({
        "2026fim": { lockedThenLost: 119, lockedDeclinedLocked: 119 },
        "2026ne": { lockedThenLost: 50, lockedDeclinedLocked: 46 },
        "2026ont": { lockedThenLost: 49, lockedDeclinedLocked: 44 },
        "2026fit": { lockedThenLost: 41, lockedDeclinedLocked: 40 },
        "2026ca": { lockedThenLost: 55, lockedDeclinedLocked: 55 },
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "field rule off: the same walks, pinned as the run shows",
    () => {
      const measured: Record<string, { lockedTakenBack: number; fieldTeamsReadOut: number }> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "fieldRuleOff");
        measured[districtKey] = { lockedTakenBack: lockedTakenBack(walk).length, fieldTeamsReadOut: fieldTeamsReadOut(walk).length };
      }
      console.log(`[261010-66y group 4] field rule off, the real walks: ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS, and said plainly: with the field rule off
      // this walk takes a Locked back at 2026 FIM only. At NE, ONT, TX and CA
      // the same code reads 50, 49, 45 and 60 teams of the field out of it
      // and takes no Locked back, because in this walk nobody reads Locked
      // while the points lag only by ticks. The walk that does take Locked
      // back at all five is the next group's.
      expect(measured).toEqual({
        "2026fim": { lockedTakenBack: 41, fieldTeamsReadOut: 121 },
        "2026ne": { lockedTakenBack: 0, fieldTeamsReadOut: 50 },
        "2026ont": { lockedTakenBack: 0, fieldTeamsReadOut: 49 },
        "2026fit": { lockedTakenBack: 0, fieldTeamsReadOut: 45 },
        "2026ca": { lockedTakenBack: 0, fieldTeamsReadOut: 60 },
      });
    },
    WALK_TIMEOUT_MS
  );
});

describe("the points arriving only as each event ends: the real 2026 FIM, NE, ONT, TX and CA championships (quick task 261010-66y, D7)", () => {
  if (MISSING_WALKED.length > 0) {
    localDataAbsent(`${MISSING_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  /** Every start of the second walk: none of the field fixing keys final, then the first one, two and so on, never all. */
  const startsOf = (districtKey: WalkedDistrict): number[] => fieldFixingDcmpKeys(dcmpEventKeysFor(walkedSource(districtKey))).map((_, index) => index);
  /** The teams shown Locked at a walk's first entry that do not hold a place at its last. */
  const lockedThenNotHeldAtTheEnd = (walk: Walk): string[] => {
    const end = walk.steps.at(-1)!.champTab;
    return [...walk.steps[0]!.champTab].filter(([teamKey, status]) => status === "locked" && !champTabHeld(end.get(teamKey) ?? "absent")).map(([teamKey]) => teamKey);
  };
  type Measured = Record<string, { lockedAtStart: number[]; notHeldAtTheEnd: number[]; lockedTakenBack: number[] }>;
  const measure = (mode: RuleMode): Measured => {
    const measured: Measured = {};
    for (const districtKey of WALKED_DISTRICTS) {
      const walks = startsOf(districtKey).map((finalAtStart) => realEventEndWalk(districtKey, finalAtStart, mode));
      measured[districtKey] = {
        lockedAtStart: walks.map((walk) => [...walk.steps[0]!.champTab.values()].filter((status) => status === "locked").length),
        notHeldAtTheEnd: walks.map((walk) => lockedThenNotHeldAtTheEnd(walk).length),
        lockedTakenBack: walks.map((walk) => lockedTakenBack(walk).length),
      };
    }
    return measured;
  };

  it(
    "rules on: from every start no team shown Locked is unheld at the end, no Locked is taken back on the way, no team of the field reads out, and the proof never goes back",
    () => {
      const table: string[] = [];
      for (const districtKey of WALKED_DISTRICTS) {
        for (const finalAtStart of startsOf(districtKey)) {
          const walk = realEventEndWalk(districtKey, finalAtStart, "on");
          expect({ districtKey, finalAtStart, notHeld: lockedThenNotHeldAtTheEnd(walk) }).toEqual({ districtKey, finalAtStart, notHeld: [] });
          expect({ districtKey, finalAtStart, lost: lockedTakenBack(walk) }).toEqual({ districtKey, finalAtStart, lost: [] });
          expect({ districtKey, finalAtStart, out: fieldTeamsReadOut(walk) }).toEqual({ districtKey, finalAtStart, out: [] });
          expect({ districtKey, finalAtStart, proofLost: provenTakenBack(walk.steps) }).toEqual({ districtKey, finalAtStart, proofLost: [] });
          expect({ districtKey, finalAtStart, districtLost: districtLockedThenLost(walk) }).toEqual({ districtKey, finalAtStart, districtLost: [] });
          expect({ districtKey, finalAtStart, declinedWhileUnproven: declinedWhileUnproven(walk.steps) }).toEqual({ districtKey, finalAtStart, declinedWhileUnproven: [] });
          // From the first tick at which the field reads unproven, the places held back never rise.
          const firstUnproven = walk.steps.findIndex((step) => !step.fieldProven);
          expect({ districtKey, finalAtStart, rises: reservationRises(firstUnproven < 0 ? [] : walk.steps.slice(firstUnproven)) }).toEqual({ districtKey, finalAtStart, rises: [] });
          table.push(`  ${districtKey}, start: ${String(finalAtStart)} of ${String(walk.fieldFixingKeys.length)} field fixing keys final`, ...tickTable(walk));
        }
      }
      console.log(["[261010-66y group 5] rules on, the points arriving only as each event ends:", ...table].join("\n"));
      console.log(`[261010-66y group 5] rules on, per start (0, 1, 2, ... keys final): ${JSON.stringify(measure("on"))}`);
    },
    WALK_TIMEOUT_MS
  );

  it(
    "field rule off: teams shown Locked that the end does not hold, and Locked taken back on the way, pinned as the run shows",
    () => {
      const measured = measure("fieldRuleOff");
      console.log(`[261010-66y group 5] field rule off, per start (0, 1, 2, ... keys final): ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS, one number per start (no key final, then
      // one, two and three). With the field rule off every district shows
      // teams Locked that the end does not hold, and takes Locked back on
      // the way from every start.
      expect(measured).toEqual({
        "2026fim": { lockedAtStart: [0, 70, 50, 22], notHeldAtTheEnd: [0, 17, 6, 0], lockedTakenBack: [68, 81, 48, 11] },
        "2026ne": { lockedAtStart: [0, 20], notHeldAtTheEnd: [0, 5], lockedTakenBack: [14, 20] },
        "2026ont": { lockedAtStart: [0, 11], notHeldAtTheEnd: [0, 2], lockedTakenBack: [6, 11] },
        "2026fit": { lockedAtStart: [0, 17], notHeldAtTheEnd: [0, 5], lockedTakenBack: [10, 17] },
        "2026ca": { lockedAtStart: [0, 46], notHeldAtTheEnd: [0, 14], lockedTakenBack: [17, 39] },
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the finals part of a rowless team's hypothetical championship off: Locked taken back on the way, pinned as the run shows",
    () => {
      const measured = measure("finalsAllowanceOff");
      console.log(`[261010-66y group 5] the finals part of the hypothetical championship off, per start (0, 1, 2, ... keys final): ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. Without the finals part a team's ceiling
      // rose by the whole Playoffs ceiling when its division's rows landed,
      // and 2026 FIM took Locked back from three of its four starts. No
      // team shown Locked was unheld at the end: the Locked came back. The
      // two division districts and California take none back, said
      // plainly: in the two division districts nobody reads Locked while
      // the field is unproven, and California's championships have no
      // finals.
      expect(measured).toEqual({
        "2026fim": { lockedAtStart: [0, 2, 4, 6], notHeldAtTheEnd: [0, 0, 0, 0], lockedTakenBack: [3, 3, 2, 0] },
        "2026ne": { lockedAtStart: [0, 0], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
        "2026ont": { lockedAtStart: [0, 0], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
        "2026fit": { lockedAtStart: [0, 0], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
        "2026ca": { lockedAtStart: [0, 7], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
      });
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 6. The published verdicts, through the finals
// ---------------------------------------------------------------------------

/** The four division synthetic of group 1 with a finals event: the same sizes, 16 teams in four divisions of four, 30 in the district, 21 Championship slots. */
const S4_FINALS = syntheticDivisioned({ ...FOUR_DIVISIONS, withFinals: true });

/**
 * A single championship over the fixture's first thirty teams, every one of
 * them in its field: 30 championship places, 21 Championship slots. Index 0
 * to 2 win it, 3 to 5 are the finalists, and Impact, Engineering Inspiration
 * and Rookie All Star go to index 6, 20 and 25. Only the numbers are
 * synthetic.
 */
function syntheticSingle(): DistrictArtifact {
  const districtRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "district")!;
  const dcmpRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "dcmp")!;
  const awardTypeOf = (index: number): number | undefined => (index === 6 ? 0 : index === 20 ? 9 : index === 25 ? 10 : undefined);
  const teams = baseline.teams.slice(0, 30).map((team, index) => {
    const district = 150 - 4 * index;
    const qual = 60 - index;
    const alliance = index < 24 ? 48 - 2 * index : 0;
    const elim = index < 3 ? 90 : index < 6 ? 60 : 0;
    const awardType = awardTypeOf(index);
    const award = awardType === undefined ? 0 : SYNTHETIC_FINALS_AWARD;
    const total = qual + alliance + elim + award;
    return {
      ...team,
      rank: index + 1,
      pointTotal: district + total,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [
        { ...districtRow, qual: district, alliance: 0, elim: 0, award: 0, total: district, state: { ...FINISHED_STATE } },
        { ...dcmpRow, eventKey: SYNTHETIC_STEM, qual, alliance, elim, award, total, state: { ...FINISHED_STATE } },
      ],
      remainingEvents: [],
      qualifyingAwards: [
        ...(elim === 90 ? [{ eventKey: SYNTHETIC_STEM, awardType: 1, label: "Winner", awardOnly: false }] : []),
        ...(awardType === undefined ? [] : [{ eventKey: SYNTHETIC_STEM, awardType, label: "a judged consuming award", awardOnly: false }]),
      ],
    };
  });
  return recomputeDistrictVerdicts(DistrictArtifactSchema.parse({ ...baseline, dcmpSlots: 30, cmpSlots: 21, teams }), { nowYear: NOW_YEAR });
}
const S1_SINGLE = syntheticSingle();

const publishedTakenBack = (walk: Walk): string[] => takeBacks(walk.steps, (step) => step.published, publishedHeld);
/** One line per tick of a walk's published series. */
function publishedTable(walk: Walk): string[] {
  return walk.steps.map((step) => {
    const ceilings = [...step.publishedCeiling.values()];
    return `  ${step.label.padEnd(44)} published held=${String([...step.published.values()].filter(publishedHeld).length).padStart(3)} teams with a champ ceiling=${String(ceilings.filter((value) => value > 0).length).padStart(3)} largest=${String(Math.max(0, ...ceilings)).padStart(3)} | tab held=${String([...step.champTab.values()].filter(champTabHeld).length)}`;
  });
}

describe("the published verdicts walked through the finals: two synthetic championships (quick task 261010-66y, D5)", () => {
  const SYNTHETICS = [
    { name: "single", source: S1_SINGLE },
    { name: "four divisions and a finals", source: S4_FINALS },
  ] as const;
  const STARTS = [false, true] as const;

  it("premise: one championship of thirty teams at one key, and one in four divisions with a finals row for eight of its teams and one team given an award at the finals alone", () => {
    expect(dcmpEventKeysFor(S1_SINGLE)).toEqual([SYNTHETIC_STEM]);
    expect(S1_SINGLE.teams.filter((team) => team.eventPoints.some((row) => row.tier === "dcmp"))).toHaveLength(30);
    expect({ dcmpSlots: S1_SINGLE.dcmpSlots, cmpSlots: S1_SINGLE.cmpSlots }).toEqual({ dcmpSlots: 30, cmpSlots: 21 });
    expect(dcmpEventKeysFor(S4_FINALS)).toEqual([SYNTHETIC_STEM, ...S4_KEYS]);
    expect(championshipShape(dcmpEventKeysFor(S4_FINALS)).kind).toBe("divisioned");
    const finalsRows = S4_FINALS.teams.flatMap((team) => team.eventPoints.filter((row) => row.eventKey === SYNTHETIC_STEM).map((row) => ({ teamKey: team.teamKey, row })));
    // Three champions and three finalists, the champion among them holding Impact, and one team at the finals alone.
    expect(finalsRows).toHaveLength(7);
    expect(finalsRows.filter(({ row }) => row.elim === 60)).toHaveLength(3);
    expect(finalsRows.filter(({ row }) => row.elim === 30)).toHaveLength(3);
    expect(finalsOnlyTeams(S4_FINALS)).toHaveLength(1);
    expect({ dcmpSlots: S4_FINALS.dcmpSlots, cmpSlots: S4_FINALS.cmpSlots, teams: S4_FINALS.teams.length }).toEqual({ dcmpSlots: 16, cmpSlots: 21, teams: 30 });
  });

  it("rules on, both starts: no published champLock is taken back, and no team's maxRemainingChamp drops and then rises", () => {
    const table: string[] = [];
    for (const { name, source } of SYNTHETICS) {
      for (const registeredFirst of STARTS) {
        const walk = walkChampionshipField(source, { registeredFirst, finalsTicks: true });
        const start = registeredFirst ? "every attending team registered first" : "no dcmp row first";
        expect({ name, start, lost: publishedTakenBack(walk) }).toEqual({ name, start, lost: [] });
        expect({ name, start, ceilings: publishedCeilingDropsThenRises(walk.steps) }).toEqual({ name, start, ceilings: [] });
        table.push(`  ${name}, ${start}`, ...publishedTable(walk));
      }
    }
    console.log(["[261010-66y group 6] rules on, the published series, synthetic:", ...table].join("\n"));
    // The walk is not vacuous: places are held in the published verdicts before the end.
    const single = walkChampionshipField(S1_SINGLE, { finalsTicks: true });
    expect([...single.steps.at(-2)!.published.values()].filter(publishedHeld).length).toBeGreaterThan(0);
  });

  it("the first rows rule off: a championship's first rows read as hindsight, pinned as the run shows", () => {
    const measured: Record<string, { publishedTakenBack: number; ceilingsDropThenRise: number }> = {};
    for (const { name, source } of SYNTHETICS) {
      for (const registeredFirst of STARTS) {
        const walk = withStatelessRowsOff(() => walkChampionshipField(source, { registeredFirst, finalsTicks: true }));
        measured[`${name}, ${registeredFirst ? "registered first" : "no dcmp row first"}`] = { publishedTakenBack: publishedTakenBack(walk).length, ceilingsDropThenRise: publishedCeilingDropsThenRises(walk.steps).length };
      }
    }
    console.log(`[261010-66y group 6] the first rows rule off, synthetic: ${JSON.stringify(measured)}`);
    // PINNED AS THE RUN SHOWS. With no dcmp row first, the single
    // championship's thirty teams all lose their championship ceiling on the
    // tick their rows arrive and get it back on the next, and ten of them
    // read locked in between. The four division one drops and restores the
    // ceilings of its sixteen and takes no lock back, said plainly: nobody
    // is locked that early there. With every attending team registered first
    // the state is written on the registration before the rows post, so no
    // row is ever stateless and the rule has nothing to do.
    expect(measured).toEqual({
      "single, no dcmp row first": { publishedTakenBack: 10, ceilingsDropThenRise: 30 },
      "single, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
      "four divisions and a finals, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 16 },
      "four divisions and a finals, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
    });
  });
});

/** The five of group 4 and the single championship of 2026 PNW. */
const PUBLISHED_WALKED = [...WALKED_DISTRICTS, "2026pnw"] as const;
const MISSING_PUBLISHED_WALKED = PUBLISHED_WALKED.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));

describe("the published verdicts walked through the finals: the real 2026 FIM, NE, ONT, TX, CA and PNW championships, both starts (quick task 261010-66y, D5)", () => {
  if (MISSING_PUBLISHED_WALKED.length > 0) {
    localDataAbsent(`${MISSING_PUBLISHED_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }
  const sourceOf = (districtKey: string): DistrictArtifact => recomputeDistrictVerdicts(localArtifact(`v1__district__${districtKey}.json`), { nowYear: NOW_YEAR });
  const STARTS = [false, true] as const;
  const startName = (registeredFirst: boolean): string => (registeredFirst ? "registered first" : "no dcmp row first");

  it(
    "rules on: on all twelve walks no published champLock is taken back and no team's maxRemainingChamp drops and then rises",
    () => {
      const table: string[] = [];
      const belowTheLine: Record<string, number> = {};
      const tabRecorded: Record<string, Record<string, number>> = {};
      let walks = 0;
      for (const districtKey of PUBLISHED_WALKED) {
        for (const registeredFirst of STARTS) {
          const walk = walkChampionshipField(sourceOf(districtKey), { registeredFirst, finalsTicks: true });
          walks += 1;
          expect({ districtKey, start: startName(registeredFirst), lost: publishedTakenBack(walk) }).toEqual({ districtKey, start: startName(registeredFirst), lost: [] });
          expect({ districtKey, start: startName(registeredFirst), ceilings: publishedCeilingDropsThenRises(walk.steps) }).toEqual({ districtKey, start: startName(registeredFirst), ceilings: [] });
          // The proof never goes back on these walks either.
          expect({ districtKey, start: startName(registeredFirst), proofLost: provenTakenBack(walk.steps) }).toEqual({ districtKey, start: startName(registeredFirst), proofLost: [] });
          expect({ districtKey, start: startName(registeredFirst), rises: unexplainedCeilingRises(walk.steps) }).toEqual({ districtKey, start: startName(registeredFirst), rises: [] });
          belowTheLine[`${districtKey}, ${startName(registeredFirst)}`] = belowTheLineAttendees(walk.steps);
          // Per tick at which a Locked was lost: how many.
          const lostAt: Record<string, number> = {};
          for (const line of lockedTakenBack(walk)) {
            const label = /at "([^"]*)"$/.exec(line)![1]!;
            lostAt[label] = (lostAt[label] ?? 0) + 1;
          }
          tabRecorded[`${districtKey}, ${startName(registeredFirst)}`] = lostAt;
          table.push(`  ${districtKey}, ${startName(registeredFirst)}`, ...publishedTable(walk));
        }
      }
      expect(walks).toBe(12);
      console.log(["[261010-66y group 6] rules on, the published series, the real walks:", ...table].join("\n"));
      console.log(`[261010-66y group 6] the stated limit, teams below the district line whose ceiling rose when their row landed while the field was unproven: ${JSON.stringify(belowTheLine)}`);
      // RECORDED, NOT ASSERTED YET: the Champ Locks tab's own series through
      // the finals ticks, with no bracket facts handed. Its ceiling test
      // reads the finals differently for a team with a finals row and a team
      // without one, which the last step of this quick task closes and
      // asserts.
      console.log(`[261010-66y group 6] recorded, not asserted yet: Champ Locks tab Locked taken back through the finals ticks, no bracket facts: ${JSON.stringify(tabRecorded)}`);
      // THE STATED LIMIT, MEASURED and pinned as the run shows: a team below
      // the district cut line carries no hypothetical championship in the
      // published verdicts, registered at the championship or not, and a
      // few attend all the same. The registered first start counts every
      // one of them (8, 9, 4, 4 and 1), because the field reads unproven
      // from the first event's state on; with no dcmp row first the teams of
      // the first event to post land before anything has started. No lock is
      // taken back by them on any of the twelve walks, asserted above.
      expect(belowTheLine).toEqual({
        "2026fim, no dcmp row first": 0,
        "2026fim, registered first": 0,
        "2026ne, no dcmp row first": 4,
        "2026ne, registered first": 8,
        "2026ont, no dcmp row first": 4,
        "2026ont, registered first": 9,
        "2026fit, no dcmp row first": 3,
        "2026fit, registered first": 4,
        "2026ca, no dcmp row first": 3,
        "2026ca, registered first": 4,
        "2026pnw, no dcmp row first": 0,
        "2026pnw, registered first": 1,
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the first rows rule off: published locks taken back and ceilings that drop and then rise, pinned as the run shows",
    () => {
      const measured: Record<string, { publishedTakenBack: number; ceilingsDropThenRise: number }> = {};
      for (const districtKey of PUBLISHED_WALKED) {
        for (const registeredFirst of STARTS) {
          const walk = withStatelessRowsOff(() => walkChampionshipField(sourceOf(districtKey), { registeredFirst, finalsTicks: true }));
          measured[`${districtKey}, ${startName(registeredFirst)}`] = { publishedTakenBack: publishedTakenBack(walk).length, ceilingsDropThenRise: publishedCeilingDropsThenRises(walk.steps).length };
        }
      }
      console.log(`[261010-66y group 6] the first rows rule off, the real walks: ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. With no dcmp row first every team of the
      // field loses its championship ceiling for the tick its rows arrive
      // (161, 92, 90, 86, 117 and 50 teams), and at 2026 PNW ten published
      // locks are taken back. With every attending team registered first no
      // row is ever stateless.
      expect(measured).toEqual({
        "2026fim, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 161 },
        "2026fim, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026ne, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 92 },
        "2026ne, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026ont, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 90 },
        "2026ont, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026fit, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 86 },
        "2026fit, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026ca, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 117 },
        "2026ca, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026pnw, no dcmp row first": { publishedTakenBack: 10, ceilingsDropThenRise: 50 },
        "2026pnw, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the points arriving only as each event ends, rules on: from every start no published champLock is taken back and no ceiling rises when a division's rows land",
    () => {
      const table: string[] = [];
      for (const districtKey of WALKED_DISTRICTS) {
        const fieldFixing = fieldFixingDcmpKeys(dcmpEventKeysFor(walkedSource(districtKey)));
        for (let finalAtStart = 0; finalAtStart < fieldFixing.length; finalAtStart++) {
          const walk = realEventEndWalk(districtKey, finalAtStart, "on");
          expect({ districtKey, finalAtStart, lost: publishedTakenBack(walk) }).toEqual({ districtKey, finalAtStart, lost: [] });
          expect({ districtKey, finalAtStart, ceilings: publishedCeilingDropsThenRises(walk.steps) }).toEqual({ districtKey, finalAtStart, ceilings: [] });
          expect({ districtKey, finalAtStart, rises: unexplainedCeilingRises(walk.steps) }).toEqual({ districtKey, finalAtStart, rises: [] });
          table.push(`  ${districtKey}, start: ${String(finalAtStart)} of ${String(fieldFixing.length)} field fixing keys final`, ...publishedTable(walk));
        }
      }
      console.log(["[261010-66y group 6] rules on, the published series, the points arriving only as each event ends:", ...table].join("\n"));
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the points arriving only as each event ends, the finals part of the hypothetical championship off: published ceilings that rise when a division's rows land, pinned as the run shows",
    () => {
      const measured: Record<string, { publishedTakenBack: number[]; ceilingRisesWhileUnproven: number[] }> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const fieldFixing = fieldFixingDcmpKeys(dcmpEventKeysFor(walkedSource(districtKey)));
        const walks = fieldFixing.map((_, finalAtStart) => realEventEndWalk(districtKey, finalAtStart, "finalsAllowanceOff"));
        measured[districtKey] = { publishedTakenBack: walks.map((walk) => publishedTakenBack(walk).length), ceilingRisesWhileUnproven: walks.map((walk) => unexplainedCeilingRises(walk.steps).length) };
      }
      console.log(`[261010-66y group 6] the finals part of the hypothetical championship off, the published series, per start (0, 1, 2, ... keys final): ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. Without the finals part every team of a
      // division still to post carried one whole championship, and gained
      // the whole Playoffs ceiling on top when its rows landed: 121, 121,
      // 81 and 40 published ceilings rose at 2026 FIM, and the published
      // champLock was taken back 3, 3 and 2 times. California's
      // championships have no finals, so nothing rose there.
      expect(measured).toEqual({
        "2026fim": { publishedTakenBack: [3, 3, 2, 0], ceilingRisesWhileUnproven: [121, 121, 81, 40] },
        "2026ne": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [46, 46] },
        "2026ont": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [45, 45] },
        "2026fit": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [42, 42] },
        "2026ca": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [0, 0] },
      });
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 7. The convention the finals reading rests on
// ---------------------------------------------------------------------------

/** Impact, Engineering Inspiration and Rookie All Star: the judged awards that take a Championship slot at a District Championship. */
const CONSUMING_JUDGED_AWARD_TYPES: ReadonlySet<number> = new Set([0, 9, 10]);

describe("the convention the finals reading rests on, over every local district artifact (quick task 261010-66y)", () => {
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it("every row at a finals key that carries award points belongs to a team with a consuming award recorded there, and a team whose only championship row is the finals row earned nothing else there", () => {
    let finalsRows = 0;
    let withAwardPoints = 0;
    let finalsOnlyRows = 0;
    const withoutConsumingAward: string[] = [];
    const finalsOnlyWithOtherPoints: string[] = [];
    const finalsOnlyTeamKeys = new Set<string>();
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const artifact = localArtifact(fileName);
      const dcmpKeys = dcmpEventKeysFor(artifact);
      const fieldFixing = new Set(fieldFixingDcmpKeys(dcmpKeys));
      // A finals key is a dcmp key another dcmp key of the artifact extends by one digit.
      const finalsKeys = new Set(dcmpKeys.filter((key) => !fieldFixing.has(key)));
      for (const team of artifact.teams) {
        const hasDivisionRow = team.eventPoints.some((row) => fieldFixing.has(row.eventKey));
        for (const row of team.eventPoints) {
          if (!finalsKeys.has(row.eventKey)) continue;
          finalsRows += 1;
          if (row.award > 0) {
            withAwardPoints += 1;
            const consuming = team.qualifyingAwards.some((award) => award.eventKey === row.eventKey && CONSUMING_JUDGED_AWARD_TYPES.has(award.awardType));
            if (!consuming) withoutConsumingAward.push(`${artifact.districtKey} ${team.teamKey} ${row.eventKey} award ${String(row.award)}`);
          }
          if (!hasDivisionRow) {
            finalsOnlyRows += 1;
            finalsOnlyTeamKeys.add(`${artifact.districtKey} ${team.teamKey}`);
            if (row.qual + row.alliance + row.elim !== 0) finalsOnlyWithOtherPoints.push(`${artifact.districtKey} ${team.teamKey} ${row.eventKey} ${String(row.qual)}, ${String(row.alliance)}, ${String(row.elim)}`);
          }
        }
      }
    }
    console.log(
      `[261010-66y group 7] rows at a finals key ${String(finalsRows)} | with award points ${String(withAwardPoints)} | of them with no consuming award recorded there ${String(withoutConsumingAward.length)} | finals rows of a team with no division row ${String(finalsOnlyRows)} (${String(finalsOnlyTeamKeys.size)} teams) | of them with qualification, alliance selection or playoff points ${String(finalsOnlyWithOtherPoints.length)}`
    );
    // WHAT BREAKS IF THIS FAILS: the finals' Awards add no points ceiling for
    // anyone in the published verdicts (`openAtPlayedRows`) and, from this
    // quick task's last step, on the Champ Locks tab; a row at a finals key of
    // a team with no division row adds no ceiling at all; and the joint worst
    // case proof gives the finals no judged award budget. All of it rests on a
    // points paying award at a finals event being a consuming award, which
    // takes a Championship slot whatever its winner's points and which the
    // reservation holds a place for. A season that shows an ordinary judged
    // award with points at a finals event, or a team paid Playoffs points at
    // the finals without a division row, needs those readings looked at again.
    expect(withoutConsumingAward).toEqual([]);
    expect(finalsOnlyWithOtherPoints).toEqual([]);
    // The counts, as the run shows.
    expect({ finalsRows, withAwardPoints, finalsOnlyRows, finalsOnlyTeams: finalsOnlyTeamKeys.size }).toEqual({ finalsRows: 265, withAwardPoints: 153, finalsOnlyRows: 20, finalsOnlyTeams: 20 });
  });
});

