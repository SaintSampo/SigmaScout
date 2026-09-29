# Phase 9: Analytic Ranking Points & Browser-Side Simulation - Pattern Map

**Mapped:** 2026-09-11
**Files analyzed:** 13 (new + modified, deliverables 1-8 + D-21 housekeeping)
**Analogs found:** 13 / 13

RESEARCH.md already did the file-level archaeology (exact line numbers for every touch point). This
document supplies the analog + copyable-excerpt layer only — do not re-derive the file inventory.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/rankingPoints/constants.ts` (extend: `marginalFamily`, `BonusPredicate`) | model/type-contract | transform | itself (existing `RpThresholdVariable`/`RpRuleModule`) | exact — edit in place |
| `packages/core/rankingPoints/{2016..2026}.ts` (rewrite `predictThresholds` as declarative evaluator) | model | transform | `packages/core/rankingPoints/2026.ts` (hardest case: nested threshold) + `packages/core/rankingPoints/2018.ts` (untracked-gate conservative branch) | exact |
| `packages/core/rankingPoints/marginals.ts` (NEW) | utility | transform | `packages/core/algorithms/sigma1/linkFunctions.ts` (`erf`/`normalCdf` numeric-helper style) | role-match, strong |
| `packages/core/rankingPoints/analyticPmf.ts` (NEW, replaces `distribution.ts`) | service/pure-function | transform | `packages/core/rankingPoints/distribution.ts` (the module it replaces — same call site, same header-comment discipline) | exact |
| `packages/harness/sigmaScoutLayer.ts` (swap `rpPmfForMatch` → `analyticRpPmf`; `RP_MONTE_CARLO` → `RpLayerConfig`) | service | transform | itself; config-set precedent at `packages/core/algorithms/sigma1/linkFunctions.ts` (`WinProbMode`) | exact / role-match |
| `packages/harness/preSchedule.ts` (rung-1 field-averaged branch) | service | batch/transform | itself (existing schedule-based `buildPreScheduleArtifact`) + `RpMomentsAccumulator` (`empiricalMoments.ts`) for the convolution machinery | role-match |
| `apps/worker/src/scheduled.ts` (`buildEventMatchRow` gains `redRpPmf`/`blueRpPmf`; new Worker-resident RP accumulator) | route/handler (cron) | event-driven | `buildEventUpcomingRow` in the **same file** (already correct — sibling function) | exact, in-file |
| `packages/harness/stateSnapshot.ts` (shape 11→12, new `sigmascoutRp` passenger) | model/state | CRUD (D1 row) | `withSigmaBeliefs`/`readSigmaBeliefs` (shape 10→11, most recent passenger) | exact |
| `scripts/measureRpCalibration.ts` (wire to emit publishable artifact, deliverable 5) | utility/script | batch | itself (already computes the numbers; extend, don't replace) | exact — edit in place |
| `packages/harness/pageArtifacts.ts` (extend `CompareSliceSchema` or sibling with RP calibration key) | model (Zod schema) | transform | `CompareExclusionCountsSchema.coldStart` — the most recent "add optional field to a LIVE artifact schema" precedent | exact |
| `apps/web/src/components/compare/*` (new RP scorecard section/component) | component | request-response | `apps/web/src/components/compare/CalibrationSection.tsx` + `calibrationCards.ts` | exact |
| `packages/core/algorithms/simulation/rankSimulation.ts` (red/blue coupling fix, D-15) | service | event-driven/transform | itself (edit in place — same file, same function) | exact |
| new tests: `marginals.test.ts`, `analyticPmf.test.ts`, live/offline RP parity test, D-12 digest test, rung-1 measurement script | test / script | transform / batch | `packages/core/rankingPoints/rules.test.ts` (unit style); `scripts/measureRewindGap.ts` (offline corpus-measurement script shape); `digest.test.ts` (bounded-slice before/after pattern, plan 03-01) | role-match |

## Pattern Assignments

### `packages/core/rankingPoints/{2016..2026}.ts` (declarative bonus contract, deliverable 1)

**Analog A — the hard case:** `packages/core/rankingPoints/2026.ts` (nested threshold on one variable)
**Analog B — the normal case + untracked-gate conservative branch:** `packages/core/rankingPoints/2018.ts`

**Current `predictThresholds` shape to preserve exactly (2026.ts, lines 122-138):**
```typescript
predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
  const tier = eventTierFor(eventType);
  const hubTotalCount = values.hubTotalCount ?? 0;
  const totalTowerPoints = values.totalTowerPoints ?? 0;

  const energized = hubTotalCount >= ENERGIZED_THRESHOLD[tier];
  const supercharged = hubTotalCount >= SUPERCHARGED_THRESHOLD[tier];
  const traversal = totalTowerPoints >= TRAVERSAL_THRESHOLD[tier];

  const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  bonusFlags.energized = energized;
  bonusFlags.supercharged = supercharged;
  bonusFlags.traversal = traversal;

  return { bonusFlags, totalRp: Number(energized) + Number(supercharged) + Number(traversal) };
},
```
This is the boolean-limit that a rewritten declarative evaluator must reproduce byte-for-byte when
`values` are exact (deterministic pass in the new unit tests) — it is not being deleted, it is the
target behavior the new pmf-producing evaluator must degenerate to.

**Threshold-variable declaration to extend (2026.ts, lines 69-72) with D-02's new `marginalFamily` field:**
```typescript
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "hubTotalCount", unit: "count" },
  { name: "totalTowerPoints", unit: "points" },
];
```
`RpThresholdVariable` itself lives in `constants.ts` lines 29-32 — add the field there, once, not
per-module:
```typescript
export interface RpThresholdVariable {
  readonly name: string;
  readonly unit: "count" | "points";
}
```

**The nested-threshold interval-probability math** (RESEARCH.md's own worked, correct-vs-wrong pair —
reproduce exactly, this is D-07's named highest-risk case):
```typescript
const pEnergized = 1 - F(ENERGIZED_THRESHOLD[tier] - 1);
const pSupercharged = 1 - F(SUPERCHARGED_THRESHOLD[tier] - 1); // T_s >= T_e always
const pNeither = F(ENERGIZED_THRESHOLD[tier] - 1);
const pOnlyEnergized = pEnergized - pSupercharged;
const pBoth = pSupercharged; // NOT pEnergized * pSupercharged
```

**The untracked-gate conservative-branch convention** (must survive the rewrite byte-identical —
`rpConservativeBranch.ts` is the regression oracle; see `constants.ts` lines 173-214's doc comment,
quoted in full there, for the exact contract: evaluate the untracked half at its
LESS-likely-to-achieve branch). The declarative contract needs an explicit
`conjunctionDistinct`-with-untracked-fallback shape covering 2018 `autoQuest`, 2019 `completeRocket`,
2023 `sustainabilityBonus`, 2024 `melodyBonus`, 2025 `coralBonus`/`autoBonus` — read `2018.ts` in full
before writing this shape, since it is the file with the one documented EXCEPTION (over-fires instead
of under-fires) that must not be silently "fixed" by the rewrite.

**Module header/citation discipline to copy** (every season file, e.g. 2026.ts lines 1-37): manual
citation, "deliberately never read" field list, verification method sentence, threshold provenance
note. New/changed threshold-family declarations should get the same treatment — this project's
convention is comments carrying the *evidence*, not just the code.

### `packages/core/rankingPoints/marginals.ts` (NEW — NB fit/CDF, Poisson-binomial, `erf`)

**Analog:** `packages/core/algorithms/sigma1/linkFunctions.ts` (`erf`/`normalCdf`) — copy verbatim,
this is the exact function to reuse per D-08 and the Don't-Hand-Roll table:
```typescript
// Source: packages/core/algorithms/sigma1/linkFunctions.ts:41-49
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}
```
There are three other in-repo copies of the same formula citing the same Abramowitz-Stegun 7.1.26
source (`packages/core/algorithms/bpr.ts:303`, `packages/bpr/model.ts:215`, `packages/pcm/model.ts:135`)
— pick the `linkFunctions.ts` one as the copy source since it is in the same package
(`packages/core`) as the new file, avoiding a cross-package import.

**Doc-comment / citation convention to copy** (module header style, `distribution.ts` lines 1-37 and
`constants.ts` lines 1-21): cite the decision ID (D-01/D-08), state what's hand-rolled and why,
reference the Don't-Hand-Roll table's "cite, don't rederive" framing explicitly in the new file's
header.

### `packages/core/rankingPoints/analyticPmf.ts` (NEW, replaces `distribution.ts`)

**Analog:** `packages/core/rankingPoints/distribution.ts` itself — same call site
(`sigmaScoutLayer.ts`'s `#rpFieldsFor`), same package, being replaced not created from nothing.

**Imports to DROP (this is the point of D-08):**
```typescript
// Source: packages/core/rankingPoints/distribution.ts:37 — REMOVE, do not carry forward
import { CholeskyDecomposition, Matrix } from "ml-matrix";
```

**Imports to KEEP (same shape, new file):**
```typescript
// Source: packages/core/rankingPoints/distribution.ts:38-40
import type { CompLevel } from "../algorithms/types.js";
import { isBonusRpCompLevel, type RpRuleModule } from "./constants.js";
import type { AllianceRpMoments, RpMonteCarloConfig } from "./moments.js";
```
(`RpMonteCarloConfig` itself will likely be renamed/replaced per D-05's `RpLayerConfig` — see the
`sigmaScoutLayer.ts` pattern below — but the import SHAPE, one leaf type import from `moments.ts`, is
the pattern to keep.)

**PRNG to DELETE, not port** — `mulberry32`/Box-Muller/`fnv1a32` in `distribution.ts` are listed
explicitly in RESEARCH.md's "Deprecated/outdated" table as having no analogue in the closed-form
path (no matrix, no sampling). Do not copy `mulberry32` into `analyticPmf.ts` — the closed form needs
no randomness at all. (If D-15's rank-simulation red/blue fix or D-17 rung 2's schedule shuffle need a
seeded stream elsewhere, reuse `packages/harness/identifiability.ts`'s `mulberry32`, the cited
original, not a fresh copy.)

**Zero-import leaf target:** model `analyticPmf.ts` after `rankSimulation.ts`'s own "zero-import leaf"
shape (per D-08's explicit phrasing) — only type-only imports from sibling files in the same package,
no `ml-matrix`, no Node built-ins.

### `packages/harness/stateSnapshot.ts` (D-21 — shape 11→12, `sigmascoutRp` passenger)

**Analog (most recent passenger, shape 10→11):** `withSigmaBeliefs`/`readSigmaBeliefs`, lines 914-962.
This is the template to copy exactly, with `SigmaBelief`'s fields swapped for `VariableBelief`'s
(`weight`, `weightSquares`, `mean`, `m2` — same shape as `SwingBelief`, per RESEARCH.md, one per
tracked threshold-variable name, so the passenger value is likely `Record<string, VariableBelief>`
rather than a single flat object — check `RpMomentsAccumulator`'s actual per-team shape before
copying field names verbatim).

```typescript
// Source: packages/harness/stateSnapshot.ts:914-962 (verbatim, this IS the template)
const SIGMA_BELIEF_KEY = "sigmascoutSigma";
const SIGMA_POPULATION_KEY = "sigmascoutSigmaPopulation";

export function readSigmaBeliefs(rows: readonly StateRow[]): Map<string, SigmaBelief> {
  const beliefs = new Map<string, SigmaBelief>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const raw = parsed[SIGMA_BELIEF_KEY] as Partial<SigmaBelief> | undefined;
    if (raw === undefined) continue;
    const { meanWeight, mean, varWeight, sumSquares, talent } = raw;
    if (![meanWeight, mean, varWeight, sumSquares, talent].every((v) => typeof v === "number" && Number.isFinite(v))) {
      continue;
    }
    beliefs.set(row.scopeKey, { meanWeight: meanWeight!, mean: mean!, varWeight: varWeight!, sumSquares: sumSquares!, talent: talent! });
  }
  return beliefs;
}

export function withSigmaBeliefs(rows: readonly StateRow[], beliefs: ReadonlyMap<string, SigmaBelief>): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "team") return row;
    const belief = beliefs.get(row.scopeKey);
    if (belief === undefined) return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [SIGMA_BELIEF_KEY]: belief }) };
  });
}
```

**Rules this pattern encodes, apply identically to `sigmascoutRp`:**
- key name follows `sigmascout{Feature}` (all lowercase-camel, no separator) — `sigmascoutRp`.
- all-or-nothing read: a belief missing ANY field is skipped entirely, never part-filled (comment at
  line 921-924 states the reasoning — a wrong band is harder to notice than an absent one; same logic
  applies to a wrong RP belief).
- `undefined` is a real, valid answer from the read function (pre-shape-12 row, or a team with
  nothing folded) — callers must accept a flat/default prior, never fabricate one (see
  `readSigmaPopulation`'s doc comment, lines 964-970, for the equivalent population-level rule if RP
  needs a field-level population statistic analogous to `sigmascoutSigmaPopulation`).
- `withX` returns NEW rows (`.map`), never mutates — same as both existing passengers.

**Shape version bump site:** `STATE_SNAPSHOT_SHAPE_VERSION = 11` at line 265 → 12. Search for every
other literal `11` this constant appears validated against (grep showed 6 more call sites at lines
460/510/578/617/669/697/759/802) — the bump touches the constant once; those call sites read it
symbolically already, so they do not need individual edits, only re-verification after the bump.

### `apps/worker/src/scheduled.ts` (D-21 — `buildEventMatchRow` gains `redRpPmf`/`blueRpPmf`)

**Analog: the sibling function in the SAME file**, already correct — copy its two RP lines exactly
into `buildEventMatchRow`:
```typescript
// Source: apps/worker/src/scheduled.ts (buildEventUpcomingRow, the CORRECT sibling)
redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
```
**Current (incomplete) `buildEventMatchRow` to edit — insert the two lines above between
`...liveBonusRpFields(...)` and `...swingBandFields(band)`:**
```typescript
function buildEventMatchRow(match: MatchResult, prediction: Prediction, band: MatchBand | undefined) {
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    ...liveBonusRpFields(match.compLevel, prediction),
    // INSERT redRpPmf / blueRpPmf here, matching buildEventUpcomingRow exactly
    ...swingBandFields(band),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  };
}
```
**Pitfall (RESEARCH.md Pitfall 5):** the row-builder edit above is NOT the whole fix. The real gap is
upstream: `prediction.redRpPmf` is never SET on the Worker's `Prediction` object at all — no
`SigmaScoutLayer`/`RpMomentsAccumulator` reference exists anywhere in `apps/worker/src/` today. The
new Worker-resident RP accumulator (constructed per algorithm/event, resumed via
`readRpBeliefs`/`withRpBeliefs` from stateSnapshot.ts) must populate `prediction.redRpPmf`/`blueRpPmf`
BEFORE either row builder runs — model this construction after however `swingByTeam`/`newBands` are
threaded through `PerAlgorithmFold` in this same file (see the `PerAlgorithmFold` interface a few
lines above `buildEventMatchRow`, which already carries per-tick derived per-team/per-match state of
this exact shape).

### `packages/harness/pageArtifacts.ts` (deliverable 5 — RP scorecard artifact schema)

**Analog (most recent "add optional field to a LIVE artifact schema" precedent):**
`CompareExclusionCountsSchema.coldStart`, lines 1518-1537:
```typescript
// Source: packages/harness/pageArtifacts.ts:1518-1537
const CompareExclusionCountsSchema = z.object({
  offseason: z.number().int().nonnegative(),
  surrogateAffected: z.number().int().nonnegative(),
  missingResult: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  /**
   * D-02/D-04 (quick task 260909-t5q) ... OPTIONAL here on purpose, UNLIKE
   * packages/harness/artifact.ts's own ExclusionCountsSchema counterpart —
   * this is a LIVE, R2-served artifact shape, and D-04 defers the republish
   * that would add this key to every already-published slice. A required
   * key would fail to parse every one of today's four-key live artifacts
   * and blank the Compare page in production before any republish happens.
   * Absence genuinely means "this artifact predates the field" and MUST
   * render as absent, never coerced to zero.
   */
  coldStart: z.number().int().nonnegative().optional(),
});
```
**Apply identically to the new RP scorecard field(s):** whatever key deliverable 5 adds to
`CompareSliceSchema` (or a new sibling schema) MUST be `.optional()` for the same reason — old
published `v1/compare/{year}.json` slices predate the RP calibration numbers, and a required field
would break production parsing before the republish lands. Follow the exact doc-comment discipline
too: name the decision, name why optional-not-required, name what "absent" means to the renderer, and
add the compat-test pin (`apps/web/src/lib/api/compare.compat.test.ts` is the existing pin file for
this schema — extend it, do not create a parallel one).

**`CompareSliceSchema` itself (context for where the new field lands), lines 1540-1565** — read
before deciding whether RP calibration is a new field on this schema or a new sibling
`CompareRpSliceSchema`; the existing `calibrationBins: z.array(CompareCalibrationBinSchema)` field is
the closest structural analog if RP calibration also wants a bin-table shape.

### `apps/web/src/components/compare/*` (deliverable 5 — RP scorecard component)

**Analog:** `apps/web/src/components/compare/CalibrationSection.tsx` + its data-shaping sibling
`calibrationCards.ts`. Header comment (lines 1-21) documents the settled display contract this new
component must also follow — **do not re-decide display form**, it's pinned by
`.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md` (sentence-first,
chart as supporting evidence, sample count mandatory, small samples flagged):

```typescript
// Source: apps/web/src/components/compare/CalibrationSection.tsx:23-30 (imports — copy this shape)
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../../lib/api/compare.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { buildCalibrationCard, cardHeadlineSentence, fmtPct, niceCeil, SPARSE_N, type CalibrationCardModel } from "./calibrationCards.js";
import { NO_USABLE_BINS_SENTENCE } from "./calibrationSeries.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
```
Pattern to copy: a `*Section.tsx` (render/layout, local year `Select`) paired with a `*Cards.ts`
(pure data-shaping, exported model builder + headline-sentence function + formatting helpers,
independently unit-tested — see `AccuracyTable.test.tsx`, `CalibrationSection.test.tsx` for the
paired-test-file convention). Both files import `CompareArtifact` the same relative-path way shown
above — five `../` segments from `apps/web/src/components/compare/` into `packages/harness/`.

### `packages/core/algorithms/simulation/rankSimulation.ts` (D-15 — red/blue coupling fix)

**Analog:** itself — this is an in-place edit, not a new-file-from-analog case.

**Current bug to fix (RESEARCH.md, verified this session):**
```typescript
// Source: packages/core/algorithms/simulation/rankSimulation.ts:264-274
for (const match of resolvedMatches) {
  const redRp = drawCategorical(match.redRpPmf, rng);   // draw 1: independent
  const blueRp = drawCategorical(match.blueRpPmf, rng);  // draw 2: independent
  for (const i of match.redIndices) { rpSum[i]! += redRp; matchesPlayed[i]! += 1; }
  for (const i of match.blueIndices) { rpSum[i]! += blueRp; matchesPlayed[i]! += 1; }
}
```
**Recommended fix shape (A3 in RESEARCH.md's Assumptions Log — pick approach (b), simpler, reuses
`analyticRpPmf`'s own decomposition):** draw the winner from `pRedWin` first (one draw from the shared
`rng` stream, replacing the two independent full-pmf draws' outcome component), THEN draw each
alliance's bonus RP independently from its own bonus-only marginal, then add the
deterministic-given-winner win/tie RP. This keeps the existing `drawCategorical(pmf, rng)` primitive
and the existing `rng` stream threading — only the SHAPE of what gets drawn from changes (one win/tie
draw + two independent bonus-only draws, instead of two independent full-RP-total draws).

### `scripts/measureRpCalibration.ts` (deliverable 5 — wire to publishable artifact)

**Analog:** itself, edit in place — the computation already exists and must not be reimplemented.
Header (lines 1-40) documents the three things it already reports (reliability, extremes claim,
correlation claim) and states explicitly: "driven through the SAME `SigmaScoutLayer` the publisher
runs, so these are the published numbers and not a re-derivation that could disagree with them" — any
new artifact-emitting code path must preserve that same-scorer guarantee (D-11's required mitigation).
Do not build a parallel computation for the published scorecard; add an output mode (e.g. `--json` or
`--emit-artifact`) to this script instead.

### Offline measurement scripts (Wave 0 gaps — rung-1 comparison, before/after acceptance harness)

**Analog:** `scripts/measureRewindGap.ts` — the closest existing "offline consumer of `simulateRanks`,
reads the corpus, prints a comparison table between two prediction arms" script. Header (lines 1-20)
shows the convention: name the two arms precisely (here: "stored" vs "frozen"), state which one is
the honest baseline, and note both arms pass through the SAME imported function
(`simulateRanks`) — directly mirrors D-11's same-scorer requirement for the RP acceptance harness and
is the template for both the rung-1 rank-band comparison script and the D-09 per-bonus before/after
acceptance wrapper around `measureRpCalibration.ts`.

## Shared Patterns

### The D1 passenger-key pattern (governs D-21 entirely)
**Source:** `packages/harness/stateSnapshot.ts:391-435` region generally, `withSigmaBeliefs`/
`readSigmaBeliefs` (lines 914-962) specifically — the MOST RECENT of the two existing precedents.
**Apply to:** the new `sigmascoutRp` belief passenger, `readRpBeliefs`/`withRpBeliefs`.
Two precedents exist (`sigmascoutSwing`, shape 9→10; `sigmascoutSigma`/`sigmascoutSigmaPopulation`,
shape 10→11) and they agree on every convention — no idiom conflict to flag here. Follow the more
recent one (`sigmascoutSigma`) since it is closer in time and already demonstrates the
two-keys-per-feature pattern (per-team belief + population statistic) that RP may also need if a
field-level population prior is required.

### Named, versioned config sets (governs D-05/D-06)
**Source:** `packages/core/algorithms/sigma1/linkFunctions.ts:1-27` (`WinProbMode`) — same SHAPE
(enum/config resolved once, instantiated in every combination offline, production ships one).
**Apply to:** `RpLayerConfig = {winSource, tieModel, marginal}`, read once by `SigmaScoutLayer`'s
constructor.
**Idiom conflict to flag explicitly:** `WinProbMode` is PERMANENT multi-valued scaffolding (still
multi-valued today, by design). D-05/D-06 is explicitly TEMPORARY — collapses to one hardcoded path
once the attribution measurement publishes (D-06). Do not model `RpLayerConfig` as a permanent
feature-flag surface the way `WinProbMode` reads; name the planned removal in the same file/PR that
introduces it, per D-06.

### Zero-import browser-safe leaf modules (governs D-08)
**Source:** `packages/core/algorithms/simulation/rankSimulation.ts` (the existing zero-import leaf
D-08 names as the target shape) — no direct excerpt needed, the pattern is "no non-type imports
outside the package, no Node built-ins, no third-party matrix/crypto libs."
**Apply to:** `analyticPmf.ts` and `marginals.ts` both.

### Artifacts-before-manifest, seed-first-deploy-second (governs D-20/D-21 rollout ordering)
**Source:** CLAUDE.md Cloudflare topology section + `stateSnapshot.ts`'s own header (not excerpted
here — process ordering, not a code pattern). Apply to any plan sequencing D-21's shape bump: seed D1
with shape-12 rows before deploying the Worker version that writes shape 12, mirroring the existing
documented convention for the 10→11 bump.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/harness/preSchedule.ts` rung-1 field-averaged predictor (D-16) | service | batch/transform | Genuinely new math per RESEARCH.md ("no existing implementation to read"). Building blocks exist (`RpMomentsAccumulator`, `analyticRpPmf`'s convolution, `simulateRanks`'s zero-baseline mode) but no single close analog for "convolve a team's belief with field-level partner-quality summary stats, N times" exists in the codebase. Planner should treat this as new-design, composed from the cited building blocks, not copied from one file. |

## Metadata

**Analog search scope:** `packages/core/rankingPoints/`, `packages/harness/`, `apps/worker/src/`,
`packages/core/algorithms/{sigma1,simulation}/`, `apps/web/src/components/compare/`, `scripts/`.
**Files read in full or targeted this session:** `2026.ts`, `constants.ts`, `distribution.ts` (header
+ imports), `stateSnapshot.ts` (passenger-key region), `scheduled.ts` (row-builder region),
`pageArtifacts.ts` (CompareArtifactSchema region), `CalibrationSection.tsx` (header + imports),
`measureRpCalibration.ts` (header), `measureRewindGap.ts` (header). RESEARCH.md's own Sources section
already covers full reads of every other file this phase touches — not re-read here per the
no-duplicate-range rule.
**Pattern extraction date:** 2026-09-11
