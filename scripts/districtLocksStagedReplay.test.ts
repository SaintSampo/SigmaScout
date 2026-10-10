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
 *   5. the Now census over every local district artifact.
 * Groups 1 to 3 read the committed fixture only and always run. Groups 4 and
 * 5 read gitignored local data and skip, with a message naming what is
 * absent, where it is not there.
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
  deriveStageFromState,
  liveStageByEvent,
  playedBracketMatchesFor,
  tierEvents,
  type BracketSourceEvent,
  type DistrictEventDistributions,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildChampLedgerRows, champTierEvents, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { buildDistrictTimeline } from "../apps/web/src/components/districts/districtTimeline.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { bracketFromCorpus, CORPUS_PATH, LOCAL_DISTRICT_DIR } from "./measureChampJointLocks.js";
import { settledDistrictContext, settledStops, type SettledStop } from "./measureLedgerSettledTenets.js";

/**
 * THE SWITCH. While `off` is set, the one core rule answers with the state's
 * own reading, which is what it replaced. Nothing else is switched: the merge,
 * the row builders and the status code all run as shipped.
 */
const ruleSwitch = vi.hoisted(() => ({ off: false }));

vi.mock("../packages/core/districts/categoryCorroboration.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/categoryCorroboration.js")>();
  const slots = await vi.importActual<typeof import("../packages/core/districts/reservedSlots.js")>("../packages/core/districts/reservedSlots.js");
  return {
    ...original,
    corroboratedCategoryFinality: (...args: Parameters<typeof original.corroboratedCategoryFinality>) =>
      ruleSwitch.off ? slots.districtEventCategoryFinality(args[0]) : original.corroboratedCategoryFinality(...args),
  };
});

afterEach(() => {
  ruleSwitch.off = false;
});

/** Runs `body` with the rule switched off, and switches it back on whatever happens. */
function withRuleOff<T>(body: () => T): T {
  ruleSwitch.off = true;
  try {
    return body();
  } finally {
    ruleSwitch.off = false;
  }
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
  const champRows = buildChampLedgerRows({ artifact, distributions, startedDcmpEventKeys: new Set(dcmpEventKeysFor(artifact).filter((key) => started.has(key))), atLivePosition: true });
  const champStatuses = computeChampLedgerStatuses({ artifact, teams: champRows.teams, districtLockedOut, nowYear: NOW_YEAR, ...(distributions.size === 0 ? {} : { distributions }) });

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
    it.skip(`skipped: ${String(MISSING_EVENT_FIXTURES.length)} of 8 event artifacts absent under data/fixtures/phase10/event-<key>.json (gitignored local data)`, () => {});
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
      return new Map([[eventKey, { eventKey, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches) }]]);
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

  it("both cases with the rule switched off take locks back (pinned as the run shows)", () => {
    const off = withRuleOff(() => POINTS_CASES.map((pointsCase) => totalsOf(districtEvents.map((eventKey) => fieldWalk(eventKey, pointsCase)))));
    expect(off).toEqual([
      { district: 32, champ: 9, tab: 32 },
      { district: 34, champ: 16, tab: 34 },
    ]);
  });
});

const CORPUS_ABSOLUTE = join(REPO_ROOT, CORPUS_PATH);

describe("the staged replay: the field conditioned walks of the real 2026pncmp, with its corpus bracket (quick task 261009-vp9)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    it.skip(`skipped: ${CORPUS_PATH} absent (gitignored local data)`, () => {});
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
      return new Map([[PNCMP, { eventKey: PNCMP, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches), ...(dcmpBracket === undefined ? {} : { dcmpBracket }) }]]);
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

  it("case B with the rule switched off: the Champ Locks tab takes two Locked back (frc5937 and frc2522, Locked at playoffs done on stale rows)", () => {
    const walk = withRuleOff(() => champFieldWalk("B, the points arrive only when the event ends"));
    const tab = takeBacks(walk.steps, (step) => step.champTab, champTabHeld);
    expect(tab.map((loss) => loss.split(" ")[0]).sort()).toEqual(["frc2522", "frc5937"]);
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
    it.skip(`skipped: no district artifact under ${LOCAL_DISTRICT_DIR} (gitignored local data)`, () => {});
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
