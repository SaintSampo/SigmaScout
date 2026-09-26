/**
 * The predicted cutoff, pinned END TO END against
 * `data/fixtures/phase10/district-2026pnw.json` at a position where every
 * category of all nine events is final, and pinned STRUCTURALLY over a seeded
 * sweep of random pools.
 *
 * THE FIXTURE CARRIES NO `state` BLOCKS, so the all-final `stageByEvent` is
 * supplied explicitly for all nine event keys — `champLedgerStatus.test.ts`'s
 * own `repoFile`/`ALL_FINAL`/`eventKeysOf` harness, reused verbatim.
 *
 * Both tab pins below are RECORDED FACTS rather than hopes: they were measured
 * against the real row builders and the real status modules before the plan was
 * written, and the district pin's non equality with the published insight is
 * pinned WITH its reason rather than papered over.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { mulberry32 } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import { pointsRaceSlots, type QualifierSets } from "../../../../../packages/core/districts/locks.js";
import { buildChampLedgerRows } from "./champLedgerRows.js";
import { computeChampLedgerStatuses } from "./champLedgerStatus.js";
import { buildDistrictLedgerRows, type DistrictStageFinality } from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import { predictedCutoff, simulatedCutoffRange, type CutoffRankingTeam } from "./predictedCutoff.js";

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

function eventKeysOf(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) keys.add(row.eventKey);
    for (const row of team.remainingEvents) keys.add(row.eventKey);
  }
  return [...keys].sort();
}

const ALL_FINAL_STAGES = new Map(eventKeysOf(FIXTURE).map((key) => [key, ALL_FINAL] as const));

const CHAMP = (() => {
  const rows = buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent: ALL_FINAL_STAGES, dcmpStarted: true });
  const status = computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams });
  return { rows, status };
})();

const DISTRICT = (() => {
  const rows = buildDistrictLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent: ALL_FINAL_STAGES });
  const status = computeDistrictLedgerStatuses({ artifact: FIXTURE, teams: rows.teams });
  return { rows, status };
})();

function qualifiersOf(awardQualified: readonly string[], prequalified: readonly string[]): QualifierSets {
  return { awardQualified: new Set(awardQualified), prequalified: new Set(prequalified) };
}

describe("predictedCutoff — the champ tab, all nine events final", () => {
  const cutoff = predictedCutoff({
    teams: CHAMP.rows.teams,
    capacity: FIXTURE.cmpSlots,
    qualifiers: qualifiersOf(CHAMP.status.awardQualified, CHAMP.status.prequalified),
    reservedSlots: CHAMP.status.reservedSlots,
  });

  it("races 13 points slots, 21 championship slots less the eight award qualifiers", () => {
    expect(FIXTURE.cmpSlots).toBe(21);
    expect(CHAMP.status.awardQualified).toHaveLength(8);
    expect(CHAMP.status.pointsSlots).toBe(13);
  });

  it("takes its boundary pair from pool ranks 13 and 14, both at 182", () => {
    expect(cutoff.kind).toBe("final");
    if (cutoff.kind !== "final") throw new Error("expected a final cutoff");
    expect(cutoff.boundary).toEqual({ above: 182, below: 182 });
  });

  it("prints 182, which is exactly the artifact's own cmpCutLinePoints", () => {
    if (cutoff.kind !== "final") throw new Error("expected a final cutoff");
    expect(cutoff.points).toBe(182);
    expect(cutoff.points).toBe(FIXTURE.insights.cmpCutLinePoints);
  });

  it("reports final, because every pool team is settled at this position", () => {
    expect(cutoff.kind).toBe("final");
  });
});

describe("predictedCutoff — the district tab, all nine events final", () => {
  const cutoff = predictedCutoff({
    teams: DISTRICT.rows.teams,
    capacity: FIXTURE.dcmpSlots,
    qualifiers: qualifiersOf(DISTRICT.status.awardQualified, DISTRICT.status.prequalified),
    reservedSlots: DISTRICT.status.reservedSlots,
  });

  it("races 42 points slots, 50 district championship slots less the eight award qualifiers", () => {
    expect(FIXTURE.dcmpSlots).toBe(50);
    expect(DISTRICT.status.awardQualified).toHaveLength(8);
    expect(DISTRICT.status.reservedSlots).toBe(0);
    // `locks.ts`'s own narrowing, asked the same question the cutoff asks it.
    const narrowing = pointsRaceSlots(
      DISTRICT.rows.teams.map((team) => team.teamKey),
      FIXTURE.dcmpSlots!,
      qualifiersOf(DISTRICT.status.awardQualified, DISTRICT.status.prequalified),
      DISTRICT.status.reservedSlots
    );
    expect(narrowing.pointsSlots).toBe(42);
    expect(narrowing.poolKeys).toHaveLength(118);
  });

  it("takes its boundary pair from pool ranks 42 and 43, at 60 and 57", () => {
    expect(cutoff.kind).toBe("final");
    if (cutoff.kind !== "final") throw new Error("expected a final cutoff");
    expect(cutoff.boundary).toEqual({ above: 60, below: 57 });
  });

  it("prints 59, the midpoint of 60 and 57 rounded up from 58.5", () => {
    if (cutoff.kind !== "final") throw new Error("expected a final cutoff");
    expect(cutoff.points).toBe(59);
  });

  it("is deliberately NOT insights.dcmpCutLinePoints, because the published insight ranks the all tier pointTotal while this tab's grand total is district tier only, so the two describe different races", () => {
    if (cutoff.kind !== "final") throw new Error("expected a final cutoff");
    expect(FIXTURE.insights.dcmpCutLinePoints).toBe(82);
    expect(cutoff.points).not.toBe(FIXTURE.insights.dcmpCutLinePoints);
    // The tier mismatch, shown rather than asserted in prose: the artifact's
    // own all-tier total for the team at pool rank 42 includes its District
    // Championship points, which this tab's grand total drops by construction.
    const districtOnlyTotals = DISTRICT.rows.teams.map((team) => team.projection);
    const allTierTotals = DISTRICT.rows.teams.map(
      (team) => FIXTURE.teams.find((source) => source.teamKey === team.teamKey)!.pointTotal
    );
    expect(allTierTotals.some((total, index) => total !== districtOnlyTotals[index])).toBe(true);
  });

  it("reports final, because every pool team is settled at this position", () => {
    expect(cutoff.kind).toBe("final");
  });
});

// ---------------------------------------------------------------------------
// The between property, over a seeded sweep
// ---------------------------------------------------------------------------

const NO_QUALIFIERS: QualifierSets = { awardQualified: new Set<string>(), prequalified: new Set<string>() };

/** A synthetic pool in the tab's own sorted order: descending by projection, integer medians as a points race produces. */
function randomPool(rng: () => number, size: number): CutoffRankingTeam[] {
  const projections: number[] = [];
  for (let i = 0; i < size; i++) projections.push(Math.round(rng() * 140));
  projections.sort((a, b) => b - a);
  return projections.map((projection, index) => ({
    teamKey: `frc${String(index + 1)}`,
    projection,
    hasOpenCategory: true,
  }));
}

