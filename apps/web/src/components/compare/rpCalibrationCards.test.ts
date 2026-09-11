/**
 * `rpCalibrationCards.ts`'s pure model — the RED half of Task 1's TDD gate.
 * Every expectation below is written from the plan's own `<behavior>` block
 * BEFORE reading whether the implementation satisfies it, and each test
 * hand-builds a `CompareRpCalibration` record with known numbers so the
 * headline/tie-break arithmetic is checked against a hand-computed answer,
 * never against the implementation's own output.
 */
import { describe, expect, it } from "vitest";
import { niceCeil, SPARSE_N } from "./calibrationCards.js";
import { buildRpCalibrationCard, rpCardHeadlineSentence } from "./rpCalibrationCards.js";
import type { CompareRpCalibration } from "../../../../../packages/harness/pageArtifacts.js";

function record(bonuses: CompareRpCalibration["bonuses"]): CompareRpCalibration {
  return { scoredCount: bonuses.reduce((sum, b) => sum + b.count, 0), bonuses };
}

describe("buildRpCalibrationCard — order and headline selection", () => {
  it("produces one row per bonus, in the record's OWN array order — never re-sorted, never alphabetised", () => {
    const card = buildRpCalibrationCard(
      record([
        { name: "zeta", count: 100, meanPredicted: 0.5, observedFrequency: 0.5, brierScore: 0.1 },
        { name: "alpha", count: 100, meanPredicted: 0.5, observedFrequency: 0.5, brierScore: 0.1 },
        { name: "mu", count: 100, meanPredicted: 0.5, observedFrequency: 0.5, brierScore: 0.1 },
      ])
    );
    expect(card.bonuses.map((b) => b.name)).toEqual(["zeta", "alpha", "mu"]);
  });

  it("the headline is the bonus with the largest absolute gap between observedFrequency and meanPredicted", () => {
    const card = buildRpCalibrationCard(
      record([
        { name: "smallGap", count: 100, meanPredicted: 0.5, observedFrequency: 0.5, brierScore: 0.1 },
        { name: "bigGap", count: 100, meanPredicted: 0.3, observedFrequency: 0.7, brierScore: 0.2 },
        { name: "tinyGap", count: 100, meanPredicted: 0.9, observedFrequency: 0.95, brierScore: 0.05 },
      ])
    );
    expect(card.headline?.name).toBe("bigGap");
  });

  it("ties on |gap| break on the LARGER count", () => {
    // 0.8 - 0.5 and 0.9 - 0.6 are the SAME IEEE-754 double
    // (0.30000000000000004) — verified so this is a real bitwise tie, not a
    // floating-point near-miss the test would flag as passing for the wrong
    // reason.
    const card = buildRpCalibrationCard(
      record([
        { name: "smallSample", count: 10, meanPredicted: 0.5, observedFrequency: 0.8, brierScore: 0.2 },
        { name: "largeSample", count: 50, meanPredicted: 0.6, observedFrequency: 0.9, brierScore: 0.2 },
      ])
    );
    expect(Math.abs(0.8 - 0.5)).toBe(Math.abs(0.9 - 0.6));
    expect(card.headline?.name).toBe("largeSample");
  });

  it("ties on |gap| AND count break on the EARLIER array index — deterministic, never Array.sort on equal keys alone", () => {
    const card = buildRpCalibrationCard(
      record([
        { name: "first", count: 50, meanPredicted: 0.5, observedFrequency: 0.8, brierScore: 0.2 },
        { name: "second", count: 50, meanPredicted: 0.6, observedFrequency: 0.9, brierScore: 0.2 },
      ])
    );
    // Both have the SAME |gap| (0.30000000000000004, verified above) and the
    // same count; the earlier index wins.
    expect(card.headline?.name).toBe("first");
  });
});

describe("rpCardHeadlineSentence — built entirely from the row's own numbers", () => {
  it("prints the sample count, always, with no hand-typed figure", () => {
    const card = buildRpCalibrationCard(
      record([{ name: "energized", count: 1234, meanPredicted: 0.6, observedFrequency: 0.7, brierScore: 0.15 }])
    );
    const sentence = rpCardHeadlineSentence("BPR", card.headline!);
    expect(sentence).toContain("1,234");
    expect(sentence).toContain("60%");
    expect(sentence).toContain("70%");
    expect(sentence).toContain("energized");
  });
});

describe("sparse flagging — imported SPARSE_N, never a second literal", () => {
  it("flags a bonus below SPARSE_N and does not flag one at or above it", () => {
    const card = buildRpCalibrationCard(
      record([
        { name: "sparse", count: SPARSE_N - 1, meanPredicted: 0.5, observedFrequency: 0.5, brierScore: 0.1 },
        { name: "notSparse", count: SPARSE_N, meanPredicted: 0.5, observedFrequency: 0.5, brierScore: 0.1 },
      ])
    );
    expect(card.bonuses.find((b) => b.name === "sparse")?.sparse).toBe(true);
    expect(card.bonuses.find((b) => b.name === "notSparse")?.sparse).toBe(false);
  });
});

describe("absence — an undefined record produces an empty model, never a zero-filled row or a thrown error", () => {
  it("bonuses is [] and headline is null", () => {
    const card = buildRpCalibrationCard(undefined);
    expect(card.bonuses).toEqual([]);
    expect(card.headline).toBeNull();
    expect(card.maxAbsDeviation).toBe(0);
  });

  it("the shared mini-chart scale derived from an empty model's maxAbsDeviation via niceCeil is still a positive number", () => {
    const card = buildRpCalibrationCard(undefined);
    expect(niceCeil(card.maxAbsDeviation, 0.05)).toBeGreaterThan(0);
  });
});

describe("buildRpCalibrationRecord math — same brier/rate/meanPredicted the console report uses (spot-checked via the card model)", () => {
  it("meanPredicted and observedFrequency and brierScore are exactly what the record carries — no re-derivation", () => {
    const card = buildRpCalibrationCard(
      record([{ name: "traversal", count: 4, meanPredicted: 0.125, observedFrequency: 0.25, brierScore: 0.0625 }])
    );
    const row = card.bonuses[0]!;
    expect(row.meanPredicted).toBe(0.125);
    expect(row.observedFrequency).toBe(0.25);
    expect(row.brierScore).toBe(0.0625);
  });
});
