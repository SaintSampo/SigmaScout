import { describe, expect, it } from "vitest";
import { allianceBandVariance, teamSwingFactorsFromMatches, walkForwardBandVariances, type BandMatchInput } from "./allianceBand.js";
import { swingFactorFromDeviations } from "./swingFactor.js";

function match(overrides: Partial<BandMatchInput> = {}): BandMatchInput {
  return {
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    predictedRedScore: 100,
    predictedBlueScore: 100,
    actualRedScore: 130,
    actualBlueScore: 70,
    ...overrides,
  };
}

describe("teamSwingFactorsFromMatches", () => {
  it("gives every rostered team on both alliances an entry once they have two played matches", () => {
    const swings = teamSwingFactorsFromMatches([
      match({ actualRedScore: 130, actualBlueScore: 70 }),
      match({ actualRedScore: 70, actualBlueScore: 130 }),
    ]);
    for (const team of ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]) {
      expect(swings.get(team)).toBeGreaterThan(0);
    }
  });

  it("gives NO entry to a team with only one played match — one point cannot separate bias from swing", () => {
    const swings = teamSwingFactorsFromMatches([match()]);
    expect(swings.get("frc1")).toBeUndefined();
    expect(swings.size).toBe(0);
  });

  it("ignores unplayed rows entirely rather than treating a missing score as zero", () => {
    const swings = teamSwingFactorsFromMatches([
      match({ actualRedScore: 130, actualBlueScore: 70 }),
      match({ actualRedScore: undefined, actualBlueScore: undefined }),
      match({ actualRedScore: 70, actualBlueScore: 130 }),
    ]);
    const twoPlayedOnly = teamSwingFactorsFromMatches([
      match({ actualRedScore: 130, actualBlueScore: 70 }),
      match({ actualRedScore: 70, actualBlueScore: 130 }),
    ]);
    expect(swings.get("frc1")).toBeCloseTo(twoPlayedOnly.get("frc1") as number, 10);
  });

  it("divides the alliance residual by the roster size, so a two-team alliance is not treated like a three-team one", () => {
    const pair = teamSwingFactorsFromMatches([
      match({ redTeams: ["frc1", "frc2"], actualRedScore: 130 }),
      match({ redTeams: ["frc1", "frc2"], actualRedScore: 70 }),
    ]);
    // Deviations are ±30/2 = ±15 rather than ±10.
    expect(pair.get("frc1")).toBeCloseTo(swingFactorFromDeviations([15, -15]) as number, 10);
  });

  it("reads a team's own alliance, never the opposing one", () => {
    // Red is missed by +30 then -30; blue by -30 then +30. Magnitudes match, so
    // the two sides agree here — what this pins is that neither borrows the
    // other's residual, which a mixed-up side would make unequal.
    const swings = teamSwingFactorsFromMatches([
      match({ actualRedScore: 130, actualBlueScore: 70 }),
      match({ actualRedScore: 70, actualBlueScore: 130 }),
    ]);
    expect(swings.get("frc1")).toBeCloseTo(swings.get("frc4") as number, 10);
  });
});

describe("allianceBandVariance", () => {
  const swings = new Map([
    ["frc1", 10],
    ["frc2", 20],
    ["frc3", 20],
  ]);

  it("is the quadrature sum of the roster's Swing Factors", () => {
    // 10² + 20² + 20² = 900, so the drawn band is √900 = 30.
    expect(allianceBandVariance(["frc1", "frc2", "frc3"], swings)).toBeCloseTo(900, 10);
  });

  it("combines by summing SQUARES, never by adding the spreads", () => {
    const variance = allianceBandVariance(["frc1", "frc2", "frc3"], swings) as number;
    expect(Math.sqrt(variance)).toBeCloseTo(30, 10);
    expect(Math.sqrt(variance)).not.toBeCloseTo(50, 6); // 10 + 20 + 20
  });

  it("returns undefined when ANY roster member is missing — never a narrower band from a partial sum", () => {
    expect(allianceBandVariance(["frc1", "frc2", "frcUnknown"], swings)).toBeUndefined();
  });

  it("returns undefined for an empty roster", () => {
    expect(allianceBandVariance([], swings)).toBeUndefined();
  });

  it("is the same quantity the team page prints, so the two can be reconciled by hand", () => {
    // Three robots at ±10 combine to ±17.32, the identity
    // `uncertainty-display.md` states explicitly — never ±30.
    const uniform = new Map([["a", 10], ["b", 10], ["c", 10]]);
    expect(Math.sqrt(allianceBandVariance(["a", "b", "c"], uniform) as number)).toBeCloseTo(17.3205, 4);
  });
});

describe("walkForwardBandVariances", () => {
  const keyed = (i: number, over: Partial<BandMatchInput> = {}) => ({ matchKey: `qm${i}`, ...match(over) });

  it("gives the FIRST played match no band — nothing preceded it", () => {
    const bands = walkForwardBandVariances([keyed(1), keyed(2), keyed(3)]);
    expect(bands.get("qm1")).toEqual({ red: undefined, blue: undefined });
  });

  it("never lets a match inform its own band", () => {
    // qm3's band must equal what the first two matches alone imply, so a wild
    // qm3 result cannot widen qm3's own band retroactively.
    const early = [keyed(1, { actualRedScore: 130 }), keyed(2, { actualRedScore: 70 })];
    const bands = walkForwardBandVariances([...early, keyed(3, { actualRedScore: 9999 })]);
    const fromEarlyOnly = allianceBandVariance(["frc1", "frc2", "frc3"], teamSwingFactorsFromMatches(early));
    expect(bands.get("qm3")?.red).toBeCloseTo(fromEarlyOnly as number, 10);
  });

  it("a later match has a band once its teams have two prior observations", () => {
    const bands = walkForwardBandVariances([keyed(1, { actualRedScore: 130 }), keyed(2, { actualRedScore: 70 }), keyed(3)]);
    expect(bands.get("qm3")?.red).toBeGreaterThan(0);
    expect(bands.get("qm2")?.red).toBeUndefined();   // one prior observation only
  });

  it("skips unplayed rows entirely — they are not part of the walk-forward history", () => {
    const bands = walkForwardBandVariances([keyed(1), keyed(2, { actualRedScore: undefined, actualBlueScore: undefined }), keyed(3)]);
    expect(bands.has("qm2")).toBe(false);
  });
});
