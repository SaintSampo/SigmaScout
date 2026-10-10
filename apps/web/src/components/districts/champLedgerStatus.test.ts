/**
 * The champ tier's five statuses, pinned against
 * `data/fixtures/phase10/district-2026pnw.json` at a position where every
 * category of all nine events is final.
 *
 * THE FIXTURE CARRIES NO `state` BLOCKS, so the all-final `stageByEvent` is
 * supplied explicitly for all nine event keys; `deriveStageFromState(undefined)`
 * reports every category OPEN, by design.
 *
 * The acceptance below is a RECORDED FACT rather than a hope: the artifact's
 * own `champLock` census is `{locked: 12, lockedAward: 8, contending: 2,
 * eliminated: 104}` and its own `insights.cmpCutLinePoints` is 182, and this
 * recompute reproduces both with zero per-team disagreements.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../../../../../packages/core/districts/locks.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { dcmpAwardCountCeilings } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import { MAX_WINNING_ALLIANCE_SIZE, pendingAwardSlots } from "../../../../../packages/core/districts/champReservedSlots.js";
import { unseenChampionshipsHeld } from "../../../../../packages/core/districts/dcmpFieldProof.js";
import { buildChampLedgerRows, champFieldProofAtNow } from "./champLedgerRows.js";
import { applyChampRangeState, champFinalsCeilingWithoutRow, computeChampLedgerStatuses, jointDecidedPlacementTopUp } from "./champLedgerStatus.js";
import { champCutoffView, type ChampRangeState } from "./champLedgerChances.js";
import { SHOW_SIMULATED_CHAMP_LIKELY_RANGE, predictedCutoff, type LedgerCutoffView } from "./predictedCutoff.js";
import { playoffPoints, routeBracket, type AllianceBracketMilestone, type PlayedBracketMatch } from "../../../../../packages/core/districts/bracket.js";
import { jointLockBound, jointLockedTeams, jointLockedTeamsMultiple, type JointLockInput } from "../../../../../packages/core/districts/champJointLock.js";
import {
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  pointMassDistribution,
  type DcmpBracketFacts,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";

function repoFile(relative: string): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find ${relative} above ${process.cwd()}`);
    dir = parent;
  }
}

const FIXTURE: DistrictArtifact = DistrictArtifactSchema.parse(
  JSON.parse(readFileSync(repoFile("data/fixtures/phase10/district-2026pnw.json"), "utf8"))
);

const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const ALL_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

function eventKeysOf(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) keys.add(row.eventKey);
    for (const row of team.remainingEvents) keys.add(row.eventKey);
  }
  return [...keys].sort();
}

function modelAt(stageByEvent: ReadonlyMap<string, DistrictStageFinality>, dcmpStarted: boolean) {
  const rows = buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent, dcmpStarted });
  return { rows, status: computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams }) };
}

const ALL_FINAL_STAGES = new Map(eventKeysOf(FIXTURE).map((key) => [key, ALL_FINAL] as const));
const FINISHED = modelAt(ALL_FINAL_STAGES, true);

describe("computeChampLedgerStatuses — the finished 2026 PNW district", () => {
  it("has nine events, 126 teams and 21 championship slots", () => {
    expect(eventKeysOf(FIXTURE)).toHaveLength(9);
    expect(FIXTURE.teams).toHaveLength(126);
    expect(FIXTURE.cmpSlots).toBe(21);
  });

  it("reproduces the artifact's own champLock census exactly", () => {
    expect(FINISHED.status.verdictCensus).toEqual<Record<LockStatus, number>>({
      locked: 12,
      lockedAward: 8,
      contending: 2,
      eliminated: 104,
      prequalified: 0,
      unknown: 0,
    });
  });

  it("disagrees with no single team's published champLock verdict", () => {
    const disagreements: string[] = [];
    for (const team of FIXTURE.teams) {
      const recomputed = FINISHED.status.byTeam.get(team.teamKey);
      if (recomputed === undefined || recomputed.verdict !== team.champLock.status) {
        disagreements.push(`${team.teamKey}: published ${team.champLock.status}, recomputed ${recomputed?.verdict ?? "missing"}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("names the three DCMP winning-alliance teams as winner and the five judged ones as award", () => {
    const winners = [...FINISHED.status.byTeam.values()].filter((r) => r.awardKind === "winner").map((r) => r.teamKey).sort();
    const awards = [...FINISHED.status.byTeam.values()].filter((r) => r.awardKind === "award").map((r) => r.teamKey).sort();
    expect(winners).toEqual(["frc2046", "frc2811", "frc2910"]);
    expect(awards).toEqual(["frc10991", "frc2635", "frc4125", "frc4450", "frc9023"]);
    expect(FINISHED.status.awardQualified).toHaveLength(8);
  });

  it("merges locked and lockedAward into the one Locked chip", () => {
    expect(FINISHED.status.counts.locked).toBe(20);
    expect(FINISHED.status.counts.locked).not.toBe(FIXTURE.insights.champLockedCount);
    expect(FIXTURE.insights.champLockedCount).toBe(12);
    expect(FINISHED.status.counts.lockedOut).toBe(104);
    expect(FINISHED.status.counts.prequalified).toBe(0);
    expect(FINISHED.status.counts.inRange + FINISHED.status.counts.outOfRange).toBe(2);
  });

  it("reproduces the artifact's own cmpCutLinePoints on the floors, which is the only thing floorCutLine is kept for", () => {
    // NOT RENDERED any more: the tab prints the predicted cutoff instead
    // (quick task 260926-37q). This field survives as the proof that this
    // module's recompute agrees with the published insight.
    expect(FINISHED.status.floorCutLine).toBe(182);
    expect(FINISHED.status.floorCutLine).toBe(FIXTURE.insights.cmpCutLinePoints);
  });

  it("splits the two teams tied at 182 by rank, not by the friendlier side of the line", () => {
    const inRange = FINISHED.status.byTeam.get("frc3674")!;
    const outOfRange = FINISHED.status.byTeam.get("frc9450")!;
    expect(inRange.status).toBe("inRange");
    expect(inRange.poolRank).toBe(13);
    expect(outOfRange.status).toBe("outOfRange");
    expect(outOfRange.poolRank).toBe(14);
    // Both teams sit EXACTLY on the line, which is why a `>=` rule would put
    // 22 teams into 21 slots.
    const pointsOf = (key: string): number => FIXTURE.teams.find((t) => t.teamKey === key)!.pointTotal;
    expect(pointsOf("frc3674")).toBe(182);
    expect(pointsOf("frc9450")).toBe(182);
  });

  it("reserves nothing and narrows 21 slots to 13 over a 118 team pool", () => {
    expect(FINISHED.status.reservedSlots).toBe(0);
    expect(FINISHED.status.pointsSlots).toBe(13);
    const pooled = [...FINISHED.status.byTeam.values()].filter((r) => r.poolRank !== null);
    expect(pooled).toHaveLength(118);
  });
});

describe("computeChampLedgerStatuses — reopening the DCMP", () => {
  it("un-awards every champ-tier qualifier when the DCMP's playoffs and awards reopen", () => {
    const stages = new Map(eventKeysOf(FIXTURE).map((key) => [key, key === "2026pncmp" ? ALL_OPEN : ALL_FINAL] as const));
    const reopened = modelAt(stages, true);
    expect(reopened.status.awardQualified).toEqual([]);
    expect(reopened.status.verdictCensus.lockedAward).toBe(0);
    // With no qualifier consuming a slot the whole capacity is in the points race.
    expect(reopened.status.pointsSlots).toBe(21);
  });

  it("keeps the judged awards but drops the winner when only the playoffs reopen", () => {
    const stages = new Map(
      eventKeysOf(FIXTURE).map((key) => [key, key === "2026pncmp" ? { ...ALL_FINAL, elim: false } : ALL_FINAL] as const)
    );
    const model = modelAt(stages, true).status;
    expect(model.awardQualified).toEqual(["frc10991", "frc2635", "frc4125", "frc4450", "frc9023"]);
    expect([...model.byTeam.values()].filter((r) => r.awardKind === "winner")).toEqual([]);
    expect(model.pointsSlots).toBe(16);
  });
});

describe("computeChampLedgerStatuses — the floor and the ceiling", () => {
  it("is exactly pointTotal at a position where nothing is reopened", () => {
    // Every team is either locked, eliminated or contending on its published
    // point total — a floor that had drifted from `pointTotal` could not
    // reproduce the census above, and the cut line is the pool's own
    // 13th highest point total.
    const poolTotals = FIXTURE.teams
      .filter((t) => !FINISHED.status.awardQualified.includes(t.teamKey))
      .map((t) => t.pointTotal)
      .sort((a, b) => b - a);
    expect(poolTotals[12]).toBe(FINISHED.status.floorCutLine);
  });

  it("gives a team outside the field no dcmp ceiling", () => {
    const stages = new Map(eventKeysOf(FIXTURE).map((key) => [key, key === "2026pncmp" ? ALL_OPEN : ALL_FINAL] as const));
    const model = modelAt(stages, true);
    const outside = model.rows.teams.find((t) => t.membership === "out")!;
    const inside = model.rows.teams.find((t) => t.membership === "in")!;
    // A team outside the field cannot reach anyone: with the district season
    // finished and no DCMP to play, its ceiling is its floor, so it is either
    // locked or eliminated and never contending.
    expect(model.status.byTeam.get(outside.teamKey)!.verdict).not.toBe("contending");
    // A team inside it still has all four DCMP categories open.
    expect(model.status.byTeam.get(inside.teamKey)).toBeDefined();
  });
});

/**
 * THE PRE-REGISTRATION WINDOW'S CEILING.
 *
 * Strip every dcmp-tier row off the fixture and the artifact names no
 * championship at all, which is what a real artifact looks like for most of a
 * district season. The statuses must still compute: the floor is `pointTotal`,
 * and the ceiling adds one whole hypothetical DCMP for every team that could
 * still reach the field. Without that ceiling most of the district would read
 * Locked out in week one.
 */
describe("computeChampLedgerStatuses — the champ-tier reservation (quick task 261006-3gg)", () => {
  const DCMP_KEY = "2026pncmp";
  const AWARD_SLOTS = pendingAwardSlots(dcmpAwardCountCeilings(FIXTURE.year, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts);

  /** Every district-tier event final, the DCMP at `dcmpStage`; `nowYear` pinned so the fixture (no `state` blocks) reads the same in every calendar year. */
  function modelWithDcmpAt(dcmpStage: DistrictStageFinality) {
    const stageByEvent = new Map(eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? dcmpStage : ALL_FINAL] as const));
    const rows = buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent, dcmpStarted: true });
    return computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams, nowYear: 2026 });
  }
  const lockedOnPoints = (model: ReturnType<typeof modelWithDcmpAt>): number => [...model.byTeam.values()].filter((r) => r.status === "locked" && !r.byAward).length;

  it("holds back every judged consuming award at its ceiling while the DCMP awards are open, and the winning alliance too while its playoffs are", () => {
    expect(AWARD_SLOTS).toBeGreaterThanOrEqual(3);
    expect(modelWithDcmpAt({ qual: true, alliance: true, elim: true, award: false }).reservedSlots).toBe(AWARD_SLOTS);
    expect(modelWithDcmpAt({ qual: true, alliance: true, elim: false, award: false }).reservedSlots).toBe(AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE);
    expect(modelWithDcmpAt(ALL_OPEN).reservedSlots).toBe(AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE);
  });

  it("reserves nothing once the awards are final, which is what keeps the finished fixture's census exactly as published", () => {
    expect(modelWithDcmpAt(ALL_FINAL).reservedSlots).toBe(0);
    expect(FINISHED.status.reservedSlots).toBe(0);
  });

  it("tightens the Locked test alone: fewer teams lock while the awards are open, and the unreserved pointsSlots the In range rank rule reads does not move", () => {
    const awardsOpen = modelWithDcmpAt({ qual: true, alliance: true, elim: true, award: false });
    const final = modelWithDcmpAt(ALL_FINAL);
    expect(lockedOnPoints(awardsOpen)).toBeLessThan(lockedOnPoints(final));
    // Posted DCMP judged awards leave the qualified set when the stage reopens,
    // so the unreserved count can only GROW there; it never shrinks by the reservation.
    expect(awardsOpen.pointsSlots).toBeGreaterThanOrEqual(final.pointsSlots);
    expect(awardsOpen.counts.lockedOut).toBeLessThanOrEqual(final.counts.lockedOut);
  });

  it("reads a past season with no DCMP state anywhere as a championship that never happened, and the current season as one still to come", () => {
    const stageByEvent = new Map(eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? ALL_OPEN : ALL_FINAL] as const));
    const rows = buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent, dcmpStarted: false });
    expect(computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams, nowYear: 2027 }).reservedSlots).toBe(0);
    expect(computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams, nowYear: 2026 }).reservedSlots).toBe(AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE);
  });
});

describe("computeChampLedgerStatuses — a district with two championships (quick task 261006-lwo)", () => {
  const DCMP_KEY = "2026pncmp";
  const SECOND_KEY = "2026pnncmp";
  const AWARD_SLOTS = pendingAwardSlots(dcmpAwardCountCeilings(FIXTURE.year, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts);

  /** Every other team's championship rows AND its DCMP awards relabelled to a second key: the same facts, split across two events, as 2026 California publishes them. */
  const TWO_DCMP: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team, index) => {
      if (index % 2 === 0) return team;
      const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === DCMP_KEY ? { ...row, eventKey: SECOND_KEY } : row);
      return {
        ...team,
        eventPoints: team.eventPoints.map(relabel),
        remainingEvents: team.remainingEvents.map(relabel),
        qualifyingAwards: team.qualifyingAwards.map(relabel),
      };
    }),
  });

  /** The championships a Winner is recorded at, after the relabelling above. */
  const WINNER_KEYS = [...new Set(TWO_DCMP.teams.flatMap((team) => team.qualifyingAwards.filter((award) => award.awardType === 1).map((award) => award.eventKey)))].sort();

  function modelWithStages(first: DistrictStageFinality, second: DistrictStageFinality) {
    const stageByEvent = new Map(eventKeysOf(TWO_DCMP).map((key) => [key, key === DCMP_KEY ? first : key === SECOND_KEY ? second : ALL_FINAL] as const));
    const rows = buildChampLedgerRows({ artifact: TWO_DCMP, distributions: new Map(), stageByEvent, dcmpStarted: true });
    return { rows, status: computeChampLedgerStatuses({ artifact: TWO_DCMP, teams: rows.teams, nowYear: 2026 }) };
  }

  it("carries both keys, and builds every team's row from its own championship", () => {
    const { rows } = modelWithStages(ALL_FINAL, ALL_FINAL);
    expect(rows.dcmpEventKeys).toEqual([DCMP_KEY, SECOND_KEY]);
    expect(rows.dcmpEventKey).toBe(DCMP_KEY);
    const atSecond = rows.teams.filter((team) => team.dcmpRow.sources[0]?.eventKey === SECOND_KEY);
    expect(atSecond.length).toBeGreaterThan(0);
    expect(atSecond.every((team) => team.membership === "in")).toBe(true);
  });

  it("reproduces the single-championship census exactly: the second championship's winners and award winners leave the pool too", () => {
    const { status } = modelWithStages(ALL_FINAL, ALL_FINAL);
    expect(status.counts).toEqual(FINISHED.status.counts);
    expect(status.verdictCensus).toEqual(FINISHED.status.verdictCensus);
    expect(status.awardQualified).toEqual(FINISHED.status.awardQualified);
    expect(status.pointsSlots).toBe(FINISHED.status.pointsSlots);
    expect(status.floorCutLine).toBe(FINISHED.status.floorCutLine);
    expect([...status.byTeam.values()].map((r) => [r.teamKey, r.status, r.byAward])).toEqual(
      [...FINISHED.status.byTeam.values()].map((r) => [r.teamKey, r.status, r.byAward])
    );
  });

  it("reserves one championship's slots per championship still open", () => {
    const PLAYOFFS_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };
    expect(modelWithStages(ALL_FINAL, ALL_FINAL).status.reservedSlots).toBe(0);
    // PIN MOVED by quick task 261009-vp9 (the winner hold), from AWARD_SLOTS.
    // The fixture's three Winner records all sit on teams at the FIRST
    // championship, and this fixture carries no state block, so neither
    // championship's flag is true at Now. The second championship's Playoffs
    // are final here with NO Winner recorded there, so its winning
    // alliance's four places stay held on top of its judged awards.
    expect(WINNER_KEYS).toEqual([DCMP_KEY]);
    expect(modelWithStages(ALL_FINAL, PLAYOFFS_FINAL).status.reservedSlots).toBe(AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE);
    // The mirror: the first championship does have its Winner recorded, so
    // its four places are released as before.
    expect(modelWithStages(PLAYOFFS_FINAL, ALL_FINAL).status.reservedSlots).toBe(AWARD_SLOTS);
    expect(modelWithStages({ qual: true, alliance: true, elim: false, award: false }, ALL_OPEN).status.reservedSlots).toBe(2 * (AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE));
  });

  it("folds a DIVISION into its parent: relabelled as 2026pncmp1 the second key is the same championship, so the parent's stage alone decides the reservation", () => {
    const DIVISION_KEY = "2026pncmp1";
    const withDivision: DistrictArtifact = DistrictArtifactSchema.parse({
      ...TWO_DCMP,
      teams: TWO_DCMP.teams.map((team) => {
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === SECOND_KEY ? { ...row, eventKey: DIVISION_KEY } : row);
        return { ...team, eventPoints: team.eventPoints.map(relabel), remainingEvents: team.remainingEvents.map(relabel), qualifyingAwards: team.qualifyingAwards.map(relabel) };
      }),
    });
    const at = (parent: DistrictStageFinality, division: DistrictStageFinality): number => {
      const stageByEvent = new Map(eventKeysOf(withDivision).map((key) => [key, key === DCMP_KEY ? parent : key === DIVISION_KEY ? division : ALL_FINAL] as const));
      const rows = buildChampLedgerRows({ artifact: withDivision, distributions: new Map(), stageByEvent, dcmpStarted: true });
      return computeChampLedgerStatuses({ artifact: withDivision, teams: rows.teams, nowYear: 2026 }).reservedSlots;
    };
    expect(at(ALL_FINAL, ALL_OPEN)).toBe(0);
    expect(at(ALL_OPEN, ALL_FINAL)).toBe(AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE);
    expect(at({ qual: true, alliance: true, elim: true, award: false }, ALL_FINAL)).toBe(AWARD_SLOTS);
  });

  it("locks fewer teams on points while only the second championship's awards are open than with both final", () => {
    const lockedOnPoints = (model: ReturnType<typeof modelWithStages>): number => [...model.status.byTeam.values()].filter((r) => r.status === "locked" && !r.byAward).length;
    expect(lockedOnPoints(modelWithStages(ALL_FINAL, { qual: true, alliance: true, elim: true, award: false }))).toBeLessThan(lockedOnPoints(modelWithStages(ALL_FINAL, ALL_FINAL)));
  });
});

