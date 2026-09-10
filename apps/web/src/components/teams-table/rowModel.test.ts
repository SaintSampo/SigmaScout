import { describe, expect, it } from "vitest";
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { SWING_METRIC_KEY } from "../../../../../packages/harness/swingFactor.js";
import { TOTAL_KEY } from "../../lib/metricKeys.js";
import { buildTeamRows, sortTeamRows, winRate, WIN_RATE_SORT_KEY } from "./rowModel.js";

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
    algorithmId: "bpr",
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
      "bpr",
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
      "bpr",
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
      "bpr",
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => typeof row.rank === "number")).toBe(true);
  });

  it("yields undefined for a cell whose metrics lack a declared key, rather than dropping the row or defaulting to zero", () => {
    const rows = buildTeamRows(artifact([team({ metrics: { [TOTAL_KEY]: { value: 10 } } })]), "bpr");
    expect(rows[0]?.metrics.hubShift1).toBeUndefined();
  });

  it("sorts a row missing the total key last under a descending total sort, rather than throwing", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: {} }),
      ]),
      "bpr",
    );
    expect(rows.map((row) => row.teamKey)).toEqual(["frc1", "frc2"]);
    expect(rows[1]?.rank).toBe(2);
  });

  it("returns an empty array for an empty team array, without throwing", () => {
    expect(buildTeamRows(artifact([]), "bpr")).toEqual([]);
  });

  it("returns one row at rank 1 for a single-team array", () => {
    const rows = buildTeamRows(artifact([team()]), "bpr");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(1);
  });
});

describe("buildTeamRows — derived group metrics (D-2/D-3, 260904-5zg)", () => {
  it("an EPA row's metrics carry a derived phaseAuto, summed from that row's own published components", () => {
    const rows = buildTeamRows(
      artifact([team({ metrics: { [TOTAL_KEY]: { value: 50 }, autoTower: { value: 3 }, hubAuto: { value: 5 } } })]),
      "epa",
    );
    expect(rows[0]?.metrics.phaseAuto).toEqual({ value: 8 });
  });

  it("a derived phaseAuto is SORTABLE — sortTeamRows orders by it exactly like a published metric key", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 }, autoTower: { value: 1 }, hubAuto: { value: 1 } } }),
        team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 10 }, autoTower: { value: 9 }, hubAuto: { value: 9 } } }),
      ]),
      "epa",
    );
    const sorted = sortTeamRows(rows, "phaseAuto", "desc").map((row) => row.teamKey);
    expect(sorted).toEqual(["frc2", "frc1"]);
  });

  it("a VPR row's already-published phaseAuto (with spread/percentile) survives byte-identical", () => {
    const publishedPhaseAuto = { value: 30, spread: 1.2, percentile: 90 };
    const rows = buildTeamRows(artifact([team({ metrics: { [TOTAL_KEY]: { value: 50 }, phaseAuto: publishedPhaseAuto } })]), "bpr");
    expect(rows[0]?.metrics.phaseAuto).toBe(publishedPhaseAuto);
  });
});

