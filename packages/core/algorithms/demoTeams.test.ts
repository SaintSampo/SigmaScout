import { describe, expect, it } from "vitest";
import { DEMO_PSEUDO_TEAM_KEY, DEMO_TEAM_KEYS, isDemoTeamKey, isFullyDemoAlliance, remapDemoTeams } from "./demoTeams.js";

describe("DEMO_TEAM_KEYS / isDemoTeamKey", () => {
  it("carries exactly 30 keys, frc9970 through frc9999", () => {
    expect(DEMO_TEAM_KEYS.size).toBe(30);
    expect(DEMO_TEAM_KEYS.has("frc9970")).toBe(true);
    expect(DEMO_TEAM_KEYS.has("frc9999")).toBe(true);
  });

  it("is true for every key in the 9970-9999 block and false just outside it", () => {
    expect(isDemoTeamKey("frc9970")).toBe(true);
    expect(isDemoTeamKey("frc9999")).toBe(true);
    expect(isDemoTeamKey("frc9985")).toBe(true);
    expect(isDemoTeamKey("frc9969")).toBe(false);
    expect(isDemoTeamKey("frc10000")).toBe(false);
  });

  it("is false for real teams, including ones that share a textual prefix", () => {
    expect(isDemoTeamKey("frc254")).toBe(false);
    expect(isDemoTeamKey("frc997")).toBe(false);
    expect(isDemoTeamKey("frc99700")).toBe(false);
  });
});

describe("remapDemoTeams", () => {
  it("is a no-op for an all-real alliance", () => {
    expect(remapDemoTeams(["frc254", "frc1678", "frc971"])).toEqual(["frc254", "frc1678", "frc971"]);
  });

  it("remaps a single demo teammate to the shared pseudo key, keeping real teammates and slot order", () => {
    expect(remapDemoTeams(["frc254", "frc9985", "frc971"])).toEqual(["frc254", DEMO_PSEUDO_TEAM_KEY, "frc971"]);
  });

  it("keeps duplicate pseudo entries (does not deduplicate) when two demo teammates share one alliance", () => {
    expect(remapDemoTeams(["frc254", "frc9985", "frc9990"])).toEqual(["frc254", DEMO_PSEUDO_TEAM_KEY, DEMO_PSEUDO_TEAM_KEY]);
  });

  it("remaps a fully-demo alliance to three pseudo entries", () => {
    expect(remapDemoTeams(["frc9970", "frc9971", "frc9972"])).toEqual([DEMO_PSEUDO_TEAM_KEY, DEMO_PSEUDO_TEAM_KEY, DEMO_PSEUDO_TEAM_KEY]);
  });

  it("handles an empty array", () => {
    expect(remapDemoTeams([])).toEqual([]);
  });
});

describe("isFullyDemoAlliance", () => {
  it("is true when every slot is a demo team", () => {
    expect(isFullyDemoAlliance(["frc9970", "frc9971", "frc9972"])).toBe(true);
  });

  it("is false when at least one slot is a real team", () => {
    expect(isFullyDemoAlliance(["frc254", "frc9971", "frc9972"])).toBe(false);
  });

  it("is false for an all-real alliance", () => {
    expect(isFullyDemoAlliance(["frc254", "frc1678", "frc971"])).toBe(false);
  });

  it("is false (vacuous truth avoided) for an empty array", () => {
    expect(isFullyDemoAlliance([])).toBe(false);
  });
});
