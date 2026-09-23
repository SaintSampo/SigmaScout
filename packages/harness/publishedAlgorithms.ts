/**
 * Node-free, dependency-free leaf carrying the published-algorithm id list.
 * Zero imports, so it is safe on the browser's import graph on its own;
 * `manifestSchemas.ts` re-exports this constant unchanged rather than
 * duplicating it, because that file also pulls in the full algorithm
 * implementation graph, which a browser bundle should not need.
 */

/**
 * Published set, in display order. This list is what the site reads to
 * decide which algorithms are offered, so removing an id here retires it
 * from the site even if its R2 objects are left in place unreferenced.
 * Only SPR publishes ranking-point odds; OPR and EPA do not. All three fold
 * LIVE on the cron tick since quick task 260923-3w8 — before that only SPR did,
 * so "published" and "folds live" were different sets and several readers keyed
 * on the difference. They are the same set now, and the one thing still unique
 * to SPR here is the ranking-point layer.
 */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "spr"] as const;

export type PublishedAlgorithmId = (typeof PUBLISHED_ALGORITHM_IDS)[number];
