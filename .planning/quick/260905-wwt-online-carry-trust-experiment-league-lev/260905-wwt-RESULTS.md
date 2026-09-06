# Quick task 260905-wwt: Online carry-trust experiment — RESULTS

## Motivation

Stage 2's `carryVarianceFactor` tune (see `.planning/todos/completed/retune-sigma1-rolling-origin.md`,
"RESULTS — Stage 2 carryVarianceFactor tune" table) posted the strongest challenger result
ever measured against `rolling-2026-09b`: 2025/on-arm was +0.41pt out-of-sample accuracy WITH
better Brier at a confident boundary-variance factor of 0.845 — missing the D-T7 acceptance bar
by only 0.005pt. The same set of ten verdicts also confirmed a persistent pattern: 2024 has now
gone 0-for-16 accuracy-positive across every carry-variance formulation tried (Stage 2, Stage 3,
and the earlier elim-R work), making it the one season where a confident carry seed reliably
costs accuracy. The Rule A DECISION section of the same file ("DECISION — Rule A adopted and
FIRST SHIPPED") records that the operator accepted this pattern-break risk with eyes open when
promoting `vpr@9.0.0+rolling-2026-09c`'s 2025/2026 carry knobs, explicitly flagging it as a risk
to revisit rather than a closed question.

This experiment asks whether an online, walk-forward-learned "carry reliability" signal can let
VPR seed season boundaries at the confident level Stage 2 found promising while AUTOMATICALLY
defusing the 2024-style pattern-break case — turning an accepted risk into a self-correcting
mechanism, or recording on measurement that it cannot be done this way.

## Two arms

- **Arm S** (seed alone): every carried team's boundary variance is seeded at exactly half the
  cold-start variance (`0.5`), replacing the promoted `carryVarianceFactor * evidenceFactor`
  product rather than composing with it (P-3).
- **Arm SR** (seed + rescue): identical seed, PLUS a league-level online trust accumulator
  (`carryTrust`, an EWMA of squared normalized innovations from carried teams' early matches)
  that multiplies a carried team's process noise upward — one-sided, never downward — when the
  league is collectively mispredicting carried teams.

SR-minus-S isolates the rescue's effect. Arm SR's diff below CONTAINS Arm S's diff verbatim
(same constant declaration, same `carrySeason` ternary replacement) — confirmed by direct
comparison of the two working-tree diffs captured during Task 2/Task 3 of this quick task; the
containment is what makes the SR-minus-S delta measure the rescue and nothing else.

## Exact diffs

### Arm S diff

```diff
diff --git a/packages/core/algorithms/sigma1/index.ts b/packages/core/algorithms/sigma1/index.ts
index f1c4f80f..528809af 100644
--- a/packages/core/algorithms/sigma1/index.ts
+++ b/packages/core/algorithms/sigma1/index.ts
@@ -305,6 +305,13 @@ export interface Sigma1State extends BreakdownParseTelemetry {
 
 const EMPTY_PRIOR_SEASON_RATINGS: EpaCarryoverPriorRatings = { lastSeason: new Map(), yearBefore: new Map() };
 
+// EXPERIMENT-ONLY SCAFFOLDING (quick task 260905-wwt, Arm S). Never shipped:
+// no Sigma1Params field, no SIGMA1_CODE_VERSION bump. Working-tree-only,
+// reverted after replay. The confident carry-seed factor REPLACES (does not
+// compose with) resolved.carryVarianceFactor * evidenceFactor at the
+// carrySeason seed site — see the plan's P-3.
+const EXPERIMENT_260905_WWT_CARRY_SEED_FACTOR = 0.5;
+
 function initState(): Sigma1State {
   return {
     season: null,
@@ -1915,9 +1922,9 @@ function carrySeason(state: Sigma1State, boundary: SeasonBoundary, params: Sigma
       // intermediate result and then scale the floor, a different (and
       // wrong) mechanism.
       const seededVariance =
-        (resolved.carryVarianceFactor === 1 && resolved.carryEvidenceRate === 0) || oldTeamState === undefined
+        oldTeamState === undefined
           ? coldStartVariance
-          : Math.max(resolved.minConsistencyVariance, coldStartVariance * resolved.carryVarianceFactor * evidenceFactor);
+          : Math.max(resolved.minConsistencyVariance, coldStartVariance * EXPERIMENT_260905_WWT_CARRY_SEED_FACTOR);
       beliefs[name] = { mean: share, variance: seededVariance };
       const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
       consistency[name] = carriedObserved * consistencyDecayOverGap;
```

### Arm SR diff (contains Arm S's diff verbatim — see the constant declaration and the
`carrySeason` ternary replacement, character-identical to the Arm S diff above)

```diff
diff --git a/packages/core/algorithms/sigma1/index.ts b/packages/core/algorithms/sigma1/index.ts
index f1c4f80f..5d17e739 100644
--- a/packages/core/algorithms/sigma1/index.ts
+++ b/packages/core/algorithms/sigma1/index.ts
@@ -227,6 +227,16 @@ export interface Sigma1TeamState extends RpTeamState {
    * `lastEventKey`, and an event with no accumulator).
    */
   readonly swing: TeamSwing;
+  /**
+   * EXPERIMENT-ONLY (quick task 260905-wwt, Arm SR, P-4). True when this team
+   * entered the current season through a season boundary WITH carried state
+   * (`carrySeason`, oldTeamState !== undefined). Optional so every existing
+   * team-state construction (`...working` in `applyAllianceUpdate`,
+   * `...existing` in the RP merge, `coldStartTeamState`) keeps typechecking
+   * unchanged — only `carrySeason` ever writes this field. Never shipped: no
+   * Sigma1Params field, no SIGMA1_CODE_VERSION bump.
+   */
+  readonly carriedFromPriorSeason?: boolean;
 }
 
 /**
@@ -291,6 +301,17 @@ export interface Sigma1State extends BreakdownParseTelemetry {
    * merely zero, the honest neutral.
    */
   readonly elimScoreOffset: ElimScoreOffset;
+  /**
+   * EXPERIMENT-ONLY (quick task 260905-wwt, Arm SR, P-5). The league-level
+   * online carry-trust EWMA accumulator, read pre-match in `update` (defaulted
+   * to 1 when absent) and folded post-match from both alliances' trust
+   * observations. RESET to 1 in `initState` and in `carrySeason`'s returned
+   * literal — the same reset-at-boundary reasoning `elimScoreOffset` documents
+   * above. Optional, beside `allianceScoreStats`, not inside `Sigma1League`
+   * (which holds only per-component maps). Never shipped: no Sigma1Params
+   * field, no SIGMA1_CODE_VERSION bump.
+   */
+  readonly carryTrust?: number;
   // D-Y3 (quick task 260903-750): `perEventVariance` — the retired variance
   // decomposition's per-event normal equations — IS GONE. The published `±` is
   // now one running number per team per metric key (`Sigma1TeamState.swing`),
@@ -305,6 +326,21 @@ export interface Sigma1State extends BreakdownParseTelemetry {
 
 const EMPTY_PRIOR_SEASON_RATINGS: EpaCarryoverPriorRatings = { lastSeason: new Map(), yearBefore: new Map() };
 
+// EXPERIMENT-ONLY SCAFFOLDING (quick task 260905-wwt). Never shipped: no
+// Sigma1Params field, no SIGMA1_CODE_VERSION bump. Working-tree-only,
+// reverted after replay.
+//
+// Arm S: the confident carry-seed factor REPLACES (does not compose with)
+// resolved.carryVarianceFactor * evidenceFactor at the carrySeason seed
+// site — see the plan's P-3.
+const EXPERIMENT_260905_WWT_CARRY_SEED_FACTOR = 0.5;
+// Arm SR only, beside Arm S's seed constant above (P-1/P-2/P-5): the trust
+// accumulator's EWMA alpha, the early-window match count the signal AND the
+// rescue both act on, and the rescue's one-sided upper clamp.
+const EXPERIMENT_260905_WWT_TRUST_EWMA_ALPHA = 0.05;
+const EXPERIMENT_260905_WWT_EARLY_WINDOW_MATCHES = 12;
+const EXPERIMENT_260905_WWT_RESCUE_MAX_FACTOR = 8;
+
 function initState(): Sigma1State {
   return {
     season: null,
@@ -318,6 +354,10 @@ function initState(): Sigma1State {
     // ELIM-OFF (quick task 260904-v9n): a never-observed cold start, same
     // reasoning as every other cumulative accumulator in this state.
     elimScoreOffset: emptyElimScoreOffset(),
+    // EXPERIMENT (quick task 260905-wwt, Arm SR, P-5): the "correctly
+    // specified" cold value, the same prior emptyInnovationStats documents
+    // for its per-team analogue.
+    carryTrust: 1,
   };
 }
 
@@ -446,7 +486,12 @@ function coldStartTeamState(
   };
 }
 
-function applyTeamProcessNoise(teamState: Sigma1TeamState, eventKey: string, params: Sigma1ResolvedParams): Sigma1TeamState {
+function applyTeamProcessNoise(
+  teamState: Sigma1TeamState,
+  eventKey: string,
+  params: Sigma1ResolvedParams,
+  carryTrust: number
+): Sigma1TeamState {
   // A team with no prior observation (lastEventKey === null) is treated as
   // "within event" — it was just cold-start-seeded this instant, so there
   // is nothing to have drifted since a nonexistent last observation, and
@@ -464,7 +509,24 @@ function applyTeamProcessNoise(teamState: Sigma1TeamState, eventKey: string, par
   // the disabled path — this is what keeps adaptation-off byte-identical
   // to the pre-adaptation module (`params.test.ts`'s identity test proves
   // this end to end, plan 03-04 Task 2).
-  const scaledQ = q * adaptationFactor(teamState.innovationStats, params);
+  const adaptedQ = q * adaptationFactor(teamState.innovationStats, params);
+  // EXPERIMENT (quick task 260905-wwt, Arm SR, P-2): the online rescue,
+  // applied AFTER adaptationFactor — a one-sided multiplier that can only
+  // ever shed priors faster, never slow the filter down. Eligible only when
+  // this team entered the season carried (P-4) AND its (pre-increment)
+  // matchCount is below the early-window constant (P-1) — a carried team's
+  // matches 1 through EXPERIMENT_260905_WWT_EARLY_WINDOW_MATCHES are the
+  // rescued ones. The explicit `=== 1` skip below is the same discipline
+  // carryVarianceFactor's own `=== 1` branch documents, and is what makes
+  // the 2022 cold-start control a proof rather than a floating-point hope:
+  // no team is ever marked carried in 2022, so this branch is dead code
+  // there by construction.
+  const rescueEligible =
+    teamState.carriedFromPriorSeason === true && teamState.matchCount < EXPERIMENT_260905_WWT_EARLY_WINDOW_MATCHES;
+  const rescueFactor = rescueEligible
+    ? Math.min(EXPERIMENT_260905_WWT_RESCUE_MAX_FACTOR, Math.max(1, Math.sqrt(carryTrust)))
+    : 1;
+  const scaledQ = rescueFactor === 1 ? adaptedQ : adaptedQ * rescueFactor;
   const beliefs: Record<string, TeamComponentBelief> = {};
   for (const [name, belief] of Object.entries(teamState.beliefs)) {
     // D-5 Sigma1 seam 4 (quick task 260904-6a1): `adjust`'s mean never
@@ -634,6 +696,14 @@ interface AllianceUpdateResult {
    * magnitude (which the gain-weighted share is not).
    */
   readonly residualsByTeam: ReadonlyMap<string, readonly number[]>;
+  /**
+   * EXPERIMENT-ONLY (quick task 260905-wwt, Arm SR, P-1). This alliance's
+   * trust observations — the ALREADY-COMPUTED `meanSquaredNormalizedInnovation`
+   * (below) for each teammate marked carried whose PRE-increment `matchCount`
+   * is below the early-window constant. Empty for an all-surrogate alliance.
+   * Folded into `Sigma1State.carryTrust` by `update`, after both alliances.
+   */
+  readonly trustObservations: readonly number[];
 }
 
 /**
@@ -658,7 +728,8 @@ function applyAllianceUpdate(
   eventKey: string,
   params: Sigma1ResolvedParams,
   rpVariableCount: number,
-  varianceGroups: Readonly<Record<string, readonly string[]>>
+  varianceGroups: Readonly<Record<string, readonly string[]>>,
+  carryTrust: number
 ): AllianceUpdateResult {
   if (allianceTeams.length === 0) {
     // Every team on this alliance was a surrogate — nothing to attribute,
@@ -667,7 +738,7 @@ function applyAllianceUpdate(
     // array). D-Y3: no swing is folded here either, so the all-surrogate and
     // whole-alliance-DQ-zero cases are covered by this ONE pre-existing early
     // return rather than by a second eligibility rule that could drift from it.
-    return { teams, league, residualsByTeam: new Map() };
+    return { teams, league, residualsByTeam: new Map(), trustObservations: [] };
   }
 
   const workingTeams = new Map<string, Sigma1TeamState>();
@@ -676,7 +747,7 @@ function applyAllianceUpdate(
     workingTeams.set(
       team,
       existing
-        ? applyTeamProcessNoise(existing, eventKey, params)
+        ? applyTeamProcessNoise(existing, eventKey, params, carryTrust)
         : coldStartTeamState(componentOrder, league, params, rpVariableCount)
     );
   }
@@ -926,6 +997,10 @@ function applyAllianceUpdate(
     squaredDeviationByKey[metricKey] = squaredResidual / (teamCount * teamCount);
   }
 
+  // EXPERIMENT-ONLY (quick task 260905-wwt, Arm SR, P-1): this alliance's
+  // trust observations, collected in the loop below.
+  const trustObservations: number[] = [];
+
   const nextTeams = new Map(teams);
   for (const team of allianceTeams) {
     const working = workingTeams.get(team)!;
@@ -954,6 +1029,18 @@ function applyAllianceUpdate(
         : 0;
     const aggregateNormalizedInnovation = Math.sqrt(meanSquaredNormalizedInnovation);
 
+    // EXPERIMENT (quick task 260905-wwt, Arm SR, P-1): fold this team's
+    // ALREADY-COMPUTED meanSquaredNormalizedInnovation into the alliance's
+    // trust observations — never recomputed — ONLY for a carried team whose
+    // pre-increment matchCount is still below the early-window constant. The
+    // signal window and the rescue's action window are therefore the same
+    // window (P-1's correctness argument: folding matches from teams whose
+    // priors have already washed out would drag the accumulator back to its
+    // inert value within days).
+    if (working.carriedFromPriorSeason === true && working.matchCount < EXPERIMENT_260905_WWT_EARLY_WINDOW_MATCHES) {
+      trustObservations.push(meanSquaredNormalizedInnovation);
+    }
+
     nextTeams.set(team, {
       // `...working` first so this alliance-update pass never touches RP
       // fields (`rpBeliefs`/`rpCovariance`/`rpCrossCovariance`, D-09) —
@@ -979,6 +1066,7 @@ function applyAllianceUpdate(
     // RP data.
     league: { ...league, componentMean: nextComponentMean, componentConsistency: nextComponentConsistency },
     residualsByTeam,
+    trustObservations,
   };
 }
 
@@ -1388,6 +1476,14 @@ function update(state: Sigma1State, result: MatchResult, params: Sigma1Params):
     }
   }
 
+  // EXPERIMENT (quick task 260905-wwt, Arm SR, P-5): read the accumulator
+  // from `state` BEFORE either alliance update — the same PRE-fold placement
+  // Pitfall EPA-1's `allianceScoreStats` resolve above already uses — and
+  // pass this SAME pre-match value to BOTH calls. That is the walk-forward
+  // guarantee: a match's own two alliances can never influence the trust
+  // value their own update is performed under.
+  const preMatchCarryTrust = state.carryTrust ?? 1;
+
   const afterRed = applyAllianceUpdate(
     state.teams,
     state.league,
@@ -1398,7 +1494,8 @@ function update(state: Sigma1State, result: MatchResult, params: Sigma1Params):
     result.eventKey,
     resolved,
     rpVariableCount,
-    varianceGroups
+    varianceGroups,
+    preMatchCarryTrust
   );
   const afterBlue = applyAllianceUpdate(
     afterRed.teams,
@@ -1410,12 +1507,23 @@ function update(state: Sigma1State, result: MatchResult, params: Sigma1Params):
     result.eventKey,
     resolved,
     rpVariableCount,
-    varianceGroups
+    varianceGroups,
+    preMatchCarryTrust
   );
   // D-Y3: no event-level accumulator is threaded any more. Swing lives on each
   // TEAM (`Sigma1TeamState.swing`), so `applyAllianceUpdate` carries it in the
   // team map it already returns and there is nothing to write back here.
 
+  // EXPERIMENT (quick task 260905-wwt, Arm SR, P-5): fold the red
+  // observations, THEN the blue observations, into a new accumulator value
+  // with the standard EWMA form — after both calls, so this match's own
+  // trust observations only ever affect the NEXT match's rescue factor.
+  let carryTrust = preMatchCarryTrust;
+  for (const observation of [...afterRed.trustObservations, ...afterBlue.trustObservations]) {
+    carryTrust =
+      (1 - EXPERIMENT_260905_WWT_TRUST_EWMA_ALPHA) * carryTrust + EXPERIMENT_260905_WWT_TRUST_EWMA_ALPHA * observation;
+  }
+
   // Pitfall EPA-1's fix, reused here: fold each alliance's observed total
   // into the expanding-window SD — the score itself is always known, even
   // when its breakdown is not — EXCEPT a ruling-zero (either encoding above),
@@ -1554,6 +1662,10 @@ function update(state: Sigma1State, result: MatchResult, params: Sigma1Params):
     rpSkippedMatchCount,
     breakdownParseFailureCount,
     elimScoreOffset,
+    // EXPERIMENT (quick task 260905-wwt, Arm SR, P-5): folded from BOTH
+    // alliances' trust observations above, after both `applyAllianceUpdate`
+    // calls completed — never influences the update it was computed under.
+    carryTrust,
   };
 }
 
@@ -1914,10 +2026,17 @@ function carrySeason(state: Sigma1State, boundary: SeasonBoundary, params: Sigma
       // never two sequential clamps, since clamping twice would floor the
       // intermediate result and then scale the floor, a different (and
       // wrong) mechanism.
+      // EXPERIMENT (quick task 260905-wwt, Arm S/SR, P-3): the hardcoded 0.5
+      // seed REPLACES resolved.carryVarianceFactor * evidenceFactor rather
+      // than composing with it. The inert branch now fires ONLY on
+      // oldTeamState === undefined (a genuinely never-before-seen team), so
+      // 2022 (the cold-start season, which returns above before this loop
+      // ever runs) never reaches the active branch at all — that is what
+      // makes 2022 the free control.
       const seededVariance =
-        (resolved.carryVarianceFactor === 1 && resolved.carryEvidenceRate === 0) || oldTeamState === undefined
+        oldTeamState === undefined
           ? coldStartVariance
-          : Math.max(resolved.minConsistencyVariance, coldStartVariance * resolved.carryVarianceFactor * evidenceFactor);
+          : Math.max(resolved.minConsistencyVariance, coldStartVariance * EXPERIMENT_260905_WWT_CARRY_SEED_FACTOR);
       beliefs[name] = { mean: share, variance: seededVariance };
       const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
       consistency[name] = carriedObserved * consistencyDecayOverGap;
@@ -1943,6 +2062,11 @@ function carrySeason(state: Sigma1State, boundary: SeasonBoundary, params: Sigma
       // level up. Every team resets to the cold-start "assume correctly
       // specified" prior, never carries a converged factor forward.
       innovationStats: emptyInnovationStats(),
+      // EXPERIMENT (quick task 260905-wwt, Arm SR, P-4): marks whether this
+      // team entered the incoming season carried (oldTeamState defined) — the
+      // SAME predicate the seed edit above already gates on, so the marker
+      // and the seed factor agree by construction.
+      carriedFromPriorSeason: oldTeamState !== undefined,
       ...emptyRpTeamState(toRpVariableCount, toComponentOrder.length),
     });
   }
@@ -1977,6 +2101,10 @@ function carrySeason(state: Sigma1State, boundary: SeasonBoundary, params: Sigma
     // under one season's scoring rules, and a stale bias is actively wrong
     // where a missing one is merely zero, the honest neutral.
     elimScoreOffset: emptyElimScoreOffset(),
+    // EXPERIMENT (quick task 260905-wwt, Arm SR, P-5): RESET at every season
+    // boundary — the same reasoning `elimScoreOffset` documents immediately
+    // above.
+    carryTrust: 1,
   };
 }
```

## Planner decisions restated

**P-1 — The trust signal folds ONLY early-window observations.** Narrowed from "pool
observations from carried teams" to carried teams whose pre-increment `matchCount` is below the
same 12-match window the rescue acts on. Reason: at alpha 0.05 the EWMA tracks roughly the last
20 observations, and by week 2 of a season the overwhelming majority of carried-team matches come
from teams whose priors have already washed out (normalized innovations back near 1). Folding
those would drag the accumulator back to its inert value within days, denying rescue to a team
debuting in week 5 of a pattern-break season — exactly the case the mechanism exists to serve.
Signal window and action window are therefore the same window.

**P-2 — The rescue is injected in `applyTeamProcessNoise`,** as a multiplier applied to
`scaledQ` AFTER `adaptationFactor`, guarded by an explicit branch that skips the multiplication
entirely when the factor is exactly 1. That one function is the sole consumer of the
process-noise magnitude and already has both `teamState` and `params` in scope (no new
plumbing), and the explicit skip branch is what makes the 2022 cold-start control a proof rather
than a floating-point hope.

**P-3 — The hardcoded 0.5 seed REPLACES the promoted `carryVarianceFactor * evidenceFactor`
product; it does not compose with it.** Both arms seed every carried team at exactly half the
cold-start variance in every season. **2025 reading (must be read with this in mind):** the
live-promoted baseline already carries `carryVarianceFactor = 0.845` for 2025 (see
`data/algorithm-versions/vpr@9.0.0+rolling-2026-09c.json`), so 2025's arm-vs-baseline delta
measures a move from 0.845 to 0.5 — a much smaller absolute seed change than every other season,
which measures a move from 1.0 to 0.5. 2025 is also the season Stage 2 found most promising. The
measured 2025 result below (S: -1.33 SE, SR: -1.28 SE, both accuracy-negative vs baseline) should
be read as "moving 2025's already-tuned confident seed further in the same direction did not
help," not as "confident seeding fails on 2025" — the comparison starting points differ by
season.

**P-4 — Carried teams are marked with an OPTIONAL field on `Sigma1TeamState`
(`carriedFromPriorSeason`),** set only in `carrySeason`. Every downstream construction of a team
state either spreads the existing object or is `coldStartTeamState`, which correctly leaves it
absent — one write site, zero propagation code.

**P-5 — The accumulator lives as an OPTIONAL field on `Sigma1State` (`carryTrust`),** reset to 1
in both `initState` and `carrySeason`'s returned literal, read pre-match in `update`, folded
post-match from both alliances' observations. Same top-level placement and reset-at-boundary
reasoning `elimScoreOffset` already documents — a league-level scalar statistic, beside
`allianceScoreStats`, not inside `Sigma1League`.

## Commands run

Both arm replays used the IDENTICAL command shape, season range, and algorithm id as the reused
baseline — the patch is the only difference:

```
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carrytrust-s-260905
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carrytrust-sr-260905
```

Both completed with scorable counts (14603 / 16290 / 16958 / 17815 / 18337) identical to the
baseline's own reported scorable counts, per season.

**Baseline and epa streams were REUSED, never re-replayed:**
- `reports/rpnoise-baseline-260905/` — `vpr@9.0.0+rolling-2026-09c` (the LIVE promoted set,
  produced by `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-baseline-260905`).
- `reports/autopsy-260905/` — `epa@5.0.0+baseline` rows only (that directory also holds a STALE
  `vpr@8.0.0+rolling-2026-09b` series, excluded on read by the scoring instrument).

## Version guard and 2022 control

Both arm artifacts report `algorithmVersion` `9.0.0+rolling-2026-09c`, identical to the baseline
— proof no version bump or parameter change leaked in alongside the patch (confirmed both by
Task 2's artifact-level guard and the scorer's own per-row version guard, printed below).

**2022 control: both arms' `predictions-2022.jsonl` are BYTE-IDENTICAL (sha256) to the baseline's
2022 stream.** 2022 is the replay's cold-start season — `carrySeason` returns before the seed
loop ever runs, no team is ever marked carried, `carryTrust` never leaves 1, and the rescue's
explicit skip branch never multiplies anything. This is the free control: both patches reach code
that is provably unreachable in 2022, and the measurement confirms it. The arms diverge from
baseline starting in 2023 (the first season with a real boundary).

## Early-slice definition

First-appearance chronological event order (the order events first appear in the baseline
stream, which — because the stream is written by a walk-forward replay — IS chronological
order), taking the first `ceil(eventCount * 0.33)` events of each season as "early." This is the
identical definition Stage 1 (`260905-jyf`) used, so the two experiments' early-slice numbers are
comparable.

## Full per-season and pooled results

Four series: `baseline` (vpr, reused), `epa` (epa rows only, reused), `s` (Arm S, replayed this
task), `sr` (Arm SR, replayed this task). All four scored on ONE matchKey intersection per
season and ONE early-slice event set per season, derived once from the baseline stream. `dropped
_other=0` in every season — the four series' match populations agree exactly.

## Season 2022 (cold-start control)
scored_n=14501 dropped_other=0 ties=176

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| baseline | 0.7637 | 0.1571 | 0.7357 | 4608 | 14501 |  |
| epa | 0.7670 | 0.1628 | 0.7348 | 4608 | 14501 |  |
| s | 0.7637 | 0.1571 | 0.7357 | 4608 | 14501 | 0.00 |
| sr | 0.7637 | 0.1571 | 0.7357 | 4608 | 14501 | 0.00 |
| sr-minus-s | 0.0000 |  |  |  |  | 0.00 |

## Season 2023
scored_n=16207 dropped_other=0 ties=146

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| baseline | 0.7563 | 0.1654 | 0.7402 | 5188 | 16207 |  |
| epa | 0.7623 | 0.1646 | 0.7539 | 5188 | 16207 |  |
| s | 0.7595 | 0.1639 | 0.7429 | 5188 | 16207 | 0.93 |
| sr | 0.7594 | 0.1639 | 0.7433 | 5188 | 16207 | 0.90 |
| sr-minus-s | -0.0001 |  |  |  |  | -0.04 |

## Season 2024 (the pattern-break season)
scored_n=16835 dropped_other=0 ties=194

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| baseline | 0.7451 | 0.1711 | 0.7345 | 5288 | 16835 |  |
| epa | 0.7325 | 0.1884 | 0.7254 | 5288 | 16835 |  |
| s | 0.7446 | 0.1714 | 0.7373 | 5288 | 16835 | -0.12 |
| sr | 0.7448 | 0.1714 | 0.7373 | 5288 | 16835 | -0.09 |
| sr-minus-s | 0.0001 |  |  |  |  | 0.04 |

## Season 2025 (read with P-3's caveat: baseline already carries factor 0.845 here)
scored_n=17754 dropped_other=0 ties=123

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| baseline | 0.7656 | 0.1576 | 0.7371 | 5781 | 17754 |  |
| epa | 0.7763 | 0.1596 | 0.7578 | 5781 | 17754 |  |
| s | 0.7614 | 0.1599 | 0.7307 | 5781 | 17754 | -1.33 |
| sr | 0.7616 | 0.1599 | 0.7310 | 5781 | 17754 | -1.28 |
| sr-minus-s | 0.0002 |  |  |  |  | 0.05 |

## Season 2026
scored_n=18358 dropped_other=0 ties=45

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| baseline | 0.7906 | 0.1438 | 0.7737 | 5878 | 18358 |  |
| epa | 0.7932 | 0.1435 | 0.7800 | 5878 | 18358 |  |
| s | 0.7914 | 0.1448 | 0.7717 | 5878 | 18358 | 0.27 |
| sr | 0.7914 | 0.1448 | 0.7719 | 5878 | 18358 | 0.29 |
| sr-minus-s | 0.0001 |  |  |  |  | 0.02 |

## Pooled (all seasons)
total_dropped_other=0 total_ties=684

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| baseline | 0.7648 | 0.1587 | 0.7450 | 26743 | 83655 |  |
| epa | 0.7669 | 0.1634 | 0.7516 | 26743 | 83655 |  |
| s | 0.7646 | 0.1592 | 0.7442 | 26743 | 83655 | -0.13 |
| sr | 0.7647 | 0.1592 | 0.7444 | 26743 | 83655 | -0.10 |
| sr-minus-s | 0.0000 |  |  |  |  | 0.03 |

TOTAL_SCORED=83655

### Version guard (printed by the scorer)

```
baseline: seen=[9.0.0+rolling-2026-09c] expected=9.0.0+rolling-2026-09c OK
epa: seen=[5.0.0+baseline] expected=5.0.0+baseline OK
s: seen=[9.0.0+rolling-2026-09c] expected=9.0.0+rolling-2026-09c OK
sr: seen=[9.0.0+rolling-2026-09c] expected=9.0.0+rolling-2026-09c OK
```

## Verdict

**Premise check.** Arm S beats the baseline on overall accuracy in 2023 (+0.0032) and 2026
(+0.0008) — two of five seasons, not zero. **Premise NOT failed.** Criteria (a), (b), (c)
evaluated below (all figures computed at full double precision from raw correct/n counts, not
from the rounded table above).

**(a) Retention — PASSES.** Seasons where S's accuracy exceeds baseline's: {2023, 2026}. Pooled
over exactly those two seasons (n=34,565): baseline accuracy 0.774512, S accuracy 0.776421 (gain
+0.001909), SR accuracy 0.776392 (gain +0.001881). **SR retains 98.5% of S's gain** — well above
the 60% bar.

**(b) Rescue of 2024 — FAILS.** 2024 (raw counts): baseline 12543/16835 = 0.745055, S
12536/16835 = 0.744639, SR 12538/16835 = 0.744758. S's 2024 loss = max(0, 0.745055 - 0.744639) =
0.000416 (nonzero — the premise's second half DID reproduce; not vacuous). SR's loss = max(0,
0.745055 - 0.744758) = 0.000297. The rescue reduced the loss by ~29% (0.000416 -> 0.000297), but
the criterion requires SR's loss to be **at most half** of S's loss (<= 0.000208). **0.000297 >
0.000208 — criterion (b) fails.** The rescue measurably shrank the pattern-break cost, but not
enough to clear the pre-committed bar.

**(c) Never the worst option — PASSES.** In every season, SR is never simultaneously below
BOTH baseline and S. (2022: identical to both by construction, the control. 2023: SR is
0.0001 below S but 0.0031 above baseline. 2024: SR is above S and below baseline. 2025: SR is
above S and below baseline. 2026: SR is above both.) No season triggers the "worse than both
by more than 1 baseline-SE" failure condition.

**Overall mechanism verdict: DOES-NOT-VALIDATE.** All three criteria must hold for validation;
(b) fails. The rescue is directionally correct — it always moves 2024 back toward baseline and
never makes 2024 or any other season materially worse — but the measured effect size (a ~29%
reduction in the 2024 loss) falls short of the pre-committed 50% bar, and the rescue's pooled
retention win in (a) is a very small absolute number (98.5% of a 0.0019 gain) riding on the same
small effect sizes throughout.

**Independent Rule-A ship-relevance reading** (per the operator's 2026-09-05 standard: pooled
accuracy up versus baseline AND pooled Brier not worse — see `.planning/todos/completed/
retune-sigma1-rolling-origin.md`, "DECISION — Rule A adopted and FIRST SHIPPED"). Pooled over all
five seasons (n=83,655): baseline accuracy 0.764820 / Brier 0.158707; SR accuracy 0.764676 (delta
**-0.000143**, DOWN) / Brier 0.159183 (delta **+0.000476**, WORSE). **Rule A reading: FAILS both
legs — pooled accuracy is down, not up, and pooled Brier is worse, not equal-or-better.** (Arm S
alone is very slightly worse still on both metrics: accuracy delta -0.000191, Brier delta
+0.000491.) This is a materially different question from the mechanism criteria above, and it
answers NO independently: even setting aside whether the rescue mechanism "works" in isolation,
neither arm's pooled five-season profile clears the bar that actually ships parameter changes in
this project.

**What the carry-variance thread should conclude from this.** The uniform confident seed (0.5)
that Stage 2 found promising specifically at 2025's own tuned level (0.845, not this experiment's
more aggressive 0.5) does not generalize to a flat cross-season seed — pooled across all five
seasons, both arms are accuracy-DOWN and Brier-WORSE versus the live baseline, which already
carries the 2025-specific tuned value. The online rescue is a real, measurable, correctly-signed
mechanism (it shrinks the 2024 pattern-break loss by ~29% while never costing accuracy elsewhere,
and it retains 98.5% of the seed's own gain in the two seasons where the seed helps), but it is
not yet strong enough on its own to clear either the pre-committed mechanism bar or the
independent Rule-A ship bar. A stronger rescue (larger EWMA alpha, larger max clamp, or a
different eligibility window) is the natural next lever if this thread is reopened — but per the
plan's own instruction, that tuning is explicitly OUT of scope here: this result is recorded as a
completed negative measurement, not promoted, tuned, or productionized.

## Reproducibility note

`reports/` is gitignored — none of the four stream sets (`rpnoise-baseline-260905`,
`autopsy-260905`, `carrytrust-s-260905`, `carrytrust-sr-260905`) is recoverable from git. The
baseline and epa/autopsy directories must be regenerated with the commands in their own headers
(see "Commands run" above and the plan's `interface_facts`); the two arm directories must be
regenerated by re-applying the exact diffs above to
`packages/core/algorithms/sigma1/index.ts`, typechecking, running the two `pnpm harness` commands
above, and reverting with `git checkout -- packages/core/algorithms/sigma1/index.ts`. The scoring
instrument (`score-carrytrust.cjs`, committed alongside this file) reproduces every table above
via `node score-carrytrust.cjs --arms s,sr`.
