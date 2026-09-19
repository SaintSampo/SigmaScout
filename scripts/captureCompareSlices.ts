/**
 * OFFLINE before/after instrument for a change that moves PUBLISHED accuracy.
 * It runs the REAL `publishSeasons` with `dryRun: true` and keeps only the
 * Compare page bodies (`v1/compare/{year}.json`), so every arm is scored by the
 * one scorer the site publishes with. That matters: a scratch scorer usually
 * counts ties differently from the published one, and the ~0.003 shift that
 * produces reads as a regression that is not there.
 *
 * Built for quick task 260919-368 (preseason Week 0 out of official
 * calculations), which needs three arms from three commits: the code as it
 * stood, the scoring and loader change alone, then the no-fold rule on top.
 * Run it once per commit with a different `--out`, then `--diff` two outputs.
 *
 * SAFETY, same construction as `scripts/measureReplayParity.ts`: no network
 * module, no environment variable, the corpus opened read-only, `dryRun` so no
 * request is signed, `skipState` so no seed file is written, no
 * `--write-budget`, a fixed non-UUID generation marker, and no pre-schedule
 * sidecars (they do not feed the Compare page and cost sixteen minutes).
 *
 * USAGE (no `.env`, no network):
 *   npx tsx scripts/captureCompareSlices.ts --out experiments/x/base.json
 *   npx tsx scripts/captureCompareSlices.ts --diff experiments/x/base.json experiments/x/after.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { publishSeasons, resolvePublishAlgorithms } from "../packages/harness/publish.js";
import type { PageKind } from "../packages/harness/pageArtifacts.js";

const CORPUS_PATH = join("data", "corpus.sqlite");
const UNUSED_BUCKET = "capture-compare-dry-run-never-uploaded";
const CAPTURE_GENERATION = "capture-compare-not-a-generation";
const CAPTURE_COMPUTED_AT = "2026-01-01T00:00:00.000Z";
/** The published season list, gapped at 2021 exactly as `pnpm publish:seasons` is. */
export const CAPTURE_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026] as const;

/** The fields of one published Compare slice this instrument reads. */
export interface CapturedSlice {
  readonly algorithmId: string;
  readonly season: number;
  readonly compLevelView: string;
  readonly headlineEligible: boolean;
  readonly brierScore: number;
  readonly winnerAccuracy: number;
  readonly scoredCount: number;
  readonly candidateCount: number;
  readonly exclusionCounts: Record<string, number>;
}

export function slicesOf(compareBody: string): CapturedSlice[] {
  const parsed = JSON.parse(compareBody) as { slices: CapturedSlice[] };
  return parsed.slices.map((s) => ({
    algorithmId: s.algorithmId,
    season: s.season,
    compLevelView: s.compLevelView,
    headlineEligible: s.headlineEligible,
    brierScore: s.brierScore,
    winnerAccuracy: s.winnerAccuracy,
    scoredCount: s.scoredCount,
    candidateCount: s.candidateCount,
    exclusionCounts: s.exclusionCounts,
  }));
}

export interface SliceDelta {
  readonly algorithmId: string;
  readonly season: number | "pooled";
  readonly scoredBefore: number;
  readonly scoredAfter: number;
  readonly accuracyBefore: number;
  readonly accuracyAfter: number;
  readonly brierBefore: number;
  readonly brierAfter: number;
}

const keyOf = (s: CapturedSlice): string => `${s.algorithmId}|${s.season}|${s.compLevelView}`;

/**
 * Per (algorithm, season) on one comp-level view, plus a pooled row per
 * algorithm weighted by each arm's OWN scored count. A slice present in one arm
 * only is an error, not a silent skip.
 */
