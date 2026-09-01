import { describe, expect, it } from "vitest";
import {
  SIMULATION_DRAWS,
  buildQualRows,
  buildSimulationInputs,
  defaultStartMatchKey,
  findStartIndex,
  isRewindStart,
} from "./simulationInputs.js";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";
import type { EventMatchRow } from "../components/event/eventMatchAxis.js";

/**
 * `simulationInputs.ts`'s own coverage (08-11-PLAN.md Task 1) — every D-12
 * precedence branch (named by rule number in the test name), D-13's
 * at-or-after selection with its pmf-absence exclusion, the null contract
 * (PD-04), the A2 unknown-team fallback, and the no-mutation guard.
 *
 * Every fixture is a HAND-WRITTEN `EventArtifact`-shaped object literal —
 * this module needs adversarial shapes (a null actual RP, a one-sided pmf, a
 * team absent from the roster, a team with a record and no ranking score)
 * that no single real artifact contains.
 */

const BASE_PREAMBLE = {
  schemaVersion: 1,
  generation: "gen-1",
  computedAt: "2026-08-31T00:00:00.000Z",
  algorithmId: "vpr",
  algorithmVersion: "2.1.0+tuned-2026-08",
};

function artifact(overrides: Partial<EventArtifact> = {}): EventArtifact {
  return {
    ...BASE_PREAMBLE,
    eventKey: "2024test",
    season: 2024,
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  } as EventArtifact;
}

function playedRow(matchKey: string, matchNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    matchKey,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber,
    redTeams: ["frcR"],
    blueTeams: ["frcB"],
    predictedWinner: "red" as const,
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    actualWinner: "red" as const,
    actualRedScore: 105,
    actualBlueScore: 88,
    actualRedRp: 3,
    actualBlueRp: 2,
    redRpPmf: [0.2, 0.3, 0.5],
    blueRpPmf: [0.4, 0.3, 0.3],
    ...overrides,
  };
}

function upcomingRow(matchKey: string, matchNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    matchKey,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber,
    redTeams: ["frcR"],
    blueTeams: ["frcB"],
    predictedWinner: "red" as const,
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    redRpPmf: [0.2, 0.3, 0.5],
    blueRpPmf: [0.4, 0.3, 0.3],
    ...overrides,
  };
}

function team(teamKey: string, overrides: Record<string, unknown> = {}) {
  return { teamKey, metrics: {}, ...overrides };
}

function row(matchKey: string, played: boolean): EventMatchRow {
  return {
    matchKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [],
    blueTeams: [],
    predictedWinner: "red",
    pRedWin: 0.5,
    predictedRedScore: 0,
    predictedBlueScore: 0,
    played,
  };
}

describe("SIMULATION_DRAWS", () => {
  it("is 1000", () => {
    expect(SIMULATION_DRAWS).toBe(1000);
  });
});

describe("buildQualRows — ordering and membership", () => {
  it("returns only qm rows drawn from both matches[] and upcoming[], in compareEventMatchRows order; an sf row present in matches[] never appears", () => {
    const a = artifact({
      matches: [playedRow("2024test_qm2", 2), { ...playedRow("2024test_sf1m1", 1), compLevel: "sf" as const }],
      upcoming: [upcomingRow("2024test_qm1", 1)],
    });
    const rows = buildQualRows(a);
    expect(rows.map((r) => r.matchKey)).toEqual(["2024test_qm1", "2024test_qm2"]);
    expect(rows.some((r) => r.matchKey === "2024test_sf1m1")).toBe(false);
  });

  it("a matchKey present in BOTH matches[] and upcoming[] collapses to the played row", () => {
    const a = artifact({
      matches: [playedRow("2024test_qm1", 1)],
      upcoming: [upcomingRow("2024test_qm1", 1)],
    });
    const rows = buildQualRows(a);
    expect(rows.length).toBe(1);
    expect(rows[0]!.played).toBe(true);
  });
});

