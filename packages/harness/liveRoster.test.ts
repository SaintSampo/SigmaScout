/**
 * The live roster's three decisions: who is on it, when it is worth writing,
 * and that the file stays safe for the browser and the Worker to import.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLiveRoster, LiveRosterSchema, liveRosterKey, rosterGrew, rosterTeamKeys } from "./liveRoster.js";

const upcoming = (red: string[], blue: string[]) => ({ redTeams: red, blueTeams: blue });

describe("rosterTeamKeys", () => {
  it("is standings plus every team still on the schedule, sorted, de-duplicated, with no demo robot", () => {
    const source = {
      teams: [{ teamKey: "frc254" }, { teamKey: "frc9985" }],
      upcoming: [upcoming(["frc7", "frc254", "frc9971"], ["frc10", "frc11", "frc12"])],
    };
    expect(rosterTeamKeys(source)).toEqual(["frc10", "frc11", "frc12", "frc254", "frc7"]);
    expect(rosterTeamKeys(undefined)).toEqual([]);
    expect(rosterTeamKeys({})).toEqual([]);
  });
});

describe("rosterGrew", () => {
  const six = { teams: ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"].map((teamKey) => ({ teamKey })) };

  it("is true on the first fold (nothing, or an empty stub, became a roster) and when a team is added later", () => {
    expect(rosterGrew(undefined, six)).toBe(true);
    expect(rosterGrew({ teams: [], upcoming: [] }, six)).toBe(true);
    expect(rosterGrew(six, { ...six, upcoming: [upcoming(["frc7"], [])] })).toBe(true);
  });

  it("is false on an ordinary tick, so the object is NOT rewritten every minute", () => {
    expect(rosterGrew(six, six)).toBe(false);
    // A team moving from the schedule into the standings is the same roster.
    expect(rosterGrew({ upcoming: [upcoming(["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"])] }, six)).toBe(false);
    // A demo robot arriving is not growth: it is never on the roster.
    expect(rosterGrew(six, { teams: [...six.teams, { teamKey: "frc9990" }] })).toBe(false);
  });
});

describe("buildLiveRoster", () => {
  it("round-trips through its own schema, carries identity only when known, and lives under one key spelling", () => {
    const roster = buildLiveRoster({ eventKey: "2026txrm", season: 2026, eventName: "The Remix", startDate: "2026-09-19", source: { teams: [{ teamKey: "frc2" }, { teamKey: "frc1" }] }, computedAt: "2026-09-20T15:00:00.000Z" });
    expect(LiveRosterSchema.parse(JSON.parse(JSON.stringify(roster)))).toEqual(roster);
    expect(roster.teams).toEqual(["frc1", "frc2"]);
    const bare = buildLiveRoster({ eventKey: "2026txrm", season: 2026, source: {}, computedAt: "2026-09-20T15:00:00.000Z" });
    expect("eventName" in bare).toBe(false);
    expect("startDate" in bare).toBe(false);
    expect(liveRosterKey("2026txrm")).toBe("v1/live-roster/2026txrm.json");
    // No `@`: the R2 census files it as unversioned, never as a generation to prune.
    expect(liveRosterKey("2026txrm")).not.toContain("@");
  });
});

describe("import safety", () => {
  it("imports zod and the isomorphic core only, so both the browser and the Worker can load it", () => {
    const source = readFileSync(new URL("./liveRoster.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../core/algorithms/demoTeams.js", "zod"]);
  });
});
