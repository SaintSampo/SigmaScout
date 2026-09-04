/**
 * The ONE place `tune.ts`'s search objective and screen objective are stated
 * in words (quick task 260904-oiu, OBJ-DOCS). Both `tune.ts` (the tracer,
 * screen and joint artifacts' own `objective` string) and `promote.ts` (the
 * `provenance.objectiveDefinition` field it writes into a promoted file) IMPORT
 * these two constants rather than each carrying its own literal — a second
 * literal is exactly how a promoted file could end up describing a rule that
 * no longer exists (this file's own `<key_links>` in the plan that created it).
 *
 * Deliberately a LEAF module — NO IMPORTS — because `tune.ts` already imports
 * `promote.ts`, so these constants cannot live in `tune.ts` without creating
 * an import cycle.
 */

/**
 * The JOINT SEARCH's objective (D-01 retired; accuracy-primary/Brier-secondary,
 * quick task 260904-oiu): winner accuracy is PRIMARY and MAXIMIZED. When two
 * candidates' accuracy differs by less than one event-blocked
 * PAIRED-DIFFERENCE standard error of the accuracy delta (the noise band,
 * `eventBlockedBootstrap`), they are treated as accuracy-tied and the LOWER
 * mean tune-season `brierScore` (combined `compLevelView`) decides instead.
 * The same rule, on the same accuracy definition (`scoreSet`'s own), governs
 * D-T7's ship/don't-ship acceptance bar in `acceptance.ts`.
 */
export const SEARCH_OBJECTIVE_DEFINITION =
  "winner accuracy (mean per-season winnerAccuracy, combined compLevelView) is PRIMARY and MAXIMIZED; when two " +
  "candidates' accuracy differs by less than one event-blocked paired-difference standard error of the accuracy " +
  "delta (the noise band), they are accuracy-tied and the LOWER mean tune-season brierScore (combined " +
  "compLevelView) decides instead (accuracy-primary/Brier-secondary, D-01 retired, quick task 260904-oiu)";

/**
 * The SENSITIVITY SCREEN's objective, deliberately DIFFERENT from the joint
 * search's above: the screen keeps minimizing mean tune-season `brierScore`
 * (combined `compLevelView`), unchanged. Brier is strictly more sensitive
 * than accuracy — every accuracy-relevant knob moves Brier, but not every
 * Brier-relevant knob moves a discrete accuracy call — so a Brier-based
 * screen catches every accuracy-relevant parameter, while an accuracy-based
 * screen would surface FEWER survivors, not more. See
 * `docs/models/sigma1-sensitivity-screen.md` for the published rationale.
 */
export const SCREEN_OBJECTIVE_DEFINITION =
  "mean tune-season brierScore (combined compLevelView), minimized — the screen deliberately keeps the Brier " +
  "objective even though the joint search moved to accuracy-primary (quick task 260904-oiu): Brier is strictly " +
  "more sensitive than accuracy, so a Brier-based screen catches every accuracy-relevant knob, while an " +
  "accuracy-based screen would surface FEWER parameters, not more";
