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
 *
 * D-04/D-05 (plan 07-16/07-18): from plan 07-16's wave 11 through 07-17's
 * wave 12, this file briefly carried a SECOND constant — the publisher/
 * Worker-write tier, deliberately kept apart from this one (the browser-read
 * tier) while the two named different facts: the pipeline had moved to
 * writing `vpr@` objects but no deployed browser could request them yet.
 * 07-18 collapsed the two back into one, once 07-17's write pass made the
 * renamed objects live in R2 — the sole export below now serves both the
 * publisher/Worker and the browser again.
 */

/**
 * D-03/D-05: the published set, in display order — `vpr` (formerly the retired
 * id) renamed by plan 07-18, once 07-17's write pass made the `vpr@` objects
 * live.
 *
 * `bpr` joined 2026-09-08 (quick task 260908-b4t). It is a winner/score model
 * only: like `opr` and `epa` it carries no ranking-point model, so it emits no
 * RP pmf and the rank simulation stays `vpr`-only. Its parameters were frozen
 * on 2016-2022 evidence alone and evaluated once against a sealed 2023-2026
 * holdout — see `packages/core/algorithms/bpr.ts` for the provenance that
 * number depends on.
 */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "vpr", "bpr"] as const;

export type PublishedAlgorithmId = (typeof PUBLISHED_ALGORITHM_IDS)[number];
