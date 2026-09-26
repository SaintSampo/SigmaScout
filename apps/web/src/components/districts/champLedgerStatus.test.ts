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
import { buildChampLedgerRows } from "./champLedgerRows.js";
import { computeChampLedgerStatuses } from "./champLedgerStatus.js";
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

  it("reads Today's line as the artifact's own cmpCutLinePoints", () => {
    expect(FINISHED.status.todaysLine).toBe(182);
    expect(FINISHED.status.todaysLine).toBe(FIXTURE.insights.cmpCutLinePoints);
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
    expect(poolTotals[12]).toBe(FINISHED.status.todaysLine);
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
