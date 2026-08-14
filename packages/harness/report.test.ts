import { describe, expect, it } from "vitest";
import { HarnessArtifactSchema, type HarnessArtifact } from "./artifact.js";
import { calibrationBins } from "../core/scoring/calibration.js";
import { escapeHtml, renderHeadToHeadTable, renderHtmlReport, renderStatboticsCaveat } from "./report.js";
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
  algorithmId: "opr",
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
  algorithmId: "opr",
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
  algorithmId: "opr",
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
    schemaVersion: 2,
    provenance: {
      corpusIdentity: "data/corpus.sqlite",
      runTimestamp: "2026-08-13T00:00:00.000Z",
      seasonsCovered: [2024, 2025],
      ...overrides,
    },
    algorithms: [{ id: "opr", version: "1.0.0" }],
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

describe("renderHtmlReport — D-20 per-algorithm sections", () => {
  const epaSlice2025Combined: ScoreSlice = {
    ...slice2025Combined,
    algorithmId: "epa",
    brierScore: 0.201,
    winnerAccuracy: 0.701,
  };

  function buildTwoAlgorithmArtifact(): HarnessArtifact {
    const candidate: HarnessArtifact = {
      schemaVersion: 2,
      provenance: {
        corpusIdentity: "data/corpus.sqlite",
        runTimestamp: "2026-08-13T00:00:00.000Z",
        seasonsCovered: [2024, 2025],
      },
      algorithms: [
        { id: "opr", version: "1.0.0" },
        { id: "epa", version: "1.0.0" },
      ],
      slices: [slice2024Qual, slice2024Elim, slice2025Combined, epaSlice2025Combined],
      statboticsReferences: [],
    };
    return HarnessArtifactSchema.parse(candidate);
  }

  it("renders one section per algorithm in artifact.algorithms, each headed by that algorithm's id and version", () => {
    const html = renderHtmlReport(buildTwoAlgorithmArtifact());
    expect((html.match(/class="algorithm-section"/g) ?? []).length).toBe(2);
    expect(html).toContain("opr v1.0.0");
    expect(html).toContain("epa v1.0.0");
  });

  it("feeds each algorithm's bar/calibration section only its own slices (filtered by algorithmId), never another algorithm's figures", () => {
    const html = renderHtmlReport(buildTwoAlgorithmArtifact());
    // opr's holdout Brier (0.132) and epa's holdout Brier (0.201) each
    // appear exactly once in the report — in the head-to-head table, the
    // one place the raw score table now lives (see the "renderHeadToHeadTable"
    // describe block below). Neither figure is duplicated into a
    // per-algorithm score table anymore (that would be a second place the
    // same number could silently drift from the artifact).
    expect((html.match(/0\.1320/g) ?? []).length).toBe(1);
    expect((html.match(/0\.2010/g) ?? []).length).toBe(1);
  });
});