describe("buildSimulationInputs — D-13 at-or-after selection boundary", () => {
  it("starting at the LAST qualification row yields exactly one remaining match, and it is that row", () => {
    const a = artifact({
      matches: [playedRow("2024test_qm1", 1), playedRow("2024test_qm2", 2)],
      teams: [team("frcR"), team("frcB")],
    });
    const result = buildSimulationInputs(a, "2024test_qm2")!;
    expect(result.remainingMatches.length).toBe(1);
  });

  it("starting at the FIRST row yields every qualification row as remaining", () => {
    const a = artifact({
      matches: [playedRow("2024test_qm1", 1), playedRow("2024test_qm2", 2)],
      teams: [team("frcR"), team("frcB")],
    });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.remainingMatches.length).toBe(2);
  });

  it("starting at the first row zeroes every baseline, including for a team whose rp and record are both present — nothing precedes the first match", () => {
    const a = artifact({
      matches: [playedRow("2024test_qm1", 1)],
      teams: [team("frcR", { rp: 4.83, record: { wins: 10, losses: 2, ties: 0 } }), team("frcB")],
    });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    for (const baseline of result.baselines) {
      expect(baseline.earnedRpSum).toBe(0);
      expect(baseline.matchesPlayed).toBe(0);
    }
  });
});

describe("D-12 rule 1 — the unit conversion (08-03's PD-02 case)", () => {
  it("rp 4.83 over a record of 10-2-0 converts to a TOTAL of 58, not 4.83, not 4, not 5", () => {
    const matches = Array.from({ length: 12 }, (_, i) =>
      playedRow(`2024test_qm${i + 1}`, i + 1, { redTeams: ["frcR"], blueTeams: [`frcOpp${i + 1}`] })
    );
    const upcoming = [upcomingRow("2024test_qm13", 13, { redTeams: ["frcR"], blueTeams: ["frcOpp13"] })];
    const a = artifact({
      matches,
      upcoming,
      teams: [team("frcR", { rp: 4.83, record: { wins: 10, losses: 2, ties: 0 } })],
    });
    const result = buildSimulationInputs(a, "2024test_qm13")!;
    expect(result.isRewindStart).toBe(false);
    const frcR = result.baselines.find((b) => b.teamKey === "frcR")!;
    expect(frcR.matchesPlayed).toBe(12);
    expect(frcR.earnedRpSum).toBe(58);
    expect(Math.abs(frcR.earnedRpSum / frcR.matchesPlayed - 4.83)).toBeLessThanOrEqual(0.005);
    expect(result.baselineSources.get("frcR")).toBe("ranking-score-with-record");
  });
});

describe("D-12 rule 1 — the record-absent fallback (PD-02)", () => {
  it("falls back to the played-qm appearance count as the denominator, distinguishable from a plausible record", () => {
    const matches = Array.from({ length: 10 }, (_, i) =>
      playedRow(`2024test_qm${i + 1}`, i + 1, { redTeams: ["frcR"], blueTeams: [`frcOpp${i + 1}`] })
    );
    const upcoming = [upcomingRow("2024test_qm11", 11, { redTeams: ["frcR"], blueTeams: ["frcOpp11"] })];
    const a = artifact({ matches, upcoming, teams: [team("frcR", { rp: 2.5 })] });
    const result = buildSimulationInputs(a, "2024test_qm11")!;
    const frcR = result.baselines.find((b) => b.teamKey === "frcR")!;
    expect(frcR.matchesPlayed).toBe(10);
    expect(frcR.earnedRpSum).toBe(Math.round(2.5 * 10));
    expect(result.baselineSources.get("frcR")).toBe("ranking-score-with-appearances");
  });
});

