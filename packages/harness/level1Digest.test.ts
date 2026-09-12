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

// ---------------------------------------------------------------------------
// The CROSS-PHASE pin (plan 09-10 Task 7). Added because the obvious proxy
// for "D-12 held across the whole phase" turned out to be unusable, and
// silently so.
// ---------------------------------------------------------------------------

/**
 * The stream digests as 09-01 FROZE them, hardcoded here rather than read
 * from `data/baselines/level1-digest-2026-09.json`. That duplication is the
 * entire point: this pin must survive a legitimate re-freeze of that file.
 *
 * 09-10 planned to close the phase by asserting the baseline file was
 * byte-unchanged since 09-01 — `git log -- data/baselines/level1-digest-2026-09.json`
 * showing exactly one commit. At HEAD it shows THREE, and the extra two are
 * not a violation of anything:
 *
 *   47df877d  test(09-01)            opr 223a3e0d  epa 2f723c89  bpr ee9acfec
 *   3f36e582  quick-260911-j2w       opr 223a3e0d  epa 2f723c89  bpr ee9acfec
 *   57cef7a7  quick-260911-l2k       opr 223a3e0d  epa b30d7aa5  bpr ee9acfec
 *
 * Both mutations come from a CONCURRENT SESSION's quick tasks on the EPA
 * foul model — a different workstream that shares this checkout — and they
 * are two genuinely different things that the file-immutability proxy would
 * have reported identically:
 *
 *   - `3f36e582` moved EPA's VERSION 8.0.0 -> 9.0.0 and left the stream hash
 *     untouched. Benign by inspection: the version string is metadata, the
 *     prediction stream is the claim, and the claim did not move.
 *   - `57cef7a7` moved EPA's version 9.0.0 -> 10.0.0 AND the stream hash
 *     2f723c89 -> b30d7aa5. Level-1 output really did change — deliberately,
 *     by a named non-Phase-9 commit ("the foul term becomes a
 *     post-win-probability scalar") that re-froze this baseline in the SAME
 *     commit, which is the correct discipline for an intentional level-1
 *     change.
 *
 * So the file-immutability check cannot distinguish a cross-level leak from a
 * deliberate foreign change, and at HEAD it would fail for a reason that has
 * nothing to do with Phase 9. This pin replaces it with the assertion that
 * actually carries D-12's meaning: **the RP layer moved no level-1 output.**
 * `opr` and `bpr` are untouched by the EPA workstream, so their streams must
 * be bitwise what 09-01 froze — across the ENTIRE phase, through every
 * re-freeze of the baseline file. If a Phase 9 change ever leaks into level 1,
 * these two hashes move and this pin fails even if the baseline file was
 * re-frozen in the same breath.
 *
 * `epa` is deliberately NOT pinned to a literal: its stream legitimately
 * moved once, in a commit that is not this phase's. The main gate above still
 * checks it against whatever the baseline currently records, which is the
 * right check for an algorithm another workstream is actively changing.
 */
const FROZEN_AT_09_01_STREAM_SHA256 = {
  opr: "223a3e0da5a81edff384367e67da2805cda502237336914386853967f66ff324",
  bpr: "ee9acfec85ae0a72c3bbd53ea82092efe1e706352f2be9512798be72551ede49",
} as const;

describe("D-12 across the whole phase: the algorithms Phase 9 did not touch never moved (plan 09-10 Task 7)", () => {
  if (!CORPUS_AVAILABLE && !FIXTURE_AVAILABLE) {
    it.skip(`skipped: neither ${CORPUS_PATH} nor ${DIGEST_SLICE_FIXTURE_PATH} was found`, () => {});
  } else if (!existsSync(LEVEL1_BASELINE_PATH)) {
    it.skip(`skipped: ${LEVEL1_BASELINE_PATH} does not exist yet`, () => {});
  } else {
    it("opr and bpr reproduce the digests 09-01 froze, bitwise — independent of how many times the baseline file has since been re-frozen", () => {
      const baseline = loadBaseline();
      const { fromCorpus, fromFixture } = resolveSliceMatches(baseline);
      const stream = fromCorpus ?? fromFixture;
      if (!stream) return;

      const ruleModule = RP_RULE_MODULES[baseline.sliceSeason]!;
      const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

      for (const [algorithmId, frozenSha] of Object.entries(FROZEN_AT_09_01_STREAM_SHA256)) {
        const algorithm = resolvePublishAlgorithms(undefined).find((a) => a.id === algorithmId);
        expect(algorithm, `${algorithmId} must still be a published algorithm`).toBeDefined();

        const simulator = new WalkForwardSimulator(stream);
        const raw = simulator.run(algorithm!, teams);
        const layer = new SigmaScoutLayer(ruleModule, algorithm!.id);
        const folded: PredictionRecord[] = raw.map((r) => layer.foldPlayed(r.match, r.prediction));

        expect(
          computePredictionStreamDigest(folded),
          `${algorithmId}'s level-1 prediction stream (pRedWin/redScore/blueScore) no longer reproduces the digest ` +
            `frozen by 09-01 at commit 47df877d. Phase 9's RP layer has no code path back into level 1 — ` +
            `SigmaScoutLayer.foldPlayed ATTACHES level-2 fields to the prediction it is handed and never mutates ` +
            `those three — so this is a REAL CROSS-LEVEL LEAK, not a tolerance question and not a baseline to ` +
            `refresh. Do NOT update FROZEN_AT_09_01_STREAM_SHA256 to make this pass: that would delete the only ` +
            `evidence that the leak happened. Find the write path into level 1 instead.`
        ).toBe(frozenSha);
      }
    });

    it("the pin is live, not decorative: it is checked against algorithms that are still published and still in the baseline", () => {
      const baseline = loadBaseline();
      const publishedIds = resolvePublishAlgorithms(undefined).map((a) => a.id);
      for (const algorithmId of Object.keys(FROZEN_AT_09_01_STREAM_SHA256)) {
        expect(publishedIds, `${algorithmId} left the published set — this pin needs re-deciding, not deleting`).toContain(algorithmId);
        expect(
          baseline.entries.some((e) => e.algorithmId === algorithmId),
          `${algorithmId} is no longer in the baseline file`
        ).toBe(true);
      }
    });
  }
});
