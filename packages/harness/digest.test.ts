/**
 * SC-5's reproducibility gate (D-15): every committed
 * `data/algorithm-versions/*.json` file is re-run on its OWN recorded
 * bounded slice, and the recomputed prediction-stream digest and headline
 * metrics must equal the committed ones EXACTLY. A digest mismatch is a
 * finding about the code, not a fixture to refresh — regenerating,
 * relaxing, or hand-editing a committed digest to make a failing
 * reproduction test pass is prohibited (this plan's `must_haves.prohibitions`).
 *
 * Mirrors `breakdown/reconciliation.test.ts`'s corpus-backed-assertion
 * shape: skip with an explicit message (never a silent pass) if the corpus
 * is absent or no version files exist yet.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";
import { computePredictionStreamDigest, PromotedVersionSchema, type PromotedVersion } from "./promote.js";
import { WalkForwardSimulator } from "./replay.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";

const CORPUS_PATH = "data/corpus.sqlite";
const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

function listVersionFiles(): string[] {
  if (!existsSync(ALGORITHM_VERSIONS_DIR)) return [];
  return readdirSync(ALGORITHM_VERSIONS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

describe("promoted algorithm version reproducibility (D-15/SC-5)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  const versionFiles = listVersionFiles();
  if (versionFiles.length === 0) {
    it.skip(
      `skipped: no promoted version files found under ${ALGORITHM_VERSIONS_DIR} — run pnpm tune then pnpm promote first`,
      () => {}
    );
    return;
  }

  for (const file of versionFiles) {
    describe(file, () => {
      const raw: unknown = JSON.parse(readFileSync(join(ALGORITHM_VERSIONS_DIR, file), "utf8"));
      const promoted: PromotedVersion = PromotedVersionSchema.parse(raw);

      it("re-runs on its own recorded slice and reproduces its committed digest bitwise", () => {
        const db = openCorpusReadOnly(CORPUS_PATH);
        let records;
        try {
          // Same slice-resolution shape `promote.ts` used: the season's own
          // total chronological order, filtered to the RECORDED event key
          // set — never a fresh query for "the first N events," since the
          // corpus may have grown since promotion.
          const stream = selectMatchesChronological(db, {
            year: promoted.digest.sliceSeason,
            excludeOffseason: true,
          }).filter((match) => promoted.digest.sliceEventKeys.includes(match.eventKey));

          const algorithm = makeSigma1({
            id: promoted.id,
            linkMode: "predictive-variance",
            params: promoted.params,
            paramSetName: promoted.paramSetName,
          });
          const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
          const simulator = new WalkForwardSimulator(stream);
          records = simulator.run(algorithm, teams);
        } finally {
          db.close();
        }

        expect(records.length).toBe(promoted.digest.sliceMatchCount);

        const recomputedDigest = computePredictionStreamDigest(records);
        expect(recomputedDigest).toBe(promoted.digest.predictionStreamSha256);

        const predictions: HarnessPredictionInput[] = records.map((r) => ({
          matchKey: r.match.matchKey,
          season: promoted.digest.sliceSeason,
          compLevel: r.match.compLevel,
          algorithmId: promoted.id,
          pRedWin: r.prediction.pRedWin,
          predictedRedScore: r.prediction.redScore,
          predictedBlueScore: r.prediction.blueScore,
          actualWinner: r.match.winner,
          isOffseason: false,
          isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
        }));
        const slices = aggregateScores(predictions);
        const combinedSlice = slices.find(
          (s) => s.compLevelView === "combined" && s.season === promoted.digest.sliceSeason
        );

        for (const committed of promoted.digest.headlineMetrics) {
          expect(combinedSlice?.brierScore ?? null).toBe(committed.brierScore);
          expect(combinedSlice?.winnerAccuracy ?? null).toBe(committed.winnerAccuracy);
        }
      });
    });
  }
});
