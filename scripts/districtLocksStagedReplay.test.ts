/**
 * The staged replay: an event walked stage by stage with its points LAGGING
 * its matches, through the shared merge and both Locks tabs' status code
 * (quick task 261009-vp9, CONTEXT D3 and D6).
 *
 * THE RULE, Jacob's: "it is mission critical that no team is told they are
 * locked at any stop, and then later they are not locked."
 *
 * THE GAP this file holds closed. An event's state block (qualification
 * matches played, alliances picked, playoffs done) comes from the match feed
 * and moves within a minute. Each team's points come from TBA's district
 * rankings, a different feed that can lag. Read from the state alone, a
 * category closed before its points were in: a rival lost a ceiling it could
 * still fill, a team read Locked, and the points arriving took the Locked
 * back. A category's number now reads final only once its points are in
 * (`packages/core/districts/categoryCorroboration.ts`).
 *
 * WHAT IS WALKED. One event at a time is rewound in the committed 2026 PNW
 * fixture (every other event stays finished) and replayed over ten ticks:
 *
 *   0  qualification in progress, provisional qualification points
 *   1  last qualification match played, the rankings not caught up
 *   2  the rankings catch up
 *   3  alliances picked, no alliance points on any row
 *   4  alliance points land
 *   5  playoffs done, no playoff points on any row
 *   6  playoff points land
 *   7  the judged awards are listed
 *   8  award points land
 *   9  the list has settled, the flag turns true
 *
 * The state before tick 0 (the event not started) is the walk's first entry.
 * Each tick goes through `applyDistrictRankings` when the rows change and
 * `applyDistrictEventState` when only the state does, the two entry points
 * the live Worker calls, and then through the tabs' own code at Now:
 * `buildDistrictLedgerRows` and `computeDistrictLedgerStatuses` for District
 * Locks, `buildChampLedgerRows` and `computeChampLedgerStatuses` for Champ
 * Locks.
 *
 * THE GROUPS OF THIS FILE:
 *   1. every district tier event of the fixture, the ten ticks;
 *   2. two synthetic single championships, in both tick orders (the Winner
 *      listed before the playoff points land, and after);
 *   3. the late award walks: a consuming award listed two hours after the
 *      rest of its list, and a list that never gains its Impact;
 *   4. the field conditioned walks, with the played bracket handed to the
 *      tabs at every tick, in the two cases about when TBA posts points
 *      (minutes late, or only when the event ends);
 *   5. the Now census over every local district artifact;
 *   6. the reordered walks: a later layer of points landing before the layer
 *      below it (playoff points before alliance points, award points and a
 *      settled list before playoff points).
 * Groups 1 to 3 and 6 read the committed fixture only and always run. Groups
 * 4 and 5 read gitignored local data and skip, with a message naming what is
 * absent, where it is not there. With `REQUIRE_LOCAL_DATA=1` in the
 * environment such a group FAILS instead of skipping (quick task 261010-66y),
 * so a verify step cannot pass on a machine that silently ran nothing.
 *
 * THE EVENT LIST IS DERIVED from the fixture, never typed in, and its count
 * is asserted.
 *
 * IT PROVES SOMETHING. The same walks run with the rule switched off inside
 * this file (the core rule replaced by the state's own reading through a
 * module mock, every other change left on) and must then take locks back.
 * The switched off totals are PINNED AS THE RUN SHOWS: they are a
 * measurement of the old reading, not a requirement.
 *
 * WHEN TBA POSTS POINTS DURING AN EVENT IS NOT VERIFIED. No live district
 * weekend has been observed. Group 4 walks both cases and asserts neither.
 *
 * THE SECURED PLAYOFF MINIMUM ON THESE WALKS (quick task 261012-mw2). The two
 * recipes of group 4 hand the tabs a played bracket at every tick from
 * "alliances picked" on, and with it each listed pick's secured playoff
 * minimum from the same played rows (`securedElimEntry`), which is what the
 * rows module's own reader gives. Groups 1 to 3 and 6 hand no bracket, so
 * nobody is credited there and those walks read as they did before that task.
 *
 * NO FLOOR DROPS (that task's CONTEXT D5). Every step of every walk carries
 * each team's FLOOR on both tabs: the District Locks floor from
 * `districtLockBounds`, the one place that tab's status code takes it from,
 * and the Champ Locks floor from the status model's own `floorByTeam`.
 * Wherever this file requires a rules on walk to take no lock back it also
 * requires that no team's floor is lower at a step than at the step before,
 * on either tab (`floorsLower`). The tick the playoff points land is one of
 * those steps: the secured minimum is never above what TBA then posts. A
 * floor that fell with the rules on is a finding, never a pin to move. The
 * four rule off readings pin how many floors fell, as the run shows: there a
 * category closes on a number that is not in yet, and the floor that counted
 * the stale number falls when the real one lands.
 *
 * THE LARGER OF THE TWO. Where a Playoffs category reads final the floor
 * counts TBA's posted number or the secured minimum, whichever is larger. A
 * category that reads final on rows older than the played bracket therefore
 * still counts what the bracket has secured. With this file's rule switched
 * off that is exactly the state group 4 builds, and two of its rule off
 * readings lose less than they did before that task:
 *
 *   - the field conditioned walks of the eight district events: the District
 *     Locks tab takes 26 and 24 Locked back in the two cases, where it took
 *     32 and 34. The published verdicts carry no credit and read 32 and 9,
 *     34 and 16, as before.
 *   - the real 2026pncmp, case B: the Champ Locks tab took frc2522 and
 *     frc5937 back and now takes nobody back. At "playoffs done, rows still
 *     stale" the bracket's teams hold their secured playoff points in their
 *     floors, and neither of the two is shown Locked there any more.
 *
 * Both are read with the credit switched off as well, where they read what
 * this file pinned before that task: the rule of quick task 261009-vp9 is
 * still shown to bite on its own. Floors still fall in both readings with
 * that rule off (the stale qualification numbers), with the credit or
 * without it.
 *
 * THE CREDIT OFF SWITCH is the third switch below. WHAT THE CREDIT ADDED on
 * the rules on walks of group 4, read by walking each with the credit and
 * without it: over the eight district events the District Locks tab shows a
 * team Locked at 105 team ticks more in case A and 97 more in case B, the
 * Champ Locks tab at 19 and 22 more; at the real 2026pncmp the Champ Locks
 * tab at 17 team ticks more in case A and none in case B. No team is Locked
 * at a tick without the credit and not Locked at the same tick with it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDistrictEventState, applyDistrictRankings, publishedCategoryFinality, recomputeDistrictVerdicts } from "../packages/harness/districtRankingsMerge.js";
import { DistrictArtifactSchema, EventArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../packages/harness/pageArtifacts.js";
import { maxEventPoints, type DistrictTier } from "../packages/core/districts/pointModel.js";
import { AWARDS_SETTLE_WITHOUT_IMPACT_MS, awardsListSettled } from "../packages/core/districts/eventAwards.js";
import { MAX_WINNING_ALLIANCE_SIZE, pendingAwardSlots } from "../packages/core/districts/champReservedSlots.js";
import { dcmpAwardCountCeilings } from "../packages/core/districts/hypotheticalDcmp.js";
import { districtEventCategoryFinality, type DistrictCategoryFinality } from "../packages/core/districts/reservedSlots.js";
import {
  DISTRICT_CATEGORIES,
  buildDistrictLedgerRows,
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  securedElimEntry,
  deriveStageFromState,
  liveStageByEvent,
  playedBracketMatchesFor,
  tierEvents,
  type BracketSourceEvent,
  type DistrictEventDistributions,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import { computeDistrictLedgerStatuses, districtLockBounds } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildChampLedgerRows, champTierEvents, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { buildDistrictTimeline } from "../apps/web/src/components/districts/districtTimeline.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { bracketFromCorpus, CORPUS_PATH, LOCAL_DISTRICT_DIR } from "./measureChampJointLocks.js";
import { settledDistrictContext, settledStops, type SettledStop } from "./measureLedgerSettledTenets.js";

/**
 * THE TWO SWITCHES. Nothing else is switched: the merge, the row builders and
 * the status code all run as shipped.
 *
 * While `off` is set, the one core rule answers with the state's own
 * reading, which is what it replaced.
 *
 * While `hardeningOff` is set, the two rules read as they did BEFORE the
 * hardening of group 6: Playoffs final closes Alliance selection and
 * Qualification without their own points, and the awards flag does not ask
 * for playoff points at the event.
 *
 * AND ONE SWITCH THAT IS NOT A RULE OF THIS FILE: THE CREDIT (quick task
 * 261012-mw2). While `creditOff` is set, `securedPlayoffPoints` answers with
 * an empty map. Every secured playoff minimum on either tab goes through that
 * one function (`securedElimByTeamFor` in the rows module), so with it set no
 * row carries a credit and every recipe, row and status of this file reads as
 * it did before that task. It combines with either switch above.
 */
const ruleSwitch = vi.hoisted(() => ({ off: false, hardeningOff: false, creditOff: false }));

vi.mock("../packages/core/districts/categoryCorroboration.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/categoryCorroboration.js")>();
  const slots = await vi.importActual<typeof import("../packages/core/districts/reservedSlots.js")>("../packages/core/districts/reservedSlots.js");
  /** The rule before the hardening: a later category's finality closed every earlier one. */
  const beforeHardening: typeof original.corroboratedCategoryFinality = (state, presence) => {
    if (state === undefined) return slots.ALL_CATEGORIES_OPEN;
    const award = state.awardsPosted;
    const elim = award || (state.playoffsDone && presence.winnerPlayoffPoints);
    if (presence.finalsEvent) {
      const field = slots.districtEventCategoryFinality(state);
      return { qual: field.qual, alliance: field.alliance, elim, award };
    }
    const alliance = elim || (state.alliancesPicked && presence.alliancePoints);
    return { qual: alliance, alliance, elim, award };
  };
  return {
    ...original,
    corroboratedCategoryFinality: (...args: Parameters<typeof original.corroboratedCategoryFinality>) =>
      ruleSwitch.off ? slots.districtEventCategoryFinality(args[0]) : ruleSwitch.hardeningOff ? beforeHardening(...args) : original.corroboratedCategoryFinality(...args),
  };
});

vi.mock("../packages/core/districts/eventAwards.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/eventAwards.js")>();
  return {
    ...original,
    // Before the hardening the live flag did not ask for playoff points.
    awardsPostedRule: (...args: Parameters<typeof original.awardsPostedRule>) =>
      original.awardsPostedRule(ruleSwitch.hardeningOff ? { ...args[0], playoffPointsPresent: true } : args[0], args[1]),
  };
});

vi.mock("../packages/core/districts/securedPlayoffPoints.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/securedPlayoffPoints.js")>();
  return {
    ...original,
    // The credit off switch: nobody has secured anything, which is the reading of before quick task 261012-mw2.
    securedPlayoffPoints: (...args: Parameters<typeof original.securedPlayoffPoints>): ReturnType<typeof original.securedPlayoffPoints> =>
      ruleSwitch.creditOff ? new Map<string, number>() : original.securedPlayoffPoints(...args),
  };
});

afterEach(() => {
  ruleSwitch.off = false;
  ruleSwitch.hardeningOff = false;
  ruleSwitch.creditOff = false;
});

/** Runs `body` with no secured playoff minimum credited to anybody, and switches the credit back on whatever happens. */
function withCreditOff<T>(body: () => T): T {
  ruleSwitch.creditOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.creditOff = false;
  }
}

/** Runs `body` with the rule switched off, and switches it back on whatever happens. */
function withRuleOff<T>(body: () => T): T {
  ruleSwitch.off = true;
  try {
    return body();
  } finally {
    ruleSwitch.off = false;
  }
}

/** Runs `body` with the hardening of group 6 switched off, and switches it back on whatever happens. */
function withHardeningOff<T>(body: () => T): T {
  ruleSwitch.hardeningOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.hardeningOff = false;
  }
}

/**
 * A local data gated group whose data is absent: one skipped test naming what
 * is missing, or with `REQUIRE_LOCAL_DATA=1` one FAILING test (quick task
 * 261010-66y).
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
interface Points {
  readonly qual: number;
  readonly alliance: number;
  readonly elim: number;
  readonly award: number;
}
interface AwardEntry {
  readonly award_type: number;
  readonly recipient_list: readonly { readonly team_key: string | null }[];
}

const SEASON = 2026;
const NOW_YEAR = 2026;
const STAMP = { generation: "staged-replay", computedAt: "2026-04-05T00:00:00.000Z" } as const;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(REPO_ROOT, "data", "fixtures", "phase10");
const fixtureFile: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, "district-2026pnw.json"), "utf8")));

/** Synthetic counts, real meaning: 60 qualification matches scheduled. */
const QUAL_TOTAL = 60;
const QUAL_PLAYED_IN_PROGRESS = 50;
const FINISHED_STATE: DistrictEventState = { qualMatchesPlayed: QUAL_TOTAL, qualMatchesTotal: QUAL_TOTAL, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const NOT_STARTED_STATE: DistrictEventState = { qualMatchesPlayed: 0, qualMatchesTotal: QUAL_TOTAL, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

/** The fixture with a finished state block on every row, at the verdict pass's fixed point. */
const baseline: DistrictArtifact = recomputeDistrictVerdicts(
  DistrictArtifactSchema.parse({ ...fixtureFile, teams: fixtureFile.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => ({ ...row, state: { ...FINISHED_STATE } })) })) }),
  { nowYear: NOW_YEAR }
);

