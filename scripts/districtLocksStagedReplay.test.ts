/**
 * The staged replay: an event walked stage by stage with its points LAGGING
 * its matches, through the shared merge and the District Locks status code
 * (quick task 261009-vp9, CONTEXT D3).
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
 * the live Worker calls, and then through `buildDistrictLedgerRows` and
 * `computeDistrictLedgerStatuses` at Now, the District Locks tab's own code.
 *
 * THE EVENT LIST IS DERIVED from the fixture, never typed in, and its count
 * is asserted.
 *
 * IT PROVES SOMETHING. The same walk runs with the rule switched off inside
 * this file (the core rule replaced by the state's own reading through a
 * module mock, every other change left on) and must then take locks back.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDistrictEventState, applyDistrictRankings, publishedCategoryFinality, recomputeDistrictVerdicts } from "../packages/harness/districtRankingsMerge.js";
import { DistrictArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../packages/harness/pageArtifacts.js";
import { maxEventPoints } from "../packages/core/districts/pointModel.js";
import type { DistrictCategoryFinality } from "../packages/core/districts/reservedSlots.js";
import { DISTRICT_CATEGORIES, buildDistrictLedgerRows } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";

/**
 * THE SWITCH. While `off` is set, the one core rule answers with the state's
 * own reading, which is what it replaced. Nothing else is switched: the merge,
 * the row builder and the status code all run as shipped.
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

type Team = DistrictArtifact["teams"][number];
type Row = Team["eventPoints"][number];
interface Points {
  readonly qual: number;
  readonly alliance: number;
  readonly elim: number;
  readonly award: number;
}

const SEASON = 2026;
const NOW_YEAR = 2026;
const STAMP = { generation: "staged-replay", computedAt: "2026-04-05T00:00:00.000Z" } as const;

const FIXTURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "fixtures", "phase10", "district-2026pnw.json");
const fixtureFile: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));

/** Synthetic counts, real meaning: 60 qualification matches scheduled. */
const QUAL_TOTAL = 60;
const QUAL_PLAYED_IN_PROGRESS = 50;
const FINISHED_STATE: DistrictEventState = { qualMatchesPlayed: QUAL_TOTAL, qualMatchesTotal: QUAL_TOTAL, alliancesPicked: true, playoffsDone: true, awardsPosted: true };

/** The fixture with a finished state block on every row, at the verdict pass's fixed point. */
const baseline: DistrictArtifact = recomputeDistrictVerdicts(
  DistrictArtifactSchema.parse({ ...fixtureFile, teams: fixtureFile.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => ({ ...row, state: { ...FINISHED_STATE } })) })) }),
  { nowYear: NOW_YEAR }
);

/** DERIVED, never typed in: every event key on a district tier `eventPoints` row of the fixture, sorted. */
const districtEvents: string[] = [...new Set(fixtureFile.teams.flatMap((team) => team.eventPoints.filter((row) => row.tier === "district").map((row) => row.eventKey)))].sort();

/** The winner's playoff value at a 2026 district tier event. */
const DISTRICT_WINNER_VALUE = maxEventPoints(SEASON, "district").elim;

/** DERIVED: whether the fixture carries a row at the winner's value for the event. Where it does not, Playoffs wait for the awards flag. */
function hasWinnerRow(eventKey: string): boolean {
  return baseline.teams.some((team) => team.eventPoints.some((row) => row.eventKey === eventKey && row.elim >= DISTRICT_WINNER_VALUE));
}

const districtHeld = (status: string): boolean => status === "locked" || status === "lockedAward";
const champHeld = (status: string): boolean => status === "locked" || status === "lockedAward" || status === "prequalified";
const tabLocked = (status: string): boolean => status === "locked";

const ALL_OPEN: DistrictCategoryFinality = { qual: false, alliance: false, elim: false, award: false };
const ALL_FINAL: DistrictCategoryFinality = { qual: true, alliance: true, elim: true, award: true };

