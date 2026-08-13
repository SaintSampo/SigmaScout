/**
 * The self-contained HTML report (D-01, D-03, D-04). Per D-02 the JSON
 * artifact (artifact.ts) is canonical; this module only ever reads a
 * validated `HarnessArtifact` and returns a string — no corpus access, no
 * recomputation of any figure. If a number is not in the artifact it does
 * not appear here. Every interpolated string routes through `escapeHtml`
 * (T-01-03): event/corpus/algorithm text and Statbotics' own labels
 * originate outside this module and land in a document opened in a
 * browser. The output is one file — inline CSS, inline SVG, no `src`/`href`
 * to anything off disk — so it works from a filesystem path with
 * networking disabled.
 */
import type { CalibrationBin } from "../core/scoring/calibration.js";
import type { HarnessArtifact } from "./artifact.js";
import type { CompLevelView, ScoreSlice, SeasonLabel } from "./score.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const VIEW_LABELS: Record<CompLevelView, string> = {
  qualification: "Qualification",
  elimination: "Elimination",
  combined: "Combined",
};

const SEASON_LABEL_TEXT: Record<SeasonLabel, string> = {
  tune: "Tune",
  holdout: "Holdout",
};

/** Renders a Brier/accuracy figure, or the not-applicable marker — never a fabricated `0`. */
function renderMetric(value: number | null, format: (v: number) => string): string {
  if (value === null) return `<span class="na">n/a</span>`;
  return escapeHtml(format(value));
}

function fmtBrier(value: number): string {
  return value.toFixed(4);
}

function fmtPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** One `<tr>` per score slice: season, view, tune/holdout label, both metrics, and every exclusion/tie/no-call count adjacent to the score it qualifies — never in a footnote. */
function renderScoreTable(slices: readonly ScoreSlice[]): string {
  const rows = slices
    .map((slice) => {
      const excludedTotal =
        slice.exclusionCounts.offseason + slice.exclusionCounts.surrogateAffected + slice.exclusionCounts.missingResult;
      const rowClass = slice.headlineEligible ? "holdout-row" : "tune-row";
      const labelBadge = slice.headlineEligible
        ? `<span class="badge badge-headline">Holdout — headline-eligible</span>`
        : `<span class="badge badge-tune">Tune</span>`;
      return `      <tr class="${rowClass}">
        <td>${escapeHtml(String(slice.season))}</td>
        <td>${escapeHtml(VIEW_LABELS[slice.compLevelView])}</td>
        <td>${labelBadge} <span class="season-label-text">(${escapeHtml(SEASON_LABEL_TEXT[slice.seasonLabel])})</span></td>
        <td>${renderMetric(slice.brierScore, fmtBrier)}</td>
        <td>${renderMetric(slice.winnerAccuracy, fmtPercent)}</td>
        <td>${slice.scoredCount}</td>
        <td>${slice.tieCount}</td>
        <td>${slice.noCallCount}</td>
        <td>${excludedTotal} <span class="exclusion-breakdown">(offseason ${slice.exclusionCounts.offseason}, surrogate ${slice.exclusionCounts.surrogateAffected}, missing ${slice.exclusionCounts.missingResult})</span></td>
        <td>${slice.candidateCount}</td>
      </tr>`;
    })
    .join("\n");

  return `  <table class="score-table">
    <caption>Score table — one row per season per view. Holdout rows (2025–2026) are the only headline-eligible figures per D-09; tune rows (2022–2024) are shown for transparency but must never be presented as a headline claim.</caption>
    <thead>
      <tr>
        <th>Season</th><th>View</th><th>Label</th><th>Brier score</th><th>Winner accuracy</th>
        <th>Scored</th><th>Ties</th><th>No-calls</th><th>Excluded</th><th>Candidates</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

/** The clearly-labelled Statbotics reference row(s) (D-04) — source, season and match population always visible alongside the value. */
function renderStatboticsTable(references: readonly HarnessArtifact["statboticsReferences"][number][]): string {
  if (references.length === 0) {
    return `  <p class="na">No Statbotics reference row available for this run.</p>`;
  }
  const rows = references
    .slice()
    .sort((a, b) => a.season - b.season)
    .map(
      (ref) => `      <tr>
        <td>${escapeHtml(String(ref.season))}</td>
        <td>${escapeHtml(fmtPercent(ref.value))}</td>
        <td>${escapeHtml(ref.sourceLabel)}</td>
        <td>${escapeHtml(ref.matchPopulation)}</td>
        <td>${escapeHtml(ref.capturedAt)}</td>
        <td>${ref.fetched ? "Live fetch" : "Dated fallback constant"}</td>
      </tr>`
    )
    .join("\n");

  return `  <table class="statbotics-table">
    <caption>Statbotics reference — the published target, not our own number. Not directly comparable without reading source, season and match population together.</caption>
    <thead>
      <tr><th>Season</th><th>Statbotics accuracy</th><th>Source</th><th>Match population</th><th>Captured</th><th>Provenance</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

const BAR_CHART_WIDTH = 640;
const BAR_CHART_HEIGHT = 220;
const BAR_CHART_MARGIN = { top: 16, right: 16, bottom: 32, left: 48 };

/** Per-season winner-accuracy bars (combined view) as inline SVG — the two deterministic chart shapes are hand-rolled per RESEARCH.md's rationale, no charting dependency. */
function renderScoreBarsSvg(slices: readonly ScoreSlice[]): string {
  const combined = slices.filter((s) => s.compLevelView === "combined").sort((a, b) => a.season - b.season);
  if (combined.length === 0) return `  <p class="na">No seasons to chart.</p>`;

  const plotWidth = BAR_CHART_WIDTH - BAR_CHART_MARGIN.left - BAR_CHART_MARGIN.right;
  const plotHeight = BAR_CHART_HEIGHT - BAR_CHART_MARGIN.top - BAR_CHART_MARGIN.bottom;
  const barSlotWidth = plotWidth / combined.length;
  const barWidth = Math.min(48, barSlotWidth * 0.6);

  const bars = combined
    .map((slice, i) => {
      const x = BAR_CHART_MARGIN.left + i * barSlotWidth + (barSlotWidth - barWidth) / 2;
      const labelX = x + barWidth / 2;
      const seasonLabel = `<text x="${labelX}" y="${BAR_CHART_HEIGHT - 10}" text-anchor="middle" class="axis-label">${escapeHtml(String(slice.season))}</text>`;
      if (slice.winnerAccuracy === null) {
        return `    <g>
      <text x="${labelX}" y="${BAR_CHART_MARGIN.top + plotHeight - 4}" text-anchor="middle" class="na-label">n/a</text>
      ${seasonLabel}
    </g>`;
      }
      const barHeight = slice.winnerAccuracy * plotHeight;
      const y = BAR_CHART_MARGIN.top + (plotHeight - barHeight);
      const cls = slice.headlineEligible ? "bar bar-holdout" : "bar bar-tune";
      return `    <g>
      <rect class="${cls}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"><title>${escapeHtml(
        String(slice.season)
      )}: ${escapeHtml(fmtPercent(slice.winnerAccuracy))} winner accuracy (n=${slice.scoredCount})</title></rect>
      <text x="${labelX}" y="${y - 4}" text-anchor="middle" class="bar-value">${escapeHtml(fmtPercent(slice.winnerAccuracy))}</text>
      ${seasonLabel}
    </g>`;
    })
    .join("\n");

  return `  <svg viewBox="0 0 ${BAR_CHART_WIDTH} ${BAR_CHART_HEIGHT}" class="score-bars" role="img" aria-label="Winner accuracy by season, combined view">
    <line x1="${BAR_CHART_MARGIN.left}" y1="${BAR_CHART_MARGIN.top + plotHeight}" x2="${BAR_CHART_WIDTH - BAR_CHART_MARGIN.right}" y2="${BAR_CHART_MARGIN.top + plotHeight}" class="axis-line" />
${bars}
  </svg>`;
}

const CAL_CHART_SIZE = 260;
const CAL_CHART_MARGIN = { top: 16, right: 16, bottom: 32, left: 40 };

/**
 * A reliability diagram (predicted probability vs observed frequency) per
 * season, as inline SVG. Bins whose `observedFrequency` is `null` (no
 * predictions landed in them) are omitted from the plotted line rather than
 * drawn at zero — an omission, not a fabricated data point. Circle radius
 * scales with bin count so a bin backed by a handful of matches doesn't
 * read as equal evidence to one backed by hundreds.
 */
function renderCalibrationSvg(bins: readonly CalibrationBin[], season: number): string {
  const plotSize = CAL_CHART_SIZE - CAL_CHART_MARGIN.left - CAL_CHART_MARGIN.right;
  const toX = (p: number) => CAL_CHART_MARGIN.left + p * plotSize;
  const toY = (f: number) => CAL_CHART_MARGIN.top + (1 - f) * plotSize;

  const plottable = bins.filter((b) => b.observedFrequency !== null && b.meanPredicted !== null);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  const linePoints = plottable.map((b) => `${toX(b.meanPredicted!)},${toY(b.observedFrequency!)}`).join(" ");

  const dots = plottable
    .map((b) => {
      const radius = 2 + 4 * Math.sqrt(b.count / maxCount);
      const cx = toX(b.meanPredicted!);
      const cy = toY(b.observedFrequency!);
      return `    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" class="cal-dot"><title>bin [${escapeHtml(
        b.binStart.toFixed(2)
      )}, ${escapeHtml(b.binEnd.toFixed(2))}) — predicted ${escapeHtml(b.meanPredicted!.toFixed(3))}, observed ${escapeHtml(
        b.observedFrequency!.toFixed(3)
      )}, n=${b.count}</title></circle>`;
    })
    .join("\n");

  const emptyBinCount = bins.length - plottable.length;
  const omittedNote =
    emptyBinCount > 0
      ? `<text x="${CAL_CHART_MARGIN.left}" y="${CAL_CHART_SIZE - 4}" class="cal-note">${emptyBinCount} empty bin(s) omitted</text>`
      : "";

  return `  <svg viewBox="0 0 ${CAL_CHART_SIZE} ${CAL_CHART_SIZE}" class="calibration-chart" role="img" aria-label="Calibration reliability diagram for season ${escapeHtml(
    String(season)
  )}">
    <line x1="${toX(0)}" y1="${toY(0)}" x2="${toX(1)}" y2="${toY(1)}" class="cal-diagonal" />
    <line x1="${CAL_CHART_MARGIN.left}" y1="${CAL_CHART_MARGIN.top + plotSize}" x2="${CAL_CHART_SIZE - CAL_CHART_MARGIN.right}" y2="${CAL_CHART_MARGIN.top + plotSize}" class="axis-line" />
    <line x1="${CAL_CHART_MARGIN.left}" y1="${CAL_CHART_MARGIN.top}" x2="${CAL_CHART_MARGIN.left}" y2="${CAL_CHART_MARGIN.top + plotSize}" class="axis-line" />
    ${plottable.length > 1 ? `<polyline points="${linePoints}" class="cal-line" />` : ""}
${dots}
    ${omittedNote}
  </svg>`;
}

function renderCalibrationSection(slices: readonly ScoreSlice[]): string {
  const combined = slices.filter((s) => s.compLevelView === "combined").sort((a, b) => a.season - b.season);
  if (combined.length === 0) return `  <p class="na">No calibration data available.</p>`;

  const charts = combined
    .map(
      (slice) => `    <figure class="cal-figure">
      <figcaption>Season ${escapeHtml(String(slice.season))} (${escapeHtml(SEASON_LABEL_TEXT[slice.seasonLabel])})</figcaption>
${renderCalibrationSvg(slice.calibrationBins, slice.season)}
    </figure>`
    )
    .join("\n");

  return `  <div class="cal-grid">\n${charts}\n  </div>`;
}

const REPORT_STYLE = `
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.5rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  .meta { color: #555; font-size: 0.9rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; font-size: 0.85rem; }
  caption { text-align: left; font-size: 0.85rem; color: #444; margin-bottom: 0.4rem; caption-side: top; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; }
  th { background: #f0f0f0; }
  tr.holdout-row { background: #eef7ee; font-weight: 600; }
  tr.tune-row { background: #fff; }
  .badge { display: inline-block; padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.75rem; }
  .badge-headline { background: #2e7d32; color: #fff; }
  .badge-tune { background: #999; color: #fff; }
  .season-label-text { color: #666; font-size: 0.8rem; }
  .exclusion-breakdown { color: #777; font-size: 0.78rem; }
  .na { color: #999; font-style: italic; }
  .score-bars, .calibration-chart { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 6px; }
  .axis-line { stroke: #888; stroke-width: 1; }
  .axis-label { font-size: 10px; fill: #444; }
  .bar-tune { fill: #9e9e9e; }
  .bar-holdout { fill: #2e7d32; }
  .bar-value { font-size: 10px; fill: #222; }
  .na-label { font-size: 10px; fill: #999; font-style: italic; }
  .cal-grid { display: flex; flex-wrap: wrap; gap: 1rem; }
  .cal-figure { margin: 0; }
  .cal-figure figcaption { font-size: 0.8rem; color: #444; margin-bottom: 0.25rem; }
  .cal-diagonal { stroke: #bbb; stroke-dasharray: 4 3; stroke-width: 1; }
  .cal-line { fill: none; stroke: #1565c0; stroke-width: 1.5; }
  .cal-dot { fill: #1565c0; fill-opacity: 0.8; }
  .cal-note { font-size: 9px; fill: #999; }
`;

/**
 * Renders one self-contained HTML string from a validated `HarnessArtifact`
 * — no corpus access, no recomputation. Identical input always produces
 * identical output.
 */
export function renderHtmlReport(artifact: HarnessArtifact): string {
  const { provenance, slices, statboticsReferences } = artifact;
  const algorithmId = escapeHtml(provenance.algorithmId);
  const algorithmVersion = escapeHtml(provenance.algorithmVersion);
  const corpusIdentity = escapeHtml(provenance.corpusIdentity);
  const runTimestamp = escapeHtml(provenance.runTimestamp);
  const seasonsCovered = escapeHtml(provenance.seasonsCovered.join(", "));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SigmaScout Harness Report — ${algorithmId} v${algorithmVersion}</title>
<style>${REPORT_STYLE}</style>
</head>
<body>
  <h1>SigmaScout Harness Report</h1>
  <p class="meta">
    Algorithm: <strong>${algorithmId}</strong> v${algorithmVersion} &middot;
    Corpus: ${corpusIdentity} &middot;
    Generated: ${runTimestamp} &middot;
    Schema v${artifact.schemaVersion} &middot;
    Seasons: ${seasonsCovered}
  </p>

  <h2>Score table</h2>
${renderScoreTable(slices)}

  <h2>Statbotics reference</h2>
${renderStatboticsTable(statboticsReferences)}

  <h2>Winner accuracy by season</h2>
${renderScoreBarsSvg(slices)}

  <h2>Calibration</h2>
${renderCalibrationSection(slices)}
</body>
</html>
`;
}
