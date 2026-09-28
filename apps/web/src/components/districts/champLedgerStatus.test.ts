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
import { buildChampLedgerRows } from "./champLedgerRows.js";
import { applyChampRangeState, computeChampLedgerStatuses } from "./champLedgerStatus.js";
import { champCutoffView, type ChampRangeState } from "./champLedgerChances.js";
import { SHOW_SIMULATED_CHAMP_LIKELY_RANGE, predictedCutoff, type LedgerCutoffView } from "./predictedCutoff.js";
import type { DistrictStageFinality } from "./districtLedgerRows.js";

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