/** What one tick of a walk left behind. */
interface WalkStep {
  readonly label: string;
  /** The published `districtLock.status` of every team. */
  readonly district: ReadonlyMap<string, string>;
  /** The published `champLock.status` of every team. */
  readonly champ: ReadonlyMap<string, string>;
  /** The District Locks status of every team, from the tab's own status code at Now. */
  readonly tab: ReadonlyMap<string, string>;
  /** The walked event's finality as the verdict pass reads it. */
  readonly publishedFinal: DistrictCategoryFinality;
  /** The walked event's finality as the tab's rows read it (every row of the event agrees, asserted while walking). */
  readonly rowFinal: DistrictCategoryFinality;
  /** `team category` for every cell at the walked event that is `kind: "final"` while its category reads open. */
  readonly greyOpenCells: readonly string[];
}

interface Walk {
  readonly eventKey: string;
  /** The entry before tick 0, then ticks 0 to 9: eleven steps. */
  readonly steps: readonly WalkStep[];
  readonly end: DistrictArtifact;
}

/** The state block of the walked event as the artifact carries it now: a row with a state wins over one without. */
function stateAt(artifact: DistrictArtifact, eventKey: string): DistrictEventState | undefined {
  let found: DistrictEventState | undefined;
  for (const team of artifact.teams) for (const row of [...team.eventPoints, ...team.remainingEvents]) if (row.eventKey === eventKey && found === undefined) found = row.state;
  return found;
}

function snapshot(label: string, artifact: DistrictArtifact, eventKey: string): WalkStep {
  const built = buildDistrictLedgerRows({ artifact, distributions: new Map() });
  const statuses = computeDistrictLedgerStatuses({ artifact, teams: built.teams });
  const eventRows = built.teams.flatMap((team) => team.rows.filter((row) => row.eventKey === eventKey).map((row) => ({ teamKey: team.teamKey, row })));
  const rowFinal: DistrictCategoryFinality = eventRows[0]?.row.stage.final ?? ALL_OPEN;
  const greyOpenCells: string[] = [];
  for (const { teamKey, row } of eventRows) {
    // Every row of one event carries one stage.
    expect({ label, teamKey, final: row.stage.final }).toEqual({ label, teamKey, final: rowFinal });
    DISTRICT_CATEGORIES.forEach((category, index) => {
      if (!row.stage.final[category] && row.cells[index]!.kind === "final") greyOpenCells.push(`${teamKey} ${category}`);
    });
  }
  return {
    label,
    district: new Map(artifact.teams.map((team) => [team.teamKey, team.districtLock.status] as const)),
    champ: new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const)),
    tab: new Map([...statuses.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    publishedFinal: publishedCategoryFinality(artifact.teams, eventKey, stateAt(artifact, eventKey), SEASON),
    rowFinal,
    greyOpenCells,
  };
}

/**
 * One district tier event of the fixture walked through the ten ticks. Every
 * other event stays finished.
 */
