/**
 * 260910-kco — design-era contrast: BPR season-final carry (shipped) vs
 * last-official-match carry (candidate), on the production harness path.
 *
 * One shared stream, both arms in the same runSeasons call (distinct ids),
 * production configuration (includeOffseason: true). Holdout seasons are
 * never loaded: the seasons array below is the design era and nothing else.
 *
 * Run: npx tsx .planning/quick/260910-kco-bpr-carry-from-official-play-only/scripts/carry-contrast.ts
 */
import { openCorpusReadOnly } from "../../../../packages/corpus/db.js";
import { runSeasons } from "../../../../packages/harness/cli.js";
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput } from "../../../../packages/harness/score.js";
import { eventBlockedBootstrap } from "../../../../packages/harness/eventBootstrap.js";
import { accuracyCall } from "../../../../packages/core/scoring/brier.js";
import { bpr } from "../../../../packages/core/algorithms/bpr.js";
import type { AlgorithmModule } from "../../../../packages/core/algorithms/types.js";

const DESIGN_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022] as const;
const CANDIDATE_ID = "bpr-oc";

async function main(): Promise<void> {
  const db = openCorpusReadOnly("data/corpus.sqlite");
  const incumbent = bpr;
  const candidate: AlgorithmModule<unknown> = {
    ...(bpr as AlgorithmModule<unknown>),
    id: CANDIDATE_ID,
    carryFrom: "last-official-match",
  };

  const t0 = Date.now();
  const predictions = await runSeasons(db, [...DESIGN_SEASONS], [incumbent, candidate], true, undefined);
  console.log(`replayed ${predictions.length} prediction rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Headline per-arm numbers on the standard official population.
  const slices = aggregateScores(predictions, {
    corpusSeasons: [...DESIGN_SEASONS],
    selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED,
  });
  for (const arm of [incumbent.id, CANDIDATE_ID]) {
    console.log(`\n=== ${arm} — combined view, per season ===`);
    for (const s of slices.filter((x) => x.algorithmId === arm && x.compLevelView === "combined")) {
      console.log(
        `  ${s.season}  n=${s.scoredCount}  acc=${(s.winnerAccuracy * 100).toFixed(3)}%  brier=${s.brierScore.toFixed(4)}`
      );
    }
  }

  // Paired per-match deltas on the same population aggregateScores headline-scores:
  // exclude offseason, surrogate-affected, missing-result. Cold-start rows are
  // kept (both arms stamp identically; D-Q3 handles the tie call inside
  // accuracyCall's consumer the same way for both arms).
  const byMatch = new Map<string, { inc?: HarnessPredictionInput; cand?: HarnessPredictionInput }>();
  for (const p of predictions) {
    if (p.isOffseason || p.isSurrogateAffected || p.actualWinner === null) continue;
    const slot = byMatch.get(p.matchKey) ?? {};
    if (p.algorithmId === incumbent.id) slot.inc = p;
    else if (p.algorithmId === CANDIDATE_ID) slot.cand = p;
    byMatch.set(p.matchKey, slot);
  }
  const paired = [...byMatch.values()].filter((s) => s.inc !== undefined && s.cand !== undefined) as {
    inc: HarnessPredictionInput;
    cand: HarnessPredictionInput;
  }[];
  console.log(`\npaired official matches: ${paired.length}`);

  let diverging = 0;
  const units = paired.map((s) => {
    const t = s.inc.actualWinner === "red" ? 1 : s.inc.actualWinner === "blue" ? 0 : 0.5;
    const incCall = accuracyCall({ pRedWin: s.inc.pRedWin, actualWinner: s.inc.actualWinner! });
    const candCall = accuracyCall({ pRedWin: s.cand.pRedWin, actualWinner: s.cand.actualWinner! });
    const accDelta = incCall === null || candCall === null ? 0 : (candCall ? 1 : 0) - (incCall ? 1 : 0);
    const brierDelta = (s.cand.pRedWin - t) ** 2 - (s.inc.pRedWin - t) ** 2;
    if (s.inc.pRedWin !== s.cand.pRedWin) diverging += 1;
    return { eventKey: s.inc.eventKey, accDelta, brierDelta };
  });
  console.log(`rows where the two arms' pRedWin differ at all: ${diverging}`);

  const acc = eventBlockedBootstrap(units, (u) => u.accDelta);
  const brier = eventBlockedBootstrap(units, (u) => u.brierDelta);
  console.log(`\npaired accuracy delta (candidate − incumbent): ${(acc.mean * 100).toFixed(4)}pp  95% CI [${(acc.ciLow * 100).toFixed(4)}, ${(acc.ciHigh * 100).toFixed(4)}]`);
  console.log(`paired Brier delta   (candidate − incumbent): ${brier.mean.toFixed(6)}  95% CI [${brier.ciLow.toFixed(6)}, ${brier.ciHigh.toFixed(6)}]`);
  console.log(`\npre-registered rule: ship unless paired accuracy delta < -0.169pp (RULE.md)`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