describe("computeChampLedgerStatuses — the winner hold (quick task 261009-vp9)", () => {
  const DCMP_KEY = "2026pncmp";
  const SECOND_KEY = "2026pnncmp";
  const AWARD_SLOTS = pendingAwardSlots(dcmpAwardCountCeilings(FIXTURE.year, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts);
  const HELD = AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE;
  const PLAYOFFS_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };
  type StateBlock = NonNullable<DistrictArtifact["teams"][number]["eventPoints"][number]["state"]>;
  /** Played out, awards not posted: a championship that is still live at Now. */
  const LIVE: StateBlock = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: false };
  /** Over, awards posted: the flag is true at Now. */
  const OVER: StateBlock = { ...LIVE, awardsPosted: true };
  const WINNER = (eventKey: string) => ({ eventKey, awardType: 1, label: "Winner", awardOnly: false });

  /** `artifact` with a state block on every row (`dcmpStateOf` on a dcmp tier row, over everywhere else) and, unless `winners`, every Winner record removed. */
  function withStates(artifact: DistrictArtifact, dcmpStateOf: (eventKey: string) => StateBlock, winners: boolean): DistrictArtifact {
    return DistrictArtifactSchema.parse({
      ...artifact,
      teams: artifact.teams.map((team) => ({
        ...team,
        eventPoints: team.eventPoints.map((row) => ({ ...row, state: row.tier === "dcmp" ? dcmpStateOf(row.eventKey) : OVER })),
        qualifyingAwards: winners ? team.qualifyingAwards : team.qualifyingAwards.filter((award) => award.awardType !== 1),
      })),
    });
  }

  /** The reservation at Now (no stage map), or at a rewound stop (the stage map supplied). */
  function reservedAt(artifact: DistrictArtifact, stageByEvent?: ReadonlyMap<string, DistrictStageFinality>): number {
    const rows = buildChampLedgerRows({ artifact, distributions: new Map(), ...(stageByEvent === undefined ? { atLivePosition: true } : { stageByEvent }), dcmpStarted: true });
    return computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026 }).reservedSlots;
  }
  const stopWith = (artifact: DistrictArtifact, dcmpStage: (eventKey: string) => DistrictStageFinality | undefined) =>
    new Map(eventKeysOf(artifact).map((key) => [key, dcmpStage(key) ?? ALL_FINAL] as const));

  it("a live championship whose Playoffs are final with no Winner recorded holds the four winner places, and releases them once a Winner is recorded", () => {
    // At Now. The state says the playoffs are done and the winners' rows
    // carry the 90, so the Playoffs are final. The flag is not true.
    expect(reservedAt(withStates(FIXTURE, () => LIVE, false))).toBe(HELD);
    expect(reservedAt(withStates(FIXTURE, () => LIVE, true))).toBe(AWARD_SLOTS);
    // The same at a rewound stop of that live championship.
    const stop = stopWith(FIXTURE, (key) => (key === DCMP_KEY ? PLAYOFFS_FINAL : undefined));
    expect(reservedAt(withStates(FIXTURE, () => LIVE, false), stop)).toBe(HELD);
    expect(reservedAt(withStates(FIXTURE, () => LIVE, true), stop)).toBe(AWARD_SLOTS);
  });

  it("a championship whose flag is true at Now releases them at a rewound stop where its Playoffs are final and its Awards open, Winner recorded or not (the 2020 shape)", () => {
    const stop = stopWith(FIXTURE, (key) => (key === DCMP_KEY ? PLAYOFFS_FINAL : undefined));
    expect(reservedAt(withStates(FIXTURE, () => OVER, false), stop)).toBe(AWARD_SLOTS);
    expect(reservedAt(withStates(FIXTURE, () => OVER, true), stop)).toBe(AWARD_SLOTS);
    // And while the Playoffs are open at the stop the four places are held, whatever the flag at Now says.
    const open = stopWith(FIXTURE, (key) => (key === DCMP_KEY ? { qual: true, alliance: true, elim: false, award: false } : undefined));
    expect(reservedAt(withStates(FIXTURE, () => OVER, true), open)).toBe(HELD);
  });

  it("at a divisioned championship the flag read is the finals event's own: a division's true flag does not switch the hold off", () => {
    // Even teams in division 1, odd in division 2, and the first DCMP team
    // keeps a finals row at the parent key. The divisions are over.
    const firstDcmpTeam = FIXTURE.teams.find((team) => team.eventPoints.some((row) => row.eventKey === DCMP_KEY))!.teamKey;
    const divisionOf = (index: number): string => (index % 2 === 0 ? `${DCMP_KEY}1` : `${DCMP_KEY}2`);
    const divisioned: DistrictArtifact = DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team, index) => {
        const eventPoints = team.eventPoints.map((row) => (row.eventKey === DCMP_KEY ? { ...row, eventKey: divisionOf(index) } : row));
        const finals = team.teamKey === firstDcmpTeam ? [{ ...eventPoints.find((row) => row.eventKey === divisionOf(index))!, eventKey: DCMP_KEY, qual: 0, alliance: 0, elim: 0, award: 0, total: 0 }] : [];
        return { ...team, eventPoints: [...eventPoints, ...finals] };
      }),
    });
    const stop = stopWith(divisioned, (key) => (key === DCMP_KEY ? PLAYOFFS_FINAL : undefined));
    // The finals event is still live at Now. Both divisions' flags are true.
    const finalsLive = withStates(divisioned, (key) => (key === DCMP_KEY ? LIVE : OVER), false);
    expect(reservedAt(finalsLive, stop)).toBe(HELD);
    // The finals event's own flag is true at Now: the hold is off, as in history.
    const finalsOver = withStates(divisioned, () => OVER, false);
    expect(reservedAt(finalsOver, stop)).toBe(AWARD_SLOTS);
    // A Winner recorded at the finals key releases the live one.
    expect(reservedAt(withStates(divisioned, (key) => (key === DCMP_KEY ? LIVE : OVER), true), stop)).toBe(AWARD_SLOTS);
  });

  it("in a two championship district a Winner at one does not release the other's places", () => {
    // Every other team's championship rows relabelled to a second key. The
    // Winner records are stripped and then written where each case names.
    const secondTeams = new Set(FIXTURE.teams.filter((_team, index) => index % 2 === 1).map((team) => team.teamKey));
    const two = (winnerAt: readonly string[]): DistrictArtifact => {
      const relabelled: DistrictArtifact = DistrictArtifactSchema.parse({
        ...FIXTURE,
        teams: FIXTURE.teams.map((team) => {
          const atSecond = secondTeams.has(team.teamKey);
          const relabel = <T extends { eventKey: string }>(row: T): T => (atSecond && row.eventKey === DCMP_KEY ? { ...row, eventKey: SECOND_KEY } : row);
          const ownKey = atSecond ? SECOND_KEY : DCMP_KEY;
          const playsDcmp = team.eventPoints.some((row) => row.eventKey === DCMP_KEY);
          const awards = team.qualifyingAwards.filter((award) => award.awardType !== 1).map(relabel);
          // One recorded winner per named championship: its top playoff scorer.
          const isTopScorer = playsDcmp && team.eventPoints.some((row) => row.eventKey === DCMP_KEY && row.elim === 90);
          return { ...team, eventPoints: team.eventPoints.map(relabel), qualifyingAwards: isTopScorer && winnerAt.includes(ownKey) ? [...awards, WINNER(ownKey)] : awards };
        }),
      });
      return withStates(relabelled, () => LIVE, true);
    };
    const both = (artifact: DistrictArtifact) => stopWith(artifact, (key) => (key === DCMP_KEY || key === SECOND_KEY ? PLAYOFFS_FINAL : undefined));
    const winnersOf = (artifact: DistrictArtifact) => [...new Set(artifact.teams.flatMap((team) => team.qualifyingAwards.filter((award) => award.awardType === 1).map((award) => award.eventKey)))].sort();

    const none = two([]);
    expect(winnersOf(none)).toEqual([]);
    expect(reservedAt(none, both(none))).toBe(2 * HELD);

    // The fixture's three winners (90 playoff points) sit at the first key after the split, or the second, or both.
    const everywhere = two([DCMP_KEY, SECOND_KEY]);
    const recordedAt = winnersOf(everywhere);
    expect(recordedAt.length).toBeGreaterThan(0);
    for (const key of recordedAt) {
      const only = two([key]);
      expect(winnersOf(only)).toEqual([key]);
      // Released at the championship with a Winner, held at the other.
      expect({ key, reserved: reservedAt(only, both(only)) }).toEqual({ key, reserved: AWARD_SLOTS + HELD });
    }
    expect(reservedAt(everywhere, both(everywhere))).toBe(recordedAt.length === 2 ? 2 * AWARD_SLOTS : AWARD_SLOTS + HELD);
  });

  it("takes divisionCountOf and finalsChampionMaximum from the core rule module and declares neither itself", () => {
    const source = readFileSync(repoFile("apps/web/src/components/districts/champLedgerStatus.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(source).not.toMatch(/function divisionCountOf\(/);
    expect(source).not.toMatch(/function finalsChampionMaximum\(/);
    expect(source).toMatch(/import \{[^}]*\bdivisionCountOf\b[^}]*\} from "[^"]*categoryCorroboration\.js"/);
    expect(source).toMatch(/import \{[^}]*\bfinalsChampionMaximum\b[^}]*\} from "[^"]*categoryCorroboration\.js"/);
  });
});

describe("computeChampLedgerStatuses — the pre-registration window", () => {
  const dcmpCeilings = maxEventPoints(FIXTURE.year, "dcmp");
  const DCMP_MAX = dcmpCeilings.qual + dcmpCeilings.alliance + dcmpCeilings.elim + dcmpCeilings.award;

  /** The fixture with every dcmp-tier `eventPoints` and `remainingEvents` row removed. */
  const NO_DCMP: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team) => ({
      ...team,
      eventPoints: team.eventPoints.filter((row) => row.tier !== "dcmp"),
      remainingEvents: team.remainingEvents.filter((row) => row.tier !== "dcmp"),
      // `pointTotal` is TBA's own and is NOT recomputed here: the point of the
      // test is the ceiling, and a re-summed total would test the re-sum.
    })),
  });

  const DISTRICT_KEYS = eventKeysOf(NO_DCMP);

  function modelWithNoDcmp(districtLockedOut?: ReadonlySet<string>) {
    const stageByEvent = new Map(DISTRICT_KEYS.map((key) => [key, ALL_FINAL] as const));
    const rows = buildChampLedgerRows({ artifact: NO_DCMP, distributions: new Map(), stageByEvent, dcmpStarted: false });
    return {
      rows,
      status: computeChampLedgerStatuses({
        artifact: NO_DCMP,
        teams: rows.teams,
        ...(districtLockedOut === undefined ? {} : { districtLockedOut }),
      }),
    };
  }

  it("names no dcmp event and prices no DCMP row", () => {
    expect(DISTRICT_KEYS).not.toContain("2026pncmp");
    expect(modelWithNoDcmp().rows.dcmpEventKey).toBeUndefined();
  });

  it("computes a status for EVERY team rather than leaving the capacity unknown", () => {
    const model = modelWithNoDcmp();
    expect(model.status.byTeam.size).toBe(NO_DCMP.teams.length);
    for (const result of model.status.byTeam.values()) expect(result.status).not.toBe("capacityUnknown");
  });

  /**
   * THE CEILING IS THE WHOLE POINT. With no hypothetical DCMP the ceiling would
   * equal the floor for every team and the 21-slot race would resolve into
   * 21 Locked and 105 Locked out on the spot. With it, the teams below the line
   * can still reach it, so the district is not decided in week one.
   */
  it("grants one whole hypothetical DCMP, so the race is not already over", () => {
    const model = modelWithNoDcmp();
    const contending = [...model.status.byTeam.values()].filter((result) => result.verdict === "contending");
    expect(contending.length).toBeGreaterThan(0);
    // The team at the artifact's own cut line can reach the top on one DCMP,
    // and a team more than one DCMP below it cannot.
    const totals = NO_DCMP.teams.map((team) => team.pointTotal).sort((a, b) => b - a);
    const top = totals[0]!;
    const reachable = NO_DCMP.teams.filter((team) => team.pointTotal + DCMP_MAX >= top);
    expect(reachable.length).toBeGreaterThan(21);
  });

  it("gives NO hypothetical DCMP to a team the district verdict has locked out", () => {
    const bottom = [...NO_DCMP.teams].sort((a, b) => a.pointTotal - b.pointTotal)[0]!;
    const withGate = modelWithNoDcmp(new Set([bottom.teamKey]));
    const withoutGate = modelWithNoDcmp();
    // The gate can only ever narrow a ceiling, so a team it applies to is
    // never in a FRIENDLIER status than it was without it.
    const order: Record<string, number> = { lockedOut: 0, outOfRange: 1, inRange: 2, locked: 3, prequalified: 4, capacityUnknown: 5 };
    const gated = withGate.status.byTeam.get(bottom.teamKey)!.status;
    const ungated = withoutGate.status.byTeam.get(bottom.teamKey)!.status;
    expect(order[gated]!).toBeLessThanOrEqual(order[ungated]!);
  });
});

/**
 * THE CHIPS AND THE LINE FROM ONE STATE (quick task 260927-6bf, decision L2
 * and Jacob's 2026-09-27 chip timing decision), on the real 2026 PNW fixture
 * reopened to just before the DCMP, where 20 odd teams are still contending.
 */