function walkDistrictEvent(eventKey: string): Walk {
  const finalRow = new Map<string, Row>();
  for (const team of baseline.teams) {
    const row = team.eventPoints.find((entry) => entry.eventKey === eventKey);
    if (row !== undefined) finalRow.set(team.teamKey, row);
  }
  const participants = [...finalRow.keys()].sort();
  const pointsOf = (teamKey: string): Row => finalRow.get(teamKey)!;
  // Stale qualification points: each participant's final value, taken from
  // the participant seven places on in key order, wrapping, so some sit above
  // and some below what they finish on.
  const provisionalQual = new Map(participants.map((teamKey, index) => [teamKey, pointsOf(participants[(index + 7) % participants.length]!).qual] as const));

  // The awards TBA lists for the event: every award the fixture records there,
  // one entry per recipient, and one judged award with no district recipient.
  const awardsList = [
    ...baseline.teams.flatMap((team) => team.qualifyingAwards.filter((award) => award.eventKey === eventKey).map((award) => ({ award_type: award.awardType, recipient_list: [{ team_key: team.teamKey as string | null }] }))),
    { award_type: 29, recipient_list: [{ team_key: null as string | null }] },
  ];

  // Before tick 0: the event has not started. Its participants' rows are
  // remaining events again, their totals lose the row and their awards at the
  // event leave the list.
  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...baseline,
      teams: baseline.teams.map((team) => {
        const row = finalRow.get(team.teamKey);
        if (row === undefined) return team;
        return {
          ...team,
          pointTotal: team.pointTotal - row.total,
          eventPoints: team.eventPoints.filter((entry) => entry.eventKey !== eventKey),
          remainingEvents: [
            ...team.remainingEvents,
            { eventKey, eventName: row.eventName, week: row.week, tier: "district" as const, maxPoints: 83, state: { qualMatchesPlayed: 0, qualMatchesTotal: QUAL_TOTAL, alliancesPicked: false, playoffsDone: false, awardsPosted: false } },
          ],
          qualifyingAwards: team.qualifyingAwards.filter((award) => award.eventKey !== eventKey),
        };
      }),
    }),
    { nowYear: NOW_YEAR }
  );

  /** A TBA shaped rankings payload: every other row as published, the walked event's row at the given points. */
  const payload = (at: (teamKey: string) => Points) =>
    baseline.teams.map((team) => {
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
        event_points: [...others, { event_key: eventKey, district_cmp: false, qual_points: points.qual, alliance_points: points.alliance, elim_points: points.elim, award_points: points.award, total }],
      };
    });

  /**
   * The event's state for a tick. The flag is ALWAYS the one the artifact
   * already holds, as the Worker hands it, never a literal false: only the
   * awards step raises it.
   */
  const stateOf = (played: number, picked: boolean, done: boolean): DistrictEventState => ({
    qualMatchesPlayed: played,
    qualMatchesTotal: QUAL_TOTAL,
    alliancesPicked: picked,
    playoffsDone: done,
    awardsPosted: stateAt(artifact, eventKey)?.awardsPosted === true,
  });
  type Extra = { eventAwards?: ReadonlyMap<string, typeof awardsList>; settledAwardEvents?: ReadonlySet<string> };
  const rowsChange = (state: DistrictEventState, at: (teamKey: string) => Points, extra: Extra = {}): void => {
    artifact = applyDistrictRankings({ artifact, rankings: payload(at), ...STAMP, eventState: new Map([[eventKey, state]]), ...extra });
  };
  const stateOnly = (state: DistrictEventState, extra: Extra = {}): void => {
    artifact = applyDistrictEventState({ artifact, eventState: new Map([[eventKey, state]]), ...STAMP, ...extra });
  };
  const listed = { eventAwards: new Map([[eventKey, awardsList]]) };

  const steps: WalkStep[] = [snapshot("before the event", artifact, eventKey)];
  const tick = (label: string, apply: () => void): void => {
    apply();
    steps.push(snapshot(label, artifact, eventKey));
  };

  tick("0 qualification in progress", () => rowsChange(stateOf(QUAL_PLAYED_IN_PROGRESS, false, false), (teamKey) => ({ qual: provisionalQual.get(teamKey)!, alliance: 0, elim: 0, award: 0 })));
  tick("1 last qualification match played, rankings stale", () => stateOnly(stateOf(QUAL_TOTAL, false, false)));
  tick("2 rankings catch up", () => rowsChange(stateOf(QUAL_TOTAL, false, false), (teamKey) => ({ qual: pointsOf(teamKey).qual, alliance: 0, elim: 0, award: 0 })));
  tick("3 alliances picked, no alliance points", () => stateOnly(stateOf(QUAL_TOTAL, true, false)));
  tick("4 alliance points land", () => rowsChange(stateOf(QUAL_TOTAL, true, false), (teamKey) => ({ qual: pointsOf(teamKey).qual, alliance: pointsOf(teamKey).alliance, elim: 0, award: 0 })));
  tick("5 playoffs done, no playoff points", () => stateOnly(stateOf(QUAL_TOTAL, true, true)));
  tick("6 playoff points land", () => rowsChange(stateOf(QUAL_TOTAL, true, true), (teamKey) => ({ qual: pointsOf(teamKey).qual, alliance: pointsOf(teamKey).alliance, elim: pointsOf(teamKey).elim, award: 0 })));
  tick("7 judged awards listed", () => stateOnly(stateOf(QUAL_TOTAL, true, true), listed));
  tick("8 award points land", () => rowsChange(stateOf(QUAL_TOTAL, true, true), (teamKey) => ({ qual: pointsOf(teamKey).qual, alliance: pointsOf(teamKey).alliance, elim: pointsOf(teamKey).elim, award: pointsOf(teamKey).award }), listed));
  tick("9 list settled", () => stateOnly(stateOf(QUAL_TOTAL, true, true), { ...listed, settledAwardEvents: new Set([eventKey]) }));

  return { eventKey, steps, end: artifact };
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

