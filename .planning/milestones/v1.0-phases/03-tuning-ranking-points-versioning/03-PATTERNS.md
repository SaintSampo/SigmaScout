# Phase 3: Tuning, Ranking Points & Versioning - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 13 (new) + 3 (modified)
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/algorithms/sigma1/params.ts` | model/config | CRUD (plain data, threaded not mutated) | `packages/core/algorithms/carryover.ts` (constants section) + `sigma1/index.ts`'s `Sigma1Options` | role-match |
| `packages/core/algorithms/sigma1/kalman.ts` (modify) | service | transform | itself (existing) | exact |
| `packages/core/algorithms/sigma1/consistency.ts` (modify) | service | transform | itself (existing) | exact |
| `packages/core/algorithms/sigma1/covariance.ts` (modify) | service | transform | itself (existing) | exact |
| `packages/core/algorithms/sigma1/linkFunctions.ts` (modify) | service | transform | itself (existing) | exact |
| `packages/core/algorithms/sigma1/index.ts` (modify — `makeSigma1(params)`) | service/factory | transform | itself (existing) | exact |
| `packages/core/algorithms/carryover.ts` (split into shared + sigma1-specific) | model/config | transform | itself (existing) | exact |
| `packages/core/algorithms/sigma1/rp/rules.ts` | model | CRUD (dispatch table) | `packages/core/algorithms/breakdown/index.ts` | exact |
| `packages/core/algorithms/sigma1/rp/2022.ts` .. `2026.ts` | model | transform (parse raw JSON -> RP fields) | `packages/core/algorithms/breakdown/2022.ts` .. `2026.ts` (esp. `2026.ts` for nested-field style) | exact |
| `packages/core/algorithms/sigma1/rp/reconciliation.test.ts` | test | batch (corpus-wide reconciliation) | `packages/core/algorithms/breakdown/reconciliation.test.ts` | exact |
| `packages/core/algorithms/sigma1/rp/distribution.ts` | service | transform (Monte Carlo draw -> pmf) | `packages/harness/identifiability.ts` (seeded PRNG + `ml-matrix` SVD usage — same "hand-roll with cited primitives" style) | role-match |
| `packages/harness/tune.ts` | utility/CLI script | batch | `packages/harness/identifiability.ts` (standalone committed script shape) + `packages/harness/cli.ts` (`ALGORITHMS` registry / `runSeasons` reuse) | exact |
| `packages/harness/promote.ts` | utility/CLI script | file-I/O (writes committed JSON) | `packages/harness/identifiability.ts` (script shape) + `packages/harness/artifact.ts` (validate-then-write discipline) | role-match |
| `packages/harness/digest.test.ts` | test | request-response (re-run + assert match) | `packages/core/algorithms/breakdown/reconciliation.test.ts` (corpus-backed assertion test shape) + `packages/harness/artifact.test.ts` | role-match |
| `.github/workflows/test.yml` | config | event-driven (CI trigger) | `.github/workflows/deploy.yml` | role-match |
| `packages/core/algorithms/types.ts` (extend `UpcomingMatch` with `eventType`; possibly `Prediction` with RP pmf fields) | model | transform | itself (existing) | exact |
| `packages/harness/artifact.ts` (possible schema v3 bump) | model/config | CRUD (Zod schema + validate-on-write) | itself (existing) | exact |
| `packages/harness/predictions.ts` / `metricHistory.ts` (extend for RP fields) | utility | file-I/O (JSONL sidecar) | itself (existing) | exact |

## Pattern Assignments

### `packages/core/algorithms/sigma1/params.ts` (model/config)

**Analog:** `packages/core/algorithms/carryover.ts` (constants + doc-comment style) and `sigma1/index.ts`'s existing `Sigma1Options`/`makeSigma1` factory shape.

**Doc-comment density pattern** (`carryover.ts:1-44`): every exported constant carries a multi-paragraph comment naming *why* the value/shape was chosen, citing decision IDs (`D-16`), and stating explicitly when something is a "Phase 3 hyperparameter, default unverified" (see `carryover.ts:66-71,73-78,80-84`). `params.ts` must match this density — every field should say which module it came from and reference the tagged-constant list in RESEARCH.md Pattern 1.

**Current options shape to extend** (`packages/core/algorithms/sigma1/index.ts` — read this session, factory signature `makeSigma1({ id, linkMode })` around line ~741 per RESEARCH.md's citation): add a `params: Sigma1Params` field alongside `id`/`linkMode`, defaulting to `DEFAULT_SIGMA1_PARAMS` when omitted, exactly the way an options object already threads `linkMode` down to `linkFunctions.ts`.

**Constants currently module-level, to become `Sigma1Params` fields** (imports pattern to replace):
```typescript
// Source: packages/core/algorithms/sigma1/kalman.ts:61,70 [read this session]
export const SIGMA1_PROCESS_NOISE_WITHIN_EVENT = 0.5;
export const SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY = 8;
```
Every consuming module (`kalman.ts`, `consistency.ts`, `covariance.ts`, `linkFunctions.ts`) currently imports these as bare named exports (see `sigma1/index.ts:56-65` for the existing import block) — the refactor's core pattern is turning each `import { SIGMA1_X } from "./kalman.js"` into a `params.x` field read, with the module still *exporting* the same name as a fallback default (`DEFAULT_SIGMA1_PARAMS.processNoiseWithinEvent = SIGMA1_PROCESS_NOISE_WITHIN_EVENT`) so existing call sites/tests referencing the constant directly don't silently break.

**Zod schema pattern for the committed parameter file** — mirror `artifact.ts`'s `HarnessArtifactSchema` validate-on-write discipline (`artifact.ts:86-93,112` — `buildArtifact` throws via Zod rather than returning a malformed object). `Sigma1Params` should have a matching `Sigma1ParamsSchema` used by `promote.ts` before it writes `data/algorithm-versions/{id}.json`.

---

### `packages/core/algorithms/carryover.ts` (split — D-04)

**Analog:** itself. Current shared constants (`EPA_NORM_MEAN`, `EPA_NORM_SD`, `EPA_INIT_PENALTY`, `EPA_MEAN_REVERSION` (tagged hyperparameter, line 68-71), `EPA_CARRY_LAST_YEAR_WEIGHT`/`EPA_CARRY_PRIOR_YEAR_WEIGHT` (tagged, lines 73-84)) must split into an EPA-frozen copy (kept exactly as-is, consumed by `epa.ts` unchanged) and a Sigma1-owned tunable copy threaded through `Sigma1Params`. Per RESEARCH.md Open Question 3 / CONTEXT.md D-04: only the three explicitly tagged constants (`EPA_MEAN_REVERSION`, `EPA_CARRY_LAST_YEAR_WEIGHT`, `EPA_CARRY_PRIOR_YEAR_WEIGHT`) are sensitivity-screen candidates for Sigma1's copy — `NORM_MEAN`/`NORM_SD`/`INIT_PENALTY` stay structurally duplicated, not independently tuned.

**Core function to duplicate/parameterize** (`carryover.ts:114-128`, `carryNormalizedRating`) — currently reads module-level constants directly; the Sigma1 copy needs the same function signature but reading from `Sigma1Params` instead of bare constants. Follow the exact math/comment shape already in place; do not rederive it.

---

### `packages/core/algorithms/sigma1/rp/rules.ts` (dispatch table)

**Analog:** `packages/core/algorithms/breakdown/index.ts` (read in full this session, 76 lines).

**Dispatch table pattern** (`breakdown/index.ts:36-57`):
```typescript
const SEASON_COMPONENT_MAPS: Readonly<Record<number, SeasonComponentMap>> = {
  2022: breakdown2022,
  2023: breakdown2023,
  2024: breakdown2024,
  2025: breakdown2025,
  2026: breakdown2026,
};

