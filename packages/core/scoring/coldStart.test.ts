import { describe, expect, it } from "vitest";
import {
  applyColdStartTie,
  buildColdStartIndex,
  COLD_START_TIE_PROBABILITY,
  NO_COLD_START_INDEX,
  type ColdStartCandidateMatch,
} from "./coldStart.js";

function match(overrides: Partial<ColdStartCandidateMatch> & Pick<ColdStartCandidateMatch, "matchKey">): ColdStartCandidateMatch {
  return {
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    ...overrides,
  };
}

describe("buildColdStartIndex", () => {
  it("a match whose six teams have no earlier match in the stream IS in the returned set", () => {
    const index = buildColdStartIndex([match({ matchKey: "m1" })]);
    expect(index.has("m1")).toBe(true);
  });

  it("a match where exactly one of the six has an earlier match is NOT in the set", () => {
    const index = buildColdStartIndex([
      match({ matchKey: "m1", redTeams: ["frc1"], blueTeams: ["frc4"] }),
      match({ matchKey: "m2", redTeams: ["frc1", "frc7", "frc8"], blueTeams: ["frc9", "frc10", "frc11"] }),
    ]);
    expect(index.has("m2")).toBe(false);
  });

  it("walk-forward: a team appearing ONLY in a LATER match is still unseen at the earlier match, so the earlier match is still cold start", () => {
    const index = buildColdStartIndex([
      match({ matchKey: "m1", redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }),
      match({ matchKey: "m2", redTeams: ["frc1", "frc7", "frc8"], blueTeams: ["frc9", "frc10", "frc11"] }),
    ]);
    // m1 is cold start: none of its six teams appears anywhere earlier.
    expect(index.has("m1")).toBe(true);
    // m2 is NOT cold start: frc1 already appeared in m1, which is earlier.
    expect(index.has("m2")).toBe(false);
  });

  it("a team's second match is never cold start, even when its other five teammates are all new", () => {
    const index = buildColdStartIndex([
      match({ matchKey: "m1", redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }),
      match({ matchKey: "m2", redTeams: ["frc1", "frc20", "frc21"], blueTeams: ["frc22", "frc23", "frc24"] }),
    ]);
    expect(index.has("m2")).toBe(false);
  });

  it("two consecutive all-new matches: the first is cold start; the second is cold start only if it shares no team with the first", () => {
    const disjoint = buildColdStartIndex([
      match({ matchKey: "m1", redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }),
      match({ matchKey: "m2", redTeams: ["frc7", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"] }),
    ]);
    expect(disjoint.has("m1")).toBe(true);
    expect(disjoint.has("m2")).toBe(true);

    const overlapping = buildColdStartIndex([
      match({ matchKey: "m1", redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }),
      match({ matchKey: "m2", redTeams: ["frc1", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"] }),
    ]);
    expect(overlapping.has("m1")).toBe(true);
    expect(overlapping.has("m2")).toBe(false);
  });

  it("the tie helper returns a probability of exactly 0.5 and forwards every other field unchanged", () => {
    const prediction = {
      winner: "red" as const,
      pRedWin: 0.83,
      redScore: 61,
      blueScore: 40,
      variance: 12.5,
      redComponents: { auto: { mean: 3, variance: 1 } },
    };
    const tied = applyColdStartTie(prediction);
    expect(tied.pRedWin).toBe(COLD_START_TIE_PROBABILITY);
    expect(tied.pRedWin).toBe(0.5);
    expect(tied.winner).toBe("red");
    expect(tied.redScore).toBe(61);
    expect(tied.blueScore).toBe(40);
    expect(tied.variance).toBe(12.5);
    expect(tied.redComponents).toEqual({ auto: { mean: 3, variance: 1 } });
    // Not the same object — a copy, not a mutation of the input.
    expect(tied).not.toBe(prediction);
    expect(prediction.pRedWin).toBe(0.83);
  });

  it("the unavailable-index constant has size 0 and is frozen against mutation", () => {
    expect(NO_COLD_START_INDEX.size).toBe(0);
    expect(Object.isFrozen(NO_COLD_START_INDEX)).toBe(true);
    expect(() => (NO_COLD_START_INDEX as Set<string>).add("x")).toThrow();
    expect(NO_COLD_START_INDEX.size).toBe(0);
  });
});