/** (d): a team the published verdict reads `eliminated` reads only `eliminated` or `lockedAward` afterwards. */
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

/** The step of tick `n` (0 to 9). Index 0 of `steps` is the entry before tick 0. */
const tickOf = (walk: Walk, n: number): WalkStep => walk.steps[n + 1]!;

/** Assertions (a) to (d) and the end state, for one walk with the rule on. */
function expectNoTakeBack(walk: Walk): void {
  const { eventKey, steps } = walk;
  expect(steps).toHaveLength(11);

  // (a) the published verdicts, at both tiers.
  expect({ eventKey, lost: takeBacks(steps, (step) => step.district, districtHeld) }).toEqual({ eventKey, lost: [] });
  expect({ eventKey, lost: takeBacks(steps, (step) => step.champ, champHeld) }).toEqual({ eventKey, lost: [] });
  // (b) the District Locks tab.
  expect({ eventKey, lost: takeBacks(steps, (step) => step.tab, tabLocked) }).toEqual({ eventKey, lost: [] });

  // (c) a category whose points are not in reads open, in the verdict pass
  // and in the tab's rows alike, and no cell of an open category is grey.
  const QUAL_AND_ALLIANCE: DistrictCategoryFinality = { qual: true, alliance: true, elim: false, award: false };
  const playoffsOnceLanded: DistrictCategoryFinality = { qual: true, alliance: true, elim: hasWinnerRow(eventKey), award: false };
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
  expect(walk.end.teams).toHaveLength(baseline.teams.length);
  for (const team of walk.end.teams) {
    const published = baseline.teams.find((entry) => entry.teamKey === team.teamKey)!;
    expect({
      eventKey,
      teamKey: team.teamKey,
      district: team.districtLock.status,
      champ: team.champLock.status,
      pointTotal: team.pointTotal,
      maxRemainingDistrict: team.maxRemainingDistrict,
      maxRemainingChamp: team.maxRemainingChamp,
    }).toEqual({
      eventKey,
      teamKey: team.teamKey,
      district: published.districtLock.status,
      champ: published.champLock.status,
      pointTotal: published.pointTotal,
      maxRemainingDistrict: published.maxRemainingDistrict,
      maxRemainingChamp: published.maxRemainingChamp,
    });
  }
}

describe("the staged replay: a category's number reads final only once its points are in (quick task 261009-vp9)", () => {
  it("premise: the derived event list has eight entries, and the baseline's district status equals the published file's for all 126 teams", () => {
    expect(districtEvents).toHaveLength(8);
    expect(districtEvents).toContain("2026orore");
    expect(baseline.teams).toHaveLength(126);
    const fileStatus = new Map(fixtureFile.teams.map((team) => [team.teamKey, team.districtLock.status] as const));
    for (const team of baseline.teams) expect({ teamKey: team.teamKey, status: team.districtLock.status }).toEqual({ teamKey: team.teamKey, status: fileStatus.get(team.teamKey) });
  });

  it("2026orore, the rule on: no published lock and no District Locks Locked is taken back at any tick, a category reads open until its points are in, and the end state is the published one", () => {
    expectNoTakeBack(walkDistrictEvent("2026orore"));
  });

  it("2026orore, the rule switched off: the same walk takes locks back in the published verdicts and on the tab, and tick 1 reads Qualification final", () => {
    ruleSwitch.off = true;
    const walk = walkDistrictEvent("2026orore");
    const district = takeBacks(walk.steps, (step) => step.district, districtHeld);
    const champ = takeBacks(walk.steps, (step) => step.champ, champHeld);
    const tab = takeBacks(walk.steps, (step) => step.tab, tabLocked);
    expect(district.length + champ.length).toBeGreaterThan(0);
    expect(district.length).toBeGreaterThan(0);
    expect(tab.length).toBeGreaterThan(0);
    // The state's own reading: every qualification match played closes Qualification at once.
    expect(tickOf(walk, 1).publishedFinal.qual).toBe(true);
    expect(tickOf(walk, 1).rowFinal.qual).toBe(true);
    // And the walk still ends where the published artifact is.
    for (const team of walk.end.teams) expect({ teamKey: team.teamKey, status: team.districtLock.status }).toEqual({ teamKey: team.teamKey, status: baseline.teams.find((entry) => entry.teamKey === team.teamKey)!.districtLock.status });
  });
});