export function componentMapForSeason(season: number): SeasonComponentMap {
  const map = SEASON_COMPONENT_MAPS[season];
  if (!map) {
    throw new Error(
      `componentMapForSeason: no component map registered for season ${season} (registered: ${Object.keys(SEASON_COMPONENT_MAPS).join(", ")})`
    );
  }
  return map;
}
```
`rp/rules.ts` should mirror this exactly: `RP_RULE_MODULES: Readonly<Record<number, RpRuleModule>>` and `rpRuleModuleForSeason(season)` throwing (never defaulting) for an unregistered season — same D-19 "additive, new entry, never a branch" discipline stated in `breakdown/index.ts:1-16`'s file header. Split `constants.ts`-style shared leaf types (`RpRuleModule` interface, any shared RP constant like win/tie RP-by-season) into a dependency-free leaf module the way `breakdown/constants.ts` is separated from `breakdown/index.ts`, to avoid the same circular-import trap `breakdown/index.ts:8-15` documents.

---

### `packages/core/algorithms/sigma1/rp/2022.ts` .. `2026.ts` (per-season rule modules)

**Analog:** `packages/core/algorithms/breakdown/2026.ts` (read in full, 100+ lines) for the nested-field/nonobvious-schema style; also `breakdown/2022.ts` (per canonical refs) for the simpler flat-field style.

**Imports + schema pattern** (`breakdown/2026.ts:29-68`):
```typescript
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