describe("applyChampRangeState and champCutoffView", () => {
  const beforeDcmp = new Map(eventKeysOf(FIXTURE).map((key) => [key, key === "2026pncmp" ? ALL_OPEN : ALL_FINAL] as const));
  const MODEL = modelAt(beforeDcmp, false);
  const contendingKeys = [...MODEL.status.byTeam.values()]
    .filter((result) => result.status === "inRange" || result.status === "outOfRange")
    .map((result) => result.teamKey);
  const LIKELY = { p10: 150, p90: 210 };
  const settledView = (): LedgerCutoffView => ({
    cutoff: predictedCutoff({
      teams: MODEL.rows.teams,
      capacity: FIXTURE.cmpSlots,
      qualifiers: { awardQualified: new Set(MODEL.status.awardQualified), prequalified: new Set(MODEL.status.prequalified) },
      reservedSlots: MODEL.status.reservedSlots,
    }),
    likely: undefined,
    districtOnly: false,
  });
  const viewFor = (state: ChampRangeState, display: ReturnType<typeof applyChampRangeState>) =>
    champCutoffView({ state, teams: MODEL.rows.teams, displayStatus: (teamKey) => display.byTeam.get(teamKey)?.status, settledView });

  /** Every non contending team's result, verbatim, and the untouched model level fields. */
  function expectVerdictsUntouched(display: ReturnType<typeof applyChampRangeState>): void {
    for (const [teamKey, result] of MODEL.status.byTeam) {
      if (contendingKeys.includes(teamKey)) continue;
      expect(display.byTeam.get(teamKey)).toBe(result);
    }
    expect(display.verdictCensus).toEqual(MODEL.status.verdictCensus);
    expect(display.floorCutLine).toBe(MODEL.status.floorCutLine);
    expect(display.awardQualified).toEqual(MODEL.status.awardQualified);
    expect(display.prequalified).toEqual(MODEL.status.prequalified);
    expect(display.reservedSlots).toBe(MODEL.status.reservedSlots);
    expect(display.pointsSlots).toBe(MODEL.status.pointsSlots);
    for (const key of ["prequalified", "locked", "lockedOut"] as const) expect(display.counts[key]).toBe(MODEL.status.counts[key]);
  }

  it("has contending teams to call, so the tests below are not vacuous", () => {
    expect(contendingKeys.length).toBeGreaterThan(5);
  });

  it("settled: the shipped rank rule and the shipped midpoint view, unchanged", () => {
    const display = applyChampRangeState(MODEL.status, MODEL.rows.teams, { kind: "settled" });
    for (const [teamKey, result] of MODEL.status.byTeam) expect(display.byTeam.get(teamKey)).toBe(result);
    expect(display.counts).toEqual(MODEL.status.counts);
    expect(display.withheld).toBeUndefined();
    expect(viewFor({ kind: "settled" }, display)).toEqual(settledView());
  });

  it("pending: every contending call is withheld, no rank rule leaks, and the view has no figure", () => {
    const display = applyChampRangeState(MODEL.status, MODEL.rows.teams, { kind: "pending" });
    expectVerdictsUntouched(display);
    for (const teamKey of contendingKeys) {
      expect(display.byTeam.get(teamKey)!.rangeCall).toBe("pending");
      expect(display.byTeam.get(teamKey)!.status).toBe("capacityUnknown");
    }
    expect(display.withheld).toBe("pending");
    expect(display.counts.inRange).toBe(0);
    expect(display.counts.outOfRange).toBe(0);
    expect(viewFor({ kind: "pending" }, display)).toEqual({ cutoff: { kind: "pending" }, likely: undefined, districtOnly: false });
  });

  it("noCall: the same withholding, with the reason carried to the chip and the view", () => {
    const state: ChampRangeState = { kind: "noCall", reason: "teamsExcluded" };
    const display = applyChampRangeState(MODEL.status, MODEL.rows.teams, state);
    expectVerdictsUntouched(display);
    for (const teamKey of contendingKeys) expect(display.byTeam.get(teamKey)!.rangeCall).toBe("noCall");
    expect(display.noCallReason).toBe("teamsExcluded");
    expect(viewFor(state, display)).toEqual({ cutoff: { kind: "unavailable", reason: "teamsExcluded" }, likely: undefined, districtOnly: false });
  });

  it("simulated: In range iff the median is at or above the line, the view prints that line, and the range is WITHHELD", () => {
    const projections = MODEL.rows.teams.filter((team) => contendingKeys.includes(team.teamKey)).map((team) => team.projection);
    const points = Math.round((Math.max(...projections) + Math.min(...projections)) / 2);
    const state: ChampRangeState = { kind: "simulated", points, likely: LIKELY };
    const display = applyChampRangeState(MODEL.status, MODEL.rows.teams, state);
    expectVerdictsUntouched(display);
    const view = viewFor(state, display);
    expect(view.cutoff.kind).toBe("predicted");
    if (view.cutoff.kind !== "predicted") return;
    expect(view.cutoff.source).toBe("simulated");
    expect(view.cutoff.points).toBe(points);
    // Jacob, 2026-09-27: the range is shown with the line.
    expect(SHOW_SIMULATED_CHAMP_LIKELY_RANGE).toBe(true);
    expect(view.likely).toEqual(LIKELY);
    expect(display.counts.inRange + display.counts.outOfRange).toBe(contendingKeys.length);
    expect(display.counts.inRange).toBeGreaterThan(0);
    expect(display.counts.outOfRange).toBeGreaterThan(0);
  });

  /**
   * THE BETWEEN PROPERTY, swept. A seeded generator places the simulated line
   * anywhere across (and beyond) the contending medians; at every line every
   * In range median is at or above the printed points, every Out of range
   * median below them, and the view's boundary pair brackets the line.
   */
  it("holds the between property at every line a seeded sweep can place, in simulated and settled mode", () => {
    let seed = 20260927;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const projectionOf = new Map(MODEL.rows.teams.map((team) => [team.teamKey, team.projection] as const));
    const projections = contendingKeys.map((key) => projectionOf.get(key)!);
    const low = Math.min(...projections) - 20;
    const high = Math.max(...projections) + 20;
    for (let i = 0; i < 200; i++) {
      const points = Math.round(low + next() * (high - low));
      const state: ChampRangeState = { kind: "simulated", points, likely: LIKELY };
      const display = applyChampRangeState(MODEL.status, MODEL.rows.teams, state);
      const view = viewFor(state, display);
      if (view.cutoff.kind !== "predicted") throw new Error("a simulated state always prints a predicted arm");
      for (const teamKey of contendingKeys) {
        const status = display.byTeam.get(teamKey)!.status;
        const projection = projectionOf.get(teamKey)!;
        if (status === "inRange") expect(projection).toBeGreaterThanOrEqual(view.cutoff.points);
        else expect(projection).toBeLessThan(view.cutoff.points);
      }
      expect(view.cutoff.boundary.above).toBeGreaterThanOrEqual(view.cutoff.points);
      expect(view.cutoff.boundary.below).toBeLessThanOrEqual(view.cutoff.points);
    }
    // Settled mode: the shipped rank rule and midpoint, which the 260926-37q
    // sweep in predictedCutoff.test.ts already pins; here, that the settled arm
    // hands them through untouched.
    const settled = applyChampRangeState(MODEL.status, MODEL.rows.teams, { kind: "settled" });
    const view = viewFor({ kind: "settled" }, settled);
    if (view.cutoff.kind !== "predicted" && view.cutoff.kind !== "final") throw new Error("expected a numeric settled cutoff");
    for (const teamKey of contendingKeys) {
      const status = settled.byTeam.get(teamKey)!.status;
      if (status === "inRange") expect(projectionOf.get(teamKey)!).toBeGreaterThanOrEqual(view.cutoff.points);
      else expect(projectionOf.get(teamKey)!).toBeLessThanOrEqual(view.cutoff.points);
    }
  });
});

/**
 * Quick task 261008-26o: Jacob, 2026-10-08, FNC 2026 at the DCMP Round 5 stop,
 * six teams at 99% and none Locked, because every team kept the whole 3x
 * Playoffs ceiling until the Finals posted.
 *
 * THE FNC LIKE STOP on the PNW fixture: every district event final, the DCMP's
 * qualification and alliance selection final, its playoffs and awards open,
 * and every alliance but the two finalists DECIDED. The bracket facts are
 * read off the fixture's own finished dcmp rows (90 or 60 is a finalist, 39
 * third, 21 fourth, 0 on an alliance fifth). A team on no alliance carries no
 * milestone and is NOT settled: a backup robot is called from that pool and
 * paid for its share, so its 90 point ceiling stands. The two rows at 12 (a
 * prorated pick and a backup) carry no milestone either, which is the
 * conservative side.
 *
 * JACOB'S CASE IS A REWOUND STOP OVER A FINISHED DCMP, so the fixture's dcmp
 * rows are given a finished state block here and the settled values are TBA's
 * own, exact. At Now mid playoffs (the fixture as committed, no state blocks)
 * the values come off the placement table, which TBA can prorate down, so
 * they cap ceilings and never raise a floor.
 */
describe("computeChampLedgerStatuses — a team knocked out of the DCMP playoffs is settled at once (261008-26o)", () => {
  const DCMP_KEY = "2026pncmp";
  const FNC_LIKE_STOP = new Map(
    eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? { qual: true, alliance: true, elim: false, award: false } : ALL_FINAL] as const)
  );
  /** The fixture with its DCMP finished at Now: the season Jacob rewound. */
  const DCMP_FINISHED: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team) => ({
      ...team,
      eventPoints: team.eventPoints.map((row) =>
        row.eventKey === DCMP_KEY
          ? { ...row, state: { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true } }
          : row
      ),
    })),
  });
  const dcmpRowOf = (teamKey: string) =>
    FIXTURE.teams.find((entry) => entry.teamKey === teamKey)!.eventPoints.find((entry) => entry.eventKey === DCMP_KEY);

  function milestoneFor(row: { readonly alliance: number; readonly elim: number }): AllianceBracketMilestone | undefined {
    if (row.elim === 90 || row.elim === 60) return { kind: "finals" };
    if (row.elim === 39) return { kind: "decided", placement: 3 };
    if (row.elim === 21) return { kind: "decided", placement: 4 };
    if (row.elim === 0 && row.alliance > 0) return { kind: "decided", placement: 5 };
    return undefined;
  }

  /**
   * The run's reading of the stop: a priced record per DCMP team (so the DCMP
   * row takes the championship's own cells, case 2) and the bracket facts.
   * The statuses read no histogram, only the settled set.
   */
  function settledDistributions(): ReadonlyMap<string, DistrictEventDistributions> {
    const byTeam = new Map<string, Record<DistrictCellKind, DistrictPointDistribution | undefined>>();
    const playoffMilestoneByTeam = new Map<string, AllianceBracketMilestone>();
    for (const team of FIXTURE.teams) {
      const row = team.eventPoints.find((entry) => entry.eventKey === DCMP_KEY);
      if (row === undefined) continue;
      byTeam.set(team.teamKey, {
        qual: undefined,
        alliance: undefined,
        elim: pointMassDistribution(row.elim),
        award: pointMassDistribution(row.award),
        eventTotal: pointMassDistribution(row.total),
        grandTotal: undefined,
      });
      const milestone = milestoneFor(row);
      if (milestone !== undefined) playoffMilestoneByTeam.set(team.teamKey, milestone);
    }
    return new Map([[DCMP_KEY, { eventKey: DCMP_KEY, byTeam, playoffMilestoneByTeam }]]);
  }

  function modelWith(artifact: DistrictArtifact, distributions: ReadonlyMap<string, DistrictEventDistributions>) {
    const rows = buildChampLedgerRows({ artifact, distributions, stageByEvent: FNC_LIKE_STOP, dcmpStarted: true });
    return { rows, status: computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026 }) };
  }

  const BLUNT = modelWith(DCMP_FINISHED, new Map());
  const SETTLED = modelWith(DCMP_FINISHED, settledDistributions());
  const LIVE_SETTLED = modelWith(FIXTURE, settledDistributions());
  const lockedOnPointsKeys = (model: typeof BLUNT): string[] =>
    [...model.status.byTeam.values()].filter((result) => result.status === "locked" && !result.byAward).map((result) => result.teamKey).sort();

  it("prints a decided team's DCMP Playoffs cell grey at TBA's own elim, exact, and keeps a finalist's open", () => {
    let decided = 0;
    for (const team of SETTLED.rows.teams) {
      const row = dcmpRowOf(team.teamKey);
      if (row === undefined) continue;
      const milestone = milestoneFor(row);
      const cell = team.dcmpRow.cells.find((entry) => entry.cell === "elim")!;
      if (milestone?.kind === "decided") {
        decided += 1;
        // Every mapped team's own value IS its placement's 3x points.
        expect(row.elim, team.teamKey).toBe(playoffPoints(2026, "dcmp", milestone.placement));
        expect(cell, team.teamKey).toMatchObject({ kind: "final", earned: row.elim });
        expect(team.dcmpRow.sources[0]!.settledElim, team.teamKey).toEqual({ points: row.elim, exact: true, ceiling: 0 });
      } else {
        expect(cell.kind, team.teamKey).not.toBe("final");
        expect(team.dcmpRow.sources[0]!.settledElim, team.teamKey).toBeUndefined();
      }
    }
    // 3 third place, 2 fourth place, 12 fifth place.
    expect(decided).toBe(17);
  });

  it("locks STRICTLY more teams on points than the blunt rule at the same stop (recorded counts)", () => {
    // Measured 2026-10-08: nobody under the blunt rule, frc5468 once the
    // knocked out alliances' 3x Playoffs ceilings are gone.
    expect(lockedOnPointsKeys(BLUNT)).toEqual([]);
    expect(lockedOnPointsKeys(SETTLED)).toEqual(["frc5468"]);
    expect(lockedOnPointsKeys(SETTLED).length).toBeGreaterThan(lockedOnPointsKeys(BLUNT).length);
    expect(BLUNT.status.byTeam.get("frc5468")!.verdict).toBe("contending");
    expect(SETTLED.status.byTeam.get("frc5468")!.verdict).toBe("locked");
  });

  it("locks no team on points that did not qualify in the finished standing", () => {
    for (const teamKey of [...lockedOnPointsKeys(SETTLED), ...lockedOnPointsKeys(LIVE_SETTLED)]) {
      expect(["locked", "lockedAward", "prequalified"], teamKey).toContain(FINISHED.status.byTeam.get(teamKey)!.verdict);
    }
  });

  it("leaves both reservations and the unreserved points slots exactly as the blunt rule has them", () => {
    expect(SETTLED.status.reservedSlots).toBe(BLUNT.status.reservedSlots);
    expect(SETTLED.status.pointsSlots).toBe(BLUNT.status.pointsSlots);
    expect(LIVE_SETTLED.status.reservedSlots).toBe(BLUNT.status.reservedSlots);
  });

  it("at Now mid playoffs, a placement table value caps the ceiling and never raises the team's own floor (recorded)", () => {
    let capped = 0;
    for (const team of LIVE_SETTLED.rows.teams) {
      const settled = team.dcmpRow.sources[0]?.settledElim;
      if (settled === undefined) continue;
      capped += 1;
      expect(settled.exact, team.teamKey).toBe(false);
    }
    expect(capped).toBe(17);
    // frc5468's own 39 is what locked it above. Off the placement table it is
    // only the most frc5468 can be paid, so it is not Locked here.
    expect(LIVE_SETTLED.status.byTeam.get("frc5468")!.verdict).toBe("contending");
    expect(lockedOnPointsKeys(LIVE_SETTLED)).toEqual([]);
  });
});

/** Recorded by the joint proof tests below (measured 2026-10-09). */
const JOINT_ONLY_AT_PLAYOFFS_FINAL = 3;
const CEILING_JOINT_AT_PLAYOFFS_FINAL = 6;
/**
 * Nobody: with no played rows every alliance is alive by routing, so a decided
 * alliance's members carry their settled maximum in `extra` AND take an
 * assigned placement, which is the conservative double count.
 */
const JOINT_AT_FNC_LIKE_STOP: string[] = [];
/** The same stop routed from played rows that reproduce the fixture's placements (alliances 1 and 5 alive). */
const JOINT_AT_ROUTED_ROUND_FIVE: string[] = ["frc1540", "frc2046", "frc360", "frc5468", "frc9023", "frc955"];

/**
 * Quick task 261009-2tr: the joint worst case proof (decision 5) and the
 * settled ceiling at the placement maximum (CONTEXT D7), on the PNW fixture.
 *
 * The fixture carries no event artifacts, so the DCMP's eight alliances are
 * REBUILT from its own alliance selection points: at the 3x weight a captain
 * and first pick of alliance n earn 3 x (17 - n), a second pick 3 x n. A team
 * at 0 (a backup) is on no rebuilt list.
 */
