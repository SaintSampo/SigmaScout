import { describe, expect, it } from "vitest";
import { HarnessArtifactSchema, type HarnessArtifact } from "./artifact.js";
import { calibrationBins } from "../core/scoring/calibration.js";
import { escapeHtml, renderHtmlReport } from "./report.js";
import type { ScoreSlice } from "./score.js";

// A populated combined-view slice for the holdout season 2025, with a
// calibration curve that has both populated and empty bins.
const populatedBins2025 = calibrationBins(
  [
    { pRedWin: 0.62, actualWinner: "red" },
    { pRedWin: 0.68, actualWinner: "red" },
    { pRedWin: 0.15, actualWinner: "blue" },
  ],
  10
);

const slice2024Qual: ScoreSlice = {
  season: 2024,
  seasonLabel: "tune",
  headlineEligible: false,
  compLevelView: "qualification",
  brierScore: 0.185,
  winnerAccuracy: 0.667,
  scoredCount: 3,
  tieCount: 0,
  noCallCount: 0,
  exclusionCounts: { offseason: 1, surrogateAffected: 0, missingResult: 0 },
  candidateCount: 4,
  calibrationBins: calibrationBins([{ pRedWin: 0.7, actualWinner: "red" }], 10),
};

// A slice with nothing scored — this is what a "not-applicable" render must
// cover: null metrics, a nonzero candidate count (all excluded), never a
// fabricated 0.
const slice2024Elim: ScoreSlice = {
  season: 2024,
  seasonLabel: "tune",
  headlineEligible: false,
  compLevelView: "elimination",
  brierScore: null,
  winnerAccuracy: null,
  scoredCount: 0,
  tieCount: 0,
  noCallCount: 0,
  exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 2 },
  candidateCount: 2,
  calibrationBins: calibrationBins([], 10),
};

const slice2025Combined: ScoreSlice = {
  season: 2025,
  seasonLabel: "holdout",
  headlineEligible: true,
  compLevelView: "combined",
  brierScore: 0.132,
  winnerAccuracy: 0.812,
  scoredCount: 3,
  tieCount: 0,
  noCallCount: 0,
  exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0 },
  candidateCount: 3,
  calibrationBins: populatedBins2025,
};

function buildFixtureArtifact(overrides?: Partial<HarnessArtifact["provenance"]>): HarnessArtifact {
  const candidate: HarnessArtifact = {
    schemaVersion: 1,
    provenance: {
      algorithmId: "opr",
      algorithmVersion: "1.0.0",
      corpusIdentity: "data/corpus.sqlite",
      runTimestamp: "2026-08-13T00:00:00.000Z",
      seasonsCovered: [2024, 2025],
      ...overrides,
    },
    slices: [slice2024Qual, slice2024Elim, slice2025Combined],
    statboticsReferences: [
      {
        season: 2024,
        value: 0.7,
        sourceLabel: "Statbotics (dated manual constant)",
        matchPopulation: "all 2024 qualification + elimination matches",
        capturedAt: "2026-08-13",
        fetched: false,
      },
      {
        season: 2025,
        value: 0.71,
        sourceLabel: "Statbotics API (v3/year, live fetch)",
        matchPopulation: "all 2025 qualification + elimination matches",
        capturedAt: "2026-08-13",
        fetched: true,
      },
    ],
  };
  // Fail fast if the fixture itself doesn't satisfy the artifact contract.
  return HarnessArtifactSchema.parse(candidate);
}

describe("renderHtmlReport", () => {
  it("contains a row for each season present in the artifact", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    expect(html).toContain(">2024<");
    expect(html).toContain(">2025<");
  });

  it("contains the Statbotics reference label together with its source and season", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    expect(html).toContain("Statbotics reference");
    expect(html).toContain("Statbotics (dated manual constant)");
    expect(html).toContain("Statbotics API (v3/year, live fetch)");
    expect(html).toContain("all 2024 qualification + elimination matches");
  });

  it("marks holdout rows distinguishably from tune rows", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    expect(html).toContain("holdout-row");
    expect(html).toContain("tune-row");
    expect(html).toContain("badge-headline");
    expect(html).toContain("badge-tune");
  });

  it("renders a not-applicable marker and its count for a slice with null metrics, never the digit zero as its score", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    // The elimination row (null brier/accuracy, 0 scored, 2 missingResult) must
    // show "n/a" and the candidate count, never a bare "0.0000" Brier or "0.0%" accuracy.
    expect(html).toContain('<span class="na">n/a</span>');
    // The row's scored-count cell legitimately is the digit 0 (an honest,
    // correctly-labelled count) — that's fine. What must never appear is a
    // *metric* rendered as zero. Assert no cell contains "0.0000" (a
    // zero-valued Brier score) or "0.0%" (a zero-valued accuracy).
    expect(html).not.toContain("0.0000");
    expect(html).not.toContain(">0.0%<");
  });

  it("does not plot a calibration bin with a null observed frequency at the zero position", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    // Only "combined" views are charted per season; the fixture has exactly
    // one combined slice (season 2025), whose 10 bins hold 3 predictions —
    // most bins are empty (count 0, observedFrequency null). The chart must
    // render exactly one <circle> per *populated* bin, never one for an
    // empty bin sitting at the y=0-frequency position.
    const populatedBinCount = populatedBins2025.filter((b) => b.observedFrequency !== null).length;
    const emptyBinCount = populatedBins2025.filter((b) => b.observedFrequency === null).length;
    expect(populatedBinCount).toBeGreaterThan(0);
    expect(emptyBinCount).toBeGreaterThan(0); // proves this fixture actually exercises the omission path

    const dotCount = (html.match(/<circle /g) ?? []).length;
    expect(dotCount).toBe(populatedBinCount);
  });

  it("escapes angle brackets and quote characters injected into artifact text", () => {
    const artifact = buildFixtureArtifact({ corpusIdentity: `<script>alert("xss")</script>'&` });
    const html = renderHtmlReport(artifact);
    expect(html).not.toContain(`<script>alert("xss")</script>`);
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&#39;&amp;");
  });

  it("references no off-disk resource via a src or href attribute", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    expect(html).not.toMatch(/\ssrc=["']/i);
    expect(html).not.toMatch(/\shref=["']/i);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<link[\s>]/i);
  });

  it("produces identical output for the same artifact regardless of call order or corpus state", () => {
    const artifact = buildFixtureArtifact();
    const first = renderHtmlReport(artifact);
    const second = renderHtmlReport(artifact);
    expect(first).toBe(second);

    // A structurally-identical but freshly-constructed artifact object
    // (simulating a second, independent run reading the same JSON) also
    // produces byte-identical output.
    const rebuilt = buildFixtureArtifact();
    expect(renderHtmlReport(rebuilt)).toBe(first);
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("leaves ordinary text unchanged", () => {
    expect(escapeHtml("2024casj qm12")).toBe("2024casj qm12");
  });
});
