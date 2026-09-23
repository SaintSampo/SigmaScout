/**
 * What is left of the live roster after quick task 260923-3w6 deleted its writer:
 * who is on one, and that the file stays safe for the browser to import.
 *
 * The `rosterGrew` and `buildLiveRoster` describes went with those two functions.
 * They pinned WHEN the Worker was worth writing a roster object for and what it
 * put in one; nothing writes one now, because the tick writes the team artifact
 * that made a roster object necessary. `rosterTeamKeys` stays under test as
 * `LiveRosterSchema`'s companion — it is what a stale published roster's `teams`
 * array means, and the web still reads one if it finds it, until 260923-3w7.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LiveRosterSchema, liveRosterKey, rosterTeamKeys } from "./liveRoster.js";

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

describe("import safety", () => {
  it("imports zod and the isomorphic core only, so both the browser and the Worker can load it", () => {
    const source = readFileSync(new URL("./liveRoster.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../core/algorithms/demoTeams.js", "zod"]);
  });
});