/** DERIVED, never typed in: every event key on a district tier `eventPoints` row of the fixture, sorted. */
const districtEvents: string[] = [...new Set(fixtureFile.teams.flatMap((team) => team.eventPoints.filter((row) => row.tier === "district").map((row) => row.eventKey)))].sort();
/** DERIVED: the fixture's one District Championship. */
const dcmpEvents: string[] = [...new Set(fixtureFile.teams.flatMap((team) => team.eventPoints.filter((row) => row.tier === "dcmp").map((row) => row.eventKey)))].sort();
const PNCMP = "2026pncmp";

const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();
const ALL_OPEN: DistrictCategoryFinality = { qual: false, alliance: false, elim: false, award: false };
const ALL_FINAL: DistrictCategoryFinality = { qual: true, alliance: true, elim: true, award: true };
const QUAL_AND_ALLIANCE: DistrictCategoryFinality = { qual: true, alliance: true, elim: false, award: false };

const districtHeld = (status: string): boolean => status === "locked" || status === "lockedAward";
const champHeld = (status: string): boolean => status === "locked" || status === "lockedAward" || status === "prequalified";
/** A tab status of `locked` covers Locked on points and Locked by an award. */
const districtTabHeld = (status: string): boolean => status === "locked";
const champTabHeld = (status: string): boolean => status === "locked" || status === "prequalified";

/** The tier a baseline's rows carry an event at. */
function tierOf(artifact: DistrictArtifact, eventKey: string): DistrictTier {
  for (const team of artifact.teams) for (const row of team.eventPoints) if (row.eventKey === eventKey) return row.tier;
  throw new Error(`no row for ${eventKey}`);
}

/** DERIVED: whether an artifact carries a row at the winner's playoff value for the event. Where it does not, Playoffs wait for the awards flag. */
function hasWinnerRow(artifact: DistrictArtifact, eventKey: string): boolean {
  const winnerValue = maxEventPoints(SEASON, tierOf(artifact, eventKey)).elim;
  return artifact.teams.some((team) => team.eventPoints.some((row) => row.eventKey === eventKey && row.elim >= winnerValue));
}

/** The state block of an event as the artifact carries it now: a row with a state wins over one without. */
function stateAt(artifact: DistrictArtifact, eventKey: string): DistrictEventState | undefined {
  let found: DistrictEventState | undefined;
  for (const team of artifact.teams) for (const row of [...team.eventPoints, ...team.remainingEvents]) if (row.eventKey === eventKey && found === undefined) found = row.state;
  return found;
}

// ---------------------------------------------------------------------------
// What one tick left behind
// ---------------------------------------------------------------------------

interface WalkStep {
  readonly label: string;
  /** The published `districtLock.status` of every team. */
  readonly district: ReadonlyMap<string, string>;
  /** The published `champLock.status` of every team. */
  readonly champ: ReadonlyMap<string, string>;
  /** The District Locks status of every team, from the tab's own status code at Now. */
  readonly districtTab: ReadonlyMap<string, string>;
  /** The Champ Locks status of every team, from the tab's own status code at Now. */
  readonly champTab: ReadonlyMap<string, string>;
  /** The walked event's finality as the verdict pass reads it. */
  readonly publishedFinal: DistrictCategoryFinality;
  /** The walked event's finality as the tabs' rows read it (every row of the event agrees, asserted while walking). */
  readonly rowFinal: DistrictCategoryFinality;
  /** `team category` for every cell at the walked event that is `kind: "final"` while its category reads open and no bracket placement settles it. */
  readonly greyOpenCells: readonly string[];
  /** How many rows of the walked event carry a settled Playoffs value while their Alliance selection reads open. */
  readonly settledWhileAllianceOpen: number;
  /** The event's `awardsPosted` flag on the artifact. */
  readonly flag: boolean;
  /** The Champ Locks joint proof at this tick: `applied`, the reason it refused, or `none` where the status code was handed no distributions. */
  readonly jointProof: string;
  /** The champ tier reservation the Champ Locks status code computed. */
  readonly champReserved: number;
  /** Every team's FLOOR on the District Locks tab at this tick: `districtLockBounds`, the one place that tab's status code takes it from (quick task 261012-mw2). */
  readonly districtFloor: ReadonlyMap<string, number>;
  /** Every team's FLOOR on the Champ Locks tab at this tick: the status model's own `floorByTeam` (quick task 261012-mw2). */
  readonly champFloor: ReadonlyMap<string, number>;
}

interface Walk {
  readonly eventKey: string;
  readonly steps: readonly WalkStep[];
  readonly end: DistrictArtifact;
}

/**
 * Reads everything a test asserts after one tick. `distributions` is what the
 * tabs' run would hand the row builder at this tick: nothing, or the field's
 * bracket facts.
 */
function snapshot(label: string, artifact: DistrictArtifact, eventKey: string, distributions: ReadonlyMap<string, DistrictEventDistributions> = NO_DISTRIBUTIONS): WalkStep {
  const tier = tierOf(baseline, eventKey) === "dcmp" || [...artifact.teams].some((team) => tierEvents(team, "dcmp").some((entry) => entry.eventKey === eventKey)) ? "dcmp" : "district";

  // District Locks, at Now.
  const districtRows = buildDistrictLedgerRows({ artifact, distributions, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });

  // Champ Locks, at Now, as `scripts/measureChampTenets.ts` reads it.
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);
  const started = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) if (deriveStageFromState(entry.state).started) started.add(entry.eventKey);
  const champRows = buildChampLedgerRows({ artifact, distributions, startedDcmpEventKeys: new Set(dcmpEventKeysFor(artifact).filter((key) => started.has(key))), atLivePosition: true, nowYear: NOW_YEAR });
  // The rows' own field flag goes on to the status code, as the tab hands it (quick task 261010-66y).
  const champStatuses = computeChampLedgerStatuses({ artifact, teams: champRows.teams, districtLockedOut, nowYear: NOW_YEAR, fieldProven: champRows.fieldProven, ...(distributions.size === 0 ? {} : { distributions }) });

  // The walked event's own rows at its own tier.
  const tierRows = tier === "district" ? districtRows : buildDistrictLedgerRows({ artifact, distributions, tier: "dcmp" });
  const eventRows = tierRows.teams.flatMap((team) => team.rows.filter((row) => row.eventKey === eventKey).map((row) => ({ teamKey: team.teamKey, row })));
  const rowFinal: DistrictCategoryFinality = eventRows[0]?.row.stage.final ?? ALL_OPEN;
  const greyOpenCells: string[] = [];
  let settledWhileAllianceOpen = 0;
  for (const { teamKey, row } of eventRows) {
    // Every row of one event carries one stage.
    expect({ label, teamKey, final: row.stage.final }).toEqual({ label, teamKey, final: rowFinal });
    if (row.settledElim !== undefined && !row.stage.final.alliance) settledWhileAllianceOpen += 1;
    DISTRICT_CATEGORIES.forEach((category, index) => {
      if (row.stage.final[category] || row.cells[index]!.kind !== "final") return;
      // A decided bracket placement settles the Playoffs cell while the
      // category stays open: that grey cell is the bracket's, not a number
      // read before its points are in.
      if (category === "elim" && row.settledElim !== undefined) return;
      greyOpenCells.push(`${teamKey} ${category}`);
    });
  }

  // THE FLOORS the two tabs' lock math counts at this tick (quick task 261012-mw2). The District Locks status model
  // does not publish its floors, so they are read from the function its status code calls, with the same ceilings.
  const districtMaxima = maxEventPoints(artifact.year, "district");
  const districtCeilings = { qual: districtMaxima.qual, alliance: districtMaxima.alliance, elim: districtMaxima.elim, award: districtMaxima.award };
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const districtFloor = new Map<string, number>();
  for (const team of districtRows.teams) {
    const source = sourceByKey.get(team.teamKey);
    if (source !== undefined) districtFloor.set(team.teamKey, districtLockBounds(source, team.rows, districtCeilings).floor);
  }

  const proof = champStatuses.jointProof;
  return {
    label,
    district: new Map(artifact.teams.map((team) => [team.teamKey, team.districtLock.status] as const)),
    champ: new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const)),
    districtTab: new Map([...districtStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    champTab: new Map([...champStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    publishedFinal: publishedCategoryFinality(artifact.teams, eventKey, stateAt(artifact, eventKey), SEASON),
    rowFinal,
    greyOpenCells,
    settledWhileAllianceOpen,
    flag: stateAt(artifact, eventKey)?.awardsPosted === true,
    jointProof: proof === undefined ? "none" : proof.applied ? "applied" : proof.reason,
    champReserved: champStatuses.reservedSlots,
    districtFloor,
    champFloor: new Map(champStatuses.floorByTeam ?? []),
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

/**
 * NO FLOOR DROPS (quick task 261012-mw2): one line for every team whose floor
 * at a step is BELOW its floor at the step before, on the tab named. A team
 * that is on only one of the two steps is not compared.
 */
function floorDrops(steps: readonly WalkStep[], tab: "district" | "champ"): string[] {
  const floors = (step: WalkStep): ReadonlyMap<string, number> => (tab === "district" ? step.districtFloor : step.champFloor);
  const lower: string[] = [];
  for (let index = 1; index < steps.length; index++) {
    const before = steps[index - 1]!;
    const after = steps[index]!;
    for (const [teamKey, was] of floors(before)) {
      const now = floors(after).get(teamKey);
      if (now !== undefined && now < was) lower.push(`${tab} tab ${teamKey} floor ${String(was)} at "${before.label}", ${String(now)} at "${after.label}"`);
    }
  }
  return lower;
}

/** Both tabs' floors over one walk: the requirement of a rules on walk is that this is empty. */
const floorsLower = (steps: readonly WalkStep[]): string[] => [...floorDrops(steps, "district"), ...floorDrops(steps, "champ")];

/** How many floors fell over a set of walks, per tab, and how many were compared: what a rule off reading pins. */
function floorTally(walks: readonly Walk[]): { compared: number; districtLower: number; champLower: number } {
  let compared = 0;
  for (const walk of walks) {
    for (let index = 1; index < walk.steps.length; index++) {
      for (const teamKey of walk.steps[index - 1]!.districtFloor.keys()) if (walk.steps[index]!.districtFloor.has(teamKey)) compared += 1;
      for (const teamKey of walk.steps[index - 1]!.champFloor.keys()) if (walk.steps[index]!.champFloor.has(teamKey)) compared += 1;
    }
  }
  return {
    compared,
    districtLower: walks.reduce((sum, walk) => sum + floorDrops(walk.steps, "district").length, 0),
    champLower: walks.reduce((sum, walk) => sum + floorDrops(walk.steps, "champ").length, 0),
  };
}

/** The label of the step each loss was seen at, for counting losses per gap. */
function lossSteps(losses: readonly string[]): string[] {
  return losses.map((loss) => /at "([^"]*)"$/.exec(loss)![1]!);
}

/** A team the published verdict reads `eliminated` reads only `eliminated` or `lockedAward` afterwards. */
function eliminatedThenBack(steps: readonly WalkStep[]): string[] {
  const back: string[] = [];
  for (const teamKey of steps[0]!.district.keys()) {
    let outAt = -1;
    for (let index = 0; index < steps.length; index++) {
      const status = steps[index]!.district.get(teamKey) ?? "absent";
      if (status === "eliminated") {
        if (outAt === -1) outAt = index;
      } else if (outAt !== -1 && status !== "lockedAward") {
        back.push(`${teamKey} eliminated at "${steps[outAt]!.label}", ${status} at "${steps[index]!.label}"`);
        break;
      }
    }
  }
  return back;
}

/** The end state's verdicts, totals and ceilings equal a baseline's for every team. */
function expectEndState(walk: Walk, expected: DistrictArtifact): void {
  expect(walk.end.teams).toHaveLength(expected.teams.length);
  for (const team of walk.end.teams) {
    const published = expected.teams.find((entry) => entry.teamKey === team.teamKey)!;
    expect({
      eventKey: walk.eventKey,
      teamKey: team.teamKey,
      district: team.districtLock.status,
      champ: team.champLock.status,
      pointTotal: team.pointTotal,
      maxRemainingDistrict: team.maxRemainingDistrict,
      maxRemainingChamp: team.maxRemainingChamp,
    }).toEqual({
      eventKey: walk.eventKey,
      teamKey: team.teamKey,
      district: published.districtLock.status,
      champ: published.champLock.status,
      pointTotal: published.pointTotal,
      maxRemainingDistrict: published.maxRemainingDistrict,
      maxRemainingChamp: published.maxRemainingChamp,
    });
  }
}

// ---------------------------------------------------------------------------
// One event rewound, and the two merge entry points
// ---------------------------------------------------------------------------

/** One tick: its label, what it does to the artifact, and the bracket stop the field shows at it (group 4). */
interface Tick {
  readonly label: string;
  readonly apply: () => void;
  readonly bracket?: string;
}

/**
 * One event of `source` rewound to "not started", with the two entry points
 * the Worker calls and the points every participant ends on.
 */
function eventWalker(source: DistrictArtifact, eventKey: string) {
  const tier = tierOf(source, eventKey);
  const finalRow = new Map<string, Row>();
  for (const team of source.teams) {
    const row = team.eventPoints.find((entry) => entry.eventKey === eventKey);
    if (row !== undefined) finalRow.set(team.teamKey, row);
  }
  const participants = [...finalRow.keys()].sort();
  const final = (teamKey: string): Row => finalRow.get(teamKey)!;
  // Stale qualification points: each participant's final value, taken from
  // the participant seven places on in key order, wrapping, so some sit above
  // and some below what they finish on.
  const provisionalQual = new Map(participants.map((teamKey, index) => [teamKey, final(participants[(index + 7) % participants.length]!).qual] as const));

  // The awards TBA lists for the event: every award the artifact records
  // there, one entry per recipient, and one judged award with no district
  // recipient.
  const recorded: AwardEntry[] = source.teams.flatMap((team) =>
    team.qualifyingAwards.filter((award) => award.eventKey === eventKey).map((award) => ({ award_type: award.awardType, recipient_list: [{ team_key: team.teamKey }] }))
  );
  const awardsList: AwardEntry[] = [...recorded, { award_type: 29, recipient_list: [{ team_key: null }] }];
  const winnerOnly: AwardEntry[] = recorded.filter((entry) => entry.award_type === 1);

  // Before tick 0: the event has not started. Its participants' rows are
  // remaining events again, their totals lose the row and their awards at the
  // event leave the list.
  const eventMaxima = maxEventPoints(SEASON, tier);
  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...source,
      teams: source.teams.map((team) => {
        const row = finalRow.get(team.teamKey);
        if (row === undefined) return team;
        return {
          ...team,
          pointTotal: team.pointTotal - row.total,
          eventPoints: team.eventPoints.filter((entry) => entry.eventKey !== eventKey),
          remainingEvents: [
            ...team.remainingEvents,
            { eventKey, eventName: row.eventName, week: row.week, tier, maxPoints: eventMaxima.qual + eventMaxima.alliance + eventMaxima.elim + eventMaxima.award, state: { ...NOT_STARTED_STATE } },
          ],
          qualifyingAwards: team.qualifyingAwards.filter((award) => award.eventKey !== eventKey),
        };
      }),
    }),
    { nowYear: NOW_YEAR }
  );

  /** A TBA shaped rankings payload: every other row as published, the walked event's row at the given points. */
  const payload = (at: (teamKey: string) => Points) =>
    source.teams.map((team) => {
      const row = finalRow.get(team.teamKey);
      const others = team.eventPoints
        .filter((entry) => entry.eventKey !== eventKey)
        .map((entry) => ({ event_key: entry.eventKey, district_cmp: entry.tier === "dcmp", qual_points: entry.qual, alliance_points: entry.alliance, elim_points: entry.elim, award_points: entry.award, total: entry.total }));
      if (row === undefined) return { team_key: team.teamKey, rank: team.rank, point_total: team.pointTotal, rookie_bonus: team.rookieBonus, adjustments: team.adjustments, event_points: others };
      const points = at(team.teamKey);
      const total = points.qual + points.alliance + points.elim + points.award;
      return {
        team_key: team.teamKey,
        rank: team.rank,
        point_total: team.pointTotal - row.total + total,
        rookie_bonus: team.rookieBonus,
        adjustments: team.adjustments,
        event_points: [...others, { event_key: eventKey, district_cmp: tier === "dcmp", qual_points: points.qual, alliance_points: points.alliance, elim_points: points.elim, award_points: points.award, total }],
      };
    });

  type Extra = { eventAwards?: ReadonlyMap<string, readonly AwardEntry[]>; settledAwardEvents?: ReadonlySet<string>; longSettledAwardEvents?: ReadonlySet<string> };
  return {
    eventKey,
    tier,
    awardsList,
    winnerOnly,
    current: (): DistrictArtifact => artifact,
    /**
     * The event's state for a tick. The flag is ALWAYS the one the artifact
     * already holds, as the Worker hands it, never a literal false: only the
     * awards step raises it.
     */
    stateOf: (played: number, picked: boolean, done: boolean): DistrictEventState => ({
      qualMatchesPlayed: played,
      qualMatchesTotal: QUAL_TOTAL,
      alliancesPicked: picked,
      playoffsDone: done,
      awardsPosted: stateAt(artifact, eventKey)?.awardsPosted === true,
    }),
    rowsChange: (state: DistrictEventState, at: (teamKey: string) => Points, extra: Extra = {}): void => {
      artifact = applyDistrictRankings({ artifact, rankings: payload(at), ...STAMP, eventState: new Map([[eventKey, state]]), ...extra });
    },
    stateOnly: (state: DistrictEventState, extra: Extra = {}): void => {
      artifact = applyDistrictEventState({ artifact, eventState: new Map([[eventKey, state]]), ...STAMP, ...extra });
    },
    // The points a participant's row carries at each stage of the lag.
    stale: (teamKey: string): Points => ({ qual: provisionalQual.get(teamKey)!, alliance: 0, elim: 0, award: 0 }),
    qualOnly: (teamKey: string): Points => ({ qual: final(teamKey).qual, alliance: 0, elim: 0, award: 0 }),
    upToAlliance: (teamKey: string): Points => ({ qual: final(teamKey).qual, alliance: final(teamKey).alliance, elim: 0, award: 0 }),
    upToElim: (teamKey: string): Points => ({ qual: final(teamKey).qual, alliance: final(teamKey).alliance, elim: final(teamKey).elim, award: 0 }),
    all: (teamKey: string): Points => ({ qual: final(teamKey).qual, alliance: final(teamKey).alliance, elim: final(teamKey).elim, award: final(teamKey).award }),
  };
}