describe("D-12 rule 1 — the nearest-integer recovery is exact (PD-03)", () => {
  it("rp 1.12 over a record of 3-5-0 yields exactly 9", () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      playedRow(`2024test_qm${i + 1}`, i + 1, { redTeams: ["frcR"], blueTeams: [`frcOpp${i + 1}`] })
    );
    const upcoming = [upcomingRow("2024test_qm9", 9, { redTeams: ["frcR"], blueTeams: ["frcOpp9"] })];
    const a = artifact({ matches, upcoming, teams: [team("frcR", { rp: 1.12, record: { wins: 3, losses: 5, ties: 0 } })] });
    const result = buildSimulationInputs(a, "2024test_qm9")!;
    expect(result.baselines.find((b) => b.teamKey === "frcR")!.earnedRpSum).toBe(9);
  });

  it("a product landing on .96 and one landing on .04 both round to their true integer, and every baseline stays an integer", () => {
    const matches = Array.from({ length: 4 }, (_, i) => playedRow(`2024test_qm${i + 1}`, i + 1, { redTeams: ["frcA"], blueTeams: ["frcB"] }));
    const upcoming = [upcomingRow("2024test_qm5", 5, { redTeams: ["frcA"], blueTeams: ["frcB"] })];
    const a = artifact({
      matches,
      upcoming,
      teams: [
        team("frcA", { rp: 0.24, record: { wins: 4, losses: 0, ties: 0 } }), // 0.24 * 4 = 0.96
        team("frcB", { rp: 0.26, record: { wins: 0, losses: 4, ties: 0 } }), // 0.26 * 4 = 1.04
      ],
    });
    const result = buildSimulationInputs(a, "2024test_qm5")!;
    expect(result.baselines.find((b) => b.teamKey === "frcA")!.earnedRpSum).toBe(1);
    expect(result.baselines.find((b) => b.teamKey === "frcB")!.earnedRpSum).toBe(1);
    for (const baseline of result.baselines) expect(Number.isInteger(baseline.earnedRpSum)).toBe(true);
  });
});

describe("D-12 rule 2 — the summed fallback (the rewind path, PD-01)", () => {
  it("with a played qualification row at or after the start, the SUMMED prefix total is used even though rp/record are present, and disagrees with the rule-1 value", () => {
    const matches = [
      playedRow("2024test_qm1", 1, { redTeams: ["frcR"], blueTeams: ["frcOpp1"], actualRedRp: 3 }),
      playedRow("2024test_qm2", 2, { redTeams: ["frcR"], blueTeams: ["frcOpp2"], actualRedRp: 4 }),
      playedRow("2024test_qm3", 3, { redTeams: ["frcR"], blueTeams: ["frcOpp3"], actualRedRp: 5 }),
    ];
    const a = artifact({ matches, teams: [team("frcR", { rp: 4.83, record: { wins: 10, losses: 2, ties: 0 } })] });
    const result = buildSimulationInputs(a, "2024test_qm3")!;
    expect(result.isRewindStart).toBe(true);
    const frcR = result.baselines.find((b) => b.teamKey === "frcR")!;
    expect(frcR.earnedRpSum).toBe(7);
    expect(frcR.matchesPlayed).toBe(2);
    expect(result.baselineSources.get("frcR")).toBe("summed-actual-rp");
    expect(frcR.earnedRpSum).not.toBe(Math.round(4.83 * 12));
  });

  it("with no Ranking Score published at all (the 2024auwarp state), produces the same summed result", () => {
    const matches = [
      playedRow("2024test_qm1", 1, { redTeams: ["frcR"], blueTeams: ["frcOpp1"], actualRedRp: 3 }),
      playedRow("2024test_qm2", 2, { redTeams: ["frcR"], blueTeams: ["frcOpp2"], actualRedRp: 4 }),
    ];
    const upcoming = [upcomingRow("2024test_qm3", 3, { redTeams: ["frcR"], blueTeams: ["frcOpp3"] })];
    const a = artifact({ matches, upcoming, teams: [team("frcR")] });
    const result = buildSimulationInputs(a, "2024test_qm3")!;
    const frcR = result.baselines.find((b) => b.teamKey === "frcR")!;
    expect(frcR.earnedRpSum).toBe(7);
    expect(frcR.matchesPlayed).toBe(2);
    expect(result.baselineSources.get("frcR")).toBe("summed-actual-rp");
  });
});

