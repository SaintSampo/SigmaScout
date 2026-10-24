/**
 * The reveal rehearsal (quick task 261024-lfa). The committed `CURRENT_SEASON` stays on the newest
 * game season until the roster-only season's artifacts are verified on the live origin. This file
 * mocks `./seasons.js` to the state that one-line reveal produces, so the reveal is proven safe
 * without being made.
 *
 * The revealed state is derived from the registry, never a literal: `CURRENT_SEASON` becomes
 * `NEWEST_GAME_SEASON + 1`. Today that is 2027; once 2027's game is registered it becomes 2028 and
 * this file still means the same thing.
 */
import { describe, expect, it, vi } from "vitest";
import { metricKeysFor, teamsSortKeyUniverse, TOTAL_KEY } from "./metricKeys.js";
import { applyYearChange, RootSearchSchema } from "./searchParams.js";
import { CURRENT_SEASON, DEFAULT_SEASON, SEASONS } from "./seasons.js";
import { isRosterOnlySeason } from "./seasonGame.js";

vi.mock("./seasons.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./seasons.js")>();
  const { NEWEST_GAME_SEASON } = await import("../../../../packages/harness/rosterOnlySeason.js");
  const revealed = NEWEST_GAME_SEASON + 1;
  return {
    ...original,
    CURRENT_SEASON: revealed,
    // The same descending rule `seasons.ts` uses, rebuilt from the revealed bound.
    SEASONS: Array.from({ length: revealed - original.FIRST_SEASON + 1 }, (_, index) => revealed - index).filter(
      (season) => !original.EXCLUDED_SEASONS.includes(season)
    ),
  };
});

const ROSTER_SEASON = CURRENT_SEASON;

describe("the revealed season list", () => {
  it("lists the roster-only season first and still lists the default season", () => {
    expect(isRosterOnlySeason(ROSTER_SEASON)).toBe(true);
    expect(SEASONS[0]).toBe(ROSTER_SEASON);
    expect(SEASONS).toContain(DEFAULT_SEASON);
    expect(isRosterOnlySeason(DEFAULT_SEASON)).toBe(false);
  });

  it("opens on the default season with no year or an unknown year, and opens the roster season when asked", () => {
    expect(RootSearchSchema.parse({}).year).toBe(DEFAULT_SEASON);
    expect(RootSearchSchema.parse({ year: "1990" }).year).toBe(DEFAULT_SEASON);
    expect(RootSearchSchema.parse({ year: String(ROSTER_SEASON) }).year).toBe(ROSTER_SEASON);
  });

  it("answers the Total key alone for the roster season instead of throwing", () => {
    expect(metricKeysFor("epa", ROSTER_SEASON)).toEqual([TOTAL_KEY]);
    expect(metricKeysFor("spr", ROSTER_SEASON)).toEqual([TOTAL_KEY]);
    expect(() => teamsSortKeyUniverse("spr", ROSTER_SEASON)).not.toThrow();
    expect(teamsSortKeyUniverse("spr", ROSTER_SEASON)).toContain(TOTAL_KEY);
  });

  it("keeps a grouped sort when the year changes to the roster season", () => {
    const next = applyYearChange({ year: DEFAULT_SEASON, algorithm: "spr" as const, sort: "phaseAuto", sortDir: "desc" as const }, ROSTER_SEASON);
    expect(next.year).toBe(ROSTER_SEASON);
    expect(next.sort).toBe("phaseAuto");
  });
});