export function diffSlices(before: readonly CapturedSlice[], after: readonly CapturedSlice[], view: string): SliceDelta[] {
  const a = new Map(before.filter((s) => s.compLevelView === view).map((s) => [keyOf(s), s]));
  const b = new Map(after.filter((s) => s.compLevelView === view).map((s) => [keyOf(s), s]));
  const missing = [...a.keys()].filter((k) => !b.has(k)).concat([...b.keys()].filter((k) => !a.has(k)));
  if (missing.length > 0) throw new Error(`captureCompareSlices: slices present in one arm only: ${missing.join(", ")}`);

  const deltas: SliceDelta[] = [];
  const pooled = new Map<string, { sb: number; sa: number; ab: number; aa: number; bb: number; ba: number }>();
  for (const [k, x] of [...a].sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) {
    const y = b.get(k)!;
    deltas.push({
      algorithmId: x.algorithmId,
      season: x.season,
      scoredBefore: x.scoredCount,
      scoredAfter: y.scoredCount,
      accuracyBefore: x.winnerAccuracy,
      accuracyAfter: y.winnerAccuracy,
      brierBefore: x.brierScore,
      brierAfter: y.brierScore,
    });
    const p = pooled.get(x.algorithmId) ?? { sb: 0, sa: 0, ab: 0, aa: 0, bb: 0, ba: 0 };
    p.sb += x.scoredCount;
    p.sa += y.scoredCount;
    p.ab += x.winnerAccuracy * x.scoredCount;
    p.aa += y.winnerAccuracy * y.scoredCount;
    p.bb += x.brierScore * x.scoredCount;
    p.ba += y.brierScore * y.scoredCount;
    pooled.set(x.algorithmId, p);
  }
  for (const [algorithmId, p] of pooled) {
    deltas.push({
      algorithmId,
      season: "pooled",
      scoredBefore: p.sb,
      scoredAfter: p.sa,
      accuracyBefore: p.ab / p.sb,
      accuracyAfter: p.aa / p.sa,
      brierBefore: p.bb / p.sb,
      brierAfter: p.ba / p.sa,
    });
  }
  return deltas;
}

async function capture(out: string): Promise<void> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  const slices: CapturedSlice[] = [];
  try {
    await publishSeasons(db, {
      seasons: [...CAPTURE_SEASONS],
      algorithms: resolvePublishAlgorithms(undefined),
      bucket: UNUSED_BUCKET,
      dryRun: true,
      skipState: true,
      includeOffseason: true,
      preScheduleFromSeason: 9999,
      generation: CAPTURE_GENERATION,
      computedAt: CAPTURE_COMPUTED_AT,
      artifactSink: (pageKind: PageKind, _key: string, body: string): void => {
        if (pageKind === "compare") slices.push(...slicesOf(body));
      },
    });
  } finally {
    db.close();
  }
  if (slices.length === 0) throw new Error("captureCompareSlices: the publisher emitted no compare page");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ seasons: CAPTURE_SEASONS, slices }, null, 1));
  console.log(`captured ${slices.length} slices to ${out}`);
}

function printDiff(beforePath: string, afterPath: string, view: string): void {
  const before = (JSON.parse(readFileSync(beforePath, "utf8")) as { slices: CapturedSlice[] }).slices;
  const after = (JSON.parse(readFileSync(afterPath, "utf8")) as { slices: CapturedSlice[] }).slices;
  console.log(`view=${view}   before=${beforePath}   after=${afterPath}`);
  console.log("alg  season   scored(before>after)   accuracy before > after (delta)        brier before > after (delta)");
  for (const d of diffSlices(before, after, view)) {
    const acc = d.accuracyAfter - d.accuracyBefore;
    const bri = d.brierAfter - d.brierBefore;
    console.log(
      `${d.algorithmId.padEnd(4)} ${String(d.season).padEnd(7)} ${String(d.scoredBefore).padStart(7)} > ${String(d.scoredAfter).padEnd(7)}  ` +
        `${d.accuracyBefore.toFixed(5)} > ${d.accuracyAfter.toFixed(5)} (${acc >= 0 ? "+" : ""}${acc.toFixed(5)})   ` +
        `${d.brierBefore.toFixed(5)} > ${d.brierAfter.toFixed(5)} (${bri >= 0 ? "+" : ""}${bri.toFixed(5)})`
    );
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { out: { type: "string" }, diff: { type: "boolean" }, view: { type: "string" } },
  });
  if (values.diff === true) {
    if (positionals.length !== 2) throw new Error("--diff needs exactly two capture files: before, then after");
    printDiff(positionals[0]!, positionals[1]!, values.view ?? "qualification");
    return;
  }
  if (values.out === undefined) throw new Error("--out is required");
  await capture(values.out);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2));
}
