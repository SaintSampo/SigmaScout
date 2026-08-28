/**
 * Node-free, dependency-free leaf carrying the published-algorithm id list,
 * split out of `manifestSchemas.ts` (plan 05-01 Task 3). `manifestSchemas.ts`
 * itself imports `Sigma1ParamsSchema` from the Sigma1 barrel, which
 * transitively reaches the whole algorithm implementation — fine for the
 * Worker (`apps/worker/src/liveWindows.ts` already imports it), but wrong
 * for a browser bundle that only needs to know which algorithm ids are
 * published. This file has zero imports, so it is safe on the browser's
 * import graph on its own. `manifestSchemas.ts` re-exports
 * `PUBLISHED_ALGORITHM_IDS` unchanged, so every existing call site keeps
 * working without modification.
 */

/** D-03: the published set is exactly these three ids, in this order. */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "sigma1"] as const;

export type PublishedAlgorithmId = (typeof PUBLISHED_ALGORITHM_IDS)[number];

/**
 * D-04/D-05 (plan 07-16, PD-01): the PUBLISHER/WORKER-facing tier, added
 * beside `PUBLISHED_ALGORITHM_IDS` rather than in place of it, for the
 * duration of this phase's rename transition window (waves 11-12).
 *
 * `PUBLISHED_ALGORITHM_IDS` above names the ids that currently have LIVE
 * OBJECTS IN R2 — the ids a deployed browser may actually request today.
 * `PIPELINE_ALGORITHM_IDS` names the ids the publisher (`publish.ts`) and
 * the Worker (`scheduled.ts`) WRITE under, starting with this plan. During
 * this transition window BOTH statements are true at once, and the two sets
 * genuinely differ (only the third member moves: `sigma1` -> `vpr`) — that
 * difference is the entire safety property the outline's tier split
 * depends on (07-16-PLAN.md, "outline assumption 7"): no wave may have the
 * browser reading a prefix nothing has written yet.
 *
 * The lifecycle is explicit and three plans own it, by name:
 *   - 07-17 writes the new `vpr@` objects to R2, additively — the old
 *     `sigma1@` objects are untouched, so `PUBLISHED_ALGORITHM_IDS` staying
 *     put through 07-17 is what keeps the deployed site working.
 *   - 07-18 collapses the two constants back into one: it moves
 *     `PUBLISHED_ALGORITHM_IDS`'s value to the renamed triple and DELETES
 *     `PIPELINE_ALGORITHM_IDS` entirely, once the new objects exist for the
 *     browser to request.
 *   - 07-19 deletes the retired `sigma1@` objects from R2 and the
 *     `algorithm_id = 'sigma1'` rows from D1, and redeploys the Worker under
 *     the renamed live-fold tier.
 *
 * Consumed by exactly three publisher/Worker-side call sites —
 * `resolvePublishAlgorithms`'s default set (`publish.ts`),
 * `parseLiveAlgorithmIds`'s validation set (`scheduled.ts`), and
 * `replayRig.ts`'s default `--algorithm` list. Nothing in `apps/web` imports
 * this constant. Kept in THIS file (zero imports, zero Node built-ins) so it
 * stays as safe on the browser's import graph as `PUBLISHED_ALGORITHM_IDS`
 * itself, even though nothing in `apps/web` currently reaches it.
 */
export const PIPELINE_ALGORITHM_IDS = ["opr", "epa", "vpr"] as const;

export type PipelineAlgorithmId = (typeof PIPELINE_ALGORITHM_IDS)[number];
