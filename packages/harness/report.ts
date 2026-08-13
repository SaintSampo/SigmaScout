/**
 * JSON artifact writer and self-contained HTML report renderer (D-01, D-02).
 * Per D-02 the JSON is the canonical source of truth; the HTML renders from
 * it, never the reverse. Every value interpolated into the HTML that
 * originates from TBA-sourced text is routed through `escapeHtml`
 * (T-01-03) — the report references no off-disk script or stylesheet, so
 * injected markup has no external code to load.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompLevel } from "../core/algorithms/types.js";

export interface PredictionArtifactRecord {
  matchKey: string;
  compLevel: CompLevel;
  matchNumber: number;
  setNumber: number;
  pRedWin: number;
  predictedWinner: "red" | "blue";
  actualWinner: "red" | "blue" | "tie";
  redScorePredicted: number;
  blueScorePredicted: number;
  redScoreActual: number;
  blueScoreActual: number;
}

export interface HarnessArtifact {
  schemaVersion: number;
  algorithmId: string;
  algorithmVersion: string;
  eventKey: string;
  generatedAt: string;
  predictions: PredictionArtifactRecord[];
  aggregate: {
    brierScore: number;
    winnerAccuracy: number;
    n: number;
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Writes the canonical JSON artifact. `secretToScrub`, when supplied
 * (e.g. the TBA API key), causes the write to throw rather than persist
 * the value — T-01-02's automated assertion that the key never crosses
 * into a written file.
 */
export function writeArtifact(outDir: string, artifact: HarnessArtifact, secretToScrub?: string): string {
  const serialized = JSON.stringify(artifact, null, 2);
  if (secretToScrub && serialized.includes(secretToScrub)) {
    throw new Error("Refusing to write harness artifact: serialized output contains a secret value.");
  }
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "artifact.json");
  writeFileSync(path, serialized, "utf8");
  return path;
}

function renderRow(p: PredictionArtifactRecord): string {
  return `      <tr>
        <td>${escapeHtml(p.matchKey)}</td>
        <td>${escapeHtml(p.compLevel)}</td>
        <td>${p.matchNumber}</td>
        <td>${(p.pRedWin * 100).toFixed(1)}%</td>
        <td>${escapeHtml(p.predictedWinner)}</td>
        <td>${escapeHtml(p.actualWinner)}</td>
        <td>${p.redScorePredicted.toFixed(1)} / ${p.blueScorePredicted.toFixed(1)}</td>
        <td>${p.redScoreActual} / ${p.blueScoreActual}</td>
      </tr>`;
}

/** Renders a single self-contained HTML string — no external script or stylesheet references. */
export function renderHtmlReport(artifact: HarnessArtifact): string {
  const rows = artifact.predictions.map(renderRow).join("\n");
  const eventKey = escapeHtml(artifact.eventKey);
  const algorithmId = escapeHtml(artifact.algorithmId);
  const algorithmVersion = escapeHtml(artifact.algorithmVersion);
  const generatedAt = escapeHtml(artifact.generatedAt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SigmaScout Harness Report — ${eventKey}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }
  th { background: #f0f0f0; }
  .summary { display: flex; gap: 2rem; margin-top: 1rem; }
  .stat { background: #f7f7f7; border: 1px solid #ddd; border-radius: 6px; padding: 0.75rem 1rem; }
  .stat-value { font-size: 1.3rem; font-weight: 600; }
</style>
</head>
<body>
  <h1>SigmaScout Harness Report</h1>
  <p>Event: <strong>${eventKey}</strong> — Algorithm: <strong>${algorithmId}</strong> v${algorithmVersion}</p>
  <p>Generated: ${generatedAt} — Schema v${artifact.schemaVersion}</p>
  <div class="summary">
    <div class="stat"><div>Brier score</div><div class="stat-value">${artifact.aggregate.brierScore.toFixed(4)}</div></div>
    <div class="stat"><div>Winner accuracy</div><div class="stat-value">${(artifact.aggregate.winnerAccuracy * 100).toFixed(1)}%</div></div>
    <div class="stat"><div>Matches scored</div><div class="stat-value">${artifact.aggregate.n}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Match</th><th>Level</th><th>#</th><th>P(Red)</th><th>Predicted</th><th>Actual</th><th>Predicted score (R/B)</th><th>Actual score (R/B)</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}