const HubScoreSchema = z.object({
  transitionPoints: z.number().finite(),
  // ... only the fields this map reads — zod's default strip mode drops the rest
});

const SideBreakdownSchema = z.object({ /* ... */ });
const Breakdown2026Schema = z.object({ red: SideBreakdownSchema, blue: SideBreakdownSchema });
```
RP modules should follow the identical "only declare the fields you read, zod strips the rest, deliberately NOT `.passthrough()`" discipline (`2026.ts:33-42` explains why), but the field selection is the count/flag fields named in RESEARCH.md's verified per-season RP table (e.g. 2026: `energizedAchieved`, `superchargedAchieved`, `traversalAchieved`, `hubScore.totalCount`, `totalTowerPoints`) rather than point fields.

**Doc-comment discipline** (`breakdown/2026.ts:1-28`): every season module opens with a comment block citing the manual section (D-12: "manual is the authoring source, cited by section"), the verification method used (corpus reconciliation), and an explicit "roll-up avoidance" list of fields deliberately never read. RP modules must match this exactly, citing the manual sections from RESEARCH.md's Code Examples table.

**Season-specific structural warning to carry over:** `2026.ts:14-19` documents that `hubScore.totalCount` — not `totalPoints` — is the correct field despite being numerically identical in sampled data; this is the exact "count fields, never points" discipline D-09 requires for every RP module (see RESEARCH.md Anti-Patterns).

**Component map interface to extend/mirror** — `breakdown/constants.ts`'s `SeasonComponentMap` interface (`components`, `diagnosticKeys`, `parse(rawJson, side)`) is the shape `RpRuleModule` should structurally match: `parse(rawJson, side, eventType)` returning the season's RP-relevant flags/counts plus win/tie RP value, with `eventType` threaded in per RESEARCH.md Open Question 2's recommendation (widen `UpcomingMatch` with a non-outcome-bearing `eventType: number` field).

---

### `packages/core/algorithms/sigma1/rp/reconciliation.test.ts`

**Analog:** `packages/core/algorithms/breakdown/reconciliation.test.ts` (read in full, 100+ lines) — D-12 explicitly calls for mirroring this shape.

**Full structural pattern to copy nearly verbatim:**
```typescript
// Source: packages/core/algorithms/breakdown/reconciliation.test.ts [read this session]
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../../corpus/db.js";
import { componentMapForSeason, FOULS_COMMITTED_COMPONENT } from "./index.js";

const CORPUS_PATH = "data/corpus.sqlite";
const SAMPLE_SIZE = 2000;
const REGISTERED_SEASONS = [2022, 2023, 2024, 2025, 2026] as const;

function sampleBreakdowns(year: number, limit: number) {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    return db.prepare(
      `SELECT m.match_key, m.score_breakdown_raw
       FROM matches m JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.has_score_breakdown = 1 AND m.winner IS NOT NULL AND e.is_offseason = 0
       ORDER BY m.match_key ASC LIMIT ?`
    ).all(year, limit);
  } finally { db.close(); }
}

const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

