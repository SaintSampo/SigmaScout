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
