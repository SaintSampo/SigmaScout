/**
 * D-12's gate (phase 09 plan 09-01 Task 3): level-1 output — `pRedWin`,
 * `redScore`, `blueScore` — must be BYTE-IDENTICAL across the whole of
 * Phase 9's ranking-point rewrite, on a bounded 2022 corpus slice, for every
 * published algorithm. The RP layer does not feed back into level 1 by
 * construction (`sigmaScoutLayer.ts`'s two-level framing: `foldPlayed`
 * ATTACHES level-2 fields onto the prediction it is handed, it never
 * mutates `pRedWin`/`redScore`/`blueScore`), so ANY difference this gate
 * finds is a real cross-level leak, not a tolerance question — see
 * `computePredictionStreamDigest`'s own doc comment for why the digest is
 * never rounded or truncated.
 *
 * The digest is computed over the prediction AFTER `SigmaScoutLayer.foldPlayed`,
 * NOT over the raw `WalkForwardSimulator` output. Digesting the raw stream
 * would make this gate structurally unfalsifiable: the RP layer has no code
 * path into the simulator, so a cross-level leak could never show up in a
 * raw-stream digest, and this test would pass forever while proving
 * nothing.
 *
 * Resolution order mirrors `digest.test.ts` exactly: the real corpus (the
 * strongest check — it proves the committed FIXTURE and the corpus agree)
 * when `data/corpus.sqlite` exists, otherwise the committed
 * `packages/harness/fixtures/digest-slice.json`. Only when NEITHER source
 * is available does this suite skip, and then with an explicit message
 * naming both paths — never a silent pass. When BOTH are present, a second
 * assertion checks the corpus-derived and fixture-derived match lists are
 * deeply equal, so a stale committed fixture fails loudly rather than
 * silently certifying a slice that no longer matches it.
 *
 * A digest mismatch is a finding about the code, not a fixture to refresh —
 * regenerating, relaxing, or hand-editing the committed
 * `data/baselines/level1-digest-2026-09.json` to make a failing reproduction
 * test pass is PROHIBITED (`must_haves.prohibitions`). Recorded `algorithmVersion`
 * is checked against the resolved one FIRST, and a mismatch fails with a
 * message naming both versions and stating the baseline predates the
 * promotion — so a deliberate version bump reads as "the baseline predates
 * this version," never as a cross-level leak.
 *
 * Consumed by TWO later plans in this phase, both re-proving this SAME
 * baseline: 09-04 (immediately after the closed form replaces the Monte
 * Carlo) and 09-10 (at phase close). Neither is tempted to treat a
 * difference as a tolerance question — the RP layer does not feed back into
 * level 1, so any difference at all is a real cross-level leak.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, selectMatchesChronological } from "./../corpus/db.js";
import type { MatchResult } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { computePredictionStreamDigest } from "./promote.js";
import { resolvePublishAlgorithms } from "./publish.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");
const LEVEL1_BASELINE_PATH = join("data", "baselines", "level1-digest-2026-09.json");

const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const FIXTURE_AVAILABLE = existsSync(DIGEST_SLICE_FIXTURE_PATH);

interface DigestSliceFixture {
  sliceSeason: number;
  sliceEventKeys: string[];
  extractedAt: string;
  corpusIdentity: string;
  matches: MatchResult[];
}

interface Level1DigestBaseline {
  measuredAt: string;
  sliceSeason: number;
  sliceEventKeys: string[];
  sliceMatchCount: number;
  entries: { algorithmId: string; algorithmVersion: string; predictionStreamSha256: string }[];
}

function loadFixture(): DigestSliceFixture | undefined {
  if (!FIXTURE_AVAILABLE) return undefined;
  return JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
}

function loadBaseline(): Level1DigestBaseline {
  return JSON.parse(readFileSync(LEVEL1_BASELINE_PATH, "utf8")) as Level1DigestBaseline;
}

/** Matches for the baseline's own recorded slice, from corpus and/or fixture — whichever is available. Same shape as `digest.test.ts`'s `resolveSliceMatches`. */
function resolveSliceMatches(baseline: Level1DigestBaseline): { fromCorpus?: MatchResult[]; fromFixture?: MatchResult[] } {
  const result: { fromCorpus?: MatchResult[]; fromFixture?: MatchResult[] } = {};

  if (CORPUS_AVAILABLE) {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      result.fromCorpus = selectMatchesChronological(db, { year: baseline.sliceSeason, excludeOffseason: true }).filter((match) =>
        baseline.sliceEventKeys.includes(match.eventKey)
      );
    } finally {
      db.close();
    }
  }

  const fixture = loadFixture();
  if (
    fixture &&
    fixture.sliceSeason === baseline.sliceSeason &&
    fixture.sliceEventKeys.length === baseline.sliceEventKeys.length &&
    fixture.sliceEventKeys.every((key) => baseline.sliceEventKeys.includes(key))
  ) {
    result.fromFixture = fixture.matches;
  }

  return result;
}

