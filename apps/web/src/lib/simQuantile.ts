/**
 * Sketch 005's continuous quantile estimator, RE-EXPORTED.
 *
 * The implementation now lives at
 * `packages/core/algorithms/simulation/continuousQuantile.ts`, promoted there
 * by phase 10 plan 10-04 so that `packages/core` and the Node pipeline can
 * reach it — the district points ledger runs the same estimator on a POINTS
 * histogram, and `packages/core` cannot import upward into `apps/web`. That
 * module's header carries the whole doc comment: the three defects sketch 005
 * measured and fixed, the MUST-NOT-be-reimplemented instruction, the
 * `ArrayLike` reasoning, the bounded-by-construction argument, and the rule
 * reserving the one-standard-deviation glyph.
 *
 * THIS PATH STILL EXISTS because four importers use it and none of them
 * changed: `apps/web/src/components/event/rankRows.ts`,
 * `apps/web/src/lib/simAxis.test.ts`, `apps/web/src/lib/simQuantile.test.ts`
 * and `scripts/measureFieldAveragedRanks.ts`. The last reaches from
 * `scripts/` into `apps/web/src/lib/`; this re-export keeps that import
 * working while the layering inversion underneath it is gone. The shipped
 * `simQuantile.test.ts` is the promotion's regression oracle and imports
 * through this file, unedited.
 */
export { continuousQuantile } from "../../../../packages/core/algorithms/simulation/continuousQuantile.js";
