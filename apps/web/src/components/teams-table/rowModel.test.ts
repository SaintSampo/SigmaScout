import { describe, expect, it } from "vitest";
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { TOTAL_KEY } from "../../lib/metricKeys.js";
import { buildTeamRows, sortTeamRows, winRate } from "./rowModel.js";

type ArtifactTeam = TeamsArtifact["teams"][number];

/** A minimal, valid `TeamsTableRowSchema`-shaped fixture row — every field a real row carries, overridable per test. */
function team(overrides: Partial<ArtifactTeam> = {}): ArtifactTeam {
  return {
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    eventCount: 3,
    matchCount: 30,
    record: { wins: 7, losses: 3, ties: 0 },
    metrics: { [TOTAL_KEY]: { value: 50, spread: 2 } },
    ...overrides,
  };
}

function artifact(teams: ArtifactTeam[]): TeamsArtifact {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-01-01T00:00:00Z",
    algorithmId: "sigma1",
    algorithmVersion: "1.0.0",
    season: 2026,
    teams,
  };
}

describe("winRate", () => {
  it("returns the win fraction for a normal record", () => {
    expect(winRate({ wins: 7, losses: 3, ties: 0 })).toBe(0.7);
  });

  it("returns null for a zero-match record — a rate over zero matches is undefined, not zero", () => {
    expect(winRate({ wins: 0, losses: 0, ties: 0 })).toBeNull();
  });

  it("returns a real zero for a 0-5-0 record, distinct from the null zero-match case", () => {
    expect(winRate({ wins: 0, losses: 5, ties: 0 })).toBe(0);
  });

  it("counts ties in the denominator but not the numerator", () => {
    expect(winRate({ wins: 1, losses: 1, ties: 1 })).toBeCloseTo(1 / 3);
  });
});

describe("buildTeamRows", () => {
  it("assigns rank 1 to the team with the highest total metric and increments from there", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 10 } } }),
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 30 } } }),
        team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 20 } } }),
      ]),
      "sigma1",
    );
    expect(rows.map((row) => [row.teamKey, row.rank])).toEqual([
      ["frc1", 1],
      ["frc3", 2],
      ["frc2", 3],
    ]);
  });

  it("breaks a rank tie by ascending team number, giving each tied team its own distinct consecutive rank", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc200", teamNumber: 200, metrics: { [TOTAL_KEY]: { value: 40 } } }),
        team({ teamKey: "frc100", teamNumber: 100, metrics: { [TOTAL_KEY]: { value: 40 } } }),
      ]),
      "sigma1",
    );
    expect(rows.map((row) => [row.teamKey, row.rank])).toEqual([
      ["frc100", 1],
      ["frc200", 2],
    ]);
    expect(rows[0]?.rank).not.toBe(rows[1]?.rank);
  });

  it("assigns a rank to every input row — the count of rows out equals the count of rows in", () => {
    const rows = buildTeamRows(
      artifact([team({ teamKey: "frc1", teamNumber: 1 }), team({ teamKey: "frc2", teamNumber: 2 }), team({ teamKey: "frc3", teamNumber: 3 })]),
      "sigma1",
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => typeof row.rank === "number")).toBe(true);
  });

  it("yields undefined for a cell whose metrics lack a declared key, rather than dropping the row or defaulting to zero", () => {
    const rows = buildTeamRows(artifact([team({ metrics: { [TOTAL_KEY]: { value: 10 } } })]), "sigma1");
    expect(rows[0]?.metrics.hubShift1).toBeUndefined();
  });

  it("sorts a row missing the total key last under a descending total sort, rather than throwing", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: {} }),
      ]),
      "sigma1",
    );
    expect(rows.map((row) => row.teamKey)).toEqual(["frc1", "frc2"]);
    expect(rows[1]?.rank).toBe(2);
  });

  it("returns an empty array for an empty team array, without throwing", () => {
    expect(buildTeamRows(artifact([]), "sigma1")).toEqual([]);
  });

  it("returns one row at rank 1 for a single-team array", () => {
    const rows = buildTeamRows(artifact([team()]), "sigma1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(1);
  });
});

describe("sortTeamRows", () => {
  it("orders by the given key descending and breaks ties by ascending team number", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 }, hubShift1: { value: 5 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 20 }, hubShift1: { value: 5 } } }),
        team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 30 }, hubShift1: { value: 9 } } }),
      ]),
      "sigma1",
    );
    const sorted = sortTeamRows(rows, "hubShift1", "desc");
    expect(sorted.map((row) => row.teamKey)).toEqual(["frc3", "frc1", "frc2"]);
  });

  it("produces identical output when called twice on the same input", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 20 } } }),
      ]),
      "sigma1",
    );
    const first = sortTeamRows(rows, TOTAL_KEY, "desc").map((row) => row.teamKey);
    const second = sortTeamRows(rows, TOTAL_KEY, "desc").map((row) => row.teamKey);
    expect(second).toEqual(first);
  });

  it("places rows missing the sort key last regardless of direction", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 20 }, hubShift1: { value: 4 } } }),
      ]),
      "sigma1",
    );
    const desc = sortTeamRows(rows, "hubShift1", "desc").map((row) => row.teamKey);
    const asc = sortTeamRows(rows, "hubShift1", "asc").map((row) => row.teamKey);
    expect(desc).toEqual(["frc2", "frc1"]);
    expect(asc).toEqual(["frc2", "frc1"]);
  });

  it("falls back to the tie-break alone, deterministically, when a key is absent from every row", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc200", teamNumber: 200, metrics: { [TOTAL_KEY]: { value: 10 } } }),
        team({ teamKey: "frc100", teamNumber: 100, metrics: { [TOTAL_KEY]: { value: 10 } } }),
      ]),
      "sigma1",
    );
    const sorted = sortTeamRows(rows, "no-such-key", "desc").map((row) => row.teamKey);
    expect(sorted).toEqual(["frc100", "frc200"]);
  });

  it("does not renumber ranks — rank stays a property of the artifact, not of the current sort", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 30 }, hubShift1: { value: 1 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 10 }, hubShift1: { value: 9 } } }),
      ]),
      "sigma1",
    );
    const sorted = sortTeamRows(rows, "hubShift1", "desc");
    expect(sorted.map((row) => [row.teamKey, row.rank])).toEqual([
      ["frc2", 2],
      ["frc1", 1],
    ]);
  });
});