describe("renderHeadToHeadTable — SC-1's one comparable table (D-20/D-21)", () => {
  const epaSlice2025Combined: ScoreSlice = {
    ...slice2025Combined,
    algorithmId: "epa",
    brierScore: 0.201,
    winnerAccuracy: 0.701,
  };
  const sigma1Slice2025Combined: ScoreSlice = {
    ...slice2025Combined,
    algorithmId: "sigma1",
    brierScore: 0.119,
    winnerAccuracy: 0.83,
  };

  function buildThreeAlgorithmArtifact(): HarnessArtifact {
    const candidate: HarnessArtifact = {
      schemaVersion: 2,
      provenance: {
        corpusIdentity: "data/corpus.sqlite",
        runTimestamp: "2026-08-13T00:00:00.000Z",
        seasonsCovered: [2024, 2025],
      },
      algorithms: [
        { id: "opr", version: "1.0.0" },
        { id: "epa", version: "1.0.0" },
        { id: "sigma1", version: "1.0.0" },
      ],
      slices: [slice2024Qual, slice2024Elim, slice2025Combined, epaSlice2025Combined, sigma1Slice2025Combined],
      statboticsReferences: [],
    };
    return HarnessArtifactSchema.parse(candidate);
  }

  it("produces a table containing all three algorithm ids and one row per (algorithm, season, view)", () => {
    const artifact = buildThreeAlgorithmArtifact();
    const html = renderHeadToHeadTable(artifact);

    expect(html).toContain(">opr<");
    expect(html).toContain(">epa<");
    expect(html).toContain(">sigma1<");

    const rowCount = (html.match(/<tr class="(?:holdout|tune)-row">/g) ?? []).length;
    expect(rowCount).toBe(artifact.slices.length);
  });

  it("groups rows by season (then view, then algorithm) so a reader scanning one season sees every algorithm adjacent", () => {
    // A dedicated fixture with exactly one slice per algorithm, all in the
    // same (season, view) — no other row's algorithm text can appear
    // earlier and confuse an indexOf-based ordering check.
    const artifact: HarnessArtifact = HarnessArtifactSchema.parse({
      schemaVersion: 2,
      provenance: { corpusIdentity: "data/corpus.sqlite", runTimestamp: "2026-08-13T00:00:00.000Z", seasonsCovered: [2025] },
      algorithms: [
        { id: "sigma1", version: "1.0.0" },
        { id: "opr", version: "1.0.0" },
        { id: "epa", version: "1.0.0" },
      ],
      slices: [
        { ...slice2025Combined, algorithmId: "sigma1", brierScore: 0.119, winnerAccuracy: 0.83 },
        { ...slice2025Combined, algorithmId: "opr" },
        { ...slice2025Combined, algorithmId: "epa", brierScore: 0.201, winnerAccuracy: 0.701 },
      ],
      statboticsReferences: [],
    });

    const html = renderHeadToHeadTable(artifact);
    // Alphabetical algorithm order within the shared (season, view) group: epa, opr, sigma1.
    const epaIdx = html.indexOf(">epa<");
    const oprIdx = html.indexOf(">opr<");
    const sigma1Idx = html.indexOf(">sigma1<");
    expect(oprIdx).toBeGreaterThan(epaIdx);
    expect(sigma1Idx).toBeGreaterThan(oprIdx);
  });

  it("computes no arithmetic difference between two algorithms' Brier scores — raw numbers only (D-21)", () => {
    const twoAlgorithmArtifact: HarnessArtifact = HarnessArtifactSchema.parse({
      schemaVersion: 2,
      provenance: {
        corpusIdentity: "data/corpus.sqlite",
        runTimestamp: "2026-08-13T00:00:00.000Z",
        seasonsCovered: [2025],
      },
      algorithms: [
        { id: "opr", version: "1.0.0" },
        { id: "epa", version: "1.0.0" },
      ],
      slices: [slice2025Combined, epaSlice2025Combined],
      statboticsReferences: [],
    });
    const html = renderHeadToHeadTable(twoAlgorithmArtifact);
    // 0.132 - 0.201 = -0.069 (and its absolute/rounded variants) must never
    // appear — this function must never compute a delta between rows.
    expect(html).not.toContain("0.069");
    expect(html).not.toContain("-0.069");
    // Sanity: both raw scores DO appear (the table isn't just empty).
    expect(html).toContain("0.1320");
    expect(html).toContain("0.2010");
  });

  it("renders correctly for a one-algorithm artifact", () => {
    const oneAlgorithmArtifact: HarnessArtifact = HarnessArtifactSchema.parse({
      schemaVersion: 2,
      provenance: {
        corpusIdentity: "data/corpus.sqlite",
        runTimestamp: "2026-08-13T00:00:00.000Z",
        seasonsCovered: [2024],
      },
      algorithms: [{ id: "opr", version: "1.0.0" }],
      slices: [slice2024Qual],
      statboticsReferences: [],
    });
    const html = renderHeadToHeadTable(oneAlgorithmArtifact);
    expect(html).toContain(">opr<");
    expect((html.match(/<tr class="(?:holdout|tune)-row">/g) ?? []).length).toBe(1);
  });
});

describe("renderStatboticsCaveat — D-15 loud unverified marker", () => {
  it("states UNVERIFIED and names the HTTP 500 evidence", () => {
    const html = renderStatboticsCaveat();
    expect(html).toContain("UNVERIFIED");
    expect(html).toContain("HTTP 500");
    expect(html).toContain("statbotics-caveat");
  });

  it("is attached in renderHtmlReport, adjacent to the Statbotics reference table, with the fetched field's value surfaced per row", () => {
    const html = renderHtmlReport(buildFixtureArtifact());
    // Search from the <h2> heading forward — earlier occurrences of these
    // class names in the <style> block's CSS rules must not be confused
    // with the actual body elements they style.
    const headingIdx = html.indexOf("<h2>UNVERIFIED — Statbotics reference</h2>");
    const caveatIdx = html.indexOf('class="statbotics-caveat"', headingIdx);
    const tableIdx = html.indexOf('class="statbotics-table"', caveatIdx);
    expect(html).toContain("UNVERIFIED");
    expect(headingIdx).toBeGreaterThan(-1);
    expect(caveatIdx).toBeGreaterThan(headingIdx);
    expect(tableIdx).toBeGreaterThan(caveatIdx);
    // fetched:true/false is surfaced as a visible column value, not only as
    // provenance text buried elsewhere.
    expect(html).toContain("Live fetch");
    expect(html).toContain("Dated fallback constant");
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