type EventWalker = ReturnType<typeof eventWalker>;

/** Runs the ticks in order, reading everything after each, with the entry before tick 0 first. */
function runTicks(walker: EventWalker, ticks: readonly Tick[], distributionsAt: (bracket: string | undefined) => ReadonlyMap<string, DistrictEventDistributions> = () => NO_DISTRIBUTIONS, before = "before the event"): Walk {
  const steps: WalkStep[] = [snapshot(before, walker.current(), walker.eventKey)];
  for (const tick of ticks) {
    tick.apply();
    steps.push(snapshot(tick.label, walker.current(), walker.eventKey, distributionsAt(tick.bracket)));
  }
  return { eventKey: walker.eventKey, steps, end: walker.current() };
}

// ---------------------------------------------------------------------------
// GROUP 1. Every district tier event, the ten ticks
// ---------------------------------------------------------------------------

const TEN_TICK_LABELS = [
  "0 qualification in progress",
  "1 last qualification match played, rankings stale",
  "2 rankings catch up",
  "3 alliances picked, no alliance points",
  "4 alliance points land",
  "5 playoffs done, no playoff points",
  "6 playoff points land",
  "7 judged awards listed",
  "8 award points land",
  "9 list settled",
] as const;

function walkDistrictEvent(eventKey: string): Walk {
  const w = eventWalker(baseline, eventKey);
  const listed = { eventAwards: new Map([[eventKey, w.awardsList]]) };
  const applies: (() => void)[] = [
    () => w.rowsChange(w.stateOf(QUAL_PLAYED_IN_PROGRESS, false, false), w.stale),
    () => w.stateOnly(w.stateOf(QUAL_TOTAL, false, false)),
    () => w.rowsChange(w.stateOf(QUAL_TOTAL, false, false), w.qualOnly),
    () => w.stateOnly(w.stateOf(QUAL_TOTAL, true, false)),
    () => w.rowsChange(w.stateOf(QUAL_TOTAL, true, false), w.upToAlliance),
    () => w.stateOnly(w.stateOf(QUAL_TOTAL, true, true)),
    () => w.rowsChange(w.stateOf(QUAL_TOTAL, true, true), w.upToElim),
    () => w.stateOnly(w.stateOf(QUAL_TOTAL, true, true), listed),
    () => w.rowsChange(w.stateOf(QUAL_TOTAL, true, true), w.all, listed),
    () => w.stateOnly(w.stateOf(QUAL_TOTAL, true, true), { ...listed, settledAwardEvents: new Set([eventKey]) }),
  ];
  return runTicks(
    w,
    applies.map((apply, index) => ({ label: TEN_TICK_LABELS[index]!, apply }))
  );
}

/** The step of tick `n` (0 to 9). Index 0 of `steps` is the entry before tick 0. */
const tickOf = (walk: Walk, n: number): WalkStep => walk.steps[n + 1]!;

/** Assertions (a) to (d) and the end state, for one ten tick walk with the rule on. */
function expectNoTakeBack(walk: Walk): void {
  const { eventKey, steps } = walk;
  expect(steps).toHaveLength(11);

  // (a) the published verdicts, at both tiers.
  expect({ eventKey, lost: takeBacks(steps, (step) => step.district, districtHeld) }).toEqual({ eventKey, lost: [] });
  expect({ eventKey, lost: takeBacks(steps, (step) => step.champ, champHeld) }).toEqual({ eventKey, lost: [] });
  // (b) the District Locks tab.
  expect({ eventKey, lost: takeBacks(steps, (step) => step.districtTab, districtTabHeld) }).toEqual({ eventKey, lost: [] });
  // And no team's floor is lower at a tick than at the tick before, on either tab (quick task 261012-mw2).
  expect({ eventKey, floorsLower: floorsLower(steps) }).toEqual({ eventKey, floorsLower: [] });

  // (c) a category whose points are not in reads open, in the verdict pass
  // and in the tab's rows alike, and no cell of an open category is grey.
  const playoffsOnceLanded: DistrictCategoryFinality = { qual: true, alliance: true, elim: hasWinnerRow(baseline, eventKey), award: false };
  const expected: DistrictCategoryFinality[] = [ALL_OPEN, ALL_OPEN, ALL_OPEN, ALL_OPEN, QUAL_AND_ALLIANCE, QUAL_AND_ALLIANCE, playoffsOnceLanded, playoffsOnceLanded, playoffsOnceLanded, ALL_FINAL];
  for (let n = 0; n <= 9; n++) {
    const step = tickOf(walk, n);
    expect({ eventKey, tick: n, published: step.publishedFinal, rows: step.rowFinal }).toEqual({ eventKey, tick: n, published: expected[n], rows: expected[n] });
    expect({ eventKey, tick: n, greyOpenCells: step.greyOpenCells }).toEqual({ eventKey, tick: n, greyOpenCells: [] });
  }

  // (d) told out, then back in on points: never. Out on points and in by an
  // award is the accepted meaning of the two words.
  expect({ eventKey, back: eliminatedThenBack(steps) }).toEqual({ eventKey, back: [] });

  // The end state is the published one.
  expectEndState(walk, baseline);
}