describe("computeChampLedgerStatuses — the joint worst case proof (261009-2tr)", () => {
  const DCMP_KEY = "2026pncmp";
  const FNC_LIKE_STOP = new Map(
    eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? { qual: true, alliance: true, elim: false, award: false } : ALL_FINAL] as const)
  );
  const PLAYOFFS_FINAL_STOP = new Map(
    eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? { qual: true, alliance: true, elim: true, award: false } : ALL_FINAL] as const)
  );

  function rebuiltAlliances(artifact: DistrictArtifact): { allianceNumber: number; picks: string[] }[] {
    const picks = new Map<number, string[]>();
    for (const team of artifact.teams) {
      const row = team.eventPoints.find((entry) => entry.eventKey === DCMP_KEY);
      if (row === undefined || row.alliance <= 0) continue;
      const base = row.alliance / 3;
      const allianceNumber = base >= 9 ? 17 - base : base;
      const list = picks.get(allianceNumber) ?? [];
      if (base >= 9) list.unshift(team.teamKey);
      else list.push(team.teamKey);
      picks.set(allianceNumber, list);
    }
    return [...picks.entries()].sort((a, b) => a[0] - b[0]).map(([allianceNumber, list]) => ({ allianceNumber, picks: list }));
  }
  const ALLIANCES = rebuiltAlliances(FIXTURE);

  /** Rounds 1 and 2 in TBA's coordinates: 1, 4, 2 and 3 win Round 1, 5 and 6 survive, 1 and 2 win the upper sets. Alliance 8 is placed seventh, 7 eighth. */
  const ROUND_TWO_ROWS: PlayedBracketMatch[] = (
    [
      [1, 1],
      [2, 4],
      [3, 2],
      [4, 3],
      [5, 5],
      [6, 6],
      [7, 1],
      [8, 2],
    ] as const
  ).map(([setNumber, winningAllianceNumber]) => ({ compLevel: "sf", setNumber, matchNumber: 1, winningAllianceNumber }));

  function factsAt(stage: DistrictStageFinality, playedMatches: readonly PlayedBracketMatch[], alliances = ALLIANCES): DcmpBracketFacts | undefined {
    return dcmpBracketFactsFor({ eventKey: DCMP_KEY, season: 2026, tier: "dcmp", stage, alliances, playedMatches, unresolvedMatchCount: 0 });
  }

  function distributionsWith(
    milestones: ReadonlyMap<string, AllianceBracketMilestone>,
    facts: DcmpBracketFacts | undefined
  ): ReadonlyMap<string, DistrictEventDistributions> {
    return new Map([[DCMP_KEY, { eventKey: DCMP_KEY, byTeam: new Map(), playoffMilestoneByTeam: milestones, ...(facts === undefined ? {} : { dcmpBracket: facts }) }]]);
  }

  function modelAtStop(
    artifact: DistrictArtifact,
    stageByEvent: ReadonlyMap<string, DistrictStageFinality>,
    distributions: ReadonlyMap<string, DistrictEventDistributions>,
    passDistributions = true
  ) {
    const rows = buildChampLedgerRows({ artifact, distributions, stageByEvent, dcmpStarted: true });
    return computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026, ...(passDistributions ? { distributions } : {}) });
  }

  /** The milestones the FNC like stop of 261008-26o reads off the finished rows: decided third, fourth and fifth. */
  function fncLikeMilestones(): Map<string, AllianceBracketMilestone> {
    const out = new Map<string, AllianceBracketMilestone>();
    for (const team of FIXTURE.teams) {
      const row = team.eventPoints.find((entry) => entry.eventKey === DCMP_KEY);
      if (row === undefined) continue;
      if (row.elim === 90 || row.elim === 60) out.set(team.teamKey, { kind: "finals" });
      else if (row.elim === 39) out.set(team.teamKey, { kind: "decided", placement: 3 });
      else if (row.elim === 21) out.set(team.teamKey, { kind: "decided", placement: 4 });
      else if (row.elim === 0 && row.alliance > 0) out.set(team.teamKey, { kind: "decided", placement: 5 });
    }
    return out;
  }

  const jointKeys = (model: ReturnType<typeof modelAtStop>): string[] =>
    [...model.byTeam.values()].filter((result) => result.lockedBy?.includes("joint") === true).map((result) => result.teamKey).sort();
  const lockedByCount = (model: ReturnType<typeof modelAtStop>, lockedBy: string): number =>
    [...model.byTeam.values()].filter((result) => result.lockedBy === lockedBy).length;
  const shippedView = (model: ReturnType<typeof modelAtStop>) => ({
    byTeam: model.byTeam,
    counts: model.counts,
    verdictCensus: model.verdictCensus,
    floorCutLine: model.floorCutLine,
    reservedSlots: model.reservedSlots,
    pointsSlots: model.pointsSlots,
  });

  it("rebuilds eight alliances of three from the fixture's DCMP alliance points", () => {
    expect(ALLIANCES.map((alliance) => alliance.allianceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const alliance of ALLIANCES) expect(alliance.picks).toHaveLength(3);
  });

  it("with no dcmpBracket the model is exactly the no distributions model, at the FNC like stop and at Playoffs final", () => {
    for (const stop of [FNC_LIKE_STOP, PLAYOFFS_FINAL_STOP]) {
      const distributions = distributionsWith(fncLikeMilestones(), undefined);
      const without = modelAtStop(FIXTURE, stop, distributions, false);
      const withNoFacts = modelAtStop(FIXTURE, stop, distributions);
      expect(shippedView(withNoFacts)).toEqual(shippedView(without));
      expect(without.jointProof).toEqual({ applied: false, reason: "noDistributions" });
      expect(withNoFacts.jointProof).toEqual({ applied: false, reason: "noBracketFacts" });
    }
  });

  it("refuses, with a named reason and the shipped statuses, wherever a precondition fails", () => {
    const expectRefusal = (artifact: DistrictArtifact, stop: ReadonlyMap<string, DistrictStageFinality>, distributions: ReadonlyMap<string, DistrictEventDistributions>, reason: string) => {
      const model = modelAtStop(artifact, stop, distributions);
      expect(model.jointProof).toEqual({ applied: false, reason });
      expect(shippedView(model)).toEqual(shippedView(modelAtStop(artifact, stop, distributions, false)));
    };
    const facts = factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, [])!;
    const milestones = dcmpBracketMilestonesByTeam(ALLIANCES, []);

    // A division: the proof needs exactly one dcmp tier key.
    const DIVISION_KEY = "2026pncmp1";
    const divisioned: DistrictArtifact = DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team, index) => {
        if (index % 2 === 0) return team;
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === DCMP_KEY ? { ...row, eventKey: DIVISION_KEY } : row);
        return { ...team, eventPoints: team.eventPoints.map(relabel), remainingEvents: team.remainingEvents.map(relabel), qualifyingAwards: team.qualifyingAwards.map(relabel) };
      }),
    });
    const divisionStop = new Map(eventKeysOf(divisioned).map((key) => [key, key === DCMP_KEY || key === DIVISION_KEY ? FNC_LIKE_STOP.get(DCMP_KEY)! : ALL_FINAL] as const));
    expectRefusal(divisioned, divisionStop, distributionsWith(milestones, facts), "unsupportedShape");

    // Alliance selection open, and Awards final.
    const allianceOpen = new Map(eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? { qual: true, alliance: false, elim: false, award: false } : ALL_FINAL] as const));
    expectRefusal(FIXTURE, allianceOpen, distributionsWith(milestones, facts), "stageNotEligible");
    expectRefusal(FIXTURE, new Map(eventKeysOf(FIXTURE).map((key) => [key, ALL_FINAL] as const)), distributionsWith(milestones, facts), "stageNotEligible");

    // A seven alliance list builds no facts at all.
    expect(factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, [], ALLIANCES.slice(0, 7))).toBeUndefined();
    expectRefusal(FIXTURE, FNC_LIKE_STOP, distributionsWith(milestones, factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, [], ALLIANCES.slice(0, 7))), "noBracketFacts");

    // A played row naming an alliance outside its set (sf1 is 1 against 8).
    const misMapped = factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, [{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 5 }])!;
    expectRefusal(FIXTURE, FNC_LIKE_STOP, distributionsWith(milestones, misMapped), "bracketUnroutable");

    // Playoffs final with every winner award stripped and no played rows.
    const noWinner: DistrictArtifact = DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team) => ({ ...team, qualifyingAwards: team.qualifyingAwards.filter((award) => award.awardType !== 1) })),
    });
    expectRefusal(noWinner, PLAYOFFS_FINAL_STOP, distributionsWith(milestones, factsAt(PLAYOFFS_FINAL_STOP.get(DCMP_KEY)!, [])), "winnerNotPosted");
  });

  it("refuses as not eligible while the championship's rows read Qualification or Alliance selection open, with the flat reservation, and is applied once both are final (quick task 261009-vp9)", () => {
    // The bracket facts are built from the FIELD: selection is over there.
    // The rows' stage is the NUMBER: the alliance points are not in.
    const facts = factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, [])!;
    const milestones = dcmpBracketMilestonesByTeam(ALLIANCES, []);
    const flat = pendingAwardSlots(dcmpAwardCountCeilings(FIXTURE.year, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts) + MAX_WINNING_ALLIANCE_SIZE;
    const numberAt = (stage: DistrictStageFinality) => new Map(eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? stage : ALL_FINAL] as const));
    for (const stage of [ALL_OPEN, { qual: true, alliance: false, elim: false, award: false }]) {
      const model = modelAtStop(FIXTURE, numberAt(stage), distributionsWith(milestones, facts));
      expect(model.jointProof).toEqual({ applied: false, reason: "stageNotEligible" });
      expect(model.reservedSlots).toBe(flat);
      expect(shippedView(model)).toEqual(shippedView(modelAtStop(FIXTURE, numberAt(stage), distributionsWith(milestones, facts), false)));
    }
    const applied = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributionsWith(milestones, facts));
    expect(applied.jointProof?.applied).toBe(true);
    expect(applied.reservedSlots).toBe(flat);
  });

  it("dcmpBracketFactsFor refuses a district tier event, 2022, Awards final, a partial list and an unresolved row", () => {
    const stage = FNC_LIKE_STOP.get(DCMP_KEY)!;
    const base = { eventKey: DCMP_KEY, season: 2026, tier: "dcmp" as const, stage, alliances: ALLIANCES, playedMatches: [], unresolvedMatchCount: 0 };
    expect(dcmpBracketFactsFor(base)).toBeDefined();
    expect(dcmpBracketFactsFor({ ...base, tier: "district" })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...base, season: 2022 })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...base, stage: { ...stage, award: true } })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...base, alliances: ALLIANCES.map((alliance, index) => (index === 0 ? { ...alliance, picks: alliance.picks.slice(0, 2) } : alliance)) })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...base, unresolvedMatchCount: 1 })).toBeUndefined();
  });

  it("applies at Playoffs final with awards open, and every team it locks qualified in the finished standing (recorded counts)", () => {
    const facts = factsAt(PLAYOFFS_FINAL_STOP.get(DCMP_KEY)!, [])!;
    const model = modelAtStop(FIXTURE, PLAYOFFS_FINAL_STOP, distributionsWith(dcmpBracketMilestonesByTeam(ALLIANCES, []), facts));
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") return;
    expect(model.jointProof.input.placementPoints).toEqual([75, 39, 21]);
    expect(model.jointProof.input.candidateWinners).toEqual([null]);
    expect(Object.keys(model.jointProof.input).sort()).toEqual(
      ["aliveAlliances", "alliances", "candidateWinners", "consumingAwards", "judgedAwardPoints", "judgedAwards", "maxAllianceSize", "placementPoints", "pointsSlots", "pool", "slotOnlyRivals"].sort()
    );
    for (const rival of model.jointProof.input.pool) expect(Object.keys(rival).sort()).toEqual(["extra", "floor", "teamKey"]);
    for (const teamKey of jointKeys(model)) {
      expect(["locked", "lockedAward"], teamKey).toContain(FINISHED.status.byTeam.get(teamKey)!.verdict);
    }
    expect(jointKeys(model)).toEqual([...model.jointProof.locked].sort());
    // Measured 2026-10-09.
    expect(lockedByCount(model, "joint")).toBe(JOINT_ONLY_AT_PLAYOFFS_FINAL);
    expect(lockedByCount(model, "ceiling+joint")).toBe(CEILING_JOINT_AT_PLAYOFFS_FINAL);
  });

  it("applies at the FNC like stop with all eight alive, locks only teams that qualified, and moves nothing but the locks (recorded counts)", () => {
    const facts = factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, [])!;
    const distributions = distributionsWith(fncLikeMilestones(), facts);
    const model = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributions);
    const shipped = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributions, false);
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") return;
    expect(model.jointProof.input.placementPoints).toEqual([75, 39, 21]);
    expect(model.jointProof.input.aliveAlliances).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const teamKey of jointKeys(model)) {
      expect(["locked", "lockedAward"], teamKey).toContain(FINISHED.status.byTeam.get(teamKey)!.verdict);
    }
    expect(model.floorCutLine).toBe(shipped.floorCutLine);
    expect(model.reservedSlots).toBe(shipped.reservedSlots);
    expect(model.pointsSlots).toBe(shipped.pointsSlots);
    const eliminated = (m: typeof model): string[] => [...m.byTeam.values()].filter((r) => r.verdict === "eliminated").map((r) => r.teamKey).sort();
    expect(eliminated(model)).toEqual(eliminated(shipped));
    for (const result of model.byTeam.values()) {
      if (result.verdict === "locked") continue;
      expect(result, result.teamKey).toEqual(shipped.byTeam.get(result.teamKey));
    }
    // Measured 2026-10-09.
    expect(jointKeys(model)).toEqual(JOINT_AT_FNC_LIKE_STOP);
    expect(lockedByCount(model, "joint")).toBe(JOINT_AT_FNC_LIKE_STOP.length);
  });

  /**
   * Round 5 routed from played rows that reproduce the fixture's own
   * placements: alliance 1 won (90), 5 was the finalist (60), 3 third (39), 2
   * fourth (21). Alive: 1 and 5.
   */
  const ROUND_FIVE_ROWS: PlayedBracketMatch[] = (
    [
      [1, 1],
      [2, 5],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 6],
      [7, 1],
      [8, 3],
      [9, 5],
      [10, 2],
      [11, 1],
      [12, 5],
      [13, 5],
    ] as const
  ).map(([setNumber, winningAllianceNumber]) => ({ compLevel: "sf", setNumber, matchNumber: 1, winningAllianceNumber }));

  it("applies at a routed Round 5 stop, alliances 1 and 5 alive, and every team it locks qualified (recorded)", () => {
    const facts = factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, ROUND_FIVE_ROWS)!;
    const milestones = dcmpBracketMilestonesByTeam(ALLIANCES, ROUND_FIVE_ROWS);
    for (const [allianceNumber, placement] of [
      [3, 3],
      [2, 4],
    ] as const) {
      expect(milestones.get(ALLIANCES[allianceNumber - 1]!.picks[0]!)).toEqual({ kind: "decided", placement });
    }
    const distributions = distributionsWith(milestones, facts);
    const model = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributions);
    const shipped = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributions, false);
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") return;
    expect(model.jointProof.input.aliveAlliances).toEqual([1, 5]);
    expect(model.jointProof.input.candidateWinners).toEqual([1, 5]);
    expect(model.jointProof.input.placementPoints).toEqual([75, 39, 21]);
    for (const teamKey of jointKeys(model)) {
      expect(["locked", "lockedAward"], teamKey).toContain(FINISHED.status.byTeam.get(teamKey)!.verdict);
    }
    expect(model.floorCutLine).toBe(shipped.floorCutLine);
    expect(model.pointsSlots).toBe(shipped.pointsSlots);
    for (const result of model.byTeam.values()) {
      if (result.verdict === "locked") continue;
      expect(result, result.teamKey).toEqual(shipped.byTeam.get(result.teamKey));
    }
    // Measured 2026-10-09.
    expect(jointKeys(model)).toEqual(JOINT_AT_ROUTED_ROUND_FIVE);
  });

  it("keeps a placed alliance alive for the proof while one of its picks carries no settled Playoffs value (planner reading 6)", () => {
    const facts = factsAt(FNC_LIKE_STOP.get(DCMP_KEY)!, ROUND_TWO_ROWS)!;
    const full = dcmpBracketMilestonesByTeam(ALLIANCES, ROUND_TWO_ROWS);
    expect(full.get(ALLIANCES[7]!.picks[0]!)).toEqual({ kind: "decided", placement: 7 });
    const omitted = new Map(full);
    omitted.delete(ALLIANCES[7]!.picks[1]!);
    const withGap = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributionsWith(omitted, facts));
    const complete = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributionsWith(full, facts));
    expect(withGap.jointProof?.applied).toBe(true);
    expect(complete.jointProof?.applied).toBe(true);
    if (withGap.jointProof?.applied !== true || complete.jointProof?.applied !== true || withGap.jointProof.shape === "multiple" || complete.jointProof.shape === "multiple") return;
    expect(withGap.jointProof.input.aliveAlliances).toContain(8);
    expect(complete.jointProof.input.aliveAlliances).not.toContain(8);
    expect(complete.jointProof.input.aliveAlliances).toEqual([1, 2, 3, 4, 5, 6]);
    expect(complete.jointProof.input.placementPoints).toEqual([75, 39, 21]);
  });

  it("a team of the field the facts name as a decided alliance's field observed backup keeps that alliance alive, exactly as a listed, unconfirmed fourth does (quick task 261010-66y, D4)", () => {
    // A team with a championship row that no alliance picked: no alliance points, and so no milestone and no settled Playoffs value.
    const picked = new Set(ALLIANCES.flatMap((alliance) => alliance.picks));
    const backup = FIXTURE.teams.find((team) => !picked.has(team.teamKey) && team.eventPoints.some((row) => row.eventKey === DCMP_KEY && row.alliance === 0))!.teamKey;
    const stage = FNC_LIKE_STOP.get(DCMP_KEY)!;
    // The run's own milestones never name the backup: alliance 8 is decided seventh for its three listed picks.
    const milestones = dcmpBracketMilestonesByTeam(ALLIANCES, ROUND_TWO_ROWS);
    expect(milestones.has(backup)).toBe(false);
    const listedOnly = factsAt(stage, ROUND_TWO_ROWS)!;
    const observed = dcmpBracketFactsFor({ eventKey: DCMP_KEY, season: 2026, tier: "dcmp", stage, alliances: ALLIANCES, playedMatches: ROUND_TWO_ROWS, unresolvedMatchCount: 0, fieldBackups: [{ teamKey: backup, allianceNumber: 8 }] })!;
    const listedFourth = factsAt(stage, ROUND_TWO_ROWS, ALLIANCES.map((alliance) => (alliance.allianceNumber === 8 ? { ...alliance, picks: [...alliance.picks, backup] } : alliance)))!;
    expect(observed).toEqual(listedFourth);

    const without = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributionsWith(milestones, listedOnly));
    const withObserved = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributionsWith(milestones, observed));
    const withListed = modelAtStop(FIXTURE, FNC_LIKE_STOP, distributionsWith(milestones, listedFourth));
    expect(without.jointProof?.applied).toBe(true);
    expect(withObserved.jointProof?.applied).toBe(true);
    if (without.jointProof?.applied !== true || withObserved.jointProof?.applied !== true || without.jointProof.shape === "multiple" || withObserved.jointProof.shape === "multiple") return;
    expect(without.jointProof.input.aliveAlliances).not.toContain(8);
    expect(withObserved.jointProof.input.aliveAlliances).toContain(8);
    expect(withObserved.jointProof.input.aliveAlliances).toEqual([1, 2, 3, 4, 5, 6, 8]);
    // The whole model is the listed fourth's, and holding the alliance alive never adds a lock.
    expect(withObserved).toEqual(withListed);
    for (const teamKey of jointKeys(withObserved)) expect(jointKeys(without), teamKey).toContain(teamKey);
  });

  it("jointDecidedPlacementTopUp tops up only a settled value that is not exact with no routed placement", () => {
    const secondPlace = { points: 60, exact: false, ceiling: 75 };
    expect(jointDecidedPlacementTopUp(secondPlace, 2, 2026)).toBe(0);
    expect(jointDecidedPlacementTopUp(secondPlace, 5, 2026)).toBe(0);
    expect(jointDecidedPlacementTopUp({ points: 39, exact: true, ceiling: 0 }, undefined, 2026)).toBe(0);
    expect(jointDecidedPlacementTopUp(undefined, undefined, 2026)).toBe(0);
    expect(jointDecidedPlacementTopUp(secondPlace, undefined, 2026)).toBe(15);
  });

  /**
   * D7 through the shipped ceiling test alone (no `dcmpBracket`, so the joint
   * proof refuses with noBracketFacts): a rival R on a decided second place
   * alliance, live at Now, whose ceiling at the PRINTED 60 sits one point short
   * of T's floor. Its ceiling at the placement MAXIMUM, 75, reaches T, so R is
   * the threat that keeps T from a ceiling lock. With R 15 points lower, R's
   * ceiling at 75 is one short and T locks on the ceiling test.
   */
  it("D7: a rival on a decided second place alliance threatens at its 75 point maximum, not at the 60 its cell prints", () => {
    const template = FIXTURE.teams.find((team) => team.eventPoints.some((row) => row.eventKey === DCMP_KEY))!;
    const awardSlots = pendingAwardSlots(dcmpAwardCountCeilings(FIXTURE.year, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts);
    const lockSlots = FIXTURE.cmpSlots! - MAX_WINNING_ALLIANCE_SIZE - awardSlots;
    const dcmpCeilings = maxEventPoints(2026, "dcmp");
    const T_FLOOR = 300;
    const synth = (teamKey: string, pointTotal: number) => ({
      ...template,
      teamKey,
      teamNumber: Number(teamKey.slice(3)),
      pointTotal,
      eventPoints: [{ ...template.eventPoints.find((row) => row.eventKey === DCMP_KEY)!, qual: 0, alliance: 0, elim: 0, award: 0, total: 0, state: undefined }],
      remainingEvents: [],
      qualifyingAwards: [],
    });
    const artifactWith = (rivalFloor: number): DistrictArtifact =>
      DistrictArtifactSchema.parse({
        ...FIXTURE,
        teams: [
          synth("frc9001", T_FLOOR),
          ...Array.from({ length: lockSlots - 1 }, (_, index) => synth(`frc${9100 + index}`, 290)),
          synth("frc9002", rivalFloor),
          ...Array.from({ length: 4 }, (_, index) => synth(`frc${9200 + index}`, 50)),
        ],
      });
    const stop = new Map([[DCMP_KEY, { qual: true, alliance: true, elim: false, award: false }]]);
    const milestones = new Map<string, AllianceBracketMilestone>([["frc9002", { kind: "decided", placement: 2 }]]);
    const run = (rivalFloor: number) => {
      const artifact = artifactWith(rivalFloor);
      const distributions = distributionsWith(milestones, undefined);
      const rows = buildChampLedgerRows({ artifact, distributions, stageByEvent: stop, dcmpStarted: true });
      const rival = rows.teams.find((team) => team.teamKey === "frc9002")!;
      expect(rival.dcmpRow.sources[0]!.settledElim).toEqual({ points: 60, exact: false, ceiling: 75 });
      return computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026, distributions });
    };

    // At the printed 60, R's ceiling is one point short of T's floor.
    const atEdge = T_FLOOR - 1 - 60 - dcmpCeilings.award;
    const edge = run(atEdge);
    expect(edge.jointProof).toEqual({ applied: false, reason: "noBracketFacts" });
    const t = edge.byTeam.get("frc9001")!;
    expect(t.verdict).not.toBe("locked");
    expect(t.lockedBy?.includes("ceiling") ?? false).toBe(false);
    expect(t.status).not.toBe("locked");

    // Control: 15 lower, R's ceiling at 75 is one short, and T locks on the ceiling.
    const control = run(atEdge - 15);
    expect(control.byTeam.get("frc9001")!.verdict).toBe("locked");
    expect(control.byTeam.get("frc9001")!.lockedBy).toBe("ceiling");
  });
});