describe("predictedCutoff — the between property over 240 seeded random pools", () => {
  it("sits between the two groups under the district tab's >= cut line rule and the champ tab's pool rank rule alike", () => {
    const rng = mulberry32(0x5e_ed_37);
    let sweptPredicted = 0;
    let sweptAbsent = 0;
    let tied = 0;
    let differed = 0;

    for (let trial = 0; trial < 240; trial++) {
      const size = 2 + Math.floor(rng() * 30);
      const teams = randomPool(rng, size);
      const capacity = Math.floor(rng() * (size + 3));
      const cutoff = predictedCutoff({ teams, capacity, qualifiers: NO_QUALIFIERS, reservedSlots: 0 });

      if (cutoff.kind === "absent") {
        sweptAbsent += 1;
        // The refusal's own claim: no team is Out of range here.
        expect(capacity === 0 || teams.length <= capacity).toBe(true);
        continue;
      }
      if (cutoff.kind === "capacityUnknown") throw new Error("a numeric capacity never reports capacityUnknown");
      sweptPredicted += 1;

      const slots = capacity;
      // RULE ONE — the champ tab: In range is the first `slots` of the pool.
      const inRangeByRank = teams.slice(0, slots);
      const outOfRangeByRank = teams.slice(slots);
      for (const team of inRangeByRank) expect(team.projection).toBeGreaterThanOrEqual(cutoff.points);
      for (const team of outOfRangeByRank) expect(team.projection).toBeLessThanOrEqual(cutoff.points);

      // RULE TWO — the district tab: In range is `>=` the slot-th highest
      // projection. It cuts the same sorted order at the same place, widened
      // only by a tie AT the line, which is on the In range side either way.
      const line = teams[slots - 1]!.projection;
      for (const team of teams) {
        if (team.projection >= line) expect(team.projection).toBeGreaterThanOrEqual(cutoff.points);
        else expect(team.projection).toBeLessThanOrEqual(cutoff.points);
      }

      if (cutoff.boundary.above === cutoff.boundary.below) {
        tied += 1;
        expect(cutoff.points).toBe(cutoff.boundary.above);
      } else {
        differed += 1;
        // Strictly between WHENEVER A WHOLE NUMBER FITS. Two adjacent integers
        // have no whole number between them, and the cutoff is then the nearer
        // end rather than a fraction — the one case where the strict form is
        // arithmetically impossible.
        if (cutoff.boundary.above - cutoff.boundary.below >= 2) {
          expect(cutoff.points).toBeGreaterThan(cutoff.boundary.below);
          expect(cutoff.points).toBeLessThan(cutoff.boundary.above);
        }
        expect(cutoff.points).toBeGreaterThanOrEqual(cutoff.boundary.below);
        expect(cutoff.points).toBeLessThanOrEqual(cutoff.boundary.above);
      }
    }

    // The sweep actually swept both sides.
    expect(sweptPredicted).toBeGreaterThan(150);
    expect(sweptAbsent).toBeGreaterThan(0);
    expect(tied).toBeGreaterThan(0);
    expect(differed).toBeGreaterThan(0);
  });

  it("keeps the between property on continuous medians wherever a whole number fits between the pair", () => {
    const rng = mulberry32(0x5e_ed_38);
    let checked = 0;
    for (let trial = 0; trial < 240; trial++) {
      const size = 2 + Math.floor(rng() * 20);
      const projections: number[] = [];
      for (let i = 0; i < size; i++) projections.push(rng() * 140);
      projections.sort((a, b) => b - a);
      const teams: CutoffRankingTeam[] = projections.map((projection, index) => ({
        teamKey: `frc${String(index + 1)}`,
        projection,
        hasOpenCategory: true,
      }));
      const capacity = 1 + Math.floor(rng() * (size - 1));
      const cutoff = predictedCutoff({ teams, capacity, qualifiers: NO_QUALIFIERS, reservedSlots: 0 });
      if (cutoff.kind !== "predicted") continue;
      if (Math.ceil(cutoff.boundary.below) > Math.floor(cutoff.boundary.above)) continue;
      checked += 1;
      for (const team of teams.slice(0, capacity)) expect(team.projection).toBeGreaterThanOrEqual(cutoff.points);
      for (const team of teams.slice(capacity)) expect(team.projection).toBeLessThanOrEqual(cutoff.points);
    }
    expect(checked).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// The three refusals
// ---------------------------------------------------------------------------

describe("predictedCutoff — the three refusals", () => {
  const teams: CutoffRankingTeam[] = [
    { teamKey: "frc1", projection: 90, hasOpenCategory: true },
    { teamKey: "frc2", projection: 70, hasOpenCategory: true },
    { teamKey: "frc3", projection: 50, hasOpenCategory: false },
  ];

  it("reports capacityUnknown for an unpublished capacity", () => {
    const cutoff = predictedCutoff({ teams, capacity: null, qualifiers: NO_QUALIFIERS, reservedSlots: 0 });
    expect(cutoff.kind).toBe("capacityUnknown");
  });

  it("reports absent where the pool holds no more teams than there are points slots", () => {
    expect(predictedCutoff({ teams, capacity: 3, qualifiers: NO_QUALIFIERS, reservedSlots: 0 }).kind).toBe("absent");
    expect(predictedCutoff({ teams, capacity: 9, qualifiers: NO_QUALIFIERS, reservedSlots: 0 }).kind).toBe("absent");
  });

  it("reports absent where the award qualifiers have taken every slot", () => {
    const qualifiers = qualifiersOf(["frc1", "frc2"], []);
    const cutoff = predictedCutoff({ teams, capacity: 2, qualifiers, reservedSlots: 0 });
    expect(cutoff.kind).toBe("absent");
  });

  it("reads pointsSlots and not lockSlots, so a reservation never moves the line", () => {
    const wide: CutoffRankingTeam[] = [
      { teamKey: "frc1", projection: 90, hasOpenCategory: true },
      { teamKey: "frc2", projection: 70, hasOpenCategory: true },
      { teamKey: "frc3", projection: 50, hasOpenCategory: true },
      { teamKey: "frc4", projection: 30, hasOpenCategory: true },
    ];
    const unreserved = predictedCutoff({ teams: wide, capacity: 2, qualifiers: NO_QUALIFIERS, reservedSlots: 0 });
    const reserved = predictedCutoff({ teams: wide, capacity: 2, qualifiers: NO_QUALIFIERS, reservedSlots: 1 });
    expect(reserved).toEqual(unreserved);
    if (unreserved.kind !== "predicted") throw new Error("expected a predicted cutoff");
    expect(unreserved.points).toBe(60);
  });

  it("reports final only where every pool team is settled", () => {
    const settled: CutoffRankingTeam[] = [
      { teamKey: "frc1", projection: 90, hasOpenCategory: false },
      { teamKey: "frc2", projection: 70, hasOpenCategory: false },
    ];
    expect(predictedCutoff({ teams: settled, capacity: 1, qualifiers: NO_QUALIFIERS, reservedSlots: 0 }).kind).toBe("final");
    const open = settled.map((team, index) => ({ ...team, hasOpenCategory: index === 1 }));
    expect(predictedCutoff({ teams: open, capacity: 1, qualifiers: NO_QUALIFIERS, reservedSlots: 0 }).kind).toBe("predicted");
  });
});

// ---------------------------------------------------------------------------
// The likely range
// ---------------------------------------------------------------------------

describe("simulatedCutoffRange", () => {
  it("reads the shipped percentile convention off a counting histogram of the run cutoffs", () => {
    // Ten runs, one at each of 55 to 64. The continuous estimator's own edges.
    const runs = Float64Array.from([55, 56, 57, 58, 59, 60, 61, 62, 63, 64]);
    const range = simulatedCutoffRange(runs, 10);
    expect(range).toBeDefined();
    expect(range!.p10).toBeCloseTo(55.5, 6);
    expect(range!.p90).toBeCloseTo(63.5, 6);
  });

  it("collapses to one value where every run landed on the same line", () => {
    const runs = Float64Array.from([60, 60, 60, 60]);
    const range = simulatedCutoffRange(runs, 4);
    expect(range).toBeDefined();
    expect(Math.round(range!.p10)).toBe(60);
    expect(Math.round(range!.p90)).toBe(60);
  });

  it("returns undefined for an absent array, an empty array and a disagreeing draw count", () => {
    expect(simulatedCutoffRange(undefined, 1000)).toBeUndefined();
    expect(simulatedCutoffRange(new Float64Array(0), 1000)).toBeUndefined();
    expect(simulatedCutoffRange(Float64Array.from([60, 61]), 1000)).toBeUndefined();
    expect(simulatedCutoffRange(Float64Array.from([60, 61]), 0)).toBeUndefined();
  });
});
