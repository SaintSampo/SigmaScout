import { describe, expect, it } from "vitest";
import { seasonBoundaryFor } from "./seasonBoundary.js";

describe("seasonBoundaryFor", () => {
  it("reports a truthful two-year gap across a non-contiguous corpus (the case this task exists for)", () => {
    expect(seasonBoundaryFor([2019, 2020, 2022], 2, 2019)).toEqual({
      fromSeason: 2020,
      toSeason: 2022,
      isColdStart: false,
    });
  });

  it("reports a one-year gap on today's contiguous corpus, unchanged from before this task", () => {
    expect(seasonBoundaryFor([2022, 2023, 2024], 1, 2022)).toEqual({
      fromSeason: 2022,
      toSeason: 2023,
      isColdStart: false,
    });
  });

  it("keeps the nominal season - 1 label at index 0, made unread by isColdStart: true", () => {
    expect(seasonBoundaryFor([2022, 2023], 0, 2022)).toEqual({
      fromSeason: 2021,
      toSeason: 2022,
      isColdStart: true,
    });
  });

  it("is a no-op on the current production corpus: every non-cold-start boundary spans exactly one year", () => {
    const seasons = [2022, 2023, 2024, 2025, 2026];
    const coldStartSeason = 2022;

    for (const [index, season] of seasons.entries()) {
      const boundary = seasonBoundaryFor(seasons, index, coldStartSeason);
      expect(boundary.toSeason).toBe(season);
      if (boundary.isColdStart) continue;
      expect(boundary.toSeason - boundary.fromSeason, `season ${season}: boundary must span exactly one year today`).toBe(1);
    }
  });
});