describe("level-1 output byte-identity gate (D-12, phase 09 plan 09-01)", () => {
  if (!CORPUS_AVAILABLE && !FIXTURE_AVAILABLE) {
    it.skip(`skipped: neither ${CORPUS_PATH} (run the ingest pipeline, pnpm ingest) nor ${DIGEST_SLICE_FIXTURE_PATH} (should be committed) was found`, () => {});
  } else if (!existsSync(LEVEL1_BASELINE_PATH)) {
    it.skip(`skipped: ${LEVEL1_BASELINE_PATH} does not exist yet`, () => {});
  } else {
    const baseline = loadBaseline();
    const { fromCorpus, fromFixture } = resolveSliceMatches(baseline);
    const stream = fromCorpus ?? fromFixture;

    if (!stream) {
      it.skip(
        `skipped: data/corpus.sqlite is absent and no committed fixture slice matches the baseline's recorded ` +
          `sliceSeason (${baseline.sliceSeason}) / sliceEventKeys (${JSON.stringify(baseline.sliceEventKeys)})`,
        () => {}
      );
    } else {
      it(`re-runs on the recorded ${baseline.sliceSeason} slice and reproduces the committed digest bitwise, for every published algorithm`, () => {
        expect(stream.length).toBe(baseline.sliceMatchCount);

        const ruleModule = RP_RULE_MODULES[baseline.sliceSeason];
        expect(ruleModule, `RP_RULE_MODULES must have a registered module for season ${baseline.sliceSeason}`).toBeDefined();

        const resolved = resolvePublishAlgorithms(undefined);
        const resolvedById = new Map(resolved.map((a) => [a.id, a]));

        let anyRpPmf = false;

        for (const entry of baseline.entries) {
          const algorithm = resolvedById.get(entry.algorithmId);
          expect(algorithm, `baseline entry "${entry.algorithmId}" is not among the currently resolved published algorithms`).toBeDefined();

          // Version check FIRST — a deliberate version bump reads as "the
          // baseline predates this promotion," never as a false positive
          // cross-level leak.
          expect(
            algorithm!.version,
            `algorithm "${entry.algorithmId}" is now at version "${algorithm!.version}" but the committed baseline recorded ` +
              `"${entry.algorithmVersion}" — the baseline predates this promotion. Regenerate the baseline deliberately (never to ` +
              `silence a real leak) if this version bump is expected.`
          ).toBe(entry.algorithmVersion);

          const simulator = new WalkForwardSimulator(stream);
          const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
          const raw = simulator.run(algorithm!, teams);

          const layer = new SigmaScoutLayer(ruleModule!, algorithm!.id);
          const folded: PredictionRecord[] = raw.map((r) => layer.foldPlayed(r.match, r.prediction));
          if (folded.some((r) => r.prediction.redRpPmf !== undefined)) anyRpPmf = true;

          const recomputedDigest = computePredictionStreamDigest(folded);
          expect(
            recomputedDigest,
            `level-1 output digest mismatch for "${entry.algorithmId}" — pRedWin/redScore/blueScore changed on this bounded slice. ` +
              `The RP layer does not feed back into level 1, so this is a real cross-level leak, not a tolerance question.`
          ).toBe(entry.predictionStreamSha256);
        }

        // Not vacuous: the RP layer actually ran on this digested stream.
        expect(anyRpPmf, "no folded prediction across any algorithm carried a defined redRpPmf — the RP layer never ran on this slice").toBe(true);
      });
    }

    if (CORPUS_AVAILABLE && FIXTURE_AVAILABLE && stream && fromFixture) {
      it("corpus-derived and fixture-derived slice match lists are identical (fixture is not stale)", () => {
        expect(fromCorpus).toEqual(fromFixture);
      });
    }
  }
});

describe("the gate's failure mode, demonstrated rather than asserted (this task's acceptance criterion)", () => {
  if (!CORPUS_AVAILABLE && !FIXTURE_AVAILABLE) {
    it.skip(`skipped: neither ${CORPUS_PATH} nor ${DIGEST_SLICE_FIXTURE_PATH} was found`, () => {});
  } else if (!existsSync(LEVEL1_BASELINE_PATH)) {
    it.skip(`skipped: ${LEVEL1_BASELINE_PATH} does not exist yet`, () => {});
  } else {
    it("mutating a folded prediction's pRedWin makes the digest assertion FAIL; the unmutated recomputation still passes", () => {
      const baseline = loadBaseline();
      const { fromCorpus, fromFixture } = resolveSliceMatches(baseline);
      const stream = fromCorpus ?? fromFixture;
      if (!stream) return;

      const ruleModule = RP_RULE_MODULES[baseline.sliceSeason]!;
      const entry = baseline.entries[0]!;
      const algorithm = resolvePublishAlgorithms(undefined).find((a) => a.id === entry.algorithmId)!;
      const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

      const simulator = new WalkForwardSimulator(stream);
      const raw = simulator.run(algorithm, teams);
      const layer = new SigmaScoutLayer(ruleModule, algorithm.id);
      const folded: PredictionRecord[] = raw.map((r) => layer.foldPlayed(r.match, r.prediction));

      // Observation 1: the real, unmutated recomputation passes.
      const realDigest = computePredictionStreamDigest(folded);
      expect(realDigest).toBe(entry.predictionStreamSha256);

      // Observation 2: mutate ONE folded prediction's pRedWin and observe
      // the digest assertion FAIL — the gate's failure mode has now been
      // seen, not merely claimed.
      const mutated: PredictionRecord[] = folded.map((r, i) =>
        i === 0 ? { ...r, prediction: { ...r.prediction, pRedWin: r.prediction.pRedWin === 0.999 ? 0.001 : 0.999 } } : r
      );
      const mutatedDigest = computePredictionStreamDigest(mutated);
      expect(mutatedDigest).not.toBe(entry.predictionStreamSha256);
    });
  }
});
