import type { SimResult } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { PreScheduleArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * Reconstitutes a published pre-schedule sidecar's BAKED result into the
 * exact `SimResult` shape the client's own Web Worker returns (quick task
 * 260905-tll Task 5, C-09). Pure: no React import, no fetch, no Worker, no
 * Monte Carlo — the draws were performed once, in the pipeline, by the same
 * `simulateRanks` this app ships (`packages/harness/preSchedule.ts` calls
 * it directly), and this function only unpacks them.
 *
 * **Why a `SimResult` rather than rows.** Producing the shared shape is
 * what lets the baked path call the SHIPPED `buildRankDistributionRows`
 * unchanged, so the baked default view and the live-engine view are
 * rendered by ONE row builder. A second builder for the baked path could
 * drift from the one the engine feeds — different median estimator,
 * different band edges, different sort — and the two views would then
 * disagree about the same event while both looking plausible.
 *
 * **The division of labour, stated so a reader does not "helpfully" add a
 * second check here (T-tll-02/T-tll-03).** This function deliberately does
 * NOT re-validate that `histograms.length === roster.length`, that each
 * histogram's length equals `roster.length`, or that each sums to
 * `baked.draws`. `PreScheduleArtifactSchema`'s own refinements
 * (`packages/harness/pageArtifacts.ts`) own all three, at the publish
 * boundary AND again on every fetched body via
 * `PreScheduleArtifactSchema.parse` in `lib/api/preSchedule.ts` — which is
 * what makes `rankRows.ts`'s `MalformedRankHistogramError` unreachable in
 * front of a visitor. A second tolerance, in a second place, is how two
 * tolerances drift apart; the schema is the single home for these bounds.
 *
 * Mutates nothing on the input artifact: `Int32Array.from` copies.
 */
export function decodePreScheduleResult(artifact: PreScheduleArtifact): SimResult {
  const rankHistograms = new Map<string, Int32Array>();
  // Roster order IS the index space — `baked.histograms[i]` is
  // `roster[i]`'s histogram, by the schema's own contract. Iterating the
  // roster (rather than the histograms) keeps that pairing readable and
  // means a reader never has to hold "which array is indexed by what" in
  // their head.
  artifact.roster.forEach((teamKey, index) => {
    rankHistograms.set(teamKey, Int32Array.from(artifact.baked.histograms[index]!));
  });
  return { rankHistograms, draws: artifact.baked.draws };
}
