# Phase 2: Prediction Models — EPA & Sigma1 - Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 17 (11 new, 6 modified)
**Analogs found:** 17 / 17

**Provenance note:** All analogs below are Phase 1 code shipped in this repo (`packages/`). No pre-v3 code (`v2-poc` tag) was consulted, per the clean-slate mandate.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/algorithms/epa.ts` | model | CRUD (predict/update over rolling state) | `packages/core/algorithms/opr.ts` | exact |
| `packages/core/algorithms/sigma1/kalman.ts` | model | CRUD (incremental filter update) | `packages/core/algorithms/opr.ts` (its `IncrementalInverse`/RLS section) | role-match |
| `packages/core/algorithms/sigma1/covariance.ts` | utility | transform | `packages/core/scoring/brier.ts` (pure stat transform, documented edge cases) | partial |
| `packages/core/algorithms/sigma1/consistency.ts` | utility | transform | `packages/core/scoring/calibration.ts` (binning/shrinkage-adjacent stat transform) | partial |
| `packages/core/algorithms/sigma1/linkFunctions.ts` | utility | transform | `opr.ts`'s `logisticWinProbability` (private helper, same shape) | role-match |
| `packages/core/algorithms/sigma1/index.ts` | model | CRUD | `packages/core/algorithms/opr.ts` (the `export const opr: AlgorithmModule<OprState>` assembly) | exact |
| `packages/core/algorithms/breakdown/{2022..2026}.ts` + `index.ts` | config/data-map | transform | `packages/ingest/schemas.ts` + `packages/ingest/normalize.ts` (Zod-at-boundary + per-field mapping pattern) | role-match |
| `packages/core/scoring/expandingStats.ts` | utility | streaming (O(1) per-observation fold) | `packages/core/scoring/brier.ts` / `calibration.ts` | role-match |
| `packages/harness/predictions.ts` | service | file-I/O (JSONL writer) | `packages/harness/artifact.ts` (`writeArtifact`, schema-validate-before-persist, secret-scrub) | exact |
| `packages/harness/metricHistory.ts` | service | file-I/O / event-driven (per-match snapshot) | `packages/harness/predictions.ts` (sibling, same D-23-style side-artifact discipline) — secondarily `artifact.ts` | role-match |
| `packages/harness/identifiability.ts` | utility/script | batch (one-time analysis over corpus) | `packages/harness/cli.ts` (`main()`/`parseArgs` runnable-script shape) + `opr.ts`'s SVD-based rank/conditioning reasoning | partial |
| `packages/core/algorithms/types.ts` (MODIFIED) | model contract | request-response | itself (extend in place) | exact |
| `packages/harness/replay.ts` (MODIFIED) | service | event-driven (multi-algorithm walk-forward loop) | itself (extend `WalkForwardSimulator.run`, `OUTCOME_KEYS`) | exact |
| `packages/harness/cli.ts` (MODIFIED) | route/entrypoint | request-response (CLI) | itself (extend `ALGORITHMS`, `--algorithm` parsing) | exact |
| `packages/harness/artifact.ts` (MODIFIED) | service | file-I/O | itself (`ARTIFACT_SCHEMA_VERSION` bump, schema restructure) | exact |
| `packages/harness/score.ts` (MODIFIED) | service | transform/CRUD | itself (extend `HarnessPredictionInput`, keep predicted scores) | exact |
| `packages/corpus/db.ts` (MODIFIED — `selectMatchesChronological`) | model/query | CRUD (read) | itself (extend the existing `SELECT`/row-mapping, using the sibling `score_breakdown_raw` mapping already present at line ~157 for `getMatchByKey`-style reads) | exact |

## Pattern Assignments

### `packages/core/algorithms/epa.ts` (model, CRUD)

**Analog:** `packages/core/algorithms/opr.ts` (full file read this session)

**File header / doc-comment density pattern** (opr.ts lines 1-24): every module opens with a comment block naming which RESEARCH.md pattern/pitfall it implements, which decisions it resolves, and a one-line summary of the two or three design tensions it's balancing. Match this density for `epa.ts` — open with which parts of Statbotics' EPA are ported faithfully (D-13) vs. deliberately diverged (D-08 elim weighting, no per-season post-processing quirks).

**Contract implementation pattern** (opr.ts lines 410-457):
```typescript
export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  version: "2.0.0",
  initState(): OprState { ... },
  predict(state: OprState, match: UpcomingMatch): Prediction { ... },
  update(state: OprState, result: MatchResult): OprState { ... },
};
```
`epa.ts` must export `export const epa: AlgorithmModule<EpaState> = { id: "epa", version: "1.0.0", initState, predict, update, teamMetrics }` — note `teamMetrics` is the D-27 contract addition, absent from this OPR excerpt because OPR predates D-27; every new algorithm must implement it.

**Named-constant-with-reasoning pattern** (opr.ts lines 29-47):
```typescript
export const OPR_RIDGE_LAMBDA = 3;
/**
 * Ridge penalty added to the normal equations... λ=3 is small relative to
 * a typical FRC alliance score... enough to keep the solve invertible...
 */
