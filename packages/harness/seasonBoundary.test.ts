import { describe, expect, it } from "vitest";
import { seasonBoundaryFor } from "./seasonBoundary.js";

describe("seasonBoundaryFor", () => {
  it("D-2: is byte-identical to the stale-constant behaviour over 2022-2026, the historical contiguous range harness --seasons 2022-2026 still replays (publish:seasons itself now covers the gapped seven-season corpus, 2019,2020,2022-2026)", () => {
    const seasons = [2022, 2023, 2024, 2025, 2026];

    const positional = seasons.map((_, index) => seasonBoundaryFor(seasons, index));
    const withExplicitConstant = seasons.map((_, index) => seasonBoundaryFor(seasons, index, 2022));

    positional.forEach((boundary, index) => {
      expect(boundary, `index ${index}`).toEqual(withExplicitConstant[index]);
    });

    // Non-vacuity guard: the equivalence above is only meaningful if isColdStart
    // is not trivially false (or trivially true) across the whole range.
    const coldStarts = positional.filter((boundary) => boundary.isColdStart);
    expect(coldStarts).toHaveLength(1);
    expect(positional[0]!.isColdStart).toBe(true);
  });

  it("positional default cold-starts 2019 and carries state through 2020 into 2022 (the case this task exists for)", () => {
    const seasons = [2019, 2020, 2022];
    const isColdStartSequence = seasons.map((_, index) => seasonBoundaryFor(seasons, index).isColdStart);
    expect(isColdStartSequence).toEqual([true, false, false]);
  });

  it("regression witness: the stale constant still discards 2019+2020 state by marking 2022 cold, via the surviving override", () => {
    const seasons = [2019, 2020, 2022];
    const isColdStartSequence = seasons.map((_, index) => seasonBoundaryFor(seasons, index, 2022).isColdStart);
    expect(isColdStartSequence).toEqual([false, false, true]);
  });

  it("the index-0 nominal season - 1 label is now unread precisely because isColdStart is true by construction", () => {
    expect(seasonBoundaryFor([2019, 2020, 2022], 0)).toEqual({
      fromSeason: 2018,
      toSeason: 2019,
      isColdStart: true,
    });
  });

  it("reports a truthful two-year gap across a non-contiguous corpus (the case 260903-3bv exists for), unchanged with the third argument dropped", () => {
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
