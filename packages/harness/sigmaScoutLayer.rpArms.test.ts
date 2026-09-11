/**
 * Layer-level arm tests for the three `RpLayerConfig` branches 09-05 adds
 * (D-05, D-13, D-14, D-01), exercised through the REAL `SigmaScoutLayer`
 * call site rather than `analyticPmf.ts`'s pure functions in isolation.
 * Extended once per task: Task 2 adds the optional real-margin regime gate
 * (or its recorded skip); Task 3 adds the resolved-family tally proof;
 * Task 4 adds the production-default tripwire.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MatchResult } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { RP_LAYER_CONFIG_DEFAULT, type RpLayerConfig } from "../core/rankingPoints/analyticPmf.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator } from "./replay.js";
import { resolvePublishAlgorithms } from "./publish.js";

const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");
const FIXTURE_AVAILABLE = existsSync(DIGEST_SLICE_FIXTURE_PATH);

interface DigestSliceFixture {
  readonly sliceSeason: number;
  readonly matches: readonly MatchResult[];
}

describe("SigmaScoutLayer — tieModel: \"discrete-margin\" real-margin regime gate (09-05 Task 2 step 6, optional)", () => {
  // ATTEMPTED, then RECORDED SKIP — see this plan's own SUMMARY.md
  // "## Recorded skip" section for the full reasoning. Short version:
  // 09-01's `level1Digest.test.ts` replay (WalkForwardSimulator +
  // SigmaScoutLayer.foldPlayed over the committed `digest-slice.json`
  // fixture) IS reusable verbatim for producing folded predictions with
  // `redRpPmf`/`blueRpPmf` attached — but this gate needs the mean
  // PREDICTED TIE PROBABILITY specifically, and `Prediction` does not
  // expose `pTie` in isolation: tie mass is convolved with bonus RP and can
  // land at any of several pmf indices (`tieRp`, `tieRp + 1`, ...,
  // `tieRp + bonusCount`), not read off a single index. Extracting it would
  // require either a new public accessor on `SigmaScoutLayer` for the raw
  // `RpOutcomeDistribution` (an API surface change out of this step's
  // scope — Task 2's declared files are `analyticPmf.ts`,
  // `analyticPmf.test.ts`, and this file) or re-deriving each alliance's
  // band variance and calling `matchOutcomeDistribution` a SECOND time
  // outside `SigmaScoutLayer` — exactly the "invented second replay
  // harness" risk this plan explicitly warns is "a scorer mismatch waiting
  // to happen." Relying instead on the pinned analytic check already in
  // `analyticPmf.test.ts` (`tieProbability(0, 36.5 ** 2)` against F7's
  // measured base rate), which is corpus-free and does not need this
  // fixture at all.
  it.skip(
    "SKIPPED (recorded, not silent): extracting a per-match predicted tie probability from SigmaScoutLayer.foldPlayed's folded Prediction stream would need either a new public accessor or a second, independently-derived matchOutcomeDistribution call outside the layer — both out of this step's scope. See this file's own header and 09-05-05-SUMMARY.md's \"## Recorded skip\" section.",
    () => {}
  );

  // Left in place (skipped, not deleted) so a future plan that DOES add the
  // accessor this gate needs can see exactly what shape of assertion it
  // should restore.
  if (FIXTURE_AVAILABLE) {
    it.skip("would assert: mean predicted tie probability across the 2022 digest-slice fixture lands in [0.004, 0.030] once a public accessor for the outcome half exists", () => {
      const fixture = JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
      const ruleModule = RP_RULE_MODULES[fixture.sliceSeason]!;
      const algorithm = resolvePublishAlgorithms(undefined)[0]!;
      const teams = Array.from(new Set(fixture.matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
      const simulator = new WalkForwardSimulator([...fixture.matches]);
      const raw = simulator.run(algorithm, teams);
      const config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT, tieModel: "discrete-margin" };
      const layer = new SigmaScoutLayer(ruleModule, algorithm.id, config);
      const folded = raw.map((r) => layer.foldPlayed(r.match, r.prediction));
      expect(folded.length).toBeGreaterThan(0);
    });
  }
});
