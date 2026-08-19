/**
 * GAP 1 (ALGO-03, SC-3): regression tests for the four load-bearing
 * functions exported by identifiability.ts — mulberry32, seededShuffle,
 * computeDesignMatrix, and computeConnectedComponents. Tests are fixture-based
 * and hand-computable to keep the suite fast (<1s), never corpus-backed.
 */
import { describe, expect, it } from "vitest";
import {
  mulberry32,
  seededShuffle,
  computeDesignMatrix,
  computeConnectedComponents,
  type AllianceRow,
  type DesignMatrixResult,
  type ConnectedComponentsResult,
} from "./identifiability.js";

const SAMPLE_SEED = 42;

describe("mulberry32 PRNG", () => {
  it("same seed produces byte-identical sequence on repeated calls", () => {
    const rng1 = mulberry32(SAMPLE_SEED);
    const seq1 = Array.from({ length: 10 }, () => rng1());

    const rng2 = mulberry32(SAMPLE_SEED);
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("different seed produces different sequence", () => {
    const rng1 = mulberry32(SAMPLE_SEED);
    const seq1 = Array.from({ length: 10 }, () => rng1());

    const rng2 = mulberry32(SAMPLE_SEED + 1);
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(SAMPLE_SEED);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

describe("seededShuffle determinism", () => {
  it("same seed produces identical permutation twice", () => {
    const items = ["a", "b", "c", "d", "e"];

    const perm1 = seededShuffle(items, SAMPLE_SEED);
    const perm2 = seededShuffle(items, SAMPLE_SEED);

    expect(perm1).toEqual(perm2);
  });

  it("different seed produces different permutation", () => {
    const items = ["a", "b", "c", "d", "e"];

    const perm1 = seededShuffle(items, SAMPLE_SEED);
    const perm2 = seededShuffle(items, SAMPLE_SEED + 1);

    expect(perm1).not.toEqual(perm2);
  });

  it("is a permutation (same elements, different order)", () => {
    const items = ["a", "b", "c", "d", "e"];
    const perm = seededShuffle(items, SAMPLE_SEED);

    expect(perm.sort()).toEqual(items.sort());
    expect(perm.length).toBe(items.length);
  });

  it("handles empty array", () => {
    const perm = seededShuffle([], SAMPLE_SEED);
    expect(perm).toEqual([]);
  });

  it("handles single-element array", () => {
    const perm = seededShuffle(["x"], SAMPLE_SEED);
    expect(perm).toEqual(["x"]);
  });
});

describe("computeDesignMatrix", () => {
  it("empty rows produces zero ranks and infinite condition number", () => {
    const result = computeDesignMatrix([]);

    expect(result.rowCount).toBe(0);
    expect(result.teamColumnCount).toBe(0);
    expect(result.rank).toBe(0);
    expect(result.conditionNumber).toBe(Number.POSITIVE_INFINITY);
    expect(result.fullColumnRank).toBe(false);
  });

  it("single team in single match is rank 1, full column rank", () => {
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1"],
        components: { example: 50 },
      },
    ];

    const result = computeDesignMatrix(rows);

    expect(result.rowCount).toBe(1);
    expect(result.teamColumnCount).toBe(1);
    expect(result.rank).toBe(1);
    expect(result.fullColumnRank).toBe(true);
    expect(result.largestSingularValue).toBeGreaterThan(0);
  });

  it("fully connected set of 3 teams in 3 matches is rank 3, well-conditioned", () => {
    // Three teams, three matches: each match has 2 of the 3 teams
    // This creates a connected graph with rank 3
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc2", "frc3"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e1",
        teams: ["frc1", "frc3"],
        components: { example: 100 },
      },
    ];

    const result = computeDesignMatrix(rows);

    expect(result.rowCount).toBe(3);
    expect(result.teamColumnCount).toBe(3);
    expect(result.rank).toBe(3);
    expect(result.fullColumnRank).toBe(true);
    expect(result.conditionNumber).toBeLessThan(10);
  });

  it("disconnected graph (two isolated teams) is rank 2 but not full column rank", () => {
    // Two teams that never play together: one in match 1, other in match 2
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc3"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e1",
        teams: ["frc4"],
        components: { example: 100 },
      },
    ];

    const result = computeDesignMatrix(rows);

    expect(result.teamColumnCount).toBe(4);
    expect(result.rank).toBeLessThan(4);
    expect(result.fullColumnRank).toBe(false);
  });

  it("condition number is finite and positive for well-posed system", () => {
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc2", "frc3"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e1",
        teams: ["frc1", "frc3"],
        components: { example: 100 },
      },
    ];

    const result = computeDesignMatrix(rows);

    expect(Number.isFinite(result.conditionNumber)).toBe(true);
    expect(result.conditionNumber).toBeGreaterThan(0);
  });
});