describe("the staged replay: every district tier event of the fixture, with its points lagging its matches (quick task 261009-vp9)", () => {
  it("premise: the derived event list has eight entries, the baseline's district status equals the published file's for all 126 teams, and exactly one event has no row at the winner's value", () => {
    expect(districtEvents).toHaveLength(8);
    expect(districtEvents).toContain("2026orore");
    expect(dcmpEvents).toEqual([PNCMP]);
    expect(baseline.teams).toHaveLength(126);
    const fileStatus = new Map(fixtureFile.teams.map((team) => [team.teamKey, team.districtLock.status] as const));
    for (const team of baseline.teams) expect({ teamKey: team.teamKey, status: team.districtLock.status }).toEqual({ teamKey: team.teamKey, status: fileStatus.get(team.teamKey) });
    // DERIVED from the fixture: at this event the winning alliance's full
    // value sits on no row, so its Playoffs wait for the awards flag.
    expect(districtEvents.filter((eventKey) => !hasWinnerRow(baseline, eventKey))).toEqual(["2026waahs"]);
  });

  for (const eventKey of districtEvents) {
    it(`${eventKey}, the rule on: no published lock and no District Locks Locked is taken back at any tick, a category reads open until its points are in, and the end state is the published one`, () => {
      expectNoTakeBack(walkDistrictEvent(eventKey));
    });
  }

  it("2026waahs: with no row at the winner's value its Playoffs read open from the playoff points landing until the awards flag turns true", () => {
    const walk = walkDistrictEvent("2026waahs");
    for (const n of [6, 7, 8]) expect({ tick: n, elim: tickOf(walk, n).publishedFinal.elim, rows: tickOf(walk, n).rowFinal.elim }).toEqual({ tick: n, elim: false, rows: false });
    expect(tickOf(walk, 9).publishedFinal).toEqual(ALL_FINAL);
  });

  it("the rule switched off, all eight events: the same walks take locks back at each of the three gaps (pinned as the run shows)", () => {
    const walks = withRuleOff(() => districtEvents.map((eventKey) => walkDistrictEvent(eventKey)));
    const district = walks.flatMap((walk) => takeBacks(walk.steps, (step) => step.district, districtHeld));
    const champ = walks.flatMap((walk) => takeBacks(walk.steps, (step) => step.champ, champHeld));
    const tab = walks.flatMap((walk) => takeBacks(walk.steps, (step) => step.districtTab, districtTabHeld));

    // The three totals: published district, published champ, District Locks tab.
    expect({ district: district.length, champ: champ.length, tab: tab.length }).toEqual({ district: 32, champ: 9, tab: 32 });

    // FLOORS (quick task 261012-mw2), pinned as the run shows: with the rule off a category closes on a number that
    // is not in yet, and a floor that counted the stale number falls when the real one lands. These walks hand the
    // tabs no bracket, so nobody is credited a secured minimum and they read the same with the credit switched off.
    const withoutTheCredit = withRuleOff(() => withCreditOff(() => districtEvents.map((eventKey) => walkDistrictEvent(eventKey))));
    console.log(`[261012-mw2 floors, the rule OFF, the ten ticks of all eight events] ${JSON.stringify(floorTally(walks))} | the credit off too ${JSON.stringify(floorTally(withoutTheCredit))}\n${walks.flatMap((walk) => floorsLower(walk.steps)).slice(0, 6).map((line) => `  ${line}`).join("\n")}`);
    // 236 in all, the same 118 team ticks on each tab (a district tier floor is in both tabs' floors).
    expect({ credit: floorTally(walks), creditOff: floorTally(withoutTheCredit) }).toEqual({
      credit: { compared: 20_160, districtLower: 118, champLower: 118 },
      creditOff: { compared: 20_160, districtLower: 118, champLower: 118 },
    });

    // Each gap holds at least one loss. A loss is seen on the tick the
    // lagging points land: 2 (rankings catch up), 4 (alliance points), 6
    // (playoff points).
    const perGap = (losses: readonly string[]) => {
      const seenAt = lossSteps(losses);
      return [TEN_TICK_LABELS[2], TEN_TICK_LABELS[4], TEN_TICK_LABELS[6]].map((label) => seenAt.filter((step) => step === label).length);
    };
    expect(perGap(district)).toEqual([2, 24, 6]);
    expect(perGap(tab)).toEqual([2, 24, 6]);
    for (const count of perGap([...district, ...champ])) expect(count).toBeGreaterThan(0);

    // The state's own reading: every qualification match played closes Qualification at once.
    for (const walk of walks) {
      expect(tickOf(walk, 1).publishedFinal.qual).toBe(true);
      expect(tickOf(walk, 1).rowFinal.qual).toBe(true);
      // And every walk still ends where the published artifact is.
      for (const team of walk.end.teams) expect({ teamKey: team.teamKey, status: team.districtLock.status }).toEqual({ teamKey: team.teamKey, status: baseline.teams.find((entry) => entry.teamKey === team.teamKey)!.districtLock.status });
    }
  });
});

// ---------------------------------------------------------------------------
// GROUP 6. The reordered walks: a later layer of points before the layer below
//
// The ten ticks of group 1 follow the physical order: each layer of points
// lands after the layer it is computed from. TBA's district rankings are one
// feed with four layers, and nothing proves they always arrive in that order.
// Found by the verifier of quick task 261009-vp9 on 2026orore: when a later
// layer landed first, a later category's finality closed the earlier ones
// WITHOUT their own points, and a lock was taken back when those points
// arrived.
//
// THE HARDENING. Only the awards flag cascades down. Alliance selection and
// Playoffs each need their OWN points, and the live awards flag waits for
// playoff points at the event.
//
// Each walk is a list of steps:
//   qs  qualification starts (state)         P0  provisional qualification points
//   qd  last qualification match (state)     Pq  final qualification points
//   sp  alliances picked (state)             Pa  alliance points
//   pd  playoffs done (state)                Pe  playoff points
//   L   the judged awards are listed         Pw  award points
//   ST  the list has settled
//
// ONE ORDER IS NOT WALKED AS A PASSING ZERO, AND IS THE STATED ASSUMPTION:
// alliance points landing before the final qualification points
// (`qs P0 qd sp Pa Pq pd Pe L Pw ST`). Qualification has no proof of its
// own, so the alliance points close it, and the corrected qualification
// points arriving afterwards can take a lock back (measured: 2 published
// district and 2 on the District Locks tab). The rule assumes TBA computes
// an event's point categories together, so the qualification points are
// final once alliance points appear. Not verified against a live event.
// ---------------------------------------------------------------------------

const REORDERED = {
  /** The physical order, as a check that the step machine reproduces group 1. */
  physical: "qs P0 qd Pq sp Pa pd Pe L Pw ST",
  /** Playoff points before alliance points. */
  N1: "qs P0 qd Pq sp pd Pe Pa L Pw ST",
  /** Award points and a settled list before playoff points. */
  N3: "qs P0 qd Pq sp Pa pd L Pw ST Pe",
  /** Playoff points before the final qualification points and the alliance points. */
  N4: "qs P0 qd sp pd Pe Pq Pa L Pw ST",
} as const;

/** One district event walked through a list of steps, each one tick. */
function reorderedWalk(eventKey: string, order: string): Walk {
  const w = eventWalker(baseline, eventKey);
  const field = { played: 0, picked: false, done: false };
  const landed = { qual: "none" as "none" | "provisional" | "final", alliance: false, elim: false, award: false };
  const awards = { listed: false, settled: false };
  const state = () => w.stateOf(field.played, field.picked, field.done);
  /** The row a participant carries now: each layer either its final value or not in yet. */
  const points = (teamKey: string): Points => {
    const all = w.all(teamKey);
    return { qual: landed.qual === "final" ? all.qual : w.stale(teamKey).qual, alliance: landed.alliance ? all.alliance : 0, elim: landed.elim ? all.elim : 0, award: landed.award ? all.award : 0 };
  };
  // Once listed, the list is in hand on every tick, and once settled it stays settled.
  const extra = () => ({
    ...(awards.listed ? { eventAwards: new Map([[eventKey, w.awardsList]]) } : {}),
    ...(awards.settled ? { settledAwardEvents: new Set([eventKey]) } : {}),
  });
  const stateStep = (change: () => void) => (): void => {
    change();
    w.stateOnly(state(), extra());
  };
  const pointsStep = (change: () => void) => (): void => {
    change();
    w.rowsChange(state(), points, extra());
  };
  const steps: Readonly<Record<string, () => void>> = {
    qs: stateStep(() => void (field.played = QUAL_PLAYED_IN_PROGRESS)),
    qd: stateStep(() => void (field.played = QUAL_TOTAL)),
    sp: stateStep(() => void (field.picked = true)),
    pd: stateStep(() => void (field.done = true)),
    L: stateStep(() => void (awards.listed = true)),
    ST: stateStep(() => void (awards.settled = true)),
    P0: pointsStep(() => void (landed.qual = "provisional")),
    Pq: pointsStep(() => void (landed.qual = "final")),
    Pa: pointsStep(() => void (landed.alliance = true)),
    Pe: pointsStep(() => void (landed.elim = true)),
    Pw: pointsStep(() => void (landed.award = true)),
  };
  return runTicks(
    w,
    order.split(" ").map((name) => {
      const apply = steps[name];
      if (apply === undefined) throw new Error(`unknown step "${name}" in "${order}"`);
      return { label: name, apply };
    })
  );
}

const countsOf = (walk: Walk) => ({
  district: takeBacks(walk.steps, (step) => step.district, districtHeld).length,
  champ: takeBacks(walk.steps, (step) => step.champ, champHeld).length,
  tab: takeBacks(walk.steps, (step) => step.districtTab, districtTabHeld).length,
  champTab: takeBacks(walk.steps, (step) => step.champTab, champTabHeld).length,
});

describe("the staged replay: a later layer of points landing before the layer below it, on 2026orore (quick task 261009-vp9, the hardening)", () => {
  const EVENT = "2026orore";

  it("the physical order through the step machine takes no lock back and ends on the published state, hardening on or off", () => {
    const hardeningOn = reorderedWalk(EVENT, REORDERED.physical);
    for (const walk of [hardeningOn, withHardeningOff(() => reorderedWalk(EVENT, REORDERED.physical))]) {
      expect(countsOf(walk)).toEqual({ district: 0, champ: 0, tab: 0, champTab: 0 });
      expectEndState(walk, baseline);
    }
    // The rules on walk drops no floor on either tab (quick task 261012-mw2).
    expect(floorsLower(hardeningOn.steps)).toEqual([]);
  });

  for (const name of ["N1", "N3", "N4"] as const) {
    it(`${name} (${REORDERED[name]}): no published lock and no Locked on either tab is taken back at any tick, and the end state is the published one`, () => {
      const walk = reorderedWalk(EVENT, REORDERED[name]);
      expect({ name, lost: takeBacks(walk.steps, (step) => step.district, districtHeld) }).toEqual({ name, lost: [] });
      expect({ name, lost: takeBacks(walk.steps, (step) => step.champ, champHeld) }).toEqual({ name, lost: [] });
      expect({ name, lost: takeBacks(walk.steps, (step) => step.districtTab, districtTabHeld) }).toEqual({ name, lost: [] });
      expect({ name, lost: takeBacks(walk.steps, (step) => step.champTab, champTabHeld) }).toEqual({ name, lost: [] });
      // No team's floor is lower at a tick than at the tick before, on either tab (quick task 261012-mw2).
      expect({ name, floorsLower: floorsLower(walk.steps) }).toEqual({ name, floorsLower: [] });
      // No category is grey without its own points, at any tick.
      for (const step of walk.steps) expect({ name, tick: step.label, greyOpenCells: step.greyOpenCells }).toEqual({ name, tick: step.label, greyOpenCells: [] });
      expectEndState(walk, baseline);
    });
  }

  it("N1 and N4: the playoff points alone close the Playoffs and nothing below them, until the alliance points land", () => {
    for (const name of ["N1", "N4"] as const) {
      const walk = reorderedWalk(EVENT, REORDERED[name]);
      const at = (label: string): WalkStep => walk.steps.find((step) => step.label === label)!;
      expect({ name, published: at("Pe").publishedFinal, rows: at("Pe").rowFinal }).toEqual({
        name,
        published: { qual: false, alliance: false, elim: true, award: false },
        rows: { qual: false, alliance: false, elim: true, award: false },
      });
      expect({ name, published: at("Pa").publishedFinal }).toEqual({ name, published: { qual: true, alliance: true, elim: true, award: false } });
    }
  });

  it("N3: a settled list with its award points does not raise the flag while no row carries a playoff point, and the flag rises on the tick the playoff points land", () => {
    const walk = reorderedWalk(EVENT, REORDERED.N3);
    const at = (label: string): WalkStep => walk.steps.find((step) => step.label === label)!;
    expect(at("ST").flag).toBe(false);
    expect(at("ST").publishedFinal).toEqual({ qual: true, alliance: true, elim: false, award: false });
    expect(at("Pe").flag).toBe(true);
    expect(at("Pe").publishedFinal).toEqual(ALL_FINAL);
  });

  it("with the hardening switched off, each reordered walk takes locks back (pinned as the run shows)", () => {
    const reordered = () => ({ N1: reorderedWalk(EVENT, REORDERED.N1), N3: reorderedWalk(EVENT, REORDERED.N3), N4: reorderedWalk(EVENT, REORDERED.N4) });
    const walks = withHardeningOff(reordered);
    const off = { N1: countsOf(walks.N1), N3: countsOf(walks.N3), N4: countsOf(walks.N4) };
    expect(off).toEqual({
      N1: { district: 4, champ: 2, tab: 4, champTab: 2 },
      N3: { district: 1, champ: 1, tab: 1, champTab: 1 },
      N4: { district: 4, champ: 2, tab: 4, champTab: 2 },
    });
    // FLOORS (quick task 261012-mw2), pinned as the run shows. These walks hand the tabs no bracket either, so they
    // read the same with the credit switched off.
    const withoutTheCredit = withHardeningOff(() => withCreditOff(reordered));
    console.log(`[261012-mw2 floors, the hardening OFF, the three reordered walks] ${JSON.stringify(floorTally(Object.values(walks)))} | the credit off too ${JSON.stringify(floorTally(Object.values(withoutTheCredit)))}\n${Object.values(walks).flatMap((walk) => floorsLower(walk.steps)).slice(0, 6).map((line) => `  ${line}`).join("\n")}`);
    // 32 in all.
    expect({ credit: floorTally(Object.values(walks)), creditOff: floorTally(Object.values(withoutTheCredit)) }).toEqual({
      credit: { compared: 8_316, districtLower: 16, champLower: 16 },
      creditOff: { compared: 8_316, districtLower: 16, champLower: 16 },
    });
  });
});