/**
 * Quick task 261009-kt3, CONTEXT D3 and planner readings R1 to R3, on the PNW
 * fixture split into two divisions (`2026pncmp1` for even indices, `2026pncmp2`
 * for odd) with the parent `2026pncmp` as the finals: every DCMP award stays at
 * the parent, where a divisioned championship gives it, and frc2046 carries an
 * extra finals row (qual 0, alliance 0, elim 30, award 30) with its pointTotal
 * raised by 60.
 */
describe("computeChampLedgerStatuses — every championship row is folded (261009-kt3, D3 and R1 to R3)", () => {
  const PARENT = "2026pncmp";
  const DIVISIONS = ["2026pncmp1", "2026pncmp2"] as const;
  const FINALS_TEAM = "frc2046";
  const FINALS_ELIM_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const FINALS_AWARDS_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };

  const DIVISIONED: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team, index) => {
      const division = DIVISIONS[index % 2]!;
      const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: division } : row);
      const eventPoints = team.eventPoints.map(relabel);
      const relabelled = { ...team, eventPoints, remainingEvents: team.remainingEvents.map(relabel) };
      if (team.teamKey !== FINALS_TEAM) return relabelled;
      const divisionRow = eventPoints.find((row) => row.eventKey === division)!;
      return {
        ...relabelled,
        pointTotal: team.pointTotal + 60,
        eventPoints: [...eventPoints, { ...divisionRow, eventKey: PARENT, qual: 0, alliance: 0, elim: 30, award: 30, total: 60 }],
      };
    }),
  });
  const finalsTeamSource = DIVISIONED.teams.find((team) => team.teamKey === FINALS_TEAM)!;
  /** A division team with no finals row, in the field. */
  const DIVISION_ONLY_TEAM = DIVISIONED.teams.find(
    (team) => team.teamKey !== FINALS_TEAM && team.eventPoints.some((row) => row.eventKey === DIVISIONS[0]) && team.eventPoints.every((row) => row.eventKey !== PARENT)
  )!.teamKey;

  function divisionedAt(division: DistrictStageFinality, finals: DistrictStageFinality) {
    const stageByEvent = new Map(
      eventKeysOf(DIVISIONED).map((key) => [key, key === PARENT ? finals : (DIVISIONS as readonly string[]).includes(key) ? division : ALL_FINAL] as const)
    );
    const rows = buildChampLedgerRows({ artifact: DIVISIONED, distributions: new Map(), stageByEvent, dcmpStarted: true });
    return { rows, status: computeChampLedgerStatuses({ artifact: DIVISIONED, teams: rows.teams, nowYear: 2026 }), stageByEvent };
  }

  it("lists both of the finals team's rows as DCMP sources, division first", () => {
    const { rows } = divisionedAt(ALL_FINAL, ALL_OPEN);
    const team = rows.teams.find((entry) => entry.teamKey === FINALS_TEAM)!;
    expect(team.dcmpRow.sources.map((source) => source.eventKey)).toEqual([DIVISIONS[FIXTURE.teams.findIndex((t) => t.teamKey === FINALS_TEAM) % 2], PARENT]);
  });

  it("D3: with both divisions final and the finals all open, the finals row's 60 leaves the floor and its 30 enters the ceiling; at Now the floor is pointTotal", () => {
    // Quick task 261010-66y, reading R22: the finals' Awards add no points ceiling for anyone, so only the
    // two division finals champion maximum (30) enters. Before that task this read 30 plus the 45 Awards ceiling.
    const open = divisionedAt(ALL_FINAL, ALL_OPEN).status;
    expect(open.floorByTeam!.get(FINALS_TEAM)).toBe(finalsTeamSource.pointTotal - 60);
    expect(open.ceilingByTeam!.get(FINALS_TEAM)! - open.floorByTeam!.get(FINALS_TEAM)!).toBe(30);
    const now = divisionedAt(ALL_FINAL, ALL_FINAL).status;
    expect(now.floorByTeam!.get(FINALS_TEAM)).toBe(finalsTeamSource.pointTotal);
    expect(now.ceilingByTeam!.get(FINALS_TEAM)).toBe(finalsTeamSource.pointTotal);
  });

  describe("the finals read the same way with and without a finals row (quick task 261010-66y, P12 reading (A), R22 and R23)", () => {
    const WHOLE_CHAMPIONSHIP = (() => {
      const ceiling = maxEventPoints(2026, "dcmp");
      return ceiling.qual + ceiling.alliance + ceiling.elim + ceiling.award;
    })();
    /** A team the artifact names at no championship key at all. */
    const OUTSIDE_TEAM = DIVISIONED.teams.find((team) => team.eventPoints.every((row) => row.tier !== "dcmp") && team.remainingEvents.every((row) => row.tier !== "dcmp"))!.teamKey;
    /** The same district with OUTSIDE_TEAM given an award at the finals alone: 30 award points on a finals row, and no division row. */
    const WITH_FINALS_ONLY: DistrictArtifact = DistrictArtifactSchema.parse({
      ...DIVISIONED,
      teams: DIVISIONED.teams.map((team) => {
        if (team.teamKey !== OUTSIDE_TEAM) return team;
        const finalsRow = finalsTeamSource.eventPoints.find((row) => row.eventKey === PARENT)!;
        return { ...team, pointTotal: team.pointTotal + 30, eventPoints: [...team.eventPoints, { ...finalsRow, qual: 0, alliance: 0, elim: 0, award: 30, total: 30 }] };
      }),
    });
    const outsideSource = DIVISIONED.teams.find((team) => team.teamKey === OUTSIDE_TEAM)!;

    /** The statuses at a rewound stop: each division at `division`, the finals at `finals`, and exactly `started` started. */
    function at(
      artifact: DistrictArtifact,
      stop: { division: DistrictStageFinality; finals: DistrictStageFinality; started: readonly string[] },
      options: { districtLockedOut?: ReadonlySet<string>; stripFieldRowOpen?: boolean } = {}
    ) {
      const stageByEvent = new Map(eventKeysOf(artifact).map((key) => [key, key === PARENT ? stop.finals : (DIVISIONS as readonly string[]).includes(key) ? stop.division : ALL_FINAL] as const));
      const rows = buildChampLedgerRows({ artifact, distributions: new Map(), stageByEvent, startedDcmpEventKeys: new Set(stop.started) });
      const teams = options.stripFieldRowOpen === true ? rows.teams.map(({ fieldRowOpen: _unused, ...team }) => team) : rows.teams;
      return { rows, status: computeChampLedgerStatuses({ artifact, teams, nowYear: 2026, ...(options.districtLockedOut === undefined ? {} : { districtLockedOut: options.districtLockedOut }) }) };
    }
    const openCeiling = (model: ReturnType<typeof at>, teamKey: string): number => model.status.ceilingByTeam!.get(teamKey)! - model.status.floorByTeam!.get(teamKey)!;
    const NOTHING_STARTED = { division: ALL_OPEN, finals: ALL_OPEN, started: [] as string[] };
    const ONE_DIVISION_STARTED = { division: ALL_OPEN, finals: ALL_OPEN, started: [DIVISIONS[0]] as string[] };
    const EVERY_DIVISION_STARTED = { division: ALL_OPEN, finals: ALL_OPEN, started: [...DIVISIONS] as string[] };
    const DIVISIONS_FINAL = { division: ALL_FINAL, finals: ALL_OPEN, started: [...DIVISIONS] as string[] };
    const FINALS_PLAYOFFS_FINAL = { division: ALL_FINAL, finals: FINALS_AWARDS_OPEN, started: [...DIVISIONS, PARENT] as string[] };
    const EVERYTHING_FINAL = { division: ALL_FINAL, finals: ALL_FINAL, started: [...DIVISIONS, PARENT] as string[] };

    it("R22: a finals source with its Awards open adds no Awards ceiling, and its award points are out of the floor", () => {
      // The finals' Playoffs final and their Awards open: FINALS_TEAM's 30 finals award points are open.
      const model = at(DIVISIONED, FINALS_PLAYOFFS_FINAL);
      expect(model.status.floorByTeam!.get(FINALS_TEAM)).toBe(finalsTeamSource.pointTotal - 30);
      expect(openCeiling(model, FINALS_TEAM)).toBe(0);
      // And a division team with no finals row carries nothing for the finals' Awards either, as before.
      expect(openCeiling(model, DIVISION_ONLY_TEAM)).toBe(0);
    });

    it("premise: the finals only team has one championship row, at the finals key, with award points alone", () => {
      const rows = WITH_FINALS_ONLY.teams.find((team) => team.teamKey === OUTSIDE_TEAM)!.eventPoints.filter((row) => row.tier === "dcmp");
      expect(rows.map((row) => [row.eventKey, row.qual, row.alliance, row.elim, row.award])).toEqual([[PARENT, 0, 0, 0, 30]]);
      expect(outsideSource.eventPoints.some((row) => row.tier === "dcmp")).toBe(false);
    });

    it("R23: before every division has started, a team whose only championship row is the finals row carries one hypothetical championship, exactly as the same team with the row removed", () => {
      for (const stop of [NOTHING_STARTED, ONE_DIVISION_STARTED]) {
        const withRow = at(WITH_FINALS_ONLY, stop);
        const withoutRow = at(DIVISIONED, stop);
        // The finals row adds no Playoffs ceiling and no Awards ceiling: the open ceiling is the hypothetical championship alone.
        expect(openCeiling(withRow, OUTSIDE_TEAM), JSON.stringify(stop.started)).toBe(WHOLE_CHAMPIONSHIP);
        expect(openCeiling(withoutRow, OUTSIDE_TEAM), JSON.stringify(stop.started)).toBe(WHOLE_CHAMPIONSHIP);
        // Its award points there are not earned yet at the stop: the floor is the team's total without them.
        expect(withRow.status.floorByTeam!.get(OUTSIDE_TEAM)).toBe(outsideSource.pointTotal);
        expect(withRow.status.floorByTeam!.get(OUTSIDE_TEAM)).toBe(withoutRow.status.floorByTeam!.get(OUTSIDE_TEAM));
        expect(withRow.status.ceilingByTeam!.get(OUTSIDE_TEAM)).toBe(withoutRow.status.ceilingByTeam!.get(OUTSIDE_TEAM));
        // And every other team reads the same on both artifacts.
        for (const [teamKey, ceiling] of withoutRow.status.ceilingByTeam!) expect(withRow.status.ceilingByTeam!.get(teamKey), teamKey).toBe(ceiling);
        for (const [teamKey, floor] of withoutRow.status.floorByTeam!) expect(withRow.status.floorByTeam!.get(teamKey), teamKey).toBe(floor);
      }
    });

    it("R23: the hypothetical championship keeps its two gates: none for a team the district tier has locked out", () => {
      const lockedOut = new Set([OUTSIDE_TEAM]);
      expect(openCeiling(at(WITH_FINALS_ONLY, NOTHING_STARTED, { districtLockedOut: lockedOut }), OUTSIDE_TEAM)).toBe(0);
      expect(openCeiling(at(DIVISIONED, NOTHING_STARTED, { districtLockedOut: lockedOut }), OUTSIDE_TEAM)).toBe(0);
    });

    it("R23: once every division has started the finals only team carries nothing, and its award points stay out of its floor while the finals' Awards are open", () => {
      for (const stop of [EVERY_DIVISION_STARTED, DIVISIONS_FINAL, FINALS_PLAYOFFS_FINAL]) {
        const withRow = at(WITH_FINALS_ONLY, stop);
        const withoutRow = at(DIVISIONED, stop);
        expect(openCeiling(withRow, OUTSIDE_TEAM), JSON.stringify(stop)).toBe(0);
        expect(withRow.status.floorByTeam!.get(OUTSIDE_TEAM), JSON.stringify(stop)).toBe(outsideSource.pointTotal);
        expect(withRow.status.ceilingByTeam!.get(OUTSIDE_TEAM), JSON.stringify(stop)).toBe(withoutRow.status.ceilingByTeam!.get(OUTSIDE_TEAM));
      }
      // Once the finals' Awards are final its 30 points are earned.
      const final = at(WITH_FINALS_ONLY, EVERYTHING_FINAL);
      expect(final.status.floorByTeam!.get(OUTSIDE_TEAM)).toBe(outsideSource.pointTotal + 30);
      expect(openCeiling(final, OUTSIDE_TEAM)).toBe(0);
    });

    it("R23: a division team's finals source still carries the finals Playoffs maximum, and a team with no row reads as before", () => {
      // FINALS_TEAM has a division source at the finals key's stem, so its finals row keeps the two division maximum.
      expect(openCeiling(at(DIVISIONED, DIVISIONS_FINAL), FINALS_TEAM)).toBe(30);
      // A team with no row at all: one hypothetical championship before every division has started, nothing after.
      expect(openCeiling(at(DIVISIONED, NOTHING_STARTED), OUTSIDE_TEAM)).toBe(WHOLE_CHAMPIONSHIP);
      expect(openCeiling(at(DIVISIONED, EVERY_DIVISION_STARTED), OUTSIDE_TEAM)).toBe(0);
    });

    it("a hand built team with no fieldRowOpen reads by the condition of before this task, and at a single championship, at two championships and at a divisioned one with no finals only team the two readings are the same model", () => {
      const SECOND_KEY = "2026pnncmp";
      const TWO: DistrictArtifact = DistrictArtifactSchema.parse({
        ...FIXTURE,
        teams: FIXTURE.teams.map((team, index) => {
          if (index % 2 === 0) return team;
          const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: SECOND_KEY } : row);
          return { ...team, eventPoints: team.eventPoints.map(relabel), remainingEvents: team.remainingEvents.map(relabel), qualifyingAwards: team.qualifyingAwards.map(relabel) };
        }),
      });
      const cases: readonly (readonly [string, DistrictArtifact, readonly string[]])[] = [
        ["a single championship", FIXTURE, [PARENT]],
        ["two championships", TWO, [PARENT, SECOND_KEY]],
        ["a divisioned championship", DIVISIONED, [...DIVISIONS, PARENT]],
      ];
      for (const [name, artifact, keys] of cases) {
        const dcmpKeys = new Set(keys);
        for (const stage of [ALL_OPEN, FINALS_ELIM_OPEN, FINALS_AWARDS_OPEN, ALL_FINAL]) {
          for (const started of [[], keys.slice(0, 1), keys.filter((key) => key !== PARENT || artifact !== DIVISIONED), keys]) {
            const stageByEvent = new Map(eventKeysOf(artifact).map((key) => [key, dcmpKeys.has(key) ? stage : ALL_FINAL] as const));
            const rows = buildChampLedgerRows({ artifact, distributions: new Map(), stageByEvent, startedDcmpEventKeys: new Set(started) });
            const built = computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026 });
            const handBuilt = computeChampLedgerStatuses({ artifact, teams: rows.teams.map(({ fieldRowOpen: _unused, ...team }) => team), nowYear: 2026 });
            expect(handBuilt, `${name}, started ${JSON.stringify(started)}, ${JSON.stringify(stage)}`).toEqual(built);
          }
        }
      }
    });
  });

  it("R2: a division team with no finals row carries the two division finals champion maximum while the finals' Playoffs are open, and not once they are final", () => {
    const open = divisionedAt(ALL_FINAL, FINALS_ELIM_OPEN).status;
    expect(open.ceilingByTeam!.get(DIVISION_ONLY_TEAM)! - open.floorByTeam!.get(DIVISION_ONLY_TEAM)!).toBe(30);
    const closed = divisionedAt(ALL_FINAL, FINALS_AWARDS_OPEN).status;
    expect(closed.ceilingByTeam!.get(DIVISION_ONLY_TEAM)).toBe(closed.floorByTeam!.get(DIVISION_ONLY_TEAM));
  });

  it("R2 never applies at a single championship or at two championships: the helper is 0 for every team of PNW, the two championship fixture and (when present) FNC 2026", () => {
    const SECOND_KEY = "2026pnncmp";
    const TWO: DistrictArtifact = DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team, index) => {
        if (index % 2 === 0) return team;
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: SECOND_KEY } : row);
        return { ...team, eventPoints: team.eventPoints.map(relabel), remainingEvents: team.remainingEvents.map(relabel), qualifyingAwards: team.qualifyingAwards.map(relabel) };
      }),
    });
    const fncPath = (() => {
      try {
        return repoFile("data/local-publish/districts/v1__district__2026fnc.json");
      } catch {
        return undefined;
      }
    })();
    const artifacts = [FIXTURE, TWO, ...(fncPath === undefined ? [] : [DistrictArtifactSchema.parse(JSON.parse(readFileSync(fncPath, "utf8")))])];
    for (const artifact of artifacts) {
      const dcmpKeys = [...new Set(artifact.teams.flatMap((team) => [...team.eventPoints, ...team.remainingEvents].filter((row) => row.tier === "dcmp").map((row) => row.eventKey)))].sort();
      for (const stage of [ALL_OPEN, FINALS_ELIM_OPEN, FINALS_AWARDS_OPEN, ALL_FINAL]) {
        const stageByEvent = new Map(eventKeysOf(artifact).map((key) => [key, stage] as const));
        for (const team of artifact.teams) {
          const sourceKeys = [...team.eventPoints, ...team.remainingEvents].filter((row) => row.tier === "dcmp").map((row) => row.eventKey);
          expect(champFinalsCeilingWithoutRow(sourceKeys, dcmpKeys, artifact.year, stageByEvent), `${artifact.districtKey} ${team.teamKey}`).toBe(0);
        }
      }
    }
    expect(champFinalsCeilingWithoutRow([DIVISIONS[0]], [PARENT, ...DIVISIONS], 2026, new Map())).toBe(30);
  });

  it("R3: the winner award at the finals key does not qualify a team while the finals' Playoffs are open, though its division's are final, and does once they are final", () => {
    expect(finalsTeamSource.qualifyingAwards.some((award) => award.awardType === 1 && award.eventKey === PARENT)).toBe(true);
    expect(divisionedAt(ALL_FINAL, FINALS_ELIM_OPEN).status.awardQualified).not.toContain(FINALS_TEAM);
    expect(divisionedAt(ALL_FINAL, FINALS_AWARDS_OPEN).status.awardQualified).toContain(FINALS_TEAM);
  });
});