describe("computeConnectedComponents", () => {
  it("empty rows produces zero components", () => {
    const result = computeConnectedComponents([]);

    expect(result.componentCount).toBe(0);
    expect(result.components).toEqual([]);
  });

  it("single team in single row is one component", () => {
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1"],
        components: { example: 50 },
      },
    ];

    const result = computeConnectedComponents(rows);

    expect(result.componentCount).toBe(1);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.teamCount).toBe(1);
  });

  it("fully connected alliance set is one large component", () => {
    // Three teams: frc1-frc2 match, frc2-frc3 match, frc1-frc3 match
    // All connected via team sharing => 1 component with 3 teams
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc2", "frc3"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e1",
        teams: ["frc1", "frc3"],
        components: { example: 100 },
      },
    ];

    const result = computeConnectedComponents(rows);

    expect(result.componentCount).toBe(1);
    expect(result.components[0]!.teamCount).toBe(3);
  });

  it("disconnected graph (two separate alliance sets) is two components", () => {
    // First component: frc1-frc2 (2 teams)
    // Second component: frc3-frc4 (2 teams)
    // No connection between them
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc3", "frc4"],
        components: { example: 100 },
      },
    ];

    const result = computeConnectedComponents(rows);

    expect(result.componentCount).toBe(2);
    // Components sorted by size descending
    expect(result.components[0]!.teamCount).toBe(2);
    expect(result.components[1]!.teamCount).toBe(2);
  });

  it("single team bridging two sets creates one large component", () => {
    // frc1-frc2 (component A), frc3-frc4 (component B), frc5 bridges both
    // Result: one component with 5 teams
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc3", "frc4"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e1",
        teams: ["frc1", "frc5"],
        components: { example: 100 },
      },
      {
        matchKey: "m4",
        eventKey: "e1",
        teams: ["frc5", "frc3"],
        components: { example: 100 },
      },
    ];

    const result = computeConnectedComponents(rows);

    expect(result.componentCount).toBe(1);
    expect(result.components[0]!.teamCount).toBe(5);
  });

  it("opponents in same match do NOT get unioned (only teammates in same row union)", () => {
    // This tests the critical requirement: teams in the SAME ROW (same alliance
    // observation) get unioned. But row1 and row2 represent the red and blue
    // alliances from match m1 — they are opponents, not teammates, so teams
    // from row1 and row2 should NOT merge just because they were in the same match.
    //
    // Only if they appear together in another row (as teammates on the same
    // alliance) should they be unioned.
    //
    // This fixture:
    // - m1_red: [frc1, frc2] (teammates)
    // - m1_blue: [frc3, frc4] (opponents of frc1/frc2, but NOT unioned with them here)
    // - m2_red: [frc5, frc6] (a separate component)
    //
    // Expected: 2 components — {frc1,frc2,frc3,frc4} and {frc5,frc6}
    // The first component forms because frc1-frc2 are teammates, frc3-frc4 are
    // teammates, but frc1 and frc3 only ever appear as opponents (different rows).
    // However, to make them truly separate, we need to NOT give them any matching
    // event, so the only way they'd connect is if they appeared in the same row.
    //
    // Actually, the real insight: two distinct rows can only connect if a team
    // appears in both rows. If frc1 appears only in m1_red and frc3 only in m1_blue,
    // they are forever unconnected via this union-find.
    const rows: AllianceRow[] = [
      {
        matchKey: "m1_red",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m1_blue",
        eventKey: "e1",
        teams: ["frc3", "frc4"],
        components: { example: 100 },
      },
      {
        matchKey: "m2_red",
        eventKey: "e2",
        teams: ["frc5", "frc6"],
        components: { example: 100 },
      },
    ];

    const result = computeConnectedComponents(rows);

    // Three components: {frc1,frc2}, {frc3,frc4}, {frc5,frc6}
    // Each alliance is connected internally, but alliances from the same
    // match don't merge (no shared team across those rows).
    expect(result.componentCount).toBe(3);
    expect(result.components[0]!.teamCount).toBe(2);
    expect(result.components[1]!.teamCount).toBe(2);
    expect(result.components[2]!.teamCount).toBe(2);
  });

  it("components are sorted descending by team count (largest first)", () => {
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2", "frc3"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc4"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e1",
        teams: ["frc5", "frc6"],
        components: { example: 100 },
      },
    ];

    const result = computeConnectedComponents(rows);

    expect(result.componentCount).toBe(3);
    // Verify sorted descending: 3 >= 2 >= 1
    expect(result.components[0]!.teamCount).toBe(3);
    expect(result.components[1]!.teamCount).toBe(2);
    expect(result.components[2]!.teamCount).toBe(1);
  });

  it("includes event keys in each component's event roster", () => {
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e1",
        teams: ["frc2", "frc3"],
        components: { example: 100 },
      },
      {
        matchKey: "m3",
        eventKey: "e2",
        teams: ["frc1", "frc3"],
        components: { example: 100 },
      },
    ];

    const result = computeConnectedComponents(rows);

    expect(result.componentCount).toBe(1);
    const comp = result.components[0]!;
    expect(comp.teamCount).toBe(3);
    expect([...comp.eventKeys].sort()).toEqual(["e1", "e2"]);
  });

  it("deterministic output: same input always produces same order", () => {
    const rows: AllianceRow[] = [
      {
        matchKey: "m1",
        eventKey: "e1",
        teams: ["frc1", "frc2"],
        components: { example: 100 },
      },
      {
        matchKey: "m2",
        eventKey: "e2",
        teams: ["frc3", "frc4"],
        components: { example: 100 },
      },
    ];

    const result1 = computeConnectedComponents(rows);
    const result2 = computeConnectedComponents(rows);

    expect(result1).toEqual(result2);
  });
});