// ---------------------------------------------------------------------------
// GROUP 2. Two synthetic single championships, both tick orders
// ---------------------------------------------------------------------------

interface SyntheticTeam {
  readonly district: number;
  readonly qual: number;
  readonly alliance: number;
  readonly elim: number;
  /** A consuming judged award at the championship, with its 30 award points. */
  readonly awardType?: number;
}

/**
 * A single championship over the fixture's first thirty teams: one finished
 * district row and one championship row each. Identity fields and award
 * profiles are the fixture's own. Only the numbers are synthetic.
 */
function syntheticChampionship(teamAt: (index: number) => SyntheticTeam): DistrictArtifact {
  const districtRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "district")!;
  const dcmpRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "dcmp")!;
  const teams = baseline.teams.slice(0, 30).map((team, index) => {
    const spec = teamAt(index);
    const award = spec.awardType === undefined ? 0 : 30;
    const qualifyingAwards = [
      ...(spec.elim === 90 ? [{ eventKey: dcmpRow.eventKey, awardType: 1, label: "Winner", awardOnly: false }] : []),
      ...(spec.awardType === undefined ? [] : [{ eventKey: dcmpRow.eventKey, awardType: spec.awardType, label: "a judged consuming award", awardOnly: false }]),
    ];
    return {
      ...team,
      rank: index + 1,
      pointTotal: spec.district + spec.qual + spec.alliance + spec.elim + award,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [
        { ...districtRow, qual: spec.district, alliance: 0, elim: 0, award: 0, total: spec.district, state: { ...FINISHED_STATE } },
        { ...dcmpRow, qual: spec.qual, alliance: spec.alliance, elim: spec.elim, award, total: spec.qual + spec.alliance + spec.elim + award, state: { ...FINISHED_STATE } },
      ],
      remainingEvents: [],
      qualifyingAwards,
    };
  });
  return recomputeDistrictVerdicts(DistrictArtifactSchema.parse({ ...baseline, dcmpSlots: 30, cmpSlots: 21, teams }), { nowYear: NOW_YEAR });
}

/**
 * S1. Index 0 to 8 lead. Index 9 is the team X, on the edge. Index 10 to 12
 * win the championship and 13 to 15 are the finalists. Impact to index 0,
 * Engineering Inspiration to 16, Rookie All Star to 17.
 */
const S1 = syntheticChampionship((index) => ({
  district: index < 9 ? 150 : index === 9 ? 120 : 80,
  qual: index < 9 ? 60 : index === 9 ? 40 : 30,
  alliance: index < 9 ? 40 : 0,
  elim: index >= 10 && index <= 12 ? 90 : index >= 13 && index <= 15 ? 60 : 0,
  ...(index === 0 ? { awardType: 0 } : index === 16 ? { awardType: 9 } : index === 17 ? { awardType: 10 } : {}),
}));
const S1_X = S1.teams[9]!.teamKey;

/**
 * S2. Index 0 to 11 lead and index 12 sits just behind. Index 13 to 15, the
 * winners, sit far down the standings: no points argument reaches them, so
 * their places can only come from the winner's reservation. Impact to index
 * 0, Engineering Inspiration to 20, Rookie All Star to 21.
 */
const S2 = syntheticChampionship((index) => ({
  district: index < 12 ? 150 : index === 12 ? 140 : index <= 15 ? 5 : 20,
  qual: index < 12 ? 60 : index === 12 ? 50 : 12,
  alliance: index < 12 ? 40 : index === 12 ? 20 : 3,
  elim: index >= 13 && index <= 15 ? 90 : 0,
  ...(index === 0 ? { awardType: 0 } : index === 20 ? { awardType: 9 } : index === 21 ? { awardType: 10 } : {}),
}));

type TickOrder = "the Winner listed before the playoff points land" | "the playoff points land before the Winner is listed";
const TICK_ORDERS: readonly TickOrder[] = ["the Winner listed before the playoff points land", "the playoff points land before the Winner is listed"];
const PLAYOFFS_DONE_LABEL = "5 playoffs done, no playoff points";
const PLAYOFF_POINTS_LABEL = "playoff points land";

/** The championship of a synthetic baseline walked through the ten ticks, with the Winner listed as a tick of its own. */
function walkChampionship(source: DistrictArtifact, order: TickOrder): Walk {
  const eventKey = dcmpEventKeysFor(source)[0]!;
  const w = eventWalker(source, eventKey);
  const winner = { eventAwards: new Map([[eventKey, w.winnerOnly]]) };
  const listed = { eventAwards: new Map([[eventKey, w.awardsList]]) };
  const done = () => w.stateOf(QUAL_TOTAL, true, true);
  const winnerTicks: Tick[] =
    order === "the Winner listed before the playoff points land"
      ? [
          { label: "Winner listed, no playoff points", apply: () => w.stateOnly(done(), winner) },
          { label: PLAYOFF_POINTS_LABEL, apply: () => w.rowsChange(done(), w.upToElim, winner) },
        ]
      : [
          { label: PLAYOFF_POINTS_LABEL, apply: () => w.rowsChange(done(), w.upToElim) },
          { label: "Winner listed", apply: () => w.stateOnly(done(), winner) },
        ];
  return runTicks(
    w,
    [
      { label: TEN_TICK_LABELS[0], apply: () => w.rowsChange(w.stateOf(QUAL_PLAYED_IN_PROGRESS, false, false), w.stale) },
      { label: TEN_TICK_LABELS[1], apply: () => w.stateOnly(w.stateOf(QUAL_TOTAL, false, false)) },
      { label: TEN_TICK_LABELS[2], apply: () => w.rowsChange(w.stateOf(QUAL_TOTAL, false, false), w.qualOnly) },
      { label: TEN_TICK_LABELS[3], apply: () => w.stateOnly(w.stateOf(QUAL_TOTAL, true, false)) },
      { label: TEN_TICK_LABELS[4], apply: () => w.rowsChange(w.stateOf(QUAL_TOTAL, true, false), w.upToAlliance) },
      { label: PLAYOFFS_DONE_LABEL, apply: () => w.stateOnly(done()) },
      ...winnerTicks,
      { label: "judged awards listed", apply: () => w.stateOnly(done(), listed) },
      { label: "award points land", apply: () => w.rowsChange(done(), w.all, listed) },
      { label: "list settled", apply: () => w.stateOnly(done(), { ...listed, settledAwardEvents: new Set([eventKey]) }) },
    ],
    undefined,
    "before the championship"
  );
}

describe("the staged replay: a single championship, the Winner listed before and after its playoff points (quick task 261009-vp9)", () => {
  it("premise: both synthetic championships are thirty teams at one dcmp tier event with 21 Championship slots, and their baselines hold places", () => {
    for (const source of [S1, S2]) {
      expect(source.teams).toHaveLength(30);
      expect(dcmpEventKeysFor(source)).toEqual([PNCMP]);
      expect(source.cmpSlots).toBe(21);
      expect(source.teams.filter((team) => champHeld(team.champLock.status)).length).toBeGreaterThan(0);
    }
    // X holds a place in the finished S1: the walk has something to take back.
    expect(champHeld(S1.teams.find((team) => team.teamKey === S1_X)!.champLock.status)).toBe(true);
  });

  for (const order of TICK_ORDERS) {
    for (const [name, source] of [
      ["S1", S1],
      ["S2", S2],
    ] as const) {
      it(`${name}, ${order}: no held place is lost in the published champLock or on the Champ Locks tab, and the end state is the synthetic baseline`, () => {
        const walk = walkChampionship(source, order);
        expect({ name, order, lost: takeBacks(walk.steps, (step) => step.champ, champHeld) }).toEqual({ name, order, lost: [] });
        expect({ name, order, lost: takeBacks(walk.steps, (step) => step.champTab, champTabHeld) }).toEqual({ name, order, lost: [] });
        expect({ name, order, lost: takeBacks(walk.steps, (step) => step.district, districtHeld) }).toEqual({ name, order, lost: [] });
        // No team's floor is lower at a tick than at the tick before, on either tab (quick task 261012-mw2).
        expect({ name, order, floorsLower: floorsLower(walk.steps) }).toEqual({ name, order, floorsLower: [] });
        // The flag turns true on the last tick and not before.
        expect(walk.steps.map((step) => step.flag)).toEqual([...walk.steps.slice(0, -1).map(() => false), true]);
        expectEndState(walk, source);
      });
    }

    it(`S1, ${order}, the rule switched off: X is held at the tick the playoffs are done and not held once the playoff points land`, () => {
      const walk = withRuleOff(() => walkChampionship(S1, order));
      const at = (label: string): WalkStep => walk.steps.find((step) => step.label === label)!;
      expect({ published: champHeld(at(PLAYOFFS_DONE_LABEL).champ.get(S1_X)!), tab: champTabHeld(at(PLAYOFFS_DONE_LABEL).champTab.get(S1_X)!) }).toEqual({ published: true, tab: true });
      expect({ published: champHeld(at(PLAYOFF_POINTS_LABEL).champ.get(S1_X)!), tab: champTabHeld(at(PLAYOFF_POINTS_LABEL).champTab.get(S1_X)!) }).toEqual({ published: false, tab: false });
    });
  }

  it("S2 holds the winning alliance's four places from the playoff points landing until the Winner is listed", () => {
    // WITHOUT THE WINNER HOLD the order "points land, then Winner listed" lost
    // 13 held places in the published champLock and 13 on the Champ Locks
    // tab: for one tick the Playoffs read final with no winner known, so the
    // four places were neither reserved for nor counted, and thirteen teams
    // read Locked on slots the winners then took.
    const walk = walkChampionship(S2, "the playoff points land before the Winner is listed");
    const at = (label: string): WalkStep => walk.steps.find((step) => step.label === label)!;
    const awardSlots = pendingAwardSlots(dcmpAwardCountCeilings(SEASON, S2.districtKey, S2.cmpSlots!).counts);
    expect(at(PLAYOFF_POINTS_LABEL).publishedFinal.elim).toBe(true);
    expect(at(PLAYOFF_POINTS_LABEL).champReserved).toBe(awardSlots + MAX_WINNING_ALLIANCE_SIZE);
    expect(at("Winner listed").champReserved).toBe(awardSlots);
  });
});

// ---------------------------------------------------------------------------
// GROUP 3. The late award walks
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const CLOCK_START_MS = Date.parse("2026-04-05T18:00:00.000Z");

interface LateWalk extends Walk {
  /** The minute of each step after the first. */
  readonly minutes: readonly number[];
}

/**
 * One late award walk through the pure merge. The event's award stage is
 * undone, as the 261009-tx6 replay does it. The first list is every award the
 * fixture records at the event but the late type, one Finalist and one other
 * judged award with no district recipient. The late award, with its
 * recipients' award points, is listed at `lateAt` (never, when `undefined`).
 *
 * THE TWO SETTLE FACTS ARE MEASURED AS THE WORKER MEASURES THEM: the real
 * `awardsListSettled` at both thresholds, against a simulated awards cursor
 * row (the ETag of the last list merged and the time that ETag last changed)
 * as it stood BEFORE the tick.
 */
