/**
 * SC-5's reproducibility gate (D-15): every committed
 * `data/algorithm-versions/*.json` file is re-run on its OWN recorded
 * bounded slice, and the recomputed prediction-stream digest and headline
 * metrics must equal the committed ones EXACTLY. A digest mismatch is a
 * finding about the code, not a fixture to refresh — regenerating,
 * relaxing, or hand-editing a committed digest to make a failing
 * reproduction test pass is prohibited (this plan's `must_haves.prohibitions`).
 *
 * D-15/T-03-17: replays from whichever slice source is available — the real
 * corpus (the strongest check: it proves the committed FIXTURE and the
 * corpus agree) when `data/corpus.sqlite` exists, otherwise the committed
 * `packages/harness/fixtures/digest-slice.json` (extracted by
 * `fixtures/extract-digest-slice.ts`) when its recorded `sliceSeason`/
 * `sliceEventKeys` match the version being checked. This is what makes the
 * reproducibility assertion RUN in CI, where the 351MB gitignored corpus
 * never exists — a gate that skips for want of a corpus is not a gate. Only
 * when NEITHER source is available does this suite skip, and then with an
 * explicit message naming both paths (never a silent pass) — mirroring
 * `breakdown/reconciliation.test.ts`'s corpus-backed-assertion shape.
 *
 * When BOTH sources are present, a second assertion checks the
 * corpus-derived and fixture-derived match lists are deeply equal, so a
 * stale committed fixture (the corpus has grown or changed since
 * extraction) fails loudly on any developer machine with a corpus, rather
 * than silently certifying a slice that no longer matches it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";
import type { MatchResult } from "../core/algorithms/types.js";
import type { DigestSliceFixture } from "./fixtures/extract-digest-slice.js";
import { computePredictionStreamDigest, PromotedVersionSchema, type PromotedVersion } from "./promote.js";
import { WalkForwardSimulator } from "./replay.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";

const CORPUS_PATH = "data/corpus.sqlite";
const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");
const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const FIXTURE_AVAILABLE = existsSync(DIGEST_SLICE_FIXTURE_PATH);

function listVersionFiles(): string[] {
  if (!existsSync(ALGORITHM_VERSIONS_DIR)) return [];
  return readdirSync(ALGORITHM_VERSIONS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function loadFixture(): DigestSliceFixture | undefined {
  if (!FIXTURE_AVAILABLE) return undefined;
  return JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
}

/** Matches for `promoted`'s own recorded slice, from corpus and/or fixture — whichever the caller's environment actually has. */
function resolveSliceMatches(promoted: PromotedVersion): {
  fromCorpus?: MatchResult[];
  fromFixture?: MatchResult[];
} {
  const result: { fromCorpus?: MatchResult[]; fromFixture?: MatchResult[] } = {};

  if (CORPUS_AVAILABLE) {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      // Same slice-resolution shape `promote.ts`/`extract-digest-slice.ts`
      // used: the season's own total chronological order, filtered to the
      // RECORDED event key set — never a fresh query for "the first N
      // events," since the corpus may have grown since promotion.
      result.fromCorpus = selectMatchesChronological(db, {
        year: promoted.digest.sliceSeason,
        excludeOffseason: true,
      }).filter((match) => promoted.digest.sliceEventKeys.includes(match.eventKey));
    } finally {
      db.close();
    }
  }

  const fixture = loadFixture();
  if (
    fixture &&
    fixture.sliceSeason === promoted.digest.sliceSeason &&
    fixture.sliceEventKeys.length === promoted.digest.sliceEventKeys.length &&
    fixture.sliceEventKeys.every((key) => promoted.digest.sliceEventKeys.includes(key))
  ) {
    result.fromFixture = fixture.matches;
  }

  return result;
}

describe("promoted algorithm version reproducibility (D-15/SC-5)", () => {
  if (!CORPUS_AVAILABLE && !FIXTURE_AVAILABLE) {
    it.skip(
      `skipped: neither ${CORPUS_PATH} (run the ingest pipeline, pnpm ingest) nor ${DIGEST_SLICE_FIXTURE_PATH} (should be committed) was found`,
      () => {}
    );
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
      // Resolved once per version file (not inside `it`), so a version this
      // environment cannot reproduce can be registered as an explicit,
      // named `it.skip` — never a thrown failure — while a version the
      // fixture DOES cover still runs for real. A committed fixture is
      // necessarily scoped to the one slice it was extracted from
      // (T-03-17); it cannot cover every promoted version's own slice, so
      // "neither source exists" is evaluated PER version file here, not
      // once for the whole suite.
      const { fromCorpus, fromFixture } = resolveSliceMatches(promoted);
      const stream = fromCorpus ?? fromFixture;

      if (!stream) {
        it.skip(
          `skipped: data/corpus.sqlite is absent and no committed fixture slice matches ${file}'s recorded ` +
            `sliceSeason (${promoted.digest.sliceSeason}) / sliceEventKeys (${JSON.stringify(promoted.digest.sliceEventKeys)}) — ` +
            `extract one via: pnpm tsx packages/harness/fixtures/extract-digest-slice.ts --version ${join(ALGORITHM_VERSIONS_DIR, file)}`,
          () => {}
        );
        return;
      }

      it("re-runs on its own recorded slice and reproduces its committed digest bitwise", () => {
        const algorithm = makeSigma1({
          id: promoted.id,
          linkMode: "predictive-variance",
          params: promoted.params,
          paramSetName: promoted.paramSetName,
        });
        const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
        const simulator = new WalkForwardSimulator(stream);
        const records = simulator.run(algorithm, teams);

        expect(records.length).toBe(promoted.digest.sliceMatchCount);

        const recomputedDigest = computePredictionStreamDigest(records);
        expect(recomputedDigest).toBe(promoted.digest.predictionStreamSha256);

        const predictions: HarnessPredictionInput[] = records.map((r) => ({
          matchKey: r.match.matchKey,
          season: promoted.digest.sliceSeason,
          eventKey: r.match.eventKey,
          compLevel: r.match.compLevel,
          algorithmId: promoted.id,
          pRedWin: r.prediction.pRedWin,
          predictedRedScore: r.prediction.redScore,
          predictedBlueScore: r.prediction.blueScore,
          actualWinner: r.match.winner,
          isOffseason: false,
          isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
        }));
        const slices = aggregateScores(predictions, { corpusSeasons: [promoted.digest.sliceSeason] });
        const combinedSlice = slices.find(
          (s) => s.compLevelView === "combined" && s.season === promoted.digest.sliceSeason
        );

        for (const committed of promoted.digest.headlineMetrics) {
          expect(combinedSlice?.brierScore ?? null).toBe(committed.brierScore);
          expect(combinedSlice?.winnerAccuracy ?? null).toBe(committed.winnerAccuracy);
        }
      });

      if (CORPUS_AVAILABLE && FIXTURE_AVAILABLE && fromFixture) {
        it("corpus-derived and fixture-derived slice match lists are identical (fixture is not stale, T-03-17)", () => {
          expect(fromCorpus).toEqual(fromFixture);
        });
      }
    });
  }
});
