/**
 * `preMatchMetrics` coverage (260909-tiq-PLAN.md Task 2's `<behavior>`
 * contract). The off-boundary property test is the assertion that catches
 * the off-by-one that would make the whole match page silently wrong.
 */
import { describe, expect, it } from "vitest";
import { preMatchMetrics } from "./preMatchMetrics.js";

type HistoryRow = { matchKey: string; season: number; eventKey: string; algorithmId: string; teamKey: string; matchIndex: number; metrics: Record<string, { value: number }> };

function row(matchKey: string, matchIndex: number, value: number): HistoryRow {
  return {
    matchKey,
    season: 2024,
    eventKey: "2024casf",
    algorithmId: "bpr",
    teamKey: "frc254",
    matchIndex,
    metrics: { total: { value } },
  };
}

describe("preMatchMetrics", () => {
  it("played match, history row found at index > 0 -> returns the PRECEDING row's metrics, basis 'before-this-match'", () => {
    const history = [row("2024casf_qm1", 0, 10), row("2024casf_qm2", 1, 20), row("2024casf_qm3", 2, 30)];
    const result = preMatchMetrics(history, "2024casf_qm2", { played: true });
    expect(result).toBeDefined();
    expect(result!.metrics).toBe(history[0]!.metrics);
    expect(result!.basis).toBe("before-this-match");
    expect(result!.asOfMatchKey).toBe("2024casf_qm1");
  });

  it("played match, row found at index 0 -> undefined (this team's first match of the season)", () => {
    const history = [row("2024casf_qm1", 0, 10), row("2024casf_qm2", 1, 20)];
    expect(preMatchMetrics(history, "2024casf_qm1", { played: true })).toBeUndefined();
  });

  it("played match, no row with this matchKey -> undefined (e.g. a letter-suffixed second-robot key matching no roster row)", () => {
    const history = [row("2024casf_qm1", 0, 10), row("2024casf_qm2", 1, 20)];
    expect(preMatchMetrics(history, "2024casf_qm99", { played: true })).toBeUndefined();
  });

  it("unplayed match, non-empty history -> returns the LAST row's metrics, basis 'latest-played'", () => {
    const history = [row("2024casf_qm1", 0, 10), row("2024casf_qm2", 1, 20), row("2024casf_qm3", 2, 30)];
    const result = preMatchMetrics(history, "2024casf_qm4", { played: false });
    expect(result).toBeDefined();
    expect(result!.metrics).toBe(history[2]!.metrics);
    expect(result!.basis).toBe("latest-played");
    expect(result!.asOfMatchKey).toBe("2024casf_qm3");
  });

  it("unplayed match, empty history -> undefined", () => {
    expect(preMatchMetrics([], "2024casf_qm1", { played: false })).toBeUndefined();
  });

  // The off-by-one property test: for every played row at index i > 0, the
  // returned metrics are reference-equal to rows[i-1].metrics and NEVER to
  // rows[i].metrics.
  it("property: for every played row at index i > 0 in a synthetic 5-row history, the result is reference-equal to rows[i-1].metrics and never rows[i].metrics", () => {
    const history = [
      row("2024casf_qm1", 0, 1),
      row("2024casf_qm2", 1, 2),
      row("2024casf_qm3", 2, 3),
      row("2024casf_qm4", 3, 4),
      row("2024casf_qm5", 4, 5),
    ];
    for (let i = 1; i < history.length; i++) {
      const result = preMatchMetrics(history, history[i]!.matchKey, { played: true });
      expect(result).toBeDefined();
      expect(result!.metrics).toBe(history[i - 1]!.metrics);
      expect(result!.metrics).not.toBe(history[i]!.metrics);
      expect(result!.basis).toBe("before-this-match");
    }
  });

  it("the two bases are never conflated — basis is asserted in every defined case", () => {
    const history = [row("2024casf_qm1", 0, 10), row("2024casf_qm2", 1, 20)];
    expect(preMatchMetrics(history, "2024casf_qm2", { played: true })!.basis).toBe("before-this-match");
    expect(preMatchMetrics(history, "2024casf_qm3", { played: false })!.basis).toBe("latest-played");
  });
});