function lateAwardWalk(eventKey: string, lateType: number, minutes: readonly number[], lateAt: number | undefined): LateWalk {
  const records = baseline.teams.flatMap((team) => team.qualifyingAwards.filter((award) => award.eventKey === eventKey).map((award) => ({ teamKey: team.teamKey, awardType: award.awardType })));
  const lateTeams = new Set(records.filter((record) => record.awardType === lateType).map((record) => record.teamKey));
  expect({ eventKey, lateType, recorded: lateTeams.size > 0 }).toEqual({ eventKey, lateType, recorded: true });
  const listOf = (subset: typeof records): AwardEntry[] => [
    ...[...new Set(subset.map((record) => record.awardType))].sort((a, b) => a - b).map((awardType) => ({ award_type: awardType, recipient_list: subset.filter((record) => record.awardType === awardType).map((record) => ({ team_key: record.teamKey })) })),
    { award_type: 2, recipient_list: [{ team_key: null }] },
    { award_type: 29, recipient_list: [{ team_key: null }] },
  ];
  const lists = { first: listOf(records.filter((record) => record.awardType !== lateType)), full: listOf(records) };

  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...baseline,
      teams: baseline.teams.map((team) => {
        const awardThere = team.eventPoints.filter((row) => row.eventKey === eventKey).reduce((sum, row) => sum + row.award, 0);
        return {
          ...team,
          pointTotal: team.pointTotal - awardThere,
          eventPoints: team.eventPoints.map((row) => (row.eventKey !== eventKey ? row : { ...row, award: 0, total: row.total - row.award, state: { ...FINISHED_STATE, awardsPosted: false } })),
          qualifyingAwards: team.qualifyingAwards.filter((award) => award.eventKey !== eventKey),
        };
      }),
    }),
    { nowYear: NOW_YEAR }
  );

  /** The rankings: the published rows, with the late recipients' award points at the event withheld until the late award is listed. */
  const payload = (withLatePoints: boolean) =>
    baseline.teams.map((team) => {
      const withhold = !withLatePoints && lateTeams.has(team.teamKey);
      let withheld = 0;
      const rows = team.eventPoints.map((row) => {
        const award = row.eventKey === eventKey && withhold ? 0 : row.award;
        withheld += row.award - award;
        return { event_key: row.eventKey, district_cmp: row.tier === "dcmp", qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: award, total: row.total - row.award + award };
      });
      return { team_key: team.teamKey, rank: team.rank, point_total: team.pointTotal - withheld, rookie_bonus: team.rookieBonus, adjustments: team.adjustments, event_points: rows };
    });

  // The simulated awards cursor row.
  let cursor: { etag: string; changedAt: string } | undefined;
  const steps: WalkStep[] = [snapshot("the award stage not started", artifact, eventKey)];
  for (const minute of minutes) {
    const name: keyof typeof lists = lateAt !== undefined && minute >= lateAt ? "full" : "first";
    const nowMs = CLOCK_START_MS + minute * MINUTE_MS;
    const settledAwardEvents = new Set<string>();
    const longSettledAwardEvents = new Set<string>();
    if (awardsListSettled(cursor?.etag, cursor?.changedAt, name, nowMs)) settledAwardEvents.add(eventKey);
    if (awardsListSettled(cursor?.etag, cursor?.changedAt, name, nowMs, AWARDS_SETTLE_WITHOUT_IMPACT_MS)) longSettledAwardEvents.add(eventKey);
    const awards = { eventAwards: new Map([[eventKey, lists[name]]]), settledAwardEvents, longSettledAwardEvents };
    // The state handed in is the one the artifact already holds, flag included.
    const eventState = new Map([[eventKey, stateAt(artifact, eventKey)!]]);
    // The rankings change twice: when the first list's points land, and when the late award's do.
    const rowsChange = minute === minutes[0] || minute === lateAt;
    artifact = rowsChange ? applyDistrictRankings({ artifact, rankings: payload(name === "full"), ...STAMP, eventState, ...awards }) : applyDistrictEventState({ artifact, eventState, ...STAMP, ...awards });
    if (cursor === undefined || cursor.etag !== name) cursor = { etag: name, changedAt: new Date(nowMs).toISOString() };
    steps.push(snapshot(`minute ${String(minute)}`, artifact, eventKey));
  }
  return { eventKey, steps, end: artifact, minutes };
}

/** No held place is lost in any of the four series. */
function expectNoHeldPlaceLost(walk: Walk, what: string): void {
  expect({ what, lost: takeBacks(walk.steps, (step) => step.district, districtHeld) }).toEqual({ what, lost: [] });
  expect({ what, lost: takeBacks(walk.steps, (step) => step.champ, champHeld) }).toEqual({ what, lost: [] });
  expect({ what, lost: takeBacks(walk.steps, (step) => step.districtTab, districtTabHeld) }).toEqual({ what, lost: [] });
  expect({ what, lost: takeBacks(walk.steps, (step) => step.champTab, champTabHeld) }).toEqual({ what, lost: [] });
  // No team's floor is lower at a tick than at the tick before, on either tab (quick task 261012-mw2).
  expect({ what, floorsLower: floorsLower(walk.steps) }).toEqual({ what, floorsLower: [] });
}

const LATE_MINUTES = [0, 60, 120, 179, 180] as const;
const LATE_AT = 120;

describe("the staged replay: a consuming award listed two hours after the rest of its list (quick task 261009-vp9, D6)", () => {
  /** The flag at each minute of a late walk: false at 0, 60, 120 and 179, true at 180, sixty minutes after the late award. */
  const expectFlagWaits = (walk: LateWalk, what: string): void => {
    expect({ what, flags: walk.steps.slice(1).map((step, index) => [walk.minutes[index], step.flag]) }).toEqual({
      what,
      flags: [
        [0, false],
        [60, false],
        [120, false],
        [179, false],
        [180, true],
      ],
    });
  };

  for (const eventKey of districtEvents) {
    it(`${eventKey}, a late Impact: the flag is false until sixty minutes after it is listed, and no held place is lost`, () => {
      const walk = lateAwardWalk(eventKey, 0, LATE_MINUTES, LATE_AT);
      expectFlagWaits(walk, `${eventKey} late Impact`);
      expectNoHeldPlaceLost(walk, `${eventKey} late Impact`);
      expectEndState(walk, baseline);
    });
  }

  it("2026wasam and 2026wasno, by name: frc5920 is never shown held and then not, where the old hour rule took it from held to eliminated", () => {
    for (const eventKey of ["2026wasam", "2026wasno"]) {
      expect(districtEvents).toContain(eventKey);
      const walk = lateAwardWalk(eventKey, 0, LATE_MINUTES, LATE_AT);
      const held = walk.steps.map((step) => districtHeld(step.district.get("frc5920")!));
      const firstHeld = held.indexOf(true);
      expect({ eventKey, heldToTheEnd: firstHeld === -1 || held.slice(firstHeld).every((value) => value) }).toEqual({ eventKey, heldToTheEnd: true });
      const tabHeld = walk.steps.map((step) => districtTabHeld(step.districtTab.get("frc5920")!));
      const firstTabHeld = tabHeld.indexOf(true);
      expect({ eventKey, tabHeldToTheEnd: firstTabHeld === -1 || tabHeld.slice(firstTabHeld).every((value) => value) }).toEqual({ eventKey, tabHeldToTheEnd: true });
    }
  });

  for (const [lateType, lateName] of [
    [0, "Impact"],
    [9, "Engineering Inspiration"],
    [10, "Rookie All Star"],
    [1, "Winner"],
  ] as const) {
    it(`2026pncmp, a late ${lateName}: the flag is false until sixty minutes after it is listed, and no held place is lost`, () => {
      const walk = lateAwardWalk(PNCMP, lateType, LATE_MINUTES, LATE_AT);
      expectFlagWaits(walk, `2026pncmp late ${lateName}`);
      expectNoHeldPlaceLost(walk, `2026pncmp late ${lateName}`);
      expectEndState(walk, baseline);
    });
  }

  it("a list that never gains its Impact: the flag is false at minute 719 and true at minute 720", () => {
    const walk = lateAwardWalk("2026orore", 0, [0, 60, 719, 720], undefined);
    expect(walk.steps.slice(1).map((step, index) => [walk.minutes[index], step.flag])).toEqual([
      [0, false],
      [60, false],
      [719, false],
      [720, true],
    ]);
    expectNoHeldPlaceLost(walk, "2026orore, no Impact for 12 hours");
  });
});

// ---------------------------------------------------------------------------
// GROUP 4. The field conditioned walks (gated on gitignored local data)
//
// THE TWO READINGS, NEVER MIXED. What has happened on the field (the event's
// state, the published alliances and the played bracket) is handed to the
// tabs at every tick from "alliances picked" on, whatever the points say.
// Whether a category's number is final is read from the artifact's own rows.
//
// TWO CASES ABOUT WHEN TBA POSTS POINTS, NEITHER VERIFIED:
//   A. the points lag by minutes: finality waits minutes;
//   B. the points arrive only when the event ends: the tabs show predictions
//      conditioned on the field all event, and no category reads final until
//      then.
// ---------------------------------------------------------------------------

const PLAYOFFS_FINAL_STOP = "Playoffs final, awards open";
const ALLIANCES_FINAL_STOP = "Alliances final";
type PointsCase = "A, the points lag by minutes" | "B, the points arrive only when the event ends";
const POINTS_CASES: readonly PointsCase[] = ["A, the points lag by minutes", "B, the points arrive only when the event ends"];

/** The ticks of one case, with the played playoff rounds walked one tick each. */
function fieldTicks(w: EventWalker, pointsCase: PointsCase, roundLabels: readonly string[], tail: readonly Tick[]): Tick[] {
  const picked = () => w.stateOf(QUAL_TOTAL, true, false);
  const done = () => w.stateOf(QUAL_TOTAL, true, true);
  if (pointsCase === "A, the points lag by minutes") {
    return [
      { label: "qualification in progress", apply: () => w.rowsChange(w.stateOf(QUAL_PLAYED_IN_PROGRESS, false, false), w.stale) },
      { label: "last match played, stale rankings", apply: () => w.stateOnly(w.stateOf(QUAL_TOTAL, false, false)) },
      { label: "rankings catch up", apply: () => w.rowsChange(w.stateOf(QUAL_TOTAL, false, false), w.qualOnly) },
      { label: "alliances picked, no alliance points", apply: () => w.stateOnly(picked()), bracket: ALLIANCES_FINAL_STOP },
      { label: "alliance points land", apply: () => w.rowsChange(picked(), w.upToAlliance), bracket: ALLIANCES_FINAL_STOP },
      ...roundLabels.map((label): Tick => ({ label: `${label}, no playoff points`, apply: () => w.stateOnly(picked()), bracket: label })),
      { label: "playoffs done, no playoff points", apply: () => w.stateOnly(done()), bracket: PLAYOFFS_FINAL_STOP },
      { label: "playoff points land", apply: () => w.rowsChange(done(), w.upToElim), bracket: PLAYOFFS_FINAL_STOP },
      ...tail,
    ];
  }
  return [
    { label: "qualification in progress", apply: () => w.rowsChange(w.stateOf(QUAL_PLAYED_IN_PROGRESS, false, false), w.stale) },
    { label: "last match played, stale rankings", apply: () => w.stateOnly(w.stateOf(QUAL_TOTAL, false, false)) },
    { label: "alliances picked, rows still stale", apply: () => w.stateOnly(picked()), bracket: ALLIANCES_FINAL_STOP },
    ...roundLabels.map((label): Tick => ({ label: `${label}, rows still stale`, apply: () => w.stateOnly(picked()), bracket: label })),
    { label: "playoffs done, rows still stale", apply: () => w.stateOnly(done()), bracket: PLAYOFFS_FINAL_STOP },
    { label: "every point lands at once", apply: () => w.rowsChange(done(), w.upToElim), bracket: PLAYOFFS_FINAL_STOP },
    ...tail,
  ];
}

const EVENT_FIXTURE_PATHS = districtEvents.map((eventKey) => join(FIXTURE_DIR, `event-${eventKey}.json`));
const MISSING_EVENT_FIXTURES = EVENT_FIXTURE_PATHS.filter((path) => !existsSync(path));