/**
 * Quick task 261009-kt3: the joint proof at a divisioned championship and at a
 * district with two championships, on the PNW fixture. Division 1
 * (`2026pncmp1`) holds the 24 teams of the fixture's eight DCMP alliances,
 * rebuilt from their alliance selection points; division 2 (`2026pncmp2`) the
 * other 27 DCMP teams, eight alliances of three in key order; the parent
 * `2026pncmp` is the finals, where alliance 1's picks carry a finals row and
 * every DCMP award stays.
 */
describe("computeChampLedgerStatuses — divisioned and two championship joint proof (261009-kt3)", () => {
  const PARENT = "2026pncmp";
  const DIV1 = "2026pncmp1";
  const DIV2 = "2026pncmp2";
  const OPEN_PLAYOFFS: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const PLAYOFFS_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };

  function rebuilt(artifact: DistrictArtifact, key: string): { allianceNumber: number; picks: string[] }[] {
    const picks = new Map<number, string[]>();
    for (const team of artifact.teams) {
      const row = team.eventPoints.find((entry) => entry.eventKey === key);
      if (row === undefined || row.alliance <= 0) continue;
      const base = row.alliance / 3;
      const allianceNumber = base >= 9 ? 17 - base : base;
      const list = picks.get(allianceNumber) ?? [];
      if (base >= 9) list.unshift(team.teamKey);
      else list.push(team.teamKey);
      picks.set(allianceNumber, list);
    }
    return [...picks.entries()].sort((a, b) => a[0] - b[0]).map(([allianceNumber, list]) => ({ allianceNumber, picks: list }));
  }
  const DIV1_ALLIANCES = rebuilt(FIXTURE, PARENT);
  const div1Teams = new Set(DIV1_ALLIANCES.flatMap((alliance) => alliance.picks));
  const others = FIXTURE.teams
    .filter((team) => team.eventPoints.some((row) => row.eventKey === PARENT) && !div1Teams.has(team.teamKey))
    .map((team) => team.teamKey)
    .sort();
  const DIV2_ALLIANCES = Array.from({ length: 8 }, (_, index) => ({ allianceNumber: index + 1, picks: others.slice(index * 3, index * 3 + 3) }));

  const DIVISIONED: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team) => {
      const division = div1Teams.has(team.teamKey) ? DIV1 : DIV2;
      const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: division } : row);
      const eventPoints = team.eventPoints.map(relabel);
      const finals = DIV1_ALLIANCES[0]!.picks.includes(team.teamKey)
        ? [{ ...eventPoints.find((row) => row.eventKey === division)!, eventKey: PARENT, qual: 0, alliance: 0, elim: 0, award: 0, total: 0 }]
        : [];
      return { ...team, eventPoints: [...eventPoints, ...finals], remainingEvents: team.remainingEvents.map(relabel) };
    }),
  });

  /** Round 5 in TBA's coordinates: alliance 1 won, 5 the finalist, 3 third, 2 fourth; alive 1 and 5. */
  const ROUND_FIVE: PlayedBracketMatch[] = (
    [
      [1, 1],
      [2, 5],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 6],
      [7, 1],
      [8, 3],
      [9, 5],
      [10, 2],
      [11, 1],
      [12, 5],
      [13, 5],
    ] as const
  ).map(([setNumber, winningAllianceNumber]) => ({ compLevel: "sf", setNumber, matchNumber: 1, winningAllianceNumber }));
  const FINAL_ONE_WINS: PlayedBracketMatch[] = [1, 2].map((matchNumber) => ({ compLevel: "f", setNumber: 1, matchNumber, winningAllianceNumber: 1 }));
  /** A whole bracket where the better seed wins every match: alliance 1 is champion. */
  function higherSeedRows(): PlayedBracketMatch[] {
    const rows: PlayedBracketMatch[] = [];
    routeBracket((a, b, setId, matchNumber) => {
      const winner = Math.min(a, b);
      rows.push(setId === "f" ? { compLevel: "f", setNumber: 1, matchNumber, winningAllianceNumber: winner } : { compLevel: "sf", setNumber: Number(setId.slice(2)), matchNumber: 1, winningAllianceNumber: winner });
      return winner;
    });
    return rows;
  }

  function facts(eventKey: string, stage: DistrictStageFinality, alliances: readonly { allianceNumber: number; picks: string[] }[], playedMatches: readonly PlayedBracketMatch[], role: "division" | "finals" | "championship", expectedAllianceCount?: number): DcmpBracketFacts {
    const built = dcmpBracketFactsFor({ eventKey, season: 2026, tier: "dcmp", stage, alliances, playedMatches, unresolvedMatchCount: 0, role, ...(expectedAllianceCount === undefined ? {} : { expectedAllianceCount }) });
    if (built === undefined) throw new Error(`no facts for ${eventKey}`);
    return built;
  }
  function entry(eventKey: string, dcmpBracket: DcmpBracketFacts | undefined, milestones: ReadonlyMap<string, AllianceBracketMilestone> = new Map()): [string, DistrictEventDistributions] {
    return [eventKey, { eventKey, byTeam: new Map(), playoffMilestoneByTeam: milestones, ...(dcmpBracket === undefined ? {} : { dcmpBracket }) }];
  }
  /** The rows at the stages. `startedDcmpEventKeys` is the position's started set (quick task 261009-pgq); absent, every championship key has started. */
  function rowsAt(
    artifact: DistrictArtifact,
    stages: ReadonlyMap<string, DistrictStageFinality>,
    distributions: ReadonlyMap<string, DistrictEventDistributions>,
    startedDcmpEventKeys?: ReadonlySet<string>
  ) {
    const stageByEvent = new Map(eventKeysOf(artifact).map((key) => [key, stages.get(key) ?? ALL_FINAL] as const));
    return buildChampLedgerRows({ artifact, distributions, stageByEvent, ...(startedDcmpEventKeys === undefined ? { dcmpStarted: true } : { startedDcmpEventKeys }) });
  }
  function modelAt(
    artifact: DistrictArtifact,
    stages: ReadonlyMap<string, DistrictStageFinality>,
    distributions: ReadonlyMap<string, DistrictEventDistributions>,
    startedDcmpEventKeys?: ReadonlySet<string>
  ) {
    const rows = rowsAt(artifact, stages, distributions, startedDcmpEventKeys);
    return computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026, distributions });
  }
  const C = pendingAwardSlots(dcmpAwardCountCeilings(2026, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts);

  /** Round 5 in division 1, no row in division 2, finals open; alliance 3 lists a fourth pick at 0 points and division 2's alliance 1 lists four. */
  function roundFiveDistributions(div2Facts = true): ReadonlyMap<string, DistrictEventDistributions> {
    const div1 = DIV1_ALLIANCES.map((alliance) => (alliance.allianceNumber === 3 ? { ...alliance, picks: [...alliance.picks, others[25]!] } : alliance));
    const div2 = DIV2_ALLIANCES.map((alliance) => (alliance.allianceNumber === 1 ? { ...alliance, picks: [...alliance.picks, others[26]!] } : alliance));
    return new Map([
      entry(DIV1, facts(DIV1, OPEN_PLAYOFFS, div1, ROUND_FIVE, "division"), dcmpBracketMilestonesByTeam(DIV1_ALLIANCES, ROUND_FIVE)),
      entry(DIV2, div2Facts ? facts(DIV2, OPEN_PLAYOFFS, div2, [], "division") : undefined),
    ]);
  }
  const ROUND_FIVE_STAGES = new Map([
    [DIV1, OPEN_PLAYOFFS],
    [DIV2, OPEN_PLAYOFFS],
    [PARENT, ALL_OPEN],
  ]);

  it("classifies the fixture as divisioned and applies at a Round 5 like stop: K 28, the district's C, candidates from both divisions", () => {
    const model = modelAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions());
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") throw new Error("not applied");
    expect(model.jointProof.shape).toBe("divisioned");
    const { input } = model.jointProof;
    expect(input.judgedAwards).toBe(28);
    expect(input.consumingAwards).toBe(C);
    expect(input.placementPoints).toEqual([75, 39, 21]);
    expect(input.candidateWinners).toEqual([11, 15, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(input.frames?.length).toBe(10);
    // R8 G2 and D10: decided alliance 3 of division 1 keeps its three confirmed picks, its listed fourth is unpicked, one seat.
    const placed = input.alliances.find((alliance) => alliance.allianceNumber === 13)!;
    expect(placed.members).toEqual(DIV1_ALLIANCES[2]!.picks);
    expect(placed.spareSeats).toBe(1);
    expect(input.alliances.some((alliance) => alliance.members.includes(others[25]!))).toBe(false);
    // R8 G1: division 2's alive alliance 1 lists four with no point posted: all four members, four seats.
    const alive = input.alliances.find((alliance) => alliance.allianceNumber === 21)!;
    expect(alive.members).toHaveLength(4);
    expect(alive.spareSeats).toBe(4);
  });

  it("with both divisions final and finals facts mapping each finals alliance to a division winner, the two winners are the candidates", () => {
    const stages = new Map([
      [DIV1, PLAYOFFS_FINAL],
      [DIV2, PLAYOFFS_FINAL],
      [PARENT, OPEN_PLAYOFFS],
    ]);
    const finalsFacts = (second: string[]) =>
      facts(PARENT, OPEN_PLAYOFFS, [
        { allianceNumber: 1, picks: DIV1_ALLIANCES[0]!.picks },
        { allianceNumber: 2, picks: second },
      ], [], "finals", 2);
    const distributions = (finals: DcmpBracketFacts | undefined, div2 = true) =>
      new Map([
        entry(DIV1, facts(DIV1, PLAYOFFS_FINAL, DIV1_ALLIANCES, [...ROUND_FIVE, ...FINAL_ONE_WINS], "division")),
        entry(DIV2, div2 ? facts(DIV2, PLAYOFFS_FINAL, DIV2_ALLIANCES, higherSeedRows(), "division") : undefined),
        entry(PARENT, finals),
      ]);
    const model = modelAt(DIVISIONED, stages, distributions(finalsFacts(DIV2_ALLIANCES[0]!.picks)));
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") throw new Error(`not applied: ${JSON.stringify(model.jointProof)}`);
    expect(model.jointProof.input.candidateWinners).toEqual([11, 21]);
    expect(model.jointProof.input.aliveAlliances).toEqual([]);

    // A finals alliance meeting no division winner refuses.
    expect(modelAt(DIVISIONED, stages, distributions(finalsFacts(DIV2_ALLIANCES[3]!.picks))).jointProof).toEqual({ applied: false, reason: "bracketUnroutable" });
    // The finals' Awards final refuse.
    const awardsFinal = new Map([...stages, [PARENT, ALL_FINAL]]);
    expect(modelAt(DIVISIONED, awardsFinal, distributions(finalsFacts(DIV2_ALLIANCES[0]!.picks))).jointProof).toEqual({ applied: false, reason: "stageNotEligible" });
    // A division without facts refuses.
    expect(modelAt(DIVISIONED, stages, distributions(undefined, false)).jointProof).toEqual({ applied: false, reason: "noBracketFacts" });
  });

  it("the joint proof's input on the divisioned fixture is the input of before quick task 261010-66y's last step (reading R22: the finals' Awards ceiling was never in a rival's extra)", () => {
    // The digests were taken on the tree BEFORE the finals' Awards ceiling was removed, with this same test, and
    // the test holds them after: the proof modelled the finals' Awards and Playoffs itself, so neither was in any
    // rival's `extra`. A digest that moves means the proof's input moved.
    const digestOf = (model: ReturnType<typeof modelAt>): string => {
      if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") throw new Error(`not applied: ${JSON.stringify(model.jointProof)}`);
      const input = model.jointProof.input;
      const normalised = { ...input, pool: [...input.pool].sort((a, b) => a.teamKey.localeCompare(b.teamKey)), slotOnlyRivals: [...input.slotOnlyRivals].sort() };
      return createHash("sha256").update(JSON.stringify(normalised)).digest("hex");
    };
    // Round 5 in division 1, the finals not started.
    const roundFive = modelAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions());
    // Both divisions' Playoffs final, their Awards open, the finals not started and with no facts: alliance 1 of
    // division 1 carries finals rows, whose Playoffs and Awards are open at this stop.
    const divisionsDone = modelAt(
      DIVISIONED,
      new Map([
        [DIV1, PLAYOFFS_FINAL],
        [DIV2, PLAYOFFS_FINAL],
        [PARENT, ALL_OPEN],
      ]),
      new Map([
        entry(DIV1, facts(DIV1, PLAYOFFS_FINAL, DIV1_ALLIANCES, [...ROUND_FIVE, ...FINAL_ONE_WINS], "division")),
        entry(DIV2, facts(DIV2, PLAYOFFS_FINAL, DIV2_ALLIANCES, higherSeedRows(), "division")),
      ])
    );
    // Premise: the fixture's finals rows are open at both stops, so the removed ceiling is in play.
    expect(DIVISIONED.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === PARENT))).toHaveLength(3);
    expect({ roundFive: digestOf(roundFive), divisionsDone: digestOf(divisionsDone) }).toEqual({
      roundFive: "b624337b0232a7ff32b04fdaeb8d5d1a2719591b84b4e789857d540e2854a9cf",
      divisionsDone: "f9cbb26363900789f3d8e0d5668f95e3cefb63b5a9ff0c9571d857879d6d4a67",
    });
  });

  /** Every DIVISIONED team the artifact names at no championship key: no division row, no finals row, no registration. */
  const ROWLESS = new Set(
    DIVISIONED.teams.filter((team) => team.eventPoints.every((row) => row.tier !== "dcmp") && team.remainingEvents.every((row) => row.tier !== "dcmp")).map((team) => team.teamKey)
  );
  /** One whole hypothetical DCMP: the four category maxima (249 in 2026). */
  const HYPOTHETICAL_DCMP = (() => {
    const ceiling = maxEventPoints(2026, "dcmp");
    return ceiling.qual + ceiling.alliance + ceiling.elim + ceiling.award;
  })();

  it("261009-pgq D1: a team with no championship row drops its whole hypothetical DCMP once both divisions have started, the finals not", () => {
    expect(HYPOTHETICAL_DCMP).toBe(249);
    const oneStarted = modelAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions(), new Set([DIV1]));
    const bothStarted = modelAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions(), new Set([DIV1, DIV2]));
    if (oneStarted.jointProof?.applied !== true || oneStarted.jointProof.shape === "multiple") throw new Error(`not applied: ${JSON.stringify(oneStarted.jointProof)}`);
    // R is taken from the applied proof's own pool: a rival the proof reads, with no championship row.
    const rival = oneStarted.jointProof.input.pool.find((entry) => ROWLESS.has(entry.teamKey))!;
    expect(rival).toBeDefined();
    // One division still to start: the field is not fixed, so R keeps one whole hypothetical DCMP.
    expect(rival.extra).toBe(HYPOTHETICAL_DCMP);
    // Both divisions started, the finals key not: the field is fixed and the hypothetical DCMP is gone.
    expect(oneStarted.ceilingByTeam!.get(rival.teamKey)! - bothStarted.ceilingByTeam!.get(rival.teamKey)!).toBe(HYPOTHETICAL_DCMP);
    expect(bothStarted.ceilingByTeam!.get(rival.teamKey)).toBe(bothStarted.floorByTeam!.get(rival.teamKey));
  });

  it("261009-pgq guard (D2 withdrawn): a rowless team read as out stays a pool rival at extra 0, and one consuming award covers it", () => {
    const started = new Set([DIV1, DIV2]);
    const rows = rowsAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions(), started);
    const model = modelAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions(), started);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") throw new Error(`not applied: ${JSON.stringify(model.jointProof)}`);
    const { input } = model.jointProof;
    const membershipOf = new Map(rows.teams.map((team) => [team.teamKey, team.membership] as const));
    // Every rowless team reads out, and every one of them is a rival in the proof's pool at extra 0 unless a qualification already took it out of the points race.
    const qualified = new Set([...model.awardQualified, ...model.prequalified]);
    const poolByKey = new Map(input.pool.map((entry) => [entry.teamKey, entry] as const));
    expect(ROWLESS.size).toBeGreaterThan(0);
    for (const teamKey of ROWLESS) {
      expect(membershipOf.get(teamKey)).toBe("out");
      if (qualified.has(teamKey)) continue;
      expect(poolByKey.get(teamKey)?.extra).toBe(0);
    }
    const rival = input.pool.find((entry) => ROWLESS.has(entry.teamKey))!;
    expect(rival).toBeDefined();
    expect(membershipOf.get(rival.teamKey)).toBe("out");
    expect(rival.extra).toBe(0);
    // A consuming award covers it: T is the pool's highest floor, R sits below it on points, and one consuming award lifts R past T.
    const top = input.pool.reduce((best, entry) => (entry.floor > best.floor ? entry : best));
    expect(rival.floor).toBeLessThan(top.floor);
    const reduced = (consumingAwards: number): JointLockInput => ({
      pool: [top, rival],
      slotOnlyRivals: [],
      pointsSlots: input.pointsSlots,
      alliances: [],
      aliveAlliances: [],
      candidateWinners: [null],
      placementPoints: input.placementPoints,
      consumingAwards,
      judgedAwards: 0,
      judgedAwardPoints: input.judgedAwardPoints,
      maxAllianceSize: input.maxAllianceSize,
    });
    expect(jointLockBound(reduced(1), top.teamKey)).toBe(1);
    expect(jointLockBound(reduced(0), top.teamKey)).toBe(0);
  });

  /**
   * DIVISIONED with exactly `counts.get(key)` teams carrying award points on
   * their row at each division key (the first in artifact order, 15 points
   * each, one judged award); every other row at that key reads 0.
   */
  function withAwardedTeams(counts: ReadonlyMap<string, number>): DistrictArtifact {
    const seen = new Map<string, number>();
    return DistrictArtifactSchema.parse({
      ...DIVISIONED,
      teams: DIVISIONED.teams.map((team) => ({
        ...team,
        eventPoints: team.eventPoints.map((row) => {
          const count = counts.get(row.eventKey);
          if (count === undefined) return row;
          const index = seen.get(row.eventKey) ?? 0;
          seen.set(row.eventKey, index + 1);
          const award = index < count ? 15 : 0;
          return { ...row, award, total: row.total - row.award + award };
        }),
      })),
    });
  }

  it("261009-pgq D3: the judged budget is the ceiling minus the teams already carrying award points, per division whose Awards read final", () => {
    const finals = facts(
      PARENT,
      OPEN_PLAYOFFS,
      [
        { allianceNumber: 1, picks: DIV1_ALLIANCES[0]!.picks },
        { allianceNumber: 2, picks: DIV2_ALLIANCES[0]!.picks },
      ],
      [],
      "finals",
      2
    );
    /** K with `awarded1` and `awarded2` teams carrying award points at the two divisions, at the two Awards stages. */
    const judgedAt = (div1: DistrictStageFinality, awarded1: number, div2: DistrictStageFinality, awarded2: number): number => {
      const artifact = withAwardedTeams(
        new Map([
          [DIV1, awarded1],
          [DIV2, awarded2],
        ])
      );
      for (const [key, count] of [
        [DIV1, awarded1],
        [DIV2, awarded2],
      ] as const) {
        expect(artifact.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === key && row.award > 0))).toHaveLength(count);
      }
      const stages = new Map([
        [DIV1, div1],
        [DIV2, div2],
        [PARENT, OPEN_PLAYOFFS],
      ]);
      const distributions = new Map([
        entry(DIV1, facts(DIV1, div1, DIV1_ALLIANCES, [...ROUND_FIVE, ...FINAL_ONE_WINS], "division")),
        entry(DIV2, facts(DIV2, div2, DIV2_ALLIANCES, higherSeedRows(), "division")),
        entry(PARENT, finals),
      ]);
      const model = modelAt(artifact, stages, distributions);
      if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") throw new Error(`not applied: ${JSON.stringify(model.jointProof)}`);
      expect(model.jointProof.shape).toBe("divisioned");
      expect(model.jointProof.input.candidateWinners).toEqual([11, 21]);
      return model.jointProof.input.judgedAwards;
    };
    // Playoffs final in both divisions throughout; only the Awards stage and the award points on the rows vary.
    // Both divisions' Awards open: the whole ceiling for each, whatever the rows carry.
    expect(judgedAt(PLAYOFFS_FINAL, 12, PLAYOFFS_FINAL, 12)).toBe(28);
    // One final with 12 teams carrying award points: 14 for the open division and 14 minus 12 for the final one.
    expect(judgedAt(ALL_FINAL, 12, PLAYOFFS_FINAL, 12)).toBe(16);
    // Both final with 12 each: 2 and 2.
    expect(judgedAt(ALL_FINAL, 12, ALL_FINAL, 12)).toBe(4);
    // THE PREMATURE FLAG: Awards read final and no team carries award points yet, so the division keeps its whole 14.
    expect(judgedAt(ALL_FINAL, 0, PLAYOFFS_FINAL, 12)).toBe(28);
    // A partial posting: 3 teams carry award points, 11 awards may still come.
    expect(judgedAt(ALL_FINAL, 3, PLAYOFFS_FINAL, 12)).toBe(25);
    // More awarded teams than the ceiling: 0 for that division, never negative.
    expect(judgedAt(ALL_FINAL, 16, PLAYOFFS_FINAL, 12)).toBe(14);
    expect(judgedAt(ALL_FINAL, 16, ALL_FINAL, 12)).toBe(2);
  });

  it("261009-tx9 (the backup robot rule): one seat group per division in key order, eligible by division row and confirmed picks, a team with no division row named by no group", () => {
    const model = modelAt(DIVISIONED, ROUND_FIVE_STAGES, roundFiveDistributions());
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") throw new Error("not applied");
    const { input } = model.jointProof;
    const groups = input.seatGroups;
    if (groups === undefined) throw new Error("the divisioned input carries no seat groups");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.alliances).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(groups[1]!.alliances).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
    for (const alliance of input.alliances) expect(groups.filter((group) => group.alliances.includes(alliance.allianceNumber))).toHaveLength(1);
    for (const group of groups) expect([...group.eligible]).toEqual([...group.eligible].sort());
    // Reading P3: the listed fourth of placed alliance 13, at 0 points, is not its member and is eligible in division 1's group.
    expect(input.alliances.find((alliance) => alliance.allianceNumber === 13)!.members).not.toContain(others[25]!);
    expect(groups[0]!.eligible).toContain(others[25]!);
    // A team already on an alliance is never a backup: no confirmed pick of any alliance is eligible anywhere.
    const confirmedPicks = DIV1_ALLIANCES.flatMap((alliance) => alliance.picks);
    expect(confirmedPicks).toHaveLength(24);
    for (const pick of confirmedPicks) for (const group of groups) expect(group.eligible).not.toContain(pick);
    // The fixture gives that listed fourth its row at division 2's key, so it is the LISTING that names it in group 1:
    // a pick an alliance lists and has not confirmed is named row or no row. Every other team a group names has a row
    // at that group's division key.
    const rowAt = (teamKey: string, eventKey: string): boolean => DIVISIONED.teams.find((team) => team.teamKey === teamKey)!.eventPoints.some((row) => row.eventKey === eventKey);
    expect(rowAt(others[25]!, DIV1)).toBe(false);
    for (const key of groups[0]!.eligible) if (key !== others[25]!) expect(rowAt(key, DIV1), key).toBe(true);
    for (const key of groups[1]!.eligible) expect(rowAt(key, DIV2), key).toBe(true);
    // Reading P4: a team with no division row is named by no group. The proof then offers it every group's seats.
    expect(ROWLESS.size).toBeGreaterThan(0);
    for (const key of ROWLESS) for (const group of groups) expect(group.eligible).not.toContain(key);
    // Reading P3: the four listed picks of alive alliance 21, whose points are not posted, are all its members and all eligible in group 2.
    const alive = input.alliances.find((alliance) => alliance.allianceNumber === 21)!;
    expect(alive.members).toHaveLength(4);
    for (const member of alive.members) expect(groups[1]!.eligible).toContain(member);
    // The proof the status hands the tab is the bound over these groups.
    expect([...model.jointProof.locked].sort()).toEqual([...jointLockedTeams(input)].sort());
  });

  it("refuses unsupportedShape for three divisions", () => {
    const third = new Set(others.slice(0, 9));
    const three: DistrictArtifact = DistrictArtifactSchema.parse({
      ...DIVISIONED,
      teams: DIVISIONED.teams.map((team) => {
        if (!third.has(team.teamKey)) return team;
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === DIV2 ? { ...row, eventKey: "2026pncmp3" } : row);
        return { ...team, eventPoints: team.eventPoints.map(relabel), remainingEvents: team.remainingEvents.map(relabel) };
      }),
    });
    expect(modelAt(three, ROUND_FIVE_STAGES, roundFiveDistributions()).jointProof).toEqual({ applied: false, reason: "unsupportedShape" });
  });

  it("two championships: one input per championship, a no row pool team and a no row slot only rival in BOTH, locked by the summed bound", () => {
    const SECOND = "2026pnncmp";
    const noRow = FIXTURE.teams.filter((team) => team.eventPoints.every((row) => row.tier !== "dcmp") && team.remainingEvents.every((row) => row.tier !== "dcmp")).map((team) => team.teamKey);
    const prequalified = noRow[0]!;
    const TWO: DistrictArtifact = DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team, index) => {
        const base = team.teamKey === prequalified ? { ...team, champLock: { ...team.champLock, status: "prequalified" as const } } : team;
        if (index % 2 === 0) return base;
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: SECOND } : row);
        return { ...base, eventPoints: base.eventPoints.map(relabel), remainingEvents: base.remainingEvents.map(relabel), qualifyingAwards: base.qualifyingAwards.map(relabel) };
      }),
    });
    const stages = new Map([
      [PARENT, OPEN_PLAYOFFS],
      [SECOND, OPEN_PLAYOFFS],
    ]);
    const milestones = dcmpBracketMilestonesByTeam(DIV1_ALLIANCES, ROUND_FIVE);
    const distributions = (both: boolean) =>
      new Map([
        entry(PARENT, facts(PARENT, OPEN_PLAYOFFS, DIV1_ALLIANCES, ROUND_FIVE, "championship"), milestones),
        entry(SECOND, both ? facts(SECOND, OPEN_PLAYOFFS, DIV1_ALLIANCES, ROUND_FIVE, "championship") : undefined, milestones),
      ]);
    const model = modelAt(TWO, stages, distributions(true));
    if (model.jointProof?.applied !== true || model.jointProof.shape !== "multiple") throw new Error(`not multiple: ${JSON.stringify(model.jointProof)}`);
    const [first, second] = model.jointProof.championships;
    expect(model.jointProof.championships).toHaveLength(2);
    // 261009-pgq D3 leaves this shape alone: each championship keeps its own judged budget of 14.
    expect(first!.judgedAwards).toBe(14);
    expect(second!.judgedAwards).toBe(14);
    const poolTeamWithNoRow = noRow.find((key) => key !== prequalified && first!.pool.some((rival) => rival.teamKey === key))!;
    expect(poolTeamWithNoRow).toBeDefined();
    expect(second!.pool.some((rival) => rival.teamKey === poolTeamWithNoRow)).toBe(true);
    expect(first!.slotOnlyRivals).toContain(prequalified);
    expect(second!.slotOnlyRivals).toContain(prequalified);
    // A team whose championship is the second is in the second input only.
    const atSecond = TWO.teams.find((team) => team.eventPoints.some((row) => row.eventKey === SECOND) && second!.pool.some((rival) => rival.teamKey === team.teamKey))!.teamKey;
    expect(first!.pool.some((rival) => rival.teamKey === atSecond)).toBe(false);
    // Confirmed pick membership on each championship (orchestrator decision): a pick with no points at the key is no member there.
    for (const input of [first!, second!]) for (const alliance of input.alliances) expect(alliance.spareSeats).toBe(MAX_WINNING_ALLIANCE_SIZE - alliance.members.length);
    // Quick task 261009-tx9 leaves this shape alone: no seat groups, so each championship's bound is the shipped one.
    expect(first!.seatGroups).toBeUndefined();
    expect(second!.seatGroups).toBeUndefined();
    expect([...model.jointProof.locked].sort()).toEqual([...jointLockedTeamsMultiple(model.jointProof.championships, model.pointsSlots)].sort());
    expect(modelAt(TWO, stages, distributions(false)).jointProof).toEqual({ applied: false, reason: "noBracketFacts" });
  });

  it("the single path keeps confirmed pick membership: with every DCMP alliance point removed no pick is a member and every alliance has four seats", () => {
    const noPoints: DistrictArtifact = DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => (row.eventKey === PARENT ? { ...row, alliance: 0 } : row)) })),
    });
    const model = modelAt(noPoints, new Map([[PARENT, OPEN_PLAYOFFS]]), new Map([entry(PARENT, facts(PARENT, OPEN_PLAYOFFS, DIV1_ALLIANCES, [], "championship"))]));
    if (model.jointProof?.applied !== true || model.jointProof.shape !== "single") throw new Error("not single");
    for (const alliance of model.jointProof.input.alliances) {
      expect(alliance.members).toEqual([]);
      expect(alliance.spareSeats).toBe(4);
    }
    // Quick task 261009-tx9 leaves the single shape alone: no seat groups.
    expect(model.jointProof.input.seatGroups).toBeUndefined();
  });
});

