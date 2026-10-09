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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../../../../../packages/core/districts/locks.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { dcmpAwardCountCeilings } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import { MAX_WINNING_ALLIANCE_SIZE, pendingAwardSlots } from "../../../../../packages/core/districts/champReservedSlots.js";
import { buildChampLedgerRows } from "./champLedgerRows.js";
import { applyChampRangeState, computeChampLedgerStatuses, jointDecidedPlacementTopUp } from "./champLedgerStatus.js";
import { champCutoffView, type ChampRangeState } from "./champLedgerChances.js";
import { SHOW_SIMULATED_CHAMP_LIKELY_RANGE, predictedCutoff, type LedgerCutoffView } from "./predictedCutoff.js";
import { playoffPoints, type AllianceBracketMilestone, type PlayedBracketMatch } from "../../../../../packages/core/districts/bracket.js";
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
    expect(modelWithStages(ALL_FINAL, ALL_FINAL).status.reservedSlots).toBe(0);
    expect(modelWithStages(ALL_FINAL, { qual: true, alliance: true, elim: true, award: false }).status.reservedSlots).toBe(AWARD_SLOTS);
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
    expectRefusal(divisioned, divisionStop, distributionsWith(milestones, facts), "notSingleChampionship");

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
    if (model.jointProof?.applied !== true) return;
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
    if (model.jointProof?.applied !== true) return;
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
    if (model.jointProof?.applied !== true) return;
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
    if (withGap.jointProof?.applied !== true || complete.jointProof?.applied !== true) return;
    expect(withGap.jointProof.input.aliveAlliances).toContain(8);
    expect(complete.jointProof.input.aliveAlliances).not.toContain(8);
    expect(complete.jointProof.input.aliveAlliances).toEqual([1, 2, 3, 4, 5, 6]);
    expect(complete.jointProof.input.placementPoints).toEqual([75, 39, 21]);
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