describe("the staged replay: the field conditioned walks of every district tier event (quick task 261009-vp9, the two readings)", () => {
  if (MISSING_EVENT_FIXTURES.length > 0) {
    localDataAbsent(`${String(MISSING_EVENT_FIXTURES.length)} of 8 event artifacts absent under data/fixtures/phase10/event-<key>.json (gitignored local data)`);
    return;
  }

  const context = settledDistrictContext(baseline);

  /** One district event walked in one case, the tab handed the event's bracket milestones at every tick from alliances picked on. */
  function fieldWalk(eventKey: string, pointsCase: PointsCase): Walk {
    const bracket: BracketSourceEvent = EventArtifactSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, `event-${eventKey}.json`), "utf8")));
    const stops = settledStops(context.timeline, eventKey, bracket);
    const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
    // Built as `statusesAtSettledStop` builds it: the stop's played rows, then the milestones.
    const distributionsAt = (label: string | undefined): ReadonlyMap<string, DistrictEventDistributions> => {
      if (label === undefined) return NO_DISTRIBUTIONS;
      const stop = stops.find((entry) => entry.label === label);
      if (stop === undefined) throw new Error(`${eventKey}: no stop "${label}" among ${stops.map((entry) => entry.label).join(", ")}`);
      const played = playedBracketMatchesFor(bracket, stop.playedKeys);
      return new Map([[eventKey, { eventKey, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches), ...securedElimEntry(bracket, baseline.year, "district", stop.playedKeys) }]]);
    };
    const w = eventWalker(baseline, eventKey);
    const done = () => w.stateOf(QUAL_TOTAL, true, true);
    const listed = { eventAwards: new Map([[eventKey, w.awardsList]]) };
    const tail: Tick[] = [
      { label: "judged awards listed", apply: () => w.stateOnly(done(), listed), bracket: PLAYOFFS_FINAL_STOP },
      { label: "award points land", apply: () => w.rowsChange(done(), w.all, listed), bracket: PLAYOFFS_FINAL_STOP },
      { label: "list settled", apply: () => w.stateOnly(done(), { ...listed, settledAwardEvents: new Set([eventKey]) }), bracket: PLAYOFFS_FINAL_STOP },
    ];
    const roundLabels = stops.map((stop) => stop.label).filter((label) => label.startsWith("Round "));
    return runTicks(w, fieldTicks(w, pointsCase, roundLabels, tail), distributionsAt);
  }

  const totalsOf = (walks: readonly Walk[]) => ({
    district: walks.flatMap((walk) => takeBacks(walk.steps, (step) => step.district, districtHeld)).length,
    champ: walks.flatMap((walk) => takeBacks(walk.steps, (step) => step.champ, champHeld)).length,
    tab: walks.flatMap((walk) => takeBacks(walk.steps, (step) => step.districtTab, districtTabHeld)).length,
  });

  for (const pointsCase of POINTS_CASES) {
    it(`case ${pointsCase}: with the rule on, no published lock and no District Locks Locked is taken back at any tick of any event`, () => {
      const walks = districtEvents.map((eventKey) => fieldWalk(eventKey, pointsCase));
      for (const walk of walks) {
        expect({ eventKey: walk.eventKey, lost: takeBacks(walk.steps, (step) => step.district, districtHeld) }).toEqual({ eventKey: walk.eventKey, lost: [] });
        expect({ eventKey: walk.eventKey, lost: takeBacks(walk.steps, (step) => step.champ, champHeld) }).toEqual({ eventKey: walk.eventKey, lost: [] });
        expect({ eventKey: walk.eventKey, lost: takeBacks(walk.steps, (step) => step.districtTab, districtTabHeld) }).toEqual({ eventKey: walk.eventKey, lost: [] });
        // No team's floor is lower at a tick than at the tick before, on either tab: the secured playoff minimum
        // rises row by row, and the tick the playoff points land does not lower it (quick task 261012-mw2).
        expect({ eventKey: walk.eventKey, floorsLower: floorsLower(walk.steps) }).toEqual({ eventKey: walk.eventKey, floorsLower: [] });
        // No category is grey without its points, at any tick.
        for (const step of walk.steps) expect({ eventKey: walk.eventKey, tick: step.label, greyOpenCells: step.greyOpenCells }).toEqual({ eventKey: walk.eventKey, tick: step.label, greyOpenCells: [] });
        expectEndState(walk, baseline);
      }
      if (pointsCase === "B, the points arrive only when the event ends") {
        // Nothing live goes dark: the bracket settles a knocked out
        // alliance's Playoffs cell while Alliance selection still reads open.
        const settledWhileAllianceOpen = walks.reduce((sum, walk) => sum + walk.steps.reduce((inner, step) => inner + step.settledWhileAllianceOpen, 0), 0);
        expect(settledWhileAllianceOpen).toBe(607);
        // And no category of any event reads final until the points land.
        for (const walk of walks) {
          for (const step of walk.steps.filter((entry) => entry.label.includes("rows still stale"))) {
            expect({ eventKey: walk.eventKey, tick: step.label, published: step.publishedFinal, rows: step.rowFinal }).toEqual({ eventKey: walk.eventKey, tick: step.label, published: ALL_OPEN, rows: ALL_OPEN });
          }
        }
      }
    });
  }

  it("both cases with the rule switched off take locks back, fewer on the District Locks tab with the credit than without it (pinned as the run shows)", () => {
    const bothCases = () => POINTS_CASES.map((pointsCase) => districtEvents.map((eventKey) => fieldWalk(eventKey, pointsCase)));
    const credit = withRuleOff(bothCases);
    const creditOff = withRuleOff(() => withCreditOff(bothCases));
    console.log(
      `[261012-mw2 the rule OFF, the field conditioned walks] with the credit ${JSON.stringify(credit.map(totalsOf))} floors ${JSON.stringify(credit.map(floorTally))} | the credit off too ${JSON.stringify(creditOff.map(totalsOf))} floors ${JSON.stringify(creditOff.map(floorTally))}`
    );
    // THE REQUIREMENT: the mutation is caught, with the credit and without it.
    for (const totals of [...credit.map(totalsOf), ...creditOff.map(totalsOf)]) expect(totals.tab).toBeGreaterThan(0);
    // The measurement of the old reading, pinned as the run shows. The District Locks tab read 32 and 34 until
    // quick task 261012-mw2 (the published verdicts carry no credit and did not move). With the rule off a
    // category reads final on rows that hold none of its points. The larger of the two keeps what the played
    // bracket has secured in the floor of a Playoffs category that reads final with nothing posted, and the tab
    // takes 6 and 10 fewer back.
    expect(credit.map(totalsOf)).toEqual([
      { district: 32, champ: 9, tab: 26 },
      { district: 34, champ: 16, tab: 24 },
    ]);
    // THE CREDIT SWITCHED OFF TOO: the pins this test held before that task.
    expect(creditOff.map(totalsOf)).toEqual([
      { district: 32, champ: 9, tab: 32 },
      { district: 34, champ: 16, tab: 34 },
    ]);
    // FLOORS, pinned as the run shows: 376 in all with the credit (236 in case A, 140 in case B), and 342 with
    // the credit off too (236 and 106), which is what the planner of that task read on the code of before it.
    // More fall in case B with the credit: before the tick every point lands a floor already holds the playoff
    // points the bracket secured, so a stale qualification number that is too high is no longer hidden by them
    // when the real numbers land.
    expect({ credit: credit.map(floorTally), creditOff: creditOff.map(floorTally) }).toEqual({
      credit: [
        { compared: 30_240, districtLower: 118, champLower: 118 },
        { compared: 26_208, districtLower: 70, champLower: 70 },
      ],
      creditOff: [
        { compared: 30_240, districtLower: 118, champLower: 118 },
        { compared: 26_208, districtLower: 53, champLower: 53 },
      ],
    });
  });

  it("the credit switched off, rules on: the same walks take no lock back and drop no floor either, and the credit only ADDS Locked teams, tick by tick (pinned as the run shows)", () => {
    const record: Record<string, { ticks: number; districtTabGained: number; champTabGained: number; lockedOnlyWithoutTheCredit: string[] }> = {};
    for (const pointsCase of POINTS_CASES) {
      const entry = { ticks: 0, districtTabGained: 0, champTabGained: 0, lockedOnlyWithoutTheCredit: [] as string[] };
      for (const eventKey of districtEvents) {
        const credit = fieldWalk(eventKey, pointsCase);
        const creditOff = withCreditOff(() => fieldWalk(eventKey, pointsCase));
        expect(creditOff.steps.map((step) => step.label)).toEqual(credit.steps.map((step) => step.label));
        // The walks of before quick task 261012-mw2 hold what they held: nothing taken back, no floor lower.
        expect({ eventKey, lost: takeBacks(creditOff.steps, (step) => step.district, districtHeld) }).toEqual({ eventKey, lost: [] });
        expect({ eventKey, lost: takeBacks(creditOff.steps, (step) => step.champ, champHeld) }).toEqual({ eventKey, lost: [] });
        expect({ eventKey, lost: takeBacks(creditOff.steps, (step) => step.districtTab, districtTabHeld) }).toEqual({ eventKey, lost: [] });
        expect({ eventKey, floorsLower: floorsLower(creditOff.steps) }).toEqual({ eventKey, floorsLower: [] });
        credit.steps.forEach((step, index) => {
          const without = creditOff.steps[index]!;
          entry.ticks += 1;
          for (const [teamKey, status] of step.districtTab) if (districtTabHeld(status) && !districtTabHeld(without.districtTab.get(teamKey) ?? "")) entry.districtTabGained += 1;
          for (const [teamKey, status] of step.champTab) if (champTabHeld(status) && !champTabHeld(without.champTab.get(teamKey) ?? "")) entry.champTabGained += 1;
          for (const [teamKey, status] of without.districtTab) if (districtTabHeld(status) && !districtTabHeld(step.districtTab.get(teamKey) ?? "")) entry.lockedOnlyWithoutTheCredit.push(`district tab ${eventKey} "${step.label}" ${teamKey}`);
          for (const [teamKey, status] of without.champTab) if (champTabHeld(status) && !champTabHeld(step.champTab.get(teamKey) ?? "")) entry.lockedOnlyWithoutTheCredit.push(`champ tab ${eventKey} "${step.label}" ${teamKey}`);
        });
      }
      record[pointsCase] = entry;
    }
    console.log(`[261012-mw2 what the credit adds, the field conditioned walks of the eight events, rules on] ${JSON.stringify(record)}`);
    // THE REQUIREMENT: the credit takes no Locked away at any tick.
    for (const entry of Object.values(record)) expect(entry.lockedOnlyWithoutTheCredit).toEqual([]);
    // IT REACHES THE TABS: team ticks shown Locked with the credit and not without it. Pinned as the run shows.
    expect(record).toEqual({
      "A, the points lag by minutes": { ticks: 128, districtTabGained: 105, champTabGained: 19, lockedOnlyWithoutTheCredit: [] },
      "B, the points arrive only when the event ends": { ticks: 112, districtTabGained: 97, champTabGained: 22, lockedOnlyWithoutTheCredit: [] },
    });
  });
});

const CORPUS_ABSOLUTE = join(REPO_ROOT, CORPUS_PATH);