```
Apply this exact style to every EPA constant Statbotics fixes (`NORM_MEAN=1500`, `NORM_SD=250`, `INIT_PENALTY=0.2`, `YEAR_ONE_WEIGHT=0.7`, `MEAN_REVERSION=0.4`, the derived logistic scale) — each needs its own doc comment explaining magnitude, not just a bare `export const`.

**Deliberate-divergence-documented-inline pattern** (opr.ts lines 80-95, the disqualification policy comment): every place EPA's behavior differs from Statbotics' (D-08 no elim discount, D-13's skip of per-year post-processing quirks) must carry a comment of this shape: what Statbotics does, what this project does instead, and why — matching the "Open Question 3... this plan takes the opposite position... and states why" structure.

**Surrogate/disqualification policy — MUST reuse, not reimplement** (opr.ts lines 96-149): `ratingEligibleTeams` and `allianceObservation` are already the canonical answer to "which teams' columns/components does this alliance observation touch." Both EPA and Sigma1 must call these existing exported functions (or a shared extraction if the planner wants to hoist them to a common module) rather than re-deriving the surrogate-offset math — RESEARCH.md's Pattern 2 explicitly says Sigma1 "differs from OPR only in solving it incrementally... with priors," not in surrogate/DQ policy.

**Win-probability helper pattern** (opr.ts lines 406-408):
```typescript
function logisticWinProbability(scoreMargin: number, scale: number = OPR_LOGISTIC_SCALE): number {
  return 1 / (1 + Math.exp(-scoreMargin / scale));
}
```
EPA's win probability (RESEARCH.md Pattern 1) is algebraically the same natural-exp logistic form with a derived scale (`score_sd / (-k · ln(10))`) — reuse this exact function shape, do not introduce Statbotics' base-10 `10**(k·x)` form.

---

### `packages/core/algorithms/sigma1/index.ts` + `kalman.ts` (model, CRUD)

**Analog:** `packages/core/algorithms/opr.ts` — specifically its incremental-over-recompute philosophy (lines 219-243) and its `IncrementalInverse`/RLS section (lines 250-404).

**Incremental-update-with-measured-justification pattern** (opr.ts lines 219-243): OPR's doc comment doesn't just assert the incremental approach is faster, it cites concrete benchmark numbers (21s per SVD at n=1,500, ~16 CPU-days extrapolated, 15-30ms per incremental update). `sigma1/kalman.ts` should carry the equivalent — RESEARCH.md already supplies the number ("O(1) in team-count... on the order of 100-150 scalar Kalman updates per match") — cite it the same way, and flag (per RESEARCH.md's own instruction) that it "should still be measured, not just estimated, once implemented."

**Immutable-state-update-returns-new-object pattern** (opr.ts lines 356-404, `applyObservation`): every state mutation returns a new object; nothing is mutated in place. `updateAllianceSum` in RESEARCH.md's own proposed code example already follows this (`return teammates.map(...)`) — keep the same discipline for the outer `sigma1.update()`.

**Equivalence-test-proves-incremental-correctness pattern** (opr.ts lines 232-236, referencing `opr.test.ts`'s "incremental solve matches the from-scratch dense solve" test): if the planner adds any batch/reference solve for Sigma1 (even a test-only one), the test convention is to prove the incremental path matches it exactly on a shared fixture — see Test section below.

---

### `packages/core/algorithms/sigma1/linkFunctions.ts` (utility, transform)

**Analog:** `opr.ts`'s private `logisticWinProbability` (lines 406-408) — same shape, promoted to a public, multi-mode function per RESEARCH.md's own proposed code (already fully specified in RESEARCH.md's Code Examples section — implement as given, wiring `WinProbMode` to D-12's three modes).

---

### `packages/core/scoring/expandingStats.ts` (utility, streaming)

**Analog:** `packages/core/scoring/brier.ts` and `packages/core/scoring/calibration.ts`

**File header pattern** (brier.ts lines 1-16): a bulleted list of the boundary contracts the module makes explicit (what happens at n<2, what a `null` vs `0` vs `NaN` return means). `expandingStats.ts` needs the same treatment for `standardDeviation()`'s `fallback` parameter — document why `count < 2` requires a fallback deliberately, not a `0`/`NaN`.

**Pure-function, no-class module-shape pattern** (brier.ts throughout): the whole file is top-level exported functions plus interfaces, no classes. `expandingStats.ts` should match — RESEARCH.md's own proposed implementation already does (`emptyExpandingStats`, `foldObservation`, `standardDeviation` as free functions) — implement as specified in RESEARCH.md's Code Examples section.

**`null`-safe empty-result constant pattern** (brier.ts lines 46-52, `EMPTY_RESULT`): a module-level frozen/const empty value returned for the zero-observation case rather than constructing an ad-hoc empty object at each call site — apply the same idea if `expandingStats.ts` grows a result-object return.

---

### `packages/core/algorithms/breakdown/{2022..2026}.ts`, `breakdown/index.ts` (config/data-map, transform)

**Analog:** `packages/ingest/schemas.ts` + `packages/ingest/normalize.ts` (Zod-at-the-boundary pattern; read structurally this session via Grep/RESEARCH.md's own description — RESEARCH.md's Security Domain section explicitly calls out this pattern: "parse defensively with Zod per-season schemas (matching `HarnessArtifactSchema`'s existing pattern) rather than assuming field presence/type").

**Validate-then-map pattern** (mirrors `HarnessArtifactSchema` in `artifact.ts` lines 20-76): each `breakdown/{year}.ts` should export a Zod schema for that season's raw `score_breakdown` shape (or the subset of fields it reads) plus a pure mapping function from parsed fields to the canonical component-name vector. Reject/flag non-finite values before they enter Kalman/EWMA state per RESEARCH.md's Security Domain guidance — do not silently coerce `undefined`/`null` to `0` (this directly extends Phase 1's D-05 discipline, already precedented by `allianceObservation`'s explicit `?? leagueMeanPerTeamShare` fallback rather than a bare `?? 0`).

**Data-driven-map-not-branches pattern** (D-02/D-19's own requirement): `breakdown/index.ts` should be a `Record<number, SeasonComponentMap>` or equivalent lookup keyed by season year — structured so adding 2016-2021 later (D-19) is literally adding new map entries, not touching dispatch logic. No existing file in the codebase does exactly this (Phase 1 had only one season shape to worry about), so this is genuinely new structure — but the *shape* (a year→config lookup table) should read like `packages/harness/score.ts`'s `TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit()` pattern (score.ts lines 15-29): explicit, throws for an out-of-range year rather than defaulting.

---

### `packages/harness/predictions.ts` (service, file-I/O)

**Analog:** `packages/harness/artifact.ts` (full file read this session)

**Validate-before-persist pattern** (artifact.ts lines 112-129, `writeArtifact`):
```typescript
export function writeArtifact(outDir: string, artifact: HarnessArtifact, secretToScrub?: string): string {
  const validated = HarnessArtifactSchema.parse(artifact);
  const serialized = JSON.stringify(validated, null, 2);
  if (secretToScrub && serialized.includes(secretToScrub)) {
    throw new Error("Refusing to write harness artifact: serialized output contains a secret value.");
  }
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "artifact.json");
  writeFileSync(path, serialized, "utf8");
  return path;
}
```
`predictions.ts`'s JSONL writer (D-23-25) must follow the same shape: a Zod schema for one `PredictionRecord` line (`Prediction` + `redComponents`/`blueComponents` per D-24), parse-validate each record before it's serialized, same secret-scrub defensive check (even though RESEARCH.md's Security Domain notes this path never touches TBA credentials directly, keep the discipline). JSONL specifics: open in append mode (`writeFileSync(path, line + "\n", { flag: "a" })` per match, or buffer and flush per season) so an interrupted run leaves partial-but-readable output per D-25.

**`Bumped whenever...` schema-version-comment pattern** (artifact.ts line 17): any new schema module should carry the same "bumped whenever X changes in a way a consumer must know about" comment if it introduces its own version field.

**File-per-season naming/layout convention:** no direct existing analog (Phase 1 writes one `artifact.json`/`report.html` per run, not per season) — `predictions-{season}.jsonl` is new layout; keep it consistent with `writeArtifact`'s `join(outDir, ...)` pattern (artifact.ts line 126).

---

### `packages/harness/metricHistory.ts` (service, event-driven snapshot)

**Analog:** `packages/harness/predictions.ts` (sibling new file, same D-23-style discipline) and `WalkForwardSimulator.run` (replay.ts lines 105-114) for *where* the snapshot call is made.

**Snapshot-at-the-right-moment pattern** (replay.ts's `run` loop, lines 105-114): the loop already does `predict → record → update` per match; D-28's snapshot call is a fourth step (`teamMetrics(state)` for the 6 involved teams) inserted immediately after `update`, inside the same loop — not a separate pass over the corpus. Reuse the loop, do not build a second replay.

---

### `packages/harness/identifiability.ts` (script, batch)

**Analog:** `packages/harness/cli.ts`'s `main()`/`parseArgs` runnable-script shape (cli.ts lines 296-325) for how a standalone `tsx`-run script is structured in this repo, plus `opr.ts`'s SVD/conditioning reasoning (lines 183-217, `solveRidgeOpr`) for the rank/conditioning check itself.

**Runnable-script-with-top-level-main pattern** (cli.ts lines 296-325):
```typescript
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { ... } });
  ...
}
main().catch((err) => {
  console.error("harness failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```
`identifiability.ts` should follow this same `async function main()` + `.catch(...)` + `process.exit(1)` shape (RESEARCH.md's Validation Architecture explicitly names this script pattern: "treat its successful run (no crash, condition numbers reported per season per component) as the acceptance check").

**Rank/conditioning check reference** (opr.ts's `solveRidgeOpr`, lines 183-217): reuses `ml-matrix`'s `SingularValueDecomposition` rather than a hand-rolled check — `identifiability.ts` should do the same (per RESEARCH.md's "Don't Hand-Roll" table: use `ml-matrix`'s SVD, don't hand-write Gaussian elimination), computing per-season, per-component condition numbers, with the fouls component (D-04) explicitly broken out per season per Pitfall Sigma1-1's finding that 2026 renames the foul fields entirely.

---

### `packages/core/algorithms/types.ts` (MODIFIED — contract extension)

**Pattern:** additive-only extension, matching RESEARCH.md's own proposed diff (already fully specified — implement verbatim):
```typescript
export interface MatchResult extends UpcomingMatch {
  // ...existing fields unchanged...
  scoreBreakdownRaw: string | null;
}
export interface ComponentPrediction {
  mean: number;
  variance?: number;
}
export interface Prediction {
  // ...existing fields unchanged...
  redComponents?: Record<string, ComponentPrediction>;
  blueComponents?: Record<string, ComponentPrediction>;
}
export interface AlgorithmModule<S> {
  // ...existing methods unchanged...
  /** D-27: pure, read-only accessor. Plain data only — packages/core stays Worker-importable. */
  teamMetrics(state: S): Record<string, { value: number; spread?: number }>;
}
```
Preserve the file-header constraint comment verbatim (types.ts lines 1-11) — it is the load-bearing "must stay Worker-importable... no Node-only APIs" statement CONTEXT.md explicitly requires new code respect.

---

### `packages/harness/replay.ts` (MODIFIED — multi-algorithm run, D-22)

**Analog:** itself, extended in place.

**`OUTCOME_KEYS` — MUST add `scoreBreakdownRaw`** (replay.ts lines 17-24):
```typescript
const OUTCOME_KEYS = new Set<string>([
  "winner", "redScore", "blueScore", "redRpEarned", "blueRpEarned", "hasScoreBreakdown",
  // ADD: "scoreBreakdownRaw",
]);
```
This is Pitfall Harness-1's fix, load-bearing for both EPA and Sigma1 to be leak-proof.

**`WalkForwardSimulator.run` → multi-algorithm** (replay.ts lines 105-114): current signature is `run<S>(algorithm: AlgorithmModule<S>, teams): PredictionRecord[]`. D-22 requires a shared stream driving *every* algorithm per match — the loop structure (`for (const result of this.#matches) { predict; record; update; }`) stays, but must move inside a second, inner loop or a `Map` of per-algorithm state keyed by `algorithm.id`, so each match is visited exactly once and every algorithm sees byte-identical order. Existing test convention in `replay.test.ts` (`makeInstrumentedAlgorithm`, lines 60-70, pushing to a shared `log: string[]`) is the pattern to reuse/extend for the new `replay.multiAlgorithm.test.ts` (assert one interleaved log across algorithms, not per-algorithm logs).

---

### `packages/harness/cli.ts` (MODIFIED — `ALGORITHMS` registry, comma-separated `--algorithm`)

**Analog:** itself, extended in place.

**Registry-and-resolver pattern** (cli.ts lines 42-65):
```typescript
const ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr };
// →
const ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr, epa, sigma1 };

function resolveAlgorithm(algorithmName: string | undefined): AlgorithmModule<any> { ... }
// → becomes resolveAlgorithms(spec: string | undefined): AlgorithmModule<any>[]
//   splitting on "," and reusing the same "Unknown algorithm" error message shape
```
Keep the existing `Unknown algorithm: ${name} (known: ${Object.keys(ALGORITHMS).join(", ")})` error-message convention for the new multi-value parser.

---

### `packages/harness/artifact.ts` (MODIFIED — schema v2, D-20/D-21)

**Analog:** itself, extended in place.

**Schema-version-bump-with-comment pattern** (artifact.ts line 18):
```typescript
export const ARTIFACT_SCHEMA_VERSION = 1;
// → export const ARTIFACT_SCHEMA_VERSION = 2;
```
Keep the file-header comment (lines 1-10) updated to describe the new `algorithms[]`/`slices[]`-tagged-by-`algorithmId` shape — it currently states "D-02, D-03" as its rationale and must be extended to cite D-20/D-21.

**New top-level shape** (restructure `HarnessArtifactSchema`, artifact.ts lines 60-76): `provenance` currently carries a single `algorithmId`/`algorithmVersion` (lines 61-67) — this moves out of per-run provenance into a new `algorithms: z.array(z.object({ id: z.string(), version: z.string() }))` array (D-20), and `ScoreSliceSchema` (lines 34-49) gains an `algorithmId: z.string().min(1)` field. `BuildArtifactParams`/`buildArtifact` (lines 78-110) need the equivalent signature change — keep the "assembles and validates, throws via Zod rather than returning malformed" discipline (line 88-92 comment) exactly as-is.

---

### `packages/harness/score.ts` (MODIFIED — carry predicted scores, D-24)

**Analog:** itself, extended in place.

**`HarnessPredictionInput` extension pattern** (score.ts lines 57-65):
```typescript
export interface HarnessPredictionInput {
  matchKey: string;
  season: number;
  compLevel: CompLevel;
  pRedWin: number;
  actualWinner: MatchOutcome | null;
  isOffseason: boolean;
  isSurrogateAffected: boolean;
  // ADD (D-24): predictedRedScore, predictedBlueScore, algorithmId, variance?, redComponents?, blueComponents?
}
```
Keep the doc-comment style at lines 52-56 ("One prediction record as fed into aggregation...") describing the new fields' semantics the same way `actualWinner: null` is already explained.

---

### `packages/corpus/db.ts` — `selectMatchesChronological` (MODIFIED — surface `score_breakdown_raw`)

**Analog:** itself (db.ts lines 272-329), plus the sibling row-mapping at line ~157 which already reads `score_breakdown_raw` for a different query, confirming the column and its `string | null` typing are already correct and just need to be added to this specific `SELECT`/mapping.

**Required change:**
```sql
SELECT m.match_key, m.event_key, m.comp_level, m.match_number, m.set_number,
       m.red_teams, m.blue_teams, m.red_surrogates, m.blue_surrogates,
       m.winner, m.red_score, m.blue_score, m.red_rp_earned, m.blue_rp_earned,
       m.has_score_breakdown, m.score_breakdown_raw   -- ADD
FROM matches m ...
```
```typescript
return rows.map((row) => ({
  ...
  hasScoreBreakdown: row.has_score_breakdown === 1,
  scoreBreakdownRaw: row.score_breakdown_raw,   // ADD — matches types.ts's new field
}));
```
This is Pitfall Harness-1's other half — must ship alongside the `replay.ts` `OUTCOME_KEYS` change or the leak-proof guarantee has a hole (the field would be readable but never populated, or populated but not leak-guarded).

## Shared Patterns

### Pure predict/update, immutable state
**Source:** `packages/core/algorithms/opr.ts` (whole-file convention), `packages/core/algorithms/types.ts` file header (lines 7-10)
**Apply to:** `epa.ts`, `sigma1/index.ts`, `sigma1/kalman.ts`
```typescript
// predict/update never mutate `state`; update returns a new state object.
predict(state: OprState, match: UpcomingMatch): Prediction { /* reads only */ }
update(state: OprState, result: MatchResult): OprState { /* returns new state */ }
```

### Leak-proof outcome fields
**Source:** `packages/harness/replay.ts` lines 17-37 (`OUTCOME_KEYS`, `toLeakProofUpcoming`)
**Apply to:** every new outcome-bearing field (`scoreBreakdownRaw`) — must be added to `OUTCOME_KEYS` the moment it's added to `MatchResult`, with a corresponding `replay.test.ts` case per the existing `it.each([...])` pattern (replay.test.ts lines 37-43).

### Zod schema as executable spec, validate-before-persist
**Source:** `packages/harness/artifact.ts` lines 20-76 (`HarnessArtifactSchema`), lines 112-129 (`writeArtifact`)
**Apply to:** `breakdown/{year}.ts` per-season component schemas, `predictions.ts`'s JSONL record schema, `artifact.ts` v2 schema itself.

### Dense, reasoning-carrying doc comments, decisions named by ID
**Source:** `packages/core/algorithms/opr.ts` (whole file — see especially lines 1-24, 80-95, 219-243)
**Apply to:** every new file in this phase; every deliberate divergence from Statbotics (D-08, D-13's skipped quirks, D-04's foul modeling) needs an inline comment naming the decision ID and the reasoning, matching `opr.ts`'s comment on disqualification policy ("Open Question 3, RESEARCH.md — no locked decision covers this; this plan takes the opposite position from surrogates and states why").

### Never coerce missing/malformed numeric input to zero
**Source:** `packages/core/algorithms/opr.ts` line 144-147 (`ratings.get(team) ?? leagueMeanPerTeamShare`, not `?? 0`), reinforced by RESEARCH.md's Security Domain section
**Apply to:** `breakdown/{year}.ts` parsers (D-05's fallback update, fouls sparsity) — assert finite numbers, throw or use a documented fallback, never silently substitute `0` for `undefined`/`NaN`.

### Reuse existing chronological ordering / surrogate policy — never re-derive
**Source:** `packages/corpus/db.ts` `selectMatchesChronological` (lines 272-329), `packages/core/algorithms/opr.ts` `ratingEligibleTeams`/`allianceObservation` (lines 96-149)
**Apply to:** `epa.ts`, `sigma1/*` — both must import and reuse these rather than reimplementing sort order or surrogate-offset math (RESEARCH.md's "Don't Hand-Roll" table makes this explicit for ordering; CONTEXT.md's canonical_refs make it explicit for surrogate/DQ policy consistency).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/core/algorithms/sigma1/covariance.ts` | utility | transform | No existing module computes/tracks an online covariance matrix; closest precedent (`brier.ts`/`calibration.ts`) is scalar-only. Implement per RESEARCH.md's Code Examples (`teamTotalVariance`, `allianceTotalPredictiveVariance`) and Pitfall Sigma1-3's full-quadratic-form requirement — these are given verbatim in RESEARCH.md and should be implemented largely as specified. |
| `packages/core/algorithms/breakdown/index.ts` (year→map dispatch) | config | transform | No existing year-keyed dispatch table exists in the codebase; `score.ts`'s `TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit()` (lines 15-29) is the closest shape (explicit array + throwing lookup function) but is not itself a per-year *data* map. |

## Metadata

**Analog search scope:** `packages/core/algorithms/`, `packages/core/scoring/`, `packages/harness/`, `packages/corpus/`, `packages/ingest/` (structural reference only)
**Files scanned:** `opr.ts`, `opr.test.ts`, `types.ts`, `replay.ts`, `replay.test.ts`, `artifact.ts`, `cli.ts`, `score.ts`, `db.ts` (relevant sections), `brier.ts` — 9 files read in full or targeted-section this session, plus RESEARCH.md's own fully-specified code examples (Welford stats, Kalman update, covariance quadratic form, link functions, type extensions) treated as pre-verified implementation starting points rather than re-derived from scratch.
**Pattern extraction date:** 2026-08-13
