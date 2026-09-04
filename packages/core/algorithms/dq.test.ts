import { describe, expect, it } from "vitest";
import { isAdjustZeroedAlliance, isFullyDqZeroScoreAlliance } from "./dq.js";

describe("isFullyDqZeroScoreAlliance", () => {
  it("true: every rating-eligible team disqualified, score exactly 0 — the whole-alliance-DQ case this predicate exists for", () => {
    expect(isFullyDqZeroScoreAlliance(["frc1", "frc2", "frc3"], ["frc1", "frc2", "frc3"], 0)).toBe(true);
  });

  it("false: partial DQ — some but not all rating-eligible teams disqualified, score non-zero — leave exactly as today", () => {
    expect(isFullyDqZeroScoreAlliance(["frc1", "frc2", "frc3"], ["frc3"], 68)).toBe(false);
  });

  it("false: partial DQ with a coincidental 0 score still does not fire (measured: 0 of 1,282 partial-DQ zeros)", () => {
    expect(isFullyDqZeroScoreAlliance(["frc1", "frc2", "frc3"], ["frc3"], 0)).toBe(false);
  });

  it("false: whole alliance DQ'd but a NON-zero recorded score — guards the inverse error the todo names explicitly", () => {
    expect(isFullyDqZeroScoreAlliance(["frc1", "frc2", "frc3"], ["frc1", "frc2", "frc3"], 45)).toBe(false);
  });

  it("false: no DQs at all", () => {
    expect(isFullyDqZeroScoreAlliance(["frc1", "frc2", "frc3"], [], 0)).toBe(false);
  });

  it("false: empty teams array — vacuous truth deliberately avoided, mirrors isFullyDemoAlliance", () => {
    expect(isFullyDqZeroScoreAlliance([], [], 0)).toBe(false);
  });

  it("false: a mixed real+demo-pseudo alliance where the demo pseudo key is never in the raw DQ set — the documented conservative composition choice", () => {
    expect(
      isFullyDqZeroScoreAlliance(["frc1", "demo-pseudo-unregistered", "demo-pseudo-unregistered"], ["frc1"], 0)
    ).toBe(false);
  });

  it("true: DQ set carries extra unrelated keys — only the alliance's own teams matter", () => {
    expect(isFullyDqZeroScoreAlliance(["frc1", "frc2"], ["frc1", "frc2", "frc9999"], 0)).toBe(true);
  });
});

describe("isAdjustZeroedAlliance", () => {
  it("true: score exactly 0, parsed adjustPoints -456 — the 2026bc2_sf14m1 shape this predicate exists for", () => {
    expect(isAdjustZeroedAlliance(["frc190", "frc3467", "frc237"], 0, -456)).toBe(true);
  });

  it("false: parsedAdjustPoints undefined (no parsed breakdown) even with score 0 — adjust is unknown, not negative", () => {
    expect(isAdjustZeroedAlliance(["frc1", "frc2", "frc3"], 0, undefined)).toBe(false);
  });

  it("false: allianceScore non-zero with a large negative adjust — the 95 offseason nonzero-score rows this predicate must not touch", () => {
    expect(isAdjustZeroedAlliance(["frc1", "frc2", "frc3"], 68, -200)).toBe(false);
  });

  it("false: adjust exactly 0 with score 0 — a genuinely scoreless alliance is a real observation", () => {
    expect(isAdjustZeroedAlliance(["frc1", "frc2", "frc3"], 0, 0)).toBe(false);
  });

  it("false: adjust positive with score 0", () => {
    expect(isAdjustZeroedAlliance(["frc1", "frc2", "frc3"], 0, 5)).toBe(false);
  });

  it("false: empty teams array — vacuous truth deliberately avoided, mirrors isFullyDqZeroScoreAlliance", () => {
    expect(isAdjustZeroedAlliance([], 0, -100)).toBe(false);
  });
});
