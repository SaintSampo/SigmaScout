/**
 * D-05 fallback for matches TBA shipped without a `score_breakdown`: still
 * predict normally, still update state, via a proportional-residual split
 * across components rather than a silent drop or a coerced zero
 * (RESEARCH.md Anti-Patterns: "Treating a missing score_breakdown as
 * zero-valued components" is explicitly named as the failure mode this
 * module exists to avoid — PITFALLS.md Pitfall 5).
 *
 * Measured scale (`data/corpus.sqlite`, queried this session, played
 * matches only): 562 (2022), 356 (2023), 334 (2024), 265 (2025), and 0
 * (2026) matches have `has_score_breakdown = 0` — 1,517 in total. Small
 * relative to ~104,000 played matches across 2022-2026, but exactly the
 * population a silent drop would hide in.
 */
import type { ParsedComponents } from "./index.js";

/**
 * The per-component split below is IMPUTED from the alliance's own current
 * predicted shares, not observed directly — so an algorithm that carries
 * measurement noise (Sigma1, a later plan) should treat a fallback
 * observation as proportionally less informative than a real one. Mirrors
 * `opr.ts`'s `OPR_RIDGE_LAMBDA` reasoning style: a small, documented
 * constant chosen for a defensible qualitative property, not derived from
 * data. EPA carries no variance channel and does not consume this constant
 * itself; it exists here so Sigma1's fallback wiring has it ready-made
 * rather than re-deriving the same reasoning.
 * Phase 3 hyperparameter, default unverified.
 */
export const FALLBACK_NOISE_MULTIPLIER = 3;

/**
 * Distributes `observedTotal` across every name in `componentNames`, in
 * proportion to that component's current predicted share
 * (`predictedComponents[name]`) of the alliance's total predicted score
 * (CONTEXT.md D-05: "in proportion to their current expected shares").
 *
 * Degenerate case — every predicted component is 0 (a genuinely cold-start
 * alliance with no observations yet for either teammate): falls back to a
 * UNIFORM split across `componentNames` rather than dividing by zero. This
 * is the right degenerate answer, not an arbitrary one: a cold-start
 * alliance has no basis whatsoever for a non-uniform split (there is
 * nothing yet to be proportional TO), and D-05 requires that nothing be
 * dropped from the learning stream — throwing here would silently drop
 * exactly the matches this function exists to keep.
 *
 * A component whose predicted share is exactly 0 while others are positive
 * receives exactly 0 from the split — it is not resurrected by the
 * fallback, only reweighted among the components that already carry
 * predicted mass.
 */
export function distributeResidual(
  observedTotal: number,
  predictedComponents: ParsedComponents,
  componentNames: readonly string[]
): ParsedComponents {
  const result: ParsedComponents = Object.create(null) as ParsedComponents;
  if (componentNames.length === 0) return result;

  let predictedTotal = 0;
  for (const name of componentNames) {
    predictedTotal += predictedComponents[name] ?? 0;
  }

  if (predictedTotal === 0) {
    const uniformShare = observedTotal / componentNames.length;
    for (const name of componentNames) result[name] = uniformShare;
    return result;
  }

  for (const name of componentNames) {
    const predictedShare = predictedComponents[name] ?? 0;
    result[name] = observedTotal * (predictedShare / predictedTotal);
  }
  return result;
}