/**
 * Quick task 261010-66y: what the status module does while the field is NOT
 * proven at the live position. The fixture is the committed PNW district with
 * part of its championship field taken off the rows, which is what the
 * artifact holds while TBA has posted one event of a championship and not the
 * rest. The flag itself is the row model's (`rows.fieldProven`); here it is
 * handed in both ways.
 */
describe("computeChampLedgerStatuses — while the field is not proven (quick task 261010-66y)", () => {
  const DCMP_KEY = "2026pncmp";
  const dcmpCeilings = maxEventPoints(FIXTURE.year, "dcmp");
  const DCMP_MAX = dcmpCeilings.qual + dcmpCeilings.alliance + dcmpCeilings.elim + dcmpCeilings.award;
  const AWARD_SLOTS = pendingAwardSlots(dcmpAwardCountCeilings(FIXTURE.year, FIXTURE.districtKey, FIXTURE.cmpSlots!).counts);
  const WHOLE_CHAMPIONSHIP = AWARD_SLOTS + MAX_WINNING_ALLIANCE_SIZE;
  const FIELD = FIXTURE.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === DCMP_KEY)).map((team) => team.teamKey);

  /** The fixture with only every `keepEvery`th team of the field still carrying its championship row, its points and its awards there. */
  function partlyPosted(keepEvery: number, dcmpSlots: number): DistrictArtifact {
    const kept = new Set(FIELD.filter((_, index) => index % keepEvery === 0));
    return DistrictArtifactSchema.parse({
      ...FIXTURE,
      dcmpSlots,
      teams: FIXTURE.teams.map((team) => {
        const row = team.eventPoints.find((entry) => entry.eventKey === DCMP_KEY);
        if (row === undefined || kept.has(team.teamKey)) return team;
        return {
          ...team,
          pointTotal: team.pointTotal - row.total,
          eventPoints: team.eventPoints.filter((entry) => entry.eventKey !== DCMP_KEY),
          qualifyingAwards: team.qualifyingAwards.filter((award) => award.eventKey !== DCMP_KEY),
        };
      }),
    });
  }
  const HALF = partlyPosted(2, FIXTURE.dcmpSlots!);
  const POSTED_IN_HALF = HALF.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === DCMP_KEY)).length;
  const UNPOSTED = FIELD.filter((_, index) => index % 2 === 1);

  /** The championship mid qualification at the live position, every district event final. */
  function modelOf(artifact: DistrictArtifact, fieldProven: boolean | undefined, extra: Partial<Parameters<typeof computeChampLedgerStatuses>[0]> = {}) {
    const stageByEvent = new Map(eventKeysOf(artifact).map((key) => [key, key === DCMP_KEY ? ALL_OPEN : ALL_FINAL] as const));
    const rows = buildChampLedgerRows({
      artifact,
      distributions: new Map(),
      stageByEvent,
      startedDcmpEventKeys: new Set([DCMP_KEY]),
      atLivePosition: true,
      nowYear: 2026,
      ...(fieldProven === undefined ? {} : { fieldProven }),
    });
    return { rows, status: computeChampLedgerStatuses({ artifact, teams: rows.teams, nowYear: 2026, ...(fieldProven === undefined ? {} : { fieldProven }), ...extra }) };
  }

  it("premise: half the field is on the rows, which does not prove a field of 50, and the row model says so by itself", () => {
    expect(FIELD).toHaveLength(51);
    expect(POSTED_IN_HALF).toBe(26);
    expect(HALF.dcmpSlots).toBe(50);
    expect(champFieldProofAtNow(HALF, new Set([DCMP_KEY]), 2026)).toMatchObject({ proven: false, unprovenAfterStart: true, postedTeams: 26, tolerance: 13 });
    // Left to itself the row model reads the flag off the artifact.
    expect(modelOf(HALF, undefined).rows.fieldProven).toBe(false);
    expect(modelOf(FIXTURE, undefined).rows.fieldProven).toBe(true);
  });

  it("a team with no row keeps one whole hypothetical championship and a finals on top, unless the district tier has locked it out", () => {
    const lockedOut = UNPOSTED[0]!;
    const { rows, status } = modelOf(HALF, false, { districtLockedOut: new Set([lockedOut]) });
    const membership = new Map(rows.teams.map((team) => [team.teamKey, team.membership] as const));
    for (const teamKey of UNPOSTED) {
      expect({ teamKey, membership: membership.get(teamKey) }).toEqual({ teamKey, membership: "open" });
      const open = status.ceilingByTeam!.get(teamKey)! - status.floorByTeam!.get(teamKey)!;
      // One whole championship, and the whole dcmp Playoffs ceiling again
      // for a finals: what the team will carry once its division's rows land.
      expect({ teamKey, open }).toEqual({ teamKey, open: teamKey === lockedOut ? 0 : DCMP_MAX + dcmpCeilings.elim });
    }
    expect(DCMP_MAX + dcmpCeilings.elim).toBe(249 + 90);
    // With the field read as proven the same teams are out and carry nothing.
    const proven = modelOf(HALF, true);
    for (const teamKey of UNPOSTED) {
      expect(proven.rows.teams.find((team) => team.teamKey === teamKey)!.membership).toBe("out");
      expect(proven.status.ceilingByTeam!.get(teamKey)).toBe(proven.status.floorByTeam!.get(teamKey));
    }
  });

  it("holds back the known championship and one more whole championship, and only the known one once the field is proven", () => {
    // 50 slots against a largest posted key of 26 teams: two events may exist, one is known.
    expect(unseenChampionshipsHeld(HALF.teams, HALF.dcmpSlots)).toBe(1);
    expect(modelOf(HALF, false).status.reservedSlots).toBe(2 * WHOLE_CHAMPIONSHIP);
    expect(modelOf(HALF, true).status.reservedSlots).toBe(WHOLE_CHAMPIONSHIP);
    expect(modelOf(HALF, undefined).status.reservedSlots).toBe(WHOLE_CHAMPIONSHIP);
  });

  it("D11: three championships of equal size with one posted holds two more, three whole championships in all", () => {
    const THIRD = partlyPosted(3, 51);
    const posted = THIRD.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === DCMP_KEY)).length;
    expect(posted).toBe(17);
    expect(unseenChampionshipsHeld(THIRD.teams, THIRD.dcmpSlots)).toBe(2);
    expect(modelOf(THIRD, false).status.reservedSlots).toBe(3 * WHOLE_CHAMPIONSHIP);
    expect(modelOf(THIRD, true).status.reservedSlots).toBe(WHOLE_CHAMPIONSHIP);
  });

  it("refuses the joint proof as fieldNotProven, after noDistributions and before the shape is read", () => {
    expect(modelOf(HALF, false).status.jointProof).toEqual({ applied: false, reason: "noDistributions" });
    expect(modelOf(HALF, false, { distributions: new Map() }).status.jointProof).toEqual({ applied: false, reason: "fieldNotProven" });
    // Proven, the next precondition answers as it always did.
    expect(modelOf(HALF, true, { distributions: new Map() }).status.jointProof).toEqual({ applied: false, reason: "noBracketFacts" });
  });

  it("locks no more teams while the field is not proven than once it reads proven", () => {
    const held = (model: ReturnType<typeof modelOf>): string[] => [...model.status.byTeam.values()].filter((result) => result.status === "locked").map((result) => result.teamKey).sort();
    const unproven = held(modelOf(HALF, false));
    const proven = new Set(held(modelOf(HALF, true)));
    for (const teamKey of unproven) expect(proven.has(teamKey)).toBe(true);
    expect(unproven.length).toBeLessThanOrEqual(proven.size);
  });

  it("R21: while the field is not proven a division team with no finals row carries the whole dcmp Playoffs ceiling for the finals", () => {
    const WHOLE = dcmpCeilings.elim;
    expect(WHOLE).toBe(90);
    // A lone division: no finals ceiling at all while proven, the whole ceiling while not.
    expect(champFinalsCeilingWithoutRow(["2026micmp1"], ["2026micmp1"], 2026, new Map())).toBe(0);
    expect(champFinalsCeilingWithoutRow(["2026micmp1"], ["2026micmp1"], 2026, new Map(), true)).toBe(0);
    expect(champFinalsCeilingWithoutRow(["2026micmp1"], ["2026micmp1"], 2026, new Map(), false)).toBe(WHOLE);
    // Two of four divisions known: the two division maximum while proven, the whole ceiling while not.
    const TWO_OF_FOUR = ["2026micmp1", "2026micmp2"];
    expect(champFinalsCeilingWithoutRow(["2026micmp1"], TWO_OF_FOUR, 2026, new Map())).toBe(30);
    expect(champFinalsCeilingWithoutRow(["2026micmp1"], TWO_OF_FOUR, 2026, new Map(), false)).toBe(WHOLE);
    // Four known: 60 while proven, the whole ceiling while not.
    const FOUR = ["2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
    expect(champFinalsCeilingWithoutRow(["2026micmp3"], FOUR, 2026, new Map())).toBe(60);
    expect(champFinalsCeilingWithoutRow(["2026micmp3"], FOUR, 2026, new Map(), false)).toBe(WHOLE);
    // Never for a key that is its own stem, a team with a finals source, or finals Playoffs that are final.
    expect(champFinalsCeilingWithoutRow(["2026cancmp"], ["2026cancmp"], 2026, new Map(), false)).toBe(0);
    expect(champFinalsCeilingWithoutRow(["2026micmp1", "2026micmp"], ["2026micmp", "2026micmp1"], 2026, new Map(), false)).toBe(0);
    expect(champFinalsCeilingWithoutRow(["2026micmp1"], ["2026micmp", "2026micmp1"], 2026, new Map([["2026micmp", ALL_FINAL]]), false)).toBe(0);
  });

  it("R21 in the status model: a lone division's team carries its division's open ceilings and the whole Playoffs ceiling for the finals", () => {
    const LONE = "2026pncmp1";
    const relabelled: DistrictArtifact = DistrictArtifactSchema.parse({
      ...HALF,
      teams: HALF.teams.map((team) => {
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === DCMP_KEY ? { ...row, eventKey: LONE } : row);
        return { ...team, eventPoints: team.eventPoints.map(relabel), qualifyingAwards: team.qualifyingAwards.map(relabel) };
      }),
    });
    const at = (fieldProven: boolean) => {
      const stageByEvent = new Map(eventKeysOf(relabelled).map((key) => [key, key === LONE ? ALL_OPEN : ALL_FINAL] as const));
      const rows = buildChampLedgerRows({ artifact: relabelled, distributions: new Map(), stageByEvent, startedDcmpEventKeys: new Set([LONE]), atLivePosition: true, nowYear: 2026, fieldProven });
      return computeChampLedgerStatuses({ artifact: relabelled, teams: rows.teams, nowYear: 2026, fieldProven });
    };
    const posted = relabelled.teams.find((team) => team.eventPoints.some((row) => row.eventKey === LONE))!.teamKey;
    const openOf = (model: ReturnType<typeof at>, teamKey: string): number => model.ceilingByTeam!.get(teamKey)! - model.floorByTeam!.get(teamKey)!;
    const open = (model: ReturnType<typeof at>): number => openOf(model, posted);
    expect(open(at(false))).toBe(DCMP_MAX + dcmpCeilings.elim);
    expect(open(at(true))).toBe(DCMP_MAX);

    // A TEAM'S CEILING CANNOT RISE WHEN ITS DIVISION'S ROWS LAND. While the
    // field is not proven a team still on no row carries exactly what a team
    // carries the moment its division row lands wholly open: one whole
    // championship and the whole Playoffs ceiling for a finals. Before the
    // finals part was added the row landing raised the ceiling by 90, and on
    // 2026 FIM that took Locked back (3, 3 and 2 from starts with no, one
    // and two divisions final: `scripts/champFieldStagedWalk.test.ts`).
    const rowless = UNPOSTED[1]!;
    expect(relabelled.teams.find((team) => team.teamKey === rowless)!.eventPoints.every((row) => row.tier !== "dcmp")).toBe(true);
    expect(openOf(at(false), rowless)).toBe(open(at(false)));
  });

  it("with fieldProven absent or true the committed fixture's model is the same model", () => {
    const stages = [ALL_FINAL_STAGES, new Map(eventKeysOf(FIXTURE).map((key) => [key, key === DCMP_KEY ? ALL_OPEN : ALL_FINAL] as const))];
    for (const stageByEvent of stages) {
      const rows = buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent, dcmpStarted: true });
      const absent = computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams, nowYear: 2026, distributions: new Map() });
      const supplied = computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams, nowYear: 2026, distributions: new Map(), fieldProven: true });
      expect(supplied).toEqual(absent);
    }
    expect(computeChampLedgerStatuses({ artifact: FIXTURE, teams: FINISHED.rows.teams, fieldProven: true })).toEqual(FINISHED.status);
  });
});