describe.each(REGISTERED_SEASONS)("season %i RP reconciliation (D-12)", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }
  // ... recompute each bonus flag from raw fields + event_type tier table,
  // assert === TBA's own {bonusName}Achieved flag; assert summed RP ===
  // red_rp_earned / blue_rp_earned.
});
```
Key differences the new test must add over the analog: (1) it must also read `event_type` from the `events` table (the analog doesn't need it) to apply per-tier thresholds; (2) it must assert against `red_rp_earned`/`blue_rp_earned`, not `totalPoints`; (3) per Pitfall 5 in RESEARCH.md, 2022's Cargo Bonus needs a small documented tolerance (~0.3%) rather than a literal 100% assertion — follow the same "skip with an explicit message, not a silent pass" discipline the analog uses for a missing corpus (`reconciliation.test.ts:74-80`), applied here to "assert exception rate is below a stated, documented threshold" rather than exactly zero.

---

### `packages/core/algorithms/sigma1/rp/distribution.ts` (Monte Carlo joint draw)

**Analog:** `packages/harness/identifiability.ts` for the "hand-roll with cited, well-known primitives" style and its `ml-matrix` usage pattern; RESEARCH.md's own Pattern 3 code example for the specific Cholesky/Box-Muller primitives.

**Seeded PRNG pattern to reuse verbatim** (`identifiability.ts:122-131`):
```typescript
/** Deterministic PRNG (Mulberry32) — same seed always produces the same event sample, so this script's output is reproducible across runs, not a fresh random draw each time. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}
```
D-16 requires the seed come from `Sigma1Params.rpMonteCarloSeed` rather than a module constant like `identifiability.ts`'s own `SAMPLE_SEED` — same function, parameterized seed source.

**`ml-matrix` usage pattern** (`identifiability.ts:94`, `import { Matrix, SingularValueDecomposition } from "ml-matrix";` and its usage at `computeDesignMatrix`, lines ~302-348): shows the project's established style for wrapping an `ml-matrix` call — build a `Matrix` via `Matrix.zeros`/`.set`, run the decomposition, read named properties off the result object. `distribution.ts` follows the same shape but with `CholeskyDecomposition` per RESEARCH.md's Pattern 3 example (`import { Matrix, CholeskyDecomposition } from "ml-matrix"`).

**Doc-comment discipline for pass/fail thresholds or hand-rolled math** (`identifiability.ts:60-88`): every numeric threshold or formula choice is justified in prose with a citation (Golub & Van Loan for conditioning) — the Box-Muller transform and the discrete-pmf tallying in `distribution.ts` should carry the same "well-known, cite the formula" comment discipline RESEARCH.md's Pattern 3 already models.

---

### `packages/harness/tune.ts` (sensitivity screen + joint search)

**Analog:** `packages/harness/identifiability.ts` (standalone committed-script shape) + `packages/harness/cli.ts` (`ALGORITHMS` registry, `runSeasons`/season-loop reuse, `parseArgs` flag design).

**Script skeleton to copy** (`identifiability.ts:90-131` imports/constants, plus the `parseArgs`/entry-point-guard shape referenced at file header lines 11-14 — `pnpm identifiability --seasons 2022-2026`, `async function main()`, entry-point guard via `pathToFileURL`):
```typescript
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
```
`tune.ts` should follow the identical `parseArgs` + `async function main()` + `pathToFileURL(process.argv[1]) === import.meta.url`-style entry-point guard so importing it (e.g. from a test) never triggers a real corpus/replay pass.

**CLI registry and replay reuse pattern** (`cli.ts:81-87` `ALGORITHMS` registry; `cli.ts:72` imports `buildSeasonStream, WalkForwardSimulator` from `replay.js`):
```typescript
const ALGORITHMS: Record<string, AlgorithmModule<any>> = {
  opr, epa, sigma1,
  "sigma1-seasonsd": sigma1SeasonSd,
  "sigma1-normalcdf": sigma1NormalCdf,
};
```
`tune.ts` should build `sigma1` variants directly via `makeSigma1({ params: candidateParams })` and run them through the *same* `buildSeasonStream`/`WalkForwardSimulator` pair `cli.ts` uses (import from `./replay.js`), never a parallel replay implementation — this is what makes every optimizer evaluation inherit `toLeakProofUpcoming`'s leak-proof guarantee "for free," per RESEARCH.md's Architecture Diagram.

**Objective function reuse** — `aggregateScores`/`HarnessPredictionInput` from `score.ts` (read this session, `score.ts:1-80`) is D-01's Brier objective source; `tune.ts` should call `aggregateScores` on tune-season predictions and read `.brierScore` off the resulting `ScoreSlice`, not reimplement Brier scoring.

**Output pattern** (`identifiability.ts` writes to `reports/identifiability.json` via `mkdirSync`+`writeFileSync`, `DEFAULT_OUT_PATH = join("reports", "identifiability.json")` at line 100) — `tune.ts` should write the sensitivity-screen artifact and joint-search log to `reports/` the same way (gitignored, per the failure log's repo-hygiene rule cited throughout CONTEXT.md).

---

### `packages/harness/promote.ts` (version promotion + digest writer)

**Analog:** `packages/harness/identifiability.ts` (script shape) + `packages/harness/artifact.ts` (validate-then-write discipline).

**Validate-then-write pattern** (`artifact.ts:107-112`, `buildArtifact`):
```typescript
export function buildArtifact(params: BuildArtifactParams): HarnessArtifact {
  const seasonsCovered = Array.from(new Set(params.slices.map((slice) => slice.season))).sort((a, b) => a - b);
  const candidate = { schemaVersion: ARTIFACT_SCHEMA_VERSION, provenance: { /* ... */ }, /* ... */ };
  return HarnessArtifactSchema.parse(candidate); // throws on shape drift
}
```
`promote.ts` should build a candidate `{ id, codeVersion, paramSetName, params, provenance, digest }` object and `.parse()` it through a `PromotedVersionSchema` before writing — matching the "throws rather than returning a malformed object" discipline explicitly named in `artifact.ts`'s file header.

**Where to write (committed, not gitignored)** — unlike `identifiability.ts`'s `reports/` output, `promote.ts` writes to `data/algorithm-versions/{id}.json` and this file IS committed (D-15: "commits a few hundred bytes rather than a generated artifact"). Check `.gitignore` for `data/` before implementing — RESEARCH.md Pattern 4 flags this as a deliberate exception to the otherwise-gitignored `data/`/`reports/` convention, so the planner should scope `data/algorithm-versions/` narrowly (e.g. a `.gitignore` negation pattern) rather than un-ignoring all of `data/`.

**SHA-256 digest** — use `node:crypto`'s `createHash("sha256")` (already used for `randomUUID` in `packages/ingest/cli.ts:16` per RESEARCH.md's Don't Hand-Roll table) over the full prediction stream to produce D-15's digest; no new dependency.

---

### `packages/harness/digest.test.ts` (CI reproducibility test)

**Analog:** `packages/core/algorithms/breakdown/reconciliation.test.ts` (corpus-backed assertion-test shape) + `packages/harness/artifact.test.ts` (artifact-schema-focused test conventions — check this file for existing Vitest idioms around `HarnessArtifactSchema`).

**Pattern:** load a promoted version's committed JSON from `data/algorithm-versions/{id}.json`, re-run it via `WalkForwardSimulator`/`buildSeasonStream` on the bounded deterministic slice named in its provenance, recompute the digest, and `expect(recomputedDigest).toBe(committedDigest)` — mirrors `reconciliation.test.ts`'s "recompute from raw fields, assert equals recorded value" shape, applied to a full prediction-stream hash instead of a per-match flag.

**Skip discipline to match:** if `data/corpus.sqlite` (needed to re-run the bounded slice) is absent, `it.skip` with an explicit message exactly like `reconciliation.test.ts:74-80` — never a silent pass.

---

### `.github/workflows/test.yml`

**Analog:** `.github/workflows/deploy.yml` (the only existing workflow, read in full — 53 lines, confirmed no test step per RESEARCH.md Pitfall 6).

**Structure to copy and adapt:**
```yaml
# Source: .github/workflows/deploy.yml [read this session]
name: Build & deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
```
`test.yml` should follow this shape but trigger on `push`/`pull_request` (not just `push: [main]`, since PRs need the gate too), use pnpm (this project's actual package manager per `package.json:6` `"packageManager": "pnpm@11.21.0"` — note `deploy.yml` still uses `npm`, an inconsistency not to propagate) via `pnpm/action-setup`, and run `pnpm test` (`vitest run`, `package.json:9`) and `pnpm typecheck` (`tsc --noEmit`, `package.json:8`) as separate steps, per RESEARCH.md Pitfall 6's explicit recommendation.

---

### `packages/core/algorithms/types.ts` (extend `UpcomingMatch`)

**Analog:** itself (existing file, read in full, 128 lines).

**Pattern to follow** (`types.ts:16-26`, `UpcomingMatch`): add `eventType: number` as a new field on `UpcomingMatch` (not `MatchResult`-only), following the exact style of existing non-outcome-bearing fields (`compLevel`, `setNumber`, `matchNumber`) already there — per RESEARCH.md Open Question 2, `eventType` is knowable pre-match so it belongs on `UpcomingMatch`, not gated behind `MatchResult`'s outcome-only fields (`winner`, `redScore`, etc., `types.ts:29-47`). No change needed to `replay.ts`'s `OUTCOME_KEYS`/leak-proof Proxy since `eventType` is not outcome-bearing (contrast with `scoreBreakdownRaw`'s explicit note at `types.ts:41-46` about being added to `OUTCOME_KEYS` in the same commit — `eventType` does NOT need that treatment).

**Prediction shape extension for RP** (`types.ts:56-67`, `Prediction` interface) — add optional `redRpPmf`/`blueRpPmf: readonly number[]` fields (D-10: full discrete pmf) following the existing optional-field convention already used for `variance`/`redComponents`/`blueComponents` (`Optional...populated by later algorithms` comment style at `types.ts:63`).

## Shared Patterns

### Dense, decision-ID-citing doc comments
**Source:** every existing file in `packages/core/algorithms/` and `packages/harness/` (see `carryover.ts:1-44`, `breakdown/2026.ts:1-28`, `identifiability.ts:1-89`, `types.ts:1-11`).
**Apply to:** every new file this phase introduces. Comments must name *why*, cite decision IDs (`D-XX`) from CONTEXT.md, and — for anything numeric — either justify the number or explicitly flag it `Phase 3 hyperparameter, default unverified` (see `kalman.ts:56-70`'s exact phrasing, which the sensitivity screen greps for).

### Pure predict/update, immutable state, no mutation
**Source:** `packages/core/algorithms/types.ts:1-11` (file header: "`predict` and `update` are pure: neither may mutate its `state` argument") and `kalman.ts:51-53` (`applyProcessNoise` returns a new object rather than mutating).
**Apply to:** `rp/*.ts`, `distribution.ts`, `params.ts` consumption sites in `kalman.ts`/`consistency.ts`/`covariance.ts`/`linkFunctions.ts` — parameters are read, never mutated; state transitions always return new objects.

### Zod schema as executable spec, validate-on-write
**Source:** `packages/harness/artifact.ts:107-112` (`buildArtifact` throws via `.parse()` rather than returning unvalidated data); `breakdown/2026.ts:43-68` (schemas declare only fields read, default-strip the rest, deliberately not `.passthrough()`).
**Apply to:** `Sigma1Params`/`Sigma1ParamsSchema`, RP rule modules' per-season raw-field schemas, `promote.ts`'s committed version-file schema, any `ARTIFACT_SCHEMA_VERSION` bump.

### Standalone committed-script shape (`parseArgs` + entry-point guard + JSON output to `reports/`)
**Source:** `packages/harness/identifiability.ts:90-131` (imports/constants) and its file header (lines 11-14) describing the `parseArgs`/`async function main()`/entry-point-guard shape.
**Apply to:** `tune.ts`, `promote.ts` — both are one-time, human-triggered scripts producing either gitignored (`reports/`) or deliberately-committed (`data/algorithm-versions/`) output, never imported for their side effects.

### Corpus-wide reconciliation test against TBA's own recorded ground truth
**Source:** `packages/core/algorithms/breakdown/reconciliation.test.ts` (full file read this session) — sample via `openCorpusReadOnly`, skip with explicit message if corpus absent, assert recomputed value equals TBA's own recorded field for every sampled row.
**Apply to:** `rp/reconciliation.test.ts` (D-12) and `digest.test.ts` (D-15, same "recompute and assert equals recorded/committed value" shape, applied to a version's digest instead of a per-match flag).

### Season dispatch table, additive-only (D-19 discipline)
**Source:** `packages/core/algorithms/breakdown/index.ts:1-16,36-57` — `Readonly<Record<number, Module>>` map plus a lookup function that throws (never defaults) for an unregistered season; "adding a season is a new entry, never a branch."
**Apply to:** `rp/rules.ts`'s `RP_RULE_MODULES`/`rpRuleModuleForSeason`.

## No Analog Found

None. Every file in this phase has at least a role-match analog already in the codebase; RESEARCH.md's own "Don't Hand-Roll" table independently confirms no new external dependency or novel architecture is required.

## Metadata

**Analog search scope:** `packages/core/algorithms/`, `packages/core/algorithms/breakdown/`, `packages/core/algorithms/sigma1/`, `packages/harness/`, `.github/workflows/`
**Files scanned:** 20 (12 read in full or substantial part this session: `sigma1/index.ts`, `sigma1/kalman.ts`, `breakdown/2026.ts`, `breakdown/reconciliation.test.ts`, `breakdown/index.ts`, `identifiability.ts` (full), `carryover.ts` (full), `types.ts` (full), `cli.ts` (partial), `artifact.ts` (partial), `score.ts` (partial), `replay.ts` (grepped), `deploy.yml` (full), `package.json` (full))
**Pattern extraction date:** 2026-08-14
