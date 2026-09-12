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
 * renamed objects live in R2 — the sole export below served both the
 * publisher/Worker and the browser again, until quick task 260912-ivg
 * reopened the same split for the SAME reason: see the second export below.
 *
 * 260912-ivg (Stage 1 of the BPR -> SPR identifier cutover): this file once
 * again carries TWO constants, deliberately kept apart, because the two
 * genuinely name different facts right now — the pipeline is about to write
 * `spr@` objects but no deployed browser can request them yet. Only the
 * third member differs between the two exports below. Stage 5 of that same
 * cutover is what deletes `PIPELINE_ALGORITHM_IDS` and moves
 * `PUBLISHED_ALGORITHM_IDS`'s value to match it, exactly as plan 07-18 did
 * for the `sigma1` -> `vpr` rename this mirrors.
 */

/**
 * D-03/D-05: the published set, in display order — `vpr` (formerly the retired
 * id) renamed by plan 07-18, once 07-17's write pass made the `vpr@` objects
 * live.
 *
 * `bpr` joined 2026-09-08 (quick task 260908-b4t) and is SigmaScout's premier
 * algorithm as of 2026-09-09. Its parameters were frozen on 2016-2022 evidence
 * alone and evaluated once against a sealed 2023-2026 holdout — see
 * `packages/core/algorithms/spr.ts` for the provenance that number depends on
 * (the algorithm's DISPLAY name has been "SPR" since 2026-09-10; this export's
 * wire id below is deliberately still `bpr`, because the `bpr@` R2 objects
 * are the only ones that exist today — see the note on `PIPELINE_ALGORITHM_IDS`
 * below for the identifier-layer rename this is mid-way through).
 *
 * `vpr` was REMOVED from the published set on 2026-09-09 (developer decision):
 * it is no longer offered anywhere on the site, no longer folds live, and no
 * longer appears in the methodology. The model code under
 * `packages/core/algorithms/sigma1/` is left in place for now — this list is
 * what the site reads, so dropping the id here is what retires it — and the
 * already-published `vpr@` objects in R2 are simply left unreferenced rather
 * than deleted.
 *
 * TWO CAPABILITIES LEAVE WITH IT, and neither is replaced yet, because VPR was
 * the only algorithm that modelled ranking points:
 *   - the rank SIMULATION (needs `redRpPmf`/`blueRpPmf`; BPR emits none, and no
 *     `v1/presim/…/bpr@…` sidecar exists — measured 404 on 2026-09-09 against
 *     VPR's 200), so the Simulation tab is now unreachable for every algorithm;
 *   - the per-bonus RP dots in the match tables (`redBonusRp`/`blueBonusRp`).
 * Both degrade to their existing absent-data states rather than breaking. See
 * `.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md`
 * for the plan to rebuild ranking points as a SigmaScout-layer feature.
 */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "bpr"] as const;

export type PublishedAlgorithmId = (typeof PUBLISHED_ALGORITHM_IDS)[number];

/**
 * 260912-ivg (Stage 1 of the BPR -> SPR identifier cutover, mirroring plan
 * 07-16's PD-01): the PUBLISHER/WORKER-facing tier, added beside
 * `PUBLISHED_ALGORITHM_IDS` rather than in place of it, for the duration of
 * this cutover's transition window (Stages 1-4).
 *
 * `PUBLISHED_ALGORITHM_IDS` above names the ids that currently have LIVE
 * OBJECTS IN R2 — the ids a deployed browser may actually request today.
 * `PIPELINE_ALGORITHM_IDS` names the ids the publisher (`publish.ts`) and the
 * Worker (`scheduled.ts`) WRITE under, starting with this plan. During this
 * transition window BOTH statements are true at once, and the two sets
 * genuinely differ (only the third member moves: `bpr` -> `spr`) — that
 * difference is the entire safety property the two-tier split exists for: no
 * stage may have the browser reading a prefix nothing has written yet.
 *
 * The lifecycle is explicit and named by stage, in `260912-ivg-PLAN.md`:
 *   - Stage 2 writes the new `spr@` objects to R2, additively — the old
 *     `bpr@` objects are untouched, so `PUBLISHED_ALGORITHM_IDS` staying put
 *     through Stage 2 is what keeps the deployed site working.
 *   - Stage 5 collapses the two constants back into one: it moves
 *     `PUBLISHED_ALGORITHM_IDS`'s value to the renamed triple and DELETES
 *     `PIPELINE_ALGORITHM_IDS` entirely, once the new objects exist for the
 *     browser to request.
 *   - Stage 6 deletes the retired `bpr@` objects from R2 and the
 *     `algorithm_id = 'bpr'` rows from D1.
 *
 * Consumed by exactly three publisher/Worker-side call sites —
 * `resolvePublishAlgorithms`'s default set (`publish.ts`),
 * `parseLiveAlgorithmIds`'s validation set (`scheduled.ts`), and
 * `replayRig.ts`'s default `--algorithm` list. Nothing in `apps/web` imports
 * this constant. Kept in THIS file (zero imports, zero Node built-ins) so it
 * stays as safe on the browser's import graph as `PUBLISHED_ALGORITHM_IDS`
 * itself, even though nothing in `apps/web` currently reaches it.
 */
export const PIPELINE_ALGORITHM_IDS = ["opr", "epa", "spr"] as const;

export type PipelineAlgorithmId = (typeof PIPELINE_ALGORITHM_IDS)[number];
