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
 * reopened the same split for the SAME reason (Stages 1-4 of that cutover):
 * a second `PIPELINE_ALGORITHM_IDS` constant briefly named the publisher/
 * Worker-WRITE tier (premier id `spr`) while this export stayed on the
 * browser-READ tier (premier id `bpr`, matching the `bpr@` objects still
 * live in R2). Stage 5 of that cutover is this edit: it deletes
 * `PIPELINE_ALGORITHM_IDS` and moves this export's value to the renamed
 * triple, once the write pass (Stage 2) made the `spr@` objects live for the
 * browser to request.
 */

/**
 * D-03/D-05: the published set, in display order — `vpr` (formerly the retired
 * id) renamed by plan 07-18, once 07-17's write pass made the `vpr@` objects
 * live.
 *
 * `bpr` joined 2026-09-08 (quick task 260908-b4t) and became SigmaScout's
 * premier algorithm on 2026-09-09. Its parameters were frozen on 2016-2022
 * evidence alone and evaluated once against a sealed 2023-2026 holdout — see
 * `packages/core/algorithms/spr.ts` for the provenance that number depends
 * on. Quick task 260912-ivg (2026-09-12) renamed the identifier itself from
 * `bpr` to `spr` (Sigma Power Rating) — the same algorithm, the same frozen
 * parameters, matching the DISPLAY name the site has used since 2026-09-10.
 * See `docs/models/bpr-spr-identity.md` for the durable "same algorithm, two
 * names" note.
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
 *   - the rank SIMULATION (needs `redRpPmf`/`blueRpPmf`; SPR — then still named
 *     `bpr` — emitted none, and no `v1/presim/…/bpr@…` sidecar existed —
 *     measured 404 on 2026-09-09 against VPR's 200), so the Simulation tab
 *     was unreachable for every algorithm at the time this note was written;
 *   - the per-bonus RP dots in the match tables (`redBonusRp`/`blueBonusRp`).
 * Both degrade to their existing absent-data states rather than breaking. See
 * `.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md`
 * for the plan to rebuild ranking points as a SigmaScout-layer feature.
 */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "spr"] as const;

export type PublishedAlgorithmId = (typeof PUBLISHED_ALGORITHM_IDS)[number];