describe("the staged replay: the field conditioned walks of the real 2026pncmp, with its corpus bracket (quick task 261009-vp9)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }

  const bracket: BracketSourceEvent = (() => {
    const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
    try {
      const found = bracketFromCorpus(db, new Map(), SEASON, PNCMP);
      if (found === undefined) throw new Error(`the corpus carries no alliances for ${PNCMP}`);
      return found;
    } finally {
      db.close();
    }
  })();
  const stops: SettledStop[] = settledStops(buildDistrictTimeline({ events: champTierEvents(baseline), eventArtifacts: new Map() }), PNCMP, bracket);
  const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
  const roundLabels = stops.map((stop) => stop.label).filter((label) => label.startsWith("Round "));
  const awardSlots = pendingAwardSlots(dcmpAwardCountCeilings(SEASON, baseline.districtKey, baseline.cmpSlots!).counts);

  /** The championship walked in one case, the Champ Locks status code handed the field's milestones and bracket facts. */
  function champFieldWalk(pointsCase: PointsCase): Walk {
    const w = eventWalker(baseline, PNCMP);
    const distributionsAt = (label: string | undefined): ReadonlyMap<string, DistrictEventDistributions> => {
      if (label === undefined) return NO_DISTRIBUTIONS;
      const stop = stops.find((entry) => entry.label === label);
      if (stop === undefined) throw new Error(`no stop "${label}" among ${stops.map((entry) => entry.label).join(", ")}`);
      const played = playedBracketMatchesFor(bracket, stop.playedKeys);
      // The bracket facts are built with the FIELD's stage: the state alone.
      const field = deriveStageFromState(stateAt(w.current(), PNCMP)).final;
      const dcmpBracket = dcmpBracketFactsFor({ eventKey: PNCMP, season: SEASON, tier: "dcmp", stage: field, alliances, playedMatches: played.matches, unresolvedMatchCount: played.unresolvedMatchKeys.length });
      return new Map([[PNCMP, { eventKey: PNCMP, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches), ...securedElimEntry(bracket, SEASON, "dcmp", stop.playedKeys), ...(dcmpBracket === undefined ? {} : { dcmpBracket }) }]]);
    };
    const done = () => w.stateOf(QUAL_TOTAL, true, true);
    const winner = { eventAwards: new Map([[PNCMP, w.winnerOnly]]) };
    const listed = { eventAwards: new Map([[PNCMP, w.awardsList]]) };
    const tail: Tick[] = [
      { label: "Winner listed", apply: () => w.stateOnly(done(), winner), bracket: PLAYOFFS_FINAL_STOP },
      { label: "judged awards listed", apply: () => w.stateOnly(done(), listed), bracket: PLAYOFFS_FINAL_STOP },
      { label: "award points land", apply: () => w.rowsChange(done(), w.all, listed), bracket: PLAYOFFS_FINAL_STOP },
      { label: "list settled", apply: () => w.stateOnly(done(), { ...listed, settledAwardEvents: new Set([PNCMP]) }), bracket: PLAYOFFS_FINAL_STOP },
    ];
    return runTicks(w, fieldTicks(w, pointsCase, roundLabels, tail), distributionsAt, "before the championship");
  }

  it("premise: the corpus bracket is eight alliances with played rounds, and the stops name them", () => {
    expect(alliances).toHaveLength(8);
    expect(roundLabels.length).toBeGreaterThan(0);
    expect(stops.map((stop) => stop.label)).toEqual([ALLIANCES_FINAL_STOP, ...roundLabels, PLAYOFFS_FINAL_STOP]);
  });

  for (const pointsCase of POINTS_CASES) {
    it(`case ${pointsCase}: no held place is lost in the published champLock or on the Champ Locks tab, the joint proof waits for the alliance points, and the winner's four places are held until the Winner is listed`, () => {
      const walk = champFieldWalk(pointsCase);
      expect({ lost: takeBacks(walk.steps, (step) => step.champ, champHeld) }).toEqual({ lost: [] });
      expect({ lost: takeBacks(walk.steps, (step) => step.champTab, champTabHeld) }).toEqual({ lost: [] });
      expect({ lost: takeBacks(walk.steps, (step) => step.district, districtHeld) }).toEqual({ lost: [] });
      // No team's floor is lower at a tick than at the tick before, on either tab (quick task 261012-mw2).
      expect({ floorsLower: floorsLower(walk.steps) }).toEqual({ floorsLower: [] });
      expectEndState(walk, baseline);

      // THE JOINT PROOF. It is handed the field's bracket facts from
      // "alliances picked" on. While the alliance points are missing it
      // refuses as not eligible, and it is applied on the tick they land.
      const landed = pointsCase === "A, the points lag by minutes" ? "alliance points land" : "every point lands at once";
      const landedAt = walk.steps.findIndex((step) => step.label === landed);
      const pickedAt = walk.steps.findIndex((step) => step.label.startsWith("alliances picked"));
      expect(pickedAt).toBeGreaterThan(0);
      expect(landedAt).toBeGreaterThan(pickedAt);
      for (const step of walk.steps.slice(pickedAt, landedAt)) {
        expect({ tick: step.label, proof: step.jointProof, alliance: step.rowFinal.alliance }).toEqual({ tick: step.label, proof: "stageNotEligible", alliance: false });
        // The flat reservation stands meanwhile.
        expect({ tick: step.label, reserved: step.champReserved }).toEqual({ tick: step.label, reserved: awardSlots + MAX_WINNING_ALLIANCE_SIZE });
      }
      expect({ tick: landed, proof: walk.steps[landedAt]!.jointProof }).toEqual({ tick: landed, proof: "applied" });

      // THE WINNER HOLD. The four places are held on every tick before the
      // Winner is listed, the ticks where the playoff points are already in
      // included, and released on the tick it is listed.
      const winnerAt = walk.steps.findIndex((step) => step.label === "Winner listed");
      for (const step of walk.steps.slice(0, winnerAt)) expect({ tick: step.label, reserved: step.champReserved }).toEqual({ tick: step.label, reserved: awardSlots + MAX_WINNING_ALLIANCE_SIZE });
      expect(walk.steps[winnerAt - 1]!.publishedFinal.elim).toBe(true);
      expect(walk.steps[winnerAt]!.champReserved).toBe(awardSlots);
    });
  }

  it("case B with the rule switched off: with the credit switched off too the Champ Locks tab takes two Locked back (frc5937 and frc2522, Locked at playoffs done on stale rows), and with the credit it takes none back", () => {
    // THIS TEST SHOWS THAT THE RULE OF QUICK TASK 261009-vp9 BITES, and since quick task 261012-mw2 it is read
    // twice. WITH THE CREDIT SWITCHED OFF TOO it reads as it always did: at "playoffs done, rows still stale" the
    // state closes every category on rows that hold no alliance and no playoff point, frc2522 and frc5937 are shown
    // Locked there, and both are lost on the tick every point lands. WITH THE CREDIT nobody is taken back: the
    // Playoffs read final there with nothing posted, and the floor of a final Playoffs category is the larger of
    // TBA's number and the secured minimum, so the bracket's teams already hold their playoff points in their
    // floors and neither of the two is shown Locked at that tick (both read In range, at it and after it). The
    // bite is kept where it still is, with the credit off; it is not deleted.
    const caseB: PointsCase = "B, the points arrive only when the event ends";
    const lostOn = (walk: Walk): string[] => takeBacks(walk.steps, (step) => step.champTab, champTabHeld).map((loss) => loss.split(" ")[0]!).sort();
    const creditOff = withRuleOff(() => withCreditOff(() => champFieldWalk(caseB)));
    const credit = withRuleOff(() => champFieldWalk(caseB));
    const at = (walk: Walk, label: string): WalkStep => walk.steps.find((step) => step.label === label)!;
    const view = (walk: Walk) =>
      Object.fromEntries(
        ["frc2522", "frc5937"].map((teamKey) => [
          teamKey,
          ["playoffs done, rows still stale", "every point lands at once"].map((label) => `${String(at(walk, label).champTab.get(teamKey))} floor ${String(at(walk, label).champFloor.get(teamKey))}`),
        ])
      );
    console.log(
      `[261012-mw2 the rule OFF, the real 2026pncmp, case B] with the credit: taken back ${JSON.stringify(lostOn(credit))}, floors ${JSON.stringify(floorTally([credit]))}, ${JSON.stringify(view(credit))} | the credit off too: taken back ${JSON.stringify(lostOn(creditOff))}, floors ${JSON.stringify(floorTally([creditOff]))}, ${JSON.stringify(view(creditOff))}\n${floorsLower(credit.steps).slice(0, 8).map((line) => `  ${line}`).join("\n")}`
    );
    expect(lostOn(creditOff)).toEqual(["frc2522", "frc5937"]);
    expect(lostOn(credit)).toEqual([]);
    expect(view(creditOff)).toEqual({ frc2522: ["locked floor 167", "inRange floor 194"], frc5937: ["locked floor 169", "inRange floor 190"] });
    expect(view(credit)).toEqual({ frc2522: ["inRange floor 167", "inRange floor 194"], frc5937: ["inRange floor 169", "inRange floor 190"] });
    // FLOORS, pinned as the run shows: 22 with the credit and 21 with the credit off too (the planner of that
    // task read 21 on the code of before it), every one on the Champ Locks tab at the tick every point lands:
    // the stale qualification numbers. The District Locks tab does not count a championship row.
    for (const walk of [credit, creditOff]) expect(floorsLower(walk.steps).filter((line) => !line.endsWith('at "every point lands at once"'))).toEqual([]);
    expect({ credit: floorTally([credit]), creditOff: floorTally([creditOff]) }).toEqual({
      credit: { compared: 3_528, districtLower: 0, champLower: 22 },
      creditOff: { compared: 3_528, districtLower: 0, champLower: 21 },
    });
  });

  it("the credit switched off, rules on: the same two walks take no lock back and drop no floor either, and the credit only ADDS Locked teams on the Champ Locks tab, tick by tick (pinned as the run shows)", () => {
    const record: Record<string, { ticks: number; champTabGained: number; lockedOnlyWithoutTheCredit: string[]; lockedPerTick: number[]; lockedPerTickWithoutTheCredit: number[] }> = {};
    for (const pointsCase of POINTS_CASES) {
      const credit = champFieldWalk(pointsCase);
      const creditOff = withCreditOff(() => champFieldWalk(pointsCase));
      expect(creditOff.steps.map((step) => step.label)).toEqual(credit.steps.map((step) => step.label));
      // The walk of before quick task 261012-mw2 holds what it held: nothing taken back, no floor lower.
      expect({ lost: takeBacks(creditOff.steps, (step) => step.champ, champHeld) }).toEqual({ lost: [] });
      expect({ lost: takeBacks(creditOff.steps, (step) => step.champTab, champTabHeld) }).toEqual({ lost: [] });
      expect({ lost: takeBacks(creditOff.steps, (step) => step.district, districtHeld) }).toEqual({ lost: [] });
      expect({ floorsLower: floorsLower(creditOff.steps) }).toEqual({ floorsLower: [] });
      const lockedCount = (step: WalkStep): number => [...step.champTab.values()].filter(champTabHeld).length;
      const entry = { ticks: credit.steps.length, champTabGained: 0, lockedOnlyWithoutTheCredit: [] as string[], lockedPerTick: credit.steps.map(lockedCount), lockedPerTickWithoutTheCredit: creditOff.steps.map(lockedCount) };
      credit.steps.forEach((step, index) => {
        const without = creditOff.steps[index]!;
        for (const [teamKey, status] of step.champTab) if (champTabHeld(status) && !champTabHeld(without.champTab.get(teamKey) ?? "")) entry.champTabGained += 1;
        for (const [teamKey, status] of without.champTab) if (champTabHeld(status) && !champTabHeld(step.champTab.get(teamKey) ?? "")) entry.lockedOnlyWithoutTheCredit.push(`"${step.label}" ${teamKey}`);
      });
      record[pointsCase] = entry;
    }
    console.log(`[261012-mw2 what the credit adds, the real 2026pncmp, rules on] ${JSON.stringify(record)}`);
    // THE REQUIREMENT: the credit takes no Locked away at any tick.
    for (const entry of Object.values(record)) expect(entry.lockedOnlyWithoutTheCredit).toEqual([]);
    // IT REACHES THE TAB: teams shown Locked per tick with the credit and without it. Pinned as the run shows. In
    // case A the credit shows more teams Locked from Round 2 to the tick the playoffs are done, 17 team ticks in
    // all; in case B, where no category reads final until every point lands, the two series are the same.
    expect(record).toEqual({
      "A, the points lag by minutes": {
        ticks: 17,
        champTabGained: 17,
        lockedOnlyWithoutTheCredit: [],
        lockedPerTick: [0, 0, 0, 0, 0, 2, 2, 4, 7, 8, 10, 12, 12, 12, 12, 12, 20],
        lockedPerTickWithoutTheCredit: [0, 0, 0, 0, 0, 2, 2, 2, 3, 3, 6, 10, 12, 12, 12, 12, 20],
      },
      "B, the points arrive only when the event ends": {
        ticks: 15,
        champTabGained: 0,
        lockedOnlyWithoutTheCredit: [],
        lockedPerTick: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 12, 12, 20],
        lockedPerTickWithoutTheCredit: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 12, 12, 20],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// GROUP 5. The Now census (gated on gitignored local data)
// ---------------------------------------------------------------------------

const LOCAL_DISTRICT_ABSOLUTE = join(REPO_ROOT, LOCAL_DISTRICT_DIR);
/** The district DETAIL files alone: `v1__districts__2026.json` is the per year index and carries no teams. */
const DISTRICT_DETAIL_FILE = /^v1__district__\d{4}[a-z0-9]+\.json$/;

describe("the Now census: on every finished event the rule's reading is the state's own (quick task 261009-vp9, D4)", () => {
  const files = existsSync(LOCAL_DISTRICT_ABSOLUTE) ? readdirSync(LOCAL_DISTRICT_ABSOLUTE).filter((file) => DISTRICT_DETAIL_FILE.test(file)).sort() : [];
  if (files.length === 0) {
    localDataAbsent(`no district artifact under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it("no event of any local district artifact has a category the state reads final and the rule reads open, in the verdict pass or in the tabs' rows", () => {
    let events = 0;
    let finished = 0;
    const regressed: string[] = [];
    for (const file of files) {
      // EVERY detail file, the ones a sweep skips for an unpublished capacity included.
      const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(LOCAL_DISTRICT_ABSOLUTE, file), "utf8")));
      const stateByEvent = new Map<string, DistrictEventState | undefined>();
      for (const team of artifact.teams) {
        for (const row of [...team.eventPoints, ...team.remainingEvents]) {
          if (!stateByEvent.has(row.eventKey) || (stateByEvent.get(row.eventKey) === undefined && row.state !== undefined)) stateByEvent.set(row.eventKey, row.state);
        }
      }
      const live = liveStageByEvent(artifact, ["district", "dcmp"]);
      for (const [eventKey, state] of stateByEvent) {
        if (state === undefined) continue;
        events += 1;
        const field = districtEventCategoryFinality(state);
        if (field.qual && field.alliance && field.elim && field.award) finished += 1;
        const published = publishedCategoryFinality(artifact.teams, eventKey, state, artifact.year);
        const rows = live.get(eventKey);
        if (JSON.stringify(published) !== JSON.stringify(field)) regressed.push(`${artifact.districtKey} ${eventKey} verdict pass ${JSON.stringify(published)} against the state's ${JSON.stringify(field)}`);
        if (rows !== undefined && JSON.stringify(rows) !== JSON.stringify(field)) regressed.push(`${artifact.districtKey} ${eventKey} rows ${JSON.stringify(rows)} against the state's ${JSON.stringify(field)}`);
      }
    }
    console.log(`Now census: ${String(files.length)} district artifacts, ${String(events)} events with a state block, ${String(finished)} finished by state, ${String(regressed.length)} with a category the rule reads differently`);
    expect(events).toBeGreaterThan(0);
    expect(regressed).toEqual([]);
  });
});