describe("the null contract (PD-04, and this plan's first prohibition) — never coerced to zero, never averaged as 8/3", () => {
  it("a team whose prefix rows carry actual RP of 3, null and 5 yields earnedRpSum 8 and matchesPlayed 2, average 4", () => {
    const matches = [
      playedRow("2024test_qm1", 1, { redTeams: ["frcR"], blueTeams: ["frcOpp1"], actualRedRp: 3 }),
      playedRow("2024test_qm2", 2, { redTeams: ["frcR"], blueTeams: ["frcOpp2"], actualRedRp: null }),
      playedRow("2024test_qm3", 3, { redTeams: ["frcR"], blueTeams: ["frcOpp3"], actualRedRp: 5 }),
    ];
    const upcoming = [upcomingRow("2024test_qm4", 4, { redTeams: ["frcR"], blueTeams: ["frcOpp4"] })];
    const a = artifact({ matches, upcoming, teams: [team("frcR")] });
    const result = buildSimulationInputs(a, "2024test_qm4")!;
    const frcR = result.baselines.find((b) => b.teamKey === "frcR")!;
    expect(frcR.earnedRpSum).toBe(8);
    expect(frcR.matchesPlayed).toBe(2);
    expect(frcR.earnedRpSum / frcR.matchesPlayed).toBe(4);
    expect(result.incompleteBaselineTeamKeys).toContain("frcR");
  });
});

describe("D-12 rule 3 — zero played qualification matches before the start", () => {
  it("a team with no prefix appearance gets baseline 0/0, both when rp is present and when neither rp nor record is present", () => {
    const matches = [playedRow("2024test_qm1", 1, { redTeams: ["frcOther1"], blueTeams: ["frcOther2"] })];
    const upcoming = [upcomingRow("2024test_qm2", 2, { redTeams: ["frcOther1"], blueTeams: ["frcOther2"] })];
    const a = artifact({
      matches,
      upcoming,
      teams: [team("frcWithRp", { rp: 5, record: { wins: 5, losses: 0, ties: 0 } }), team("frcNoRp")],
    });
    const result = buildSimulationInputs(a, "2024test_qm2")!;
    for (const key of ["frcWithRp", "frcNoRp"]) {
      const baseline = result.baselines.find((b) => b.teamKey === key)!;
      expect(baseline.earnedRpSum).toBe(0);
      expect(baseline.matchesPlayed).toBe(0);
      expect(result.baselineSources.get(key)).toBe("no-played-matches");
    }
  });
});

describe("assumption A2 — a team in a simulated match but absent from teams[]", () => {
  it("still produces a baseline entry (0/0), so every team named by a simulated match has one", () => {
    const upcoming = [upcomingRow("2024test_qm1", 1, { redTeams: ["frcGhost"], blueTeams: ["frcB"] })];
    const a = artifact({ upcoming, teams: [team("frcB")] });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    const referencedKeys = result.remainingMatches.flatMap((m) => [...m.redTeamKeys, ...m.blueTeamKeys]);
    for (const key of referencedKeys) {
      expect(result.baselines.some((b) => b.teamKey === key)).toBe(true);
    }
    const ghost = result.baselines.find((b) => b.teamKey === "frcGhost")!;
    expect(ghost.earnedRpSum).toBe(0);
    expect(ghost.matchesPlayed).toBe(0);
  });

  it("a rostered team in no simulated match still gets a baseline, so it is ranked rather than dropped", () => {
    const upcoming = [upcomingRow("2024test_qm1", 1, { redTeams: ["frcA"], blueTeams: ["frcB"] })];
    const a = artifact({ upcoming, teams: [team("frcA"), team("frcB"), team("frcBench")] });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.baselines.some((b) => b.teamKey === "frcBench")).toBe(true);
  });
});