describe("buildTeamRows — swing tier (quick task 260909-tgf)", () => {
  it("a published row whose metrics carry a swing entry with a tier produces swingScore from the entry's value and swingTier from the entry's tier", () => {
    const rows = buildTeamRows(
      artifact([team({ metrics: { [TOTAL_KEY]: { value: 50 }, [SWING_METRIC_KEY]: { value: 8.42, tier: "legendary" } } })]),
      "bpr",
    );
    expect(rows[0]?.swingScore).toBe(8.42);
    expect(rows[0]?.swingTier).toBe("legendary");
  });

  it("a published row whose swing entry has no tier (Common, omitted on the wire by design) still produces swingTier 'common' -- the tier IS known, it is just the omitted one", () => {
    const rows = buildTeamRows(
      artifact([team({ metrics: { [TOTAL_KEY]: { value: 50 }, [SWING_METRIC_KEY]: { value: 8.42 } } })]),
      "bpr",
    );
    expect(rows[0]?.swingScore).toBe(8.42);
    expect(rows[0]?.swingTier).toBe("common");
  });

  it("a STALE row carrying only the top-level swingFactor and no swing metric entry produces swingScore from that field and swingTier undefined -- never a fabricated ring", () => {
    const rows = buildTeamRows(
      artifact([team({ swingFactor: 8.42, metrics: { [TOTAL_KEY]: { value: 50 } } })]),
      "bpr",
    );
    expect(rows[0]?.swingScore).toBe(8.42);
    expect(rows[0]?.swingTier).toBeUndefined();
  });

  it("a row with neither the swing metric entry nor the top-level swingFactor produces swingScore undefined and swingTier undefined", () => {
    const rows = buildTeamRows(artifact([team({ metrics: { [TOTAL_KEY]: { value: 50 } } })]), "bpr");
    expect(rows[0]?.swingScore).toBeUndefined();
    expect(rows[0]?.swingTier).toBeUndefined();
  });

  it("sorting by the published swing metric key still orders by VALUE ascending/descending exactly as before -- the tier does not reorder anything", () => {
    // `sortTeamRows` sorts by `row.metrics[key]?.value` for any key besides
    // the win-rate sentinel (see `sortValueFor`) -- it was never special-cased
    // for swing and this task does not add one. Because the published `swing`
    // entry is merged into the wire `metrics` record (Task 2), sorting by
    // `SWING_METRIC_KEY` already exercises the real generic path -- this pins
    // that a tier riding alongside the value on that SAME entry cannot leak
    // into the comparison, which is the one behaviour a direction change
    // could plausibly break by accident.
    const rows = buildTeamRows(
      artifact([
        team({
          teamKey: "frc1",
          teamNumber: 1,
          metrics: { [TOTAL_KEY]: { value: 10 }, [SWING_METRIC_KEY]: { value: 9, tier: "legendary" } },
        }),
        team({
          teamKey: "frc2",
          teamNumber: 2,
          metrics: { [TOTAL_KEY]: { value: 20 }, [SWING_METRIC_KEY]: { value: 3 } },
        }),
      ]),
      "bpr",
    );
    // frc2's swing VALUE (3) is lower than frc1's (9) despite frc1 carrying
    // the "better" (legendary) tier and frc2 the Common one -- sort order
    // must track the raw value, never the tier.
    expect(sortTeamRows(rows, SWING_METRIC_KEY, "asc").map((row) => row.teamKey)).toEqual(["frc2", "frc1"]);
    expect(sortTeamRows(rows, SWING_METRIC_KEY, "desc").map((row) => row.teamKey)).toEqual(["frc1", "frc2"]);
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
      "bpr",
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
      "bpr",
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
      "bpr",
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
      "bpr",
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
      "bpr",
    );
    const sorted = sortTeamRows(rows, "hubShift1", "desc");
    expect(sorted.map((row) => [row.teamKey, row.rank])).toEqual([
      ["frc2", 2],
      ["frc1", 1],
    ]);
  });

  it("sorts by WIN_RATE_SORT_KEY using TeamRow.winRate, not the metrics record", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, record: { wins: 1, losses: 9, ties: 0 } }),
        team({ teamKey: "frc2", teamNumber: 2, record: { wins: 9, losses: 1, ties: 0 } }),
      ]),
      "bpr",
    );
    const sorted = sortTeamRows(rows, WIN_RATE_SORT_KEY, "desc").map((row) => row.teamKey);
    expect(sorted).toEqual(["frc2", "frc1"]);
  });

  it("treats a null win rate (zero matches) as absent for WIN_RATE_SORT_KEY sorting, sorting it last regardless of direction", () => {
    const rows = buildTeamRows(
      artifact([
        team({ teamKey: "frc1", teamNumber: 1, record: { wins: 0, losses: 0, ties: 0 } }),
        team({ teamKey: "frc2", teamNumber: 2, record: { wins: 3, losses: 1, ties: 0 } }),
      ]),
      "bpr",
    );
    expect(sortTeamRows(rows, WIN_RATE_SORT_KEY, "desc").map((row) => row.teamKey)).toEqual(["frc2", "frc1"]);
    expect(sortTeamRows(rows, WIN_RATE_SORT_KEY, "asc").map((row) => row.teamKey)).toEqual(["frc2", "frc1"]);
  });
});
