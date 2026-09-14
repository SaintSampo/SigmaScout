import { describe, expect, it } from "vitest";
import { seasonBoundaryFor } from "./seasonBoundary.js";

describe("seasonBoundaryFor", () => {
  it("cold-starts exactly the first season of a contiguous 2022-2026 range", () => {
    const seasons = [2022, 2023, 2024, 2025, 2026];
    expect(seasons.map((_, index) => seasonBoundaryFor(seasons, index).isColdStart)).toEqual([true, false, false, false, false]);
  });

  it("positional default cold-starts 2019 and carries state through 2020 into 2022 (the case this task exists for)", () => {
    const seasons = [2019, 2020, 2022];
    const isColdStartSequence = seasons.map((_, index) => seasonBoundaryFor(seasons, index).isColdStart);
    expect(isColdStartSequence).toEqual([true, false, false]);
  });

  it("the index-0 nominal season - 1 label is now unread precisely because isColdStart is true by construction", () => {
    expect(seasonBoundaryFor([2019, 2020, 2022], 0)).toEqual({
      fromSeason: 2018,
      toSeason: 2019,
      isColdStart: true,
    });
  });

  it("reports a truthful two-year gap across a non-contiguous corpus, unchanged", () => {
    expect(seasonBoundaryFor([2019, 2020, 2022], 2)).toEqual({
      fromSeason: 2020,
      toSeason: 2022,
      isColdStart: false,
    });
  });

  it("reports a one-year gap on today's contiguous corpus, unchanged from before this task", () => {
    expect(seasonBoundaryFor([2022, 2023, 2024], 1)).toEqual({
      fromSeason: 2022,
      toSeason: 2023,
      isColdStart: false,
    });
  });
});