describe("PD-05 — pmf absence excludes, never substitutes", () => {
  it("a row carrying redRpPmf and no blueRpPmf is excluded from remainingMatches and appears in excludedMatchKeys", () => {
    const upcoming = [upcomingRow("2024test_qm1", 1, { redRpPmf: [0.5, 0.5], blueRpPmf: undefined })];
    const a = artifact({ upcoming });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.remainingMatches.length).toBe(0);
    expect(result.excludedMatchKeys).toEqual(["2024test_qm1"]);
  });

  it("a row with both pmfs absent is excluded", () => {
    const upcoming = [upcomingRow("2024test_qm1", 1, { redRpPmf: undefined, blueRpPmf: undefined })];
    const a = artifact({ upcoming });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.excludedMatchKeys).toEqual(["2024test_qm1"]);
  });

  it("a row with a present-but-length-zero pmf array is excluded", () => {
    const upcoming = [upcomingRow("2024test_qm1", 1, { redRpPmf: [], blueRpPmf: [0.5, 0.5] })];
    const a = artifact({ upcoming });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.excludedMatchKeys).toEqual(["2024test_qm1"]);
  });

  it("no entry of remainingMatches ever carries an empty pmf", () => {
    const upcoming = [
      upcomingRow("2024test_qm1", 1, { redRpPmf: [0.5, 0.5], blueRpPmf: [0.5, 0.5] }),
      upcomingRow("2024test_qm2", 2, { redRpPmf: [], blueRpPmf: [0.5, 0.5] }),
    ];
    const a = artifact({ upcoming });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.remainingMatches.every((m) => m.redRpPmf.length > 0 && m.blueRpPmf.length > 0)).toBe(true);
  });
});

describe("elimination rows are never remaining", () => {
  it("an sf row ordered after the start never appears in remainingMatches and never in excludedMatchKeys — it was never a candidate", () => {
    const upcoming = [upcomingRow("2024test_qm1", 1)];
    const matches = [{ ...playedRow("2024test_sf1m1", 1), compLevel: "sf" as const }];
    const a = artifact({ upcoming, matches });
    const result = buildSimulationInputs(a, "2024test_qm1")!;
    expect(result.excludedMatchKeys).not.toContain("2024test_sf1m1");
    expect(result.remainingMatches.length).toBe(1);
  });
});

describe("isRewindStart (PD-08)", () => {
  it("true when a played row lies at or after the start, including when the START row itself is unplayed and a played row follows it", () => {
    const rows = [row("m1", true), row("m2", false), row("m3", true)];
    expect(isRewindStart(rows, 1)).toBe(true);
  });

  it("false when the start is the first genuinely-unplayed row of a normally-ordered event", () => {
    const rows = [row("m1", true), row("m2", true), row("m3", false)];
    expect(isRewindStart(rows, 2)).toBe(false);
  });
});

describe("defaultStartMatchKey", () => {
  it("returns the first genuinely-unplayed row's key when one exists", () => {
    const rows = [row("m1", true), row("m2", false), row("m3", false)];
    expect(defaultStartMatchKey(rows)).toBe("m2");
  });

  it("returns the FIRST match on a fully-played event, so a finished event opens on a full-event rewind rather than on nothing (2026-09-01)", () => {
    const rows = [row("m1", true), row("m2", true)];
    expect(defaultStartMatchKey(rows)).toBe("m1");
  });

  it("returns null on an empty list", () => {
    expect(defaultStartMatchKey([])).toBeNull();
  });
});

describe("findStartIndex", () => {
  it("returns the row index whose matchKey matches, or -1 when absent", () => {
    const rows = [row("m1", true), row("m2", false)];
    expect(findStartIndex(rows, "m2")).toBe(1);
    expect(findStartIndex(rows, "m999")).toBe(-1);
  });
});

describe("buildSimulationInputs — an unknown start key (PD-06's resolve-to-none rule)", () => {
  it("returns null rather than throwing or guessing a neighbour", () => {
    const a = artifact({ upcoming: [upcomingRow("2024test_qm1", 1)] });
    expect(buildSimulationInputs(a, "2024test_qm999")).toBeNull();
  });
});

describe("purity", () => {
  it("does not mutate the artifact — a deep clone taken before the call deep-equals the artifact after it", () => {
    const a = artifact({
      matches: [playedRow("2024test_qm1", 1)],
      upcoming: [upcomingRow("2024test_qm2", 2)],
      teams: [team("frcR", { rp: 3, record: { wins: 1, losses: 0, ties: 0 } })],
    });
    const before = structuredClone(a);
    buildSimulationInputs(a, "2024test_qm2");
    expect(a).toEqual(before);
  });
});
