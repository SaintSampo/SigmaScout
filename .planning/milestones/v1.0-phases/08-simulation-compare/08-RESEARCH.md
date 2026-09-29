# Phase 8: Simulation & Compare - Research

**Researched:** 2026-08-31
**Domain:** Client-side Monte Carlo rank simulation (Web Worker) + a proof-grade Compare page
**Confidence:** HIGH for code-contract facts (all read live from source this session), MEDIUM for
Web Worker/Vitest interaction (training knowledge cross-checked against a live GitHub issue),
LOW/flagged-ASSUMED for two genuinely new gaps this research surfaced that neither 08-CONTEXT.md
nor 08-UI-SPEC.md addresses (see Open Questions).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Simulation uses each match's own stored, as-of-that-match prediction. Live case (an
  unplayed start match) is exact — `publish.ts:1733` calls `algorithm.predict(state, match)` with
  one shared `state` for every scheduled match. Rewind case (an already-played start match) is
  approximate and overconfident, and must say so on the page.
- **D-02:** The phase must measure the rewind-overconfidence gap on ~5 events and publish the
  number in the on-page caption (`{measured}%` narrower rank spread). Real task, not a footnote.
- **D-03:** `redRpPmf`/`blueRpPmf` added to `EventMatchSchema` (played matches) and populated in
  the same republish. ~84 bytes/match, dense (not sparse) encoding. Already computed by the
  harness; this is publisher plumbing only.
- **D-04:** Simulation tab is VPR-only, plain-disabled (no tooltip) on OPR/EPA — exactly Phase 7
  D-17's treatment.
- **D-05:** Rank shown as median + drawn 10th–90th percentile band (never `±`) + per-row histogram.
  Band edges are continuous/interpolated (sketch 005), never integer-snapped.
- **D-06:** No "probability of top 8" / captain column. Explicitly dropped by the user.
- **D-07:** 1000 draws run in a browser Web Worker; live progress + total elapsed time shown.
  First Web Worker in `apps/web`.
- **D-08:** One uniform Compare table across all 5 seasons, no tune/holdout visual tiering — a
  single methodology note carries the disclosure instead.
- **D-09:** Compare page surfaces everything the artifact carries (accuracy, Brier, compLevel
  split, calibration bins, exclusion counts).
- **D-10:** Parity check (SC-4) is a Vitest component test rendering the Compare page against a
  committed copy of a real published `v1/compare/{year}.json`. Chosen for speed; proves page↔artifact
  fidelity only, not artifact↔harness fidelity.
- **D-11:** Differences too small to call render as a visual tie (both plain weight, neither
  greyed), not a defeat. Threshold is a stated judgement call, not a computed significance level.

### Claude's Discretion

- Where `simulation` sits in the tab strip (UI-SPEC already resolved this: sixth, after Elims) and
  six-tab mobile behavior.
- Start-match picker form (UI-SPEC resolved: a bounded-height scrollable row list).
- Auto-run vs explicit button (UI-SPEC resolved: explicit "Run simulation" button).
- Rank axis domain / shared-scale computation (UI-SPEC resolved: `1..N`, `x()` in `simAxis.ts`).
- Compare page layout and compLevel-switching (UI-SPEC resolved).
- Calibration curve drawing + explainer (UI-SPEC resolved: sentence-first, sketch 006 winner C).
- Depth-within-system polish (`ui-polish-pass.md` question 1) — base-palette question (question 2)
  stays deferred, no `--color-*`/`--accent`/`--alliance-*`/`--tier-*` value changes this phase.

### Deferred Ideas (OUT OF SCOPE)

- Rolling-origin hyperparameter tuning (its own post-v1.0 phase).
- Sidecar checkpoint simulation artifact (`v1/sim/{eventKey}/...`) — D-02's measurement is the
  trigger for revisiting this, not this phase's job to build.
- Elimination-bracket / alliance-selection simulation — SC-1 fences this to qualification matches.
- `publish-as-of-match-team-metrics.md` — reviewed, not folded; unrelated to this phase's needs.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVNT-07 | Simulation tab: pick a start match, simulate remaining quals 1000x from predicted winners/confidence/RP±variance, produce a predicted rank distribution per team | Architecture Patterns (simulation algorithm), Code Examples (categorical draw, continuousQuantile), Common Pitfalls (Web Worker + Vitest, ranking-formula gap) |
| COMP-01 | Table of prediction accuracy (winner accuracy, Brier) per algorithm per year | Compare page data shape (below), reuses already-published `v1/compare/{year}.json` — no pipeline work |
| EVAL-05 | Compare page displays the same numbers the offline harness produced, verified by automated check | D-10 parity check pattern (below), citing the exact existing component-test convention |
</phase_requirements>

## Summary

This phase has almost no new backend computation — nearly everything it needs is either already
computed (`redRpPmf`/`blueRpPmf` exist on the team artifact and inside `predict()`'s return value
today) or already published (`v1/compare/{year}.json` is live for all 5 seasons). The two genuine
build items are (1) a publisher plumbing change (two lines mirroring existing code, verified) plus
a full republish, and (2) the app's first client-side compute surface: a Web Worker running a
1000-draw Monte Carlo simulation over already-published per-match RP distributions.

The simulation is simpler than it first looks once you read what the artifacts actually carry:
`redRpPmf`/`blueRpPmf` are distributions over **total** RP (win/tie RP already folded in via the
harness's own joint Monte Carlo draw — confirmed by reading `rp/distribution.ts` and
`rp/constants.ts`), and FRC's own "Ranking Score" ranking statistic is *itself* just average RP
per match played. That means the simulation needs no separate win/loss modeling at all — draw a
total-RP value per alliance per remaining match, accumulate per team, divide by matches played,
sort descending. The catch, not previously surfaced by CONTEXT or UI-SPEC: the corpus only stores
TBA's *position-0* sort order ("Ranking Score"); no tiebreaker sort orders are captured anywhere in
the pipeline, so any two teams landing on the exact same simulated average RP are genuinely
tied with no data-backed way to break the tie. This is a forced approximation, not an oversight —
see Open Questions.

The other load-bearing finding: this app has never had a Web Worker, and jsdom (this repo's Vitest
test environment) does not implement the `Worker` API at all — a documented, currently-open
upstream limitation (even Vitest's own official `@vitest/web-worker` package has a known
jsdom-collision bug). The safe, UI-SPEC-aligned path is to keep 100% of the simulation math in a
pure, DOM-free function tested directly with plain Vitest, and test the worker *plumbing*
(message passing, error handling) against a small hand-rolled mock `Worker` class — never
`@vitest/web-worker` — assigned to `global.Worker` in the test file.

**Primary recommendation:** Sequence D-03 (schema + republish) strictly before any Worker/UI code;
place the pure simulation core (categorical RP draw + accumulate + `continuousQuantile` rank
banding) in a new browser-safe leaf module reusable by both the Worker and a new Node-side D-02
control-run script, following this repo's own established "small leaf module lives under
`packages/core/algorithms/`, checked (not blocked) by `browserSafeSchemas.test.ts`" pattern rather
than duplicating the math in two places.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| RP/win-probability distributions per match | Pipeline (Node, offline) | — | Already computed by `predict()`; D-03 only publishes what already exists |
| 1000-draw Monte Carlo simulation | Browser (Web Worker) | — | CLAUDE.md's fixed topology: "the 1000 draws themselves are cheap, unconstrained JS in the visitor's browser... not a Cloudflare Workers CPU-budget problem at all" |
| Rank-distribution rendering (histogram/band/median) | Browser (React, hand-built SVG/div) | — | UI-SPEC: no chart library on this tab, follows `matchAxis.ts`'s existing hand-built plot-cell convention |
| Rewind-overconfidence measurement (D-02) | Pipeline (Node, offline, one-off script) | — | Needs `WalkForwardSimulator`/corpus access, unavailable in the browser; output is a static number baked into copy |
| Compare page accuracy/calibration data | Pipeline (already published) / Browser (render only) | — | `v1/compare/{year}.json` already exists; this phase is UI + proof only, no pipeline change |
| Compare↔harness parity proof (D-10) | Browser test (Vitest component test) | — | Renders the real page against a committed fixture; proves page fidelity, not harness fidelity |

## Standard Stack

No new runtime dependency this phase — confirmed against `apps/web/package.json` (read live) and
UI-SPEC's own Registry Safety section ("No third-party registries declared or needed this phase;
no new npm dependency introduced"). Every library used already ships in this repo:

| Library | Version (installed) | Purpose this phase | Source |
|---------|---------|---------|--------------|
| Vite | 8.2.2 | `new Worker(new URL(...), { type: "module" })` bundling | [VERIFIED: apps/web/package.json, read live] |
| React 19 / TanStack Query / TanStack Router | 19.2.8 / 5.102.2 / 1.170.32 | Existing data-fetch/routing patterns, unchanged | [VERIFIED: apps/web/package.json] |
| Vitest | 4.1.10 | Pure-function unit tests + component tests; jsdom environment (`vitest.config.ts`) | [VERIFIED: apps/web/vitest.config.ts, read live] |
| Recharts | 3.10.1 | Compare page's calibration chart only — **not** used on the Simulation tab (UI-SPEC, binding) | [VERIFIED: apps/web/package.json] |
| `zod` | 4.4.3 | Schema changes to `EventMatchSchema` in `packages/harness/pageArtifacts.ts` | [VERIFIED: packages/harness/pageArtifacts.ts, read live] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled mock `Worker` class in tests | `@vitest/web-worker` (official Vitest package) | Not installed; has a **documented open GitHub issue** (vitest-dev/vitest#7023) where `postMessage` scope collides with jsdom's `window.postMessage` when both are combined — exactly this repo's jsdom test environment. Avoid it for this phase; a ~15-line mock class sidesteps the bug entirely and needs no new dependency |
| Copying `mulberry32` a third time into the new simulation module | Importing `mulberry32` from `packages/core/algorithms/sigma1/rp/distribution.ts` | That file imports `ml-matrix` (a real dependency) at module scope for its Cholesky decomposition — importing it would drag `ml-matrix` into the browser bundle for a 10-line PRNG. The codebase **already copies this exact function twice** (`packages/harness/identifiability.ts` and `rp/distribution.ts` both carry verbatim copies, confirmed by `rp/distribution.ts`'s own doc comment) — a third copy is this repo's own established convention, not a shortcut |

**Installation:** none required.

## Package Legitimacy Audit

Not applicable — no external packages are installed this phase (confirmed live against
`apps/web/package.json`; UI-SPEC's Registry Safety section states the same). The Web Worker is
custom code, not a dependency.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │  packages/harness/publish.ts (offline, Node) │
                     │  buildEventArtifact(): matches[].redRpPmf/   │
                     │  blueRpPmf now populated (D-03, 2-line diff) │
                     └───────────────────┬───────────────────────────┘
                                         │ full republish (pnpm publish:seasons)
                                         ▼
                     ┌─────────────────────────────────────────────┐
                     │  R2: v1/event/{eventKey}/vpr@{v}.json         │
                     │  matches[] (played, now with RP pmfs)         │
                     │  upcoming[] (unplayed, already had RP pmfs)   │
                     └───────────────────┬───────────────────────────┘
                                         │ GET (existing eventQueryOptions)
                                         ▼
        ┌───────────────────────────────────────────────────────────┐
        │  apps/web — Simulation tab (React, main thread)            │
        │  1. Start-match picker: user picks start match             │
        │  2. postMessage({ startMatchIndex, matches subset }) ─┐    │
        │                                                        │    │
        │  4. onmessage(progress) → live counter/progress bar   │    │
        │  5. onmessage(result) → rank-distribution table       │    │
        └────────────────────────────────────────────────────────┼───┘
                                                                  │
                     ┌────────────────────────────────────────────▼───┐
                     │  apps/web — simulation.worker.ts (Web Worker)   │
                     │  for each of 1000 draws:                        │
                     │    for each remaining qm match:                 │
                     │      redRp  = drawCategorical(redRpPmf, rng)    │
                     │      blueRp = drawCategorical(blueRpPmf, rng)   │
                     │      accumulate into per-team RP sum + count    │
                     │    sort teams by avg RP → this draw's ranks     │
                     │    postMessage progress every N draws           │
                     │  after 1000: continuousQuantile() per team      │
                     │  → postMessage(final per-team rank histograms)  │
                     └──────────────────────────────────────────────────┘

     Separately, offline (D-02 control run, new Node script):
     packages/harness's buildSeasonStream + WalkForwardSimulator.runAll
     → snapshot frozen pre-event state → predict() without update() on the
     event's own matches → SAME pure simulation core (imported, not
     duplicated) run against both "frozen" and "stored" predictions →
     measured %-narrower figure → hand-copied into the UI copy string.
```

### Recommended Project Structure

```
apps/web/src/
├── workers/
│   └── simulation.worker.ts       # thin: onmessage → calls the pure core → postMessage
├── lib/
│   ├── simAxis.ts                 # UI-SPEC's locked geometry constants (already specified)
│   └── simQuantile.ts             # continuousQuantile() port (UI-SPEC names this file)
packages/core/algorithms/
└── simulation/
    └── rankSimulation.ts          # NEW leaf module: pure draw+accumulate+rank core,
                                    # zero Node built-ins, zero DOM — importable from BOTH
                                    # the browser Worker and a Node control-run script
scripts/  (or packages/harness/)
└── measureRewindGap.ts            # NEW: D-02's control run (see below) — imports
                                    # rankSimulation.ts, buildSeasonStream, WalkForwardSimulator
```

**Why a new `packages/core/algorithms/simulation/` leaf module, not just `apps/web/src/lib/`:**
D-02's control-run script needs the *exact same* draw/accumulate/rank logic the browser Worker
uses — Monte Carlo results between "does the honest sim differ from the rewind sim" and "what the
user sees" must be the identical function, not two hand-synced copies (this is precisely the
"derive coupled geometry, never hand-tune both ends" lesson `chart-craft.md` names for every other
chart in this app, generalized from pixel geometry to simulation math). This repo already has a
precedent for exactly this shape of module: `packages/core/algorithms/sigma1/rp/constants.ts` is a
leaf module under `packages/core/algorithms/` that both a Node script and `apps/web` import
directly, and it is registered as a fifth-style entry point in
`packages/harness/browserSafeSchemas.test.ts`, checked *only* for Node-builtin imports (not the
broader "never reaches `packages/core/algorithms/`" rule, which applies only to the two original
schema entry points) [VERIFIED: packages/harness/browserSafeSchemas.test.ts:150-157, read live —
`RP_CONSTANTS_ENTRY_POINT` is checked via a dedicated `it(...)` for Node-builtin imports only].
**Planner obligation:** add a sixth entry-point check to `browserSafeSchemas.test.ts` for the new
`simulation/rankSimulation.ts` leaf module, mirroring the existing `RP_CONSTANTS_ENTRY_POINT`
pattern exactly.

### Pattern 1: The simulation reduces to accumulating total RP, not simulating wins/losses

**What:** `redRpPmf`/`blueRpPmf` are already a distribution over an alliance's **total** RP for
that match — win/tie RP is already folded into the domain (`maxRp = winRp + bonusNames.length`),
via the harness's own joint Monte Carlo draw that determines win/tie AND bonus achievement
together before binning the sum [VERIFIED: packages/core/algorithms/sigma1/rp/distribution.ts:411-421,
read live — `const redOutcomeRp = redWon ? ruleModule.winRp : tied ? ruleModule.tieRp : 0;` ... `redPmf = redBuckets.map((count) => count / params.rpMonteCarloDraws)`].
And FRC's own "Ranking Score" ranking statistic (the value TBA calls `sort_orders[0]`, the value
this pipeline stores as `EventTeamSchema.rp`) **is** average total RP per match played — confirmed
by the field's own doc comment [VERIFIED: packages/harness/pageArtifacts.ts:414-429, read live —
"TBA's Ranking Score, `sort_orders[0]`... It is a per-match average"].

**Consequence for the simulation:** you do not need to separately draw a winner (`pRedWin`) and
then separately draw bonus RP — draw ONE total-RP value per alliance per match directly from
`redRpPmf`/`blueRpPmf`, accumulate it into that alliance's three teams' running RP sum, divide by
each team's running matches-played count, and sort descending. `pRedWin` and
`predictedRedScore`/`predictedBlueScore` are **not inputs to the rank simulation at all** — this
narrows what the Worker needs to receive from the main thread considerably (just `redTeams`,
`blueTeams`, `redRpPmf`, `blueRpPmf` per remaining match, plus each team's already-earned RP and
matches-played count).

**When to use:** every remaining qualification match, live or rewind case alike (D-01 already
settles which source of `redRpPmf`/`blueRpPmf` to read per match — `matches[]` after D-03 lands,
or `upcoming[]`, never both for the same match).

### Pattern 2: Categorical draw from a pmf array

```typescript
// packages/core/algorithms/simulation/rankSimulation.ts (new)
// pmf[i] is P(total RP = i), i in 0..maxRp, sums to 1 (D-10's isValidPmf contract,
// pageArtifacts.ts) — draw one integer outcome via cumulative-sum inversion.
function drawCategorical(pmf: readonly number[], rng: () => number): number {
  const u = rng();
  let cumulative = 0;
  for (let i = 0; i < pmf.length; i++) {
    cumulative += pmf[i]!;
    if (u < cumulative) return i;
  }
  return pmf.length - 1; // floating-point residue guard — never reachable in exact math
}
```

### Pattern 3: `continuousQuantile()` — port verbatim, do not reinvent

```javascript
// Source, read live this session: .claude/skills/sketch-findings-sigmascout/
// sources/005-rank-distribution/index.html:149-162 [VERIFIED]
// dist[i] is a per-rank DRAW COUNT (not a probability) for rank i+1, i in 0..N-1.
function continuousQuantile(dist, p, draws) {
  var target = p * draws;
  var cum = 0;
  for (var i = 0; i < dist.length; i++) {
    var m = dist[i];
    if (m === 0) continue;
    if (cum + m >= target) {
      var frac = (target - cum) / m;
      return (i + 1) - 0.5 + frac;
    }
    cum += m;
  }
  return dist.length + 0.5;
}
```

UI-SPEC already names this file as the port target: `apps/web/src/lib/simQuantile.ts`. The
per-team `dist` array this function needs is a length-N array of "how many of the 1000 draws
landed team T at rank r" — exactly what the Worker's per-draw sort step should be accumulating
into as it goes (an `Int32Array` per team, or one `Int32Array(N*N)` indexed `[teamIndex*N + rank]`
for a single contiguous allocation, avoiding 78 separate small array allocations).

### Pattern 4: The D-03 publisher change is a 2-line mirror of existing code

`buildEventArtifact`'s `matches` row builder (`packages/harness/publish.ts:496-536`) is missing
exactly the two lines its own `upcoming` row builder (`publish.ts:538-560`) already has:

```typescript
// packages/harness/publish.ts — inside the `matches` map, add (mirrors upcoming's lines 558-559):
redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
```
[VERIFIED: packages/harness/publish.ts:538-560, read live — the `upcoming` map's last two lines
are exactly `redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,` and the
blue counterpart; `prediction` in the `matches` map's closure is the same `Prediction` type
(`params.predictions: readonly PredictionRecord[]`, `PredictionRecord.prediction: Prediction`),
which already carries `redRpPmf?: readonly number[]` on every `predict()` call, played or
unplayed, per `packages/core/algorithms/types.ts:146-148`]. `prediction` for played matches
comes from the exact same `algorithm.predict()` call used by the walk-forward replay
(`packages/harness/publish.ts:1653`, `const pr: PredictionRecord = { match: r.match, prediction: r.prediction }`)
— **no new computation, just reading a field that already exists on the object in scope.**

**Schema side:** `EventMatchSchema` (`pageArtifacts.ts:290-348`) needs the same two optional fields
`EventUpcomingMatchSchema` already has (`pageArtifacts.ts:370-371`), plus the same two
`.refine(isValidPmf, ...)` calls `EventUpcomingMatchSchema` already carries
(`pageArtifacts.ts:373-380`) — copy that refine pair onto `EventMatchSchema`'s own `.object({...})`
wrapper (it will need converting from a bare `z.object({...})` to a `.refine()`-chained schema, the
same shape `EventUpcomingMatchSchema` and `TeamSeasonMatchSchema` already use).

**Rounding side:** no new `ROUNDING_RULE` entry — reuse `ROUNDING_RULE.pmf` / `roundPmf()`
unchanged, exactly as `EventUpcomingMatchSchema` already does [VERIFIED: packages/harness/rounding.ts:96-114,
read live — `pmf: 5` is the only pmf-class entry and the file's header comment explicitly names
"Phase 8 draws ranking points from these repeatedly across a 1000-run simulation" as the reason for
5-decimal precision, i.e. this rounding rule was written anticipating exactly this field].

**Tests to update (found live, not exhaustive — planner should re-grep at execution time):**
`packages/harness/publish.test.ts` and `packages/harness/pageArtifacts.test.ts` both construct
`EventMatchSchema`/`buildEventArtifact` fixtures; a schema-shape test analogous to
`EventUpcomingMatchSchema`'s existing pmf-validation tests (referenced in STATE.md's Phase 07 log:
"pageArtifacts.test.ts's own schema-level Test 3b (07-07) is what actually covers the raw-value
refine failure") should be mirrored for `EventMatchSchema`.

### Pattern 5: The full republish command and its acceptance-criteria test

```bash
pnpm publish:seasons
# equivalently: tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason
```
[VERIFIED: package.json:24-25 and docs/publish-budget.md, read live]. ~17–25 minutes wall clock,
~54,671–56,776 PUTs depending on which measured run you compare against (both figures appear in
`docs/publish-budget.md`'s run history; use the most recent run's own reported count, don't hardcode
one). **Known Windows/Git-Bash hazard, already burned once in Phase 7:** the executor tool's Bash
timeout only kills the outer wrapper, not the deep `tsx` child process — STATE.md records a real
concurrent-writer incident from this exact failure mode during 07-17. **Any invocation of
`pnpm publish:seasons` in this phase MUST use `run_in_background: true` from the first attempt.**

**Acceptance test to name:** `packages/harness/payloadBudget.test.ts`, specifically the
`describe("published payload budget (D-05)")` block's `event`-page-kind assertions
[VERIFIED: packages/harness/payloadBudget.test.ts:129-165, read live]. This test parses a
committed JSON block at the bottom of `docs/publish-budget.md` (```json budget ... ```) —
**the planner must update that committed block's `pages.event.maxBytes`, `measuredAt`, and `run`
fields after the republish**, or the test will compare against stale numbers rather than the new
run's real output [VERIFIED: docs/publish-budget.md:1077-1084, read live — the exact JSON keys are
`count`/`medianBytes`/`p95Bytes`/`maxBytes`/`budgetMaxBytes`/`largestKey` under `pages.event`].
Current measured max for `event/{eventKey}` is 327,172 bytes against a 350,000 ceiling — 22,828
bytes of headroom, consistent with D-03's own ~84 bytes/match × largest event's ~135 matches ≈
11,340-byte worst-case addition (well inside headroom, matches CONTEXT's own estimate).

### Pattern 6: D-02's control run — no existing single entry point, build from existing primitives

There is **no existing script** that produces a frozen-prediction set — every existing entry point
(`packages/harness/cli.ts`, `tune.ts`, `promote.ts`) always predicts-then-updates per match (the
ordinary walk-forward rewind case is *already* what's published). But the primitives needed are
all exported and small:

1. `buildSeasonStream(corpus, season)` — the whole season's chronological match list
   [VERIFIED: packages/harness/replay.ts:72-81, read live].
2. `WalkForwardSimulator.runAll(algorithms, teams, initialStates?, onMatchComplete?)` — the only
   method that exposes intermediate state via its `finalStates` return property and its
   `onMatchComplete` callback [VERIFIED: packages/harness/replay.ts:136-160, read live]. `run()`
   (singular-algorithm) does **not** expose intermediate state — use `runAll()` even for one
   algorithm.
3. `selectMatchesChronological(corpus, { year, eventKey })` — the target event's own matches in
   order [VERIFIED: packages/corpus/db.ts:472-481, read live — `eventKey` is an optional filter].
4. `algorithm.predict(frozenState, toLeakProofUpcoming(match))` — called directly, once per event
   match, on the frozen state, **never followed by `update()`** — this is what makes the resulting
   predictions "frozen."

**Recipe for a new `scripts/measureRewindGap.ts`:**
1. Pick ~5 target events (mix of sizes; CONTEXT's own event-size table is a reasonable sampling
   frame).
2. For each event: run `buildSeasonStream` for its season, split into "matches strictly before this
   event's first match" and "this event's own matches" (via `eventKey` filter).
3. Run `runAll([vprAlgorithm], teams, undefined, onMatchComplete)` over the pre-event prefix;
   capture `finalStates.get("vpr")` as the frozen pre-event state.
4. For the event's own matches, in order, call `vprAlgorithm.predict(frozenState, ...)` per match
   (frozen predictions) — separately, the SAME matches already have their ordinary walk-forward
   ("stored"/rewind) predictions available from a normal full-season `runAll` pass (or reuse
   whatever `publish.ts` already produces for that event).
5. Feed both prediction sets through the SAME `rankSimulation.ts` core (imported, not
   reimplemented) to get two rank distributions per team.
6. Compare `p90 - p10` band widths, frozen vs. stored, averaged across the 5 events — this is the
   `{measured}%` figure the rewind-honesty caption needs.

This recipe is genuinely new script code — flag it plainly as build work, not "wire up an existing
tool," when estimating this task.

### Pattern 7: The D-10 parity test — first committed-JSON-fixture test in `apps/web`

No existing `apps/web` test commits a real downloaded artifact as a JSON fixture file — every
existing component test builds its fixture as an inline TS object literal
[VERIFIED: searched apps/web/src for `fixtures`/`readFileSync`/`.json` imports across all
`*.test.tsx` files, none found]. The closest reusable pattern is the route-level component test
convention already established for `/event/$eventKey`
[VERIFIED: apps/web/src/routes/event.$eventKey.test.tsx:1-85, read live]:

```typescript
// Pattern to follow for compare.test.tsx (new):
import compareFixture from "./__fixtures__/compare-2026.json"; // real, committed bytes
// ... mock global.fetch to return new Response(JSON.stringify(compareFixture))
// ... render via createMemoryHistory + QueryClientProvider + RouterProvider,
//     exactly as event.$eventKey.test.tsx's renderEventRoute() helper does
// ... assert rendered DOM text equals values DERIVED from compareFixture directly
//     (e.g. compareFixture.slices.find(...).brierScore.toFixed(4)), never a
//     hand-typed second copy of the expected number — that's what makes this a
//     parity PROOF rather than a second hand-maintained assertion that could drift.
```

**How to obtain the committed fixture bytes:** fetch the real, live
`https://data.sigmascout.org/v1/compare/2026.json` once and commit the response body verbatim
under a new `apps/web/src/routes/__fixtures__/` directory (or co-located with `compare.test.tsx`,
matching this repo's existing co-location convention for component tests). Wire the URL fetch
through `artifactUrl()` exactly as every other fetcher does — [VERIFIED: apps/web/src/lib/artifactOrigin.ts,
"the only place an artifact host string may appear"].

**D-10's stated limitation is real and should not be re-litigated:** this proves page-renders-artifact
fidelity, not artifact-equals-harness fidelity. If that wider coverage is ever wanted, the existing
pattern is `apps/web/e2e/event-live-artifact.spec.ts`
[VERIFIED: apps/web/e2e/event-live-artifact.spec.ts:1-31, read live — fetches
`v1/manifest/algorithms.json` to resolve the live `vpr` version, then fetches the real
`v1/event/{eventKey}/vpr@{version}.json` from the real production origin via Playwright's
`request` fixture, never a mock].

### Pattern 8: Compare page data shape — exact field names

`v1/compare/{year}.json` parses as `CompareArtifactSchema`
[VERIFIED: packages/harness/pageArtifacts.ts:882-933, read live]:

```typescript
CompareArtifactSchema = PagePreambleSchema.extend({
  algorithms: CompareAlgorithmSchema[],  // { id, version, codeVersion, paramSetName }
  slices: CompareSliceSchema[],
});

CompareSliceSchema = {
  algorithmId: string;
  season: number;
  seasonLabel: "tune" | "holdout";
  headlineEligible: boolean;
  compLevelView: "qualification" | "elimination" | "combined";
  brierScore: number | null;
  winnerAccuracy: number | null;
  scoredCount: number;         // int, nonnegative — the SE denominator D-11's bolding rule needs
  tieCount: number;
  noCallCount: number;
  exclusionCounts: {
    offseason: number;
    surrogateAffected: number;
    missingResult: number;
    quarantined: number;
  };
  candidateCount: number;
  calibrationBins: {
    binStart: number;
    binEnd: number;
    meanPredicted: number | null;
    observedFrequency: number | null;
    count: number;             // int, nonnegative — sketch 006's point-radius scaling input
  }[];  // always length 10, per SKILL.md's "Blocked on data" note (resolved)
};
```

3 algorithms × 5 seasons × 3 compLevel views = 45 slices per year's file. `slices` is a flat array,
not pre-grouped — the Compare page component must filter/group by `season`/`algorithmId`/
`compLevelView` client-side (trivial: 45 rows, no perf concern).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Seeded PRNG for reproducible draws | A new seeded RNG algorithm | Copy `mulberry32` verbatim a third time | Already the codebase's own established convention (2 existing verbatim copies); avoids importing `ml-matrix` transitively into the browser bundle |
| Rank-percentile quantile math | A bespoke smoothing/interpolation formula | Port `continuousQuantile()` verbatim from sketch 005 | Already validated against real corpus data (locked teams, 95 vs 4564 cases) — a fresh reimplementation risks reintroducing the exact defects sketch 005 measured and fixed |
| Web Worker jsdom testing | `@vitest/web-worker` | A ~15-line hand-rolled mock `Worker` class | `@vitest/web-worker` has an open, documented jsdom-collision bug (vitest-dev/vitest#7023) that is exactly this repo's test environment |
| Compare-page tiebreaker/win-loss logic for the simulation | A secondary sort key invented to break ties | Accept ties as ties (no data-backed tiebreaker exists) | The corpus stores only `sort_orders[0]` ("Ranking Score") — `sort_orders[1..]` (TBA's real tiebreakers, which vary by season) are never ingested. Inventing a tiebreaker would be indistinguishable from a real one to the reader; see Open Questions |

**Key insight:** almost every "build" item on this phase is actually a "wire up what already
exists" item once you read the artifact contracts closely — the two real net-new pieces of logic
are the categorical-draw-and-accumulate loop (≈20 lines) and the Web Worker message-passing
plumbing (≈40 lines), both small and both already have a directly analogous pattern elsewhere in
this codebase (`rp/distribution.ts`'s own Monte Carlo loop; `matchAxis.ts`'s existing plot-cell
convention).

## Common Pitfalls

### Pitfall 1: jsdom has no `Worker` — a naive component test throws `ReferenceError`

**What goes wrong:** any test that imports a component which unconditionally constructs
`new Worker(...)` at module scope or on first render will throw
`ReferenceError: Worker is not defined` under this repo's jsdom Vitest environment
[VERIFIED: apps/web/vitest.config.ts, `environment: "jsdom"`, read live].

**Why it happens:** jsdom does not implement the Worker API at all — a long-standing, still-open
limitation (Jest has the identical problem for the identical reason).

**How to avoid:** assign a small mock class to `global.Worker` in the test file before rendering,
matching this repo's existing `global.fetch = vi.fn(...)` mocking convention
[VERIFIED: apps/web/src/routes/event.$eventKey.test.tsx, pattern used throughout]. Never construct
the real Worker inside a component's render body without a lazy/deferred construction point (e.g.
construct it inside the "Run simulation" button's click handler, not at component mount), so a
component test that never clicks Run never needs the mock at all.

**Warning signs:** a component test failing with `Worker is not defined` at import time rather than
inside a specific `it()` block usually means the Worker is being constructed too eagerly (at module
or mount time instead of on user action).

### Pitfall 2: TypeScript's `lib` option is program-wide — `WebWorker` and `DOM` libs conflict

**What goes wrong:** adding `"WebWorker"` to `apps/web/tsconfig.json`'s existing
`lib: ["ES2023", "DOM", "DOM.Iterable"]` [VERIFIED: apps/web/tsconfig.json, read live] to type the
new worker file's `self`/`postMessage`/`onmessage` globals will produce duplicate-identifier errors
across the WHOLE program, because `lib` is a single project-wide setting and `DOM`/`WebWorker`
declare conflicting global shapes for the same names (`self`, `postMessage`, etc.).

**Why it happens:** this is a known, general TypeScript limitation, not specific to Vite — it
predates this project.

**How to avoid:** do not add `"WebWorker"` to the shared `apps/web/tsconfig.json`. Instead, either
(a) type the worker file's small message-passing surface manually with local interfaces (avoid
depending on ambient `DedicatedWorkerGlobalScope` typings at all — the actual API surface used is
tiny: `postMessage`, `onmessage`), or (b) add a second, worker-scoped `tsconfig.worker.json`
(`lib: ["ES2023", "WebWorker"]`, no `DOM`, `include` limited to the worker file) referenced via TS
project references, kept OUT of the main `tsc --noEmit -p tsconfig.json` typecheck command the repo
already runs. Option (a) is simpler and lower-risk given this phase's Worker has a genuinely small
message surface (start command in, progress/result/error out) — recommended default; confirm by
running `pnpm --filter web typecheck` (or the repo's `tsc --noEmit -p tsconfig.json`) once written,
per this project's own "measure, don't assume" discipline.
[MEDIUM confidence — general TypeScript behavior, not confirmed against this exact tsconfig by a
live compile in this research session; the planner's first typecheck run is the real confirmation.]

### Pitfall 3: `Ranking Score` (`rp`) may be entirely absent — and it's the ONLY source of "already-earned" RP on the event artifact

**What goes wrong:** to combine already-earned RP with simulated future RP for a rewind-case start
match, the simulation needs each team's accumulated actual RP as of the start match. The event
artifact has no per-match actual RP field at all on `EventMatchSchema` (unlike the per-team
artifact's `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`
[VERIFIED: packages/harness/pageArtifacts.ts:516-518, read live] — that field exists only on the
team-scoped schema, not the event-scoped one). The only source of an "already earned" baseline on
the event artifact is `EventTeamSchema.rp` (TBA's own reported average), which is independently
optional and genuinely absent for 259 of 1,581 corpus events
[VERIFIED: packages/harness/pageArtifacts.ts:404 comment and packages/corpus/schema.sql:120-131,
read live — `ranking_score REAL` is nullable, and `rank`/`record`/`rp` are documented as
independently optional].

**Why it happens:** TBA simply has no rankings published for some events (scheduled-but-not-yet-run,
or genuinely sparse historical data) — this is real upstream absence, not a pipeline bug.

**How to avoid:** if a team has zero played qualification matches (derivable reliably by counting
that team's appearances in `matches[]` filtered to `compLevel === "qm"` — always available, never
gated on `rp`), its already-earned RP is trivially 0 and no fallback is needed. The genuinely
unhandled case is a team with >0 played qm matches but `rp` undefined — flagged in Open Questions
below since neither CONTEXT nor UI-SPEC resolved it.

**Warning signs:** the mock-before-build pass (chart-craft.md's binding obligation) should
specifically sample at least one rewind-case event where `EventTeamSchema.rp` is undefined for
some team, not only the common fully-ranked case — sampling only well-ranked events would hide this
gap exactly the way sketch 005 initially missed the true rank-spread distribution by sampling only
the top of a table.

### Pitfall 4: No secondary sort exists — ties are real, not a simulation bug

**What goes wrong:** two teams landing on the exact same simulated average RP in a given draw will
look like a simulation defect if the planner assumes there should always be a strict order.

**Why it happens:** TBA's own tiebreaker sort orders (`sort_orders[1..]`, season-specific — e.g.
"Avg Coop", "Avg Tower") are read from the raw API response but never persisted past the ingest
schema; only position 0 ("Ranking Score") reaches the corpus and the published artifact
[VERIFIED: packages/ingest/rankings.ts:69-93 and packages/corpus/schema.sql:120-131, read live —
`NormalizedEventRanking` and the `event_rankings` table both carry exactly one `rankingScore`
column, no tiebreaker columns exist anywhere in the schema].

**How to avoid:** accept ties as ties in the per-draw sort (stable sort by team key as the
tie-break, so results are at least deterministic run-to-run for a fixed seed, but not claimed to
match FRC's real tiebreaker rules). Document this plainly if the planner writes any explanatory
copy about the simulation's ranking method — do not claim the simulation replicates FRC's official
tie-breaking.

### Pitfall 5: `pnpm publish:seasons` on Windows/Git-Bash — background it from the first attempt

**What goes wrong:** the executor tool's Bash timeout kills only the outer wrapper process, not the
deep `tsx` child, when a ~20-minute republish is run with a default timeout. STATE.md documents a
real concurrent-writer incident from exactly this failure mode during Phase 7 plan 07-17 — four
zombie `publish.ts` processes raced a tracked run against the live R2 bucket.

**How to avoid:** `run_in_background: true` on the very first invocation of `pnpm publish:seasons`
this phase, never as a retry-after-timeout fix.

## Code Examples

### Extracting the pure simulation core (test-first, per UI-SPEC's mock-before-build obligation)

```typescript
// packages/core/algorithms/simulation/rankSimulation.ts
export interface SimMatchInput {
  readonly redTeamKeys: readonly string[];
  readonly blueTeamKeys: readonly string[];
  readonly redRpPmf: readonly number[];
  readonly blueRpPmf: readonly number[];
}

export interface SimTeamBaseline {
  readonly teamKey: string;
  readonly earnedRpSum: number;   // rp (average) * matchesPlayedSoFar, or 0
  readonly matchesPlayed: number; // count of qm appearances in matches[]
}

export interface SimResult {
  /** teamKey -> length-N array of draw counts per rank (1-indexed rank at array index rank-1) */
  readonly rankHistograms: ReadonlyMap<string, Int32Array>;
}

export function simulateRanks(
  remainingMatches: readonly SimMatchInput[],
  baselines: readonly SimTeamBaseline[],
  draws: number,
  rng: () => number
): SimResult {
  const teamCount = baselines.length;
  const rankHistograms = new Map<string, Int32Array>(
    baselines.map((b) => [b.teamKey, new Int32Array(teamCount)])
  );
  const rpSum = new Float64Array(teamCount);
  const matchesPlayed = new Int32Array(teamCount);
  const teamIndex = new Map(baselines.map((b, i) => [b.teamKey, i]));

  for (let draw = 0; draw < draws; draw++) {
    for (let i = 0; i < teamCount; i++) {
      rpSum[i] = baselines[i]!.earnedRpSum;
      matchesPlayed[i] = baselines[i]!.matchesPlayed;
    }
    for (const match of remainingMatches) {
      const redRp = drawCategorical(match.redRpPmf, rng);
      const blueRp = drawCategorical(match.blueRpPmf, rng);
      for (const teamKey of match.redTeamKeys) {
        const i = teamIndex.get(teamKey)!;
        rpSum[i] += redRp;
        matchesPlayed[i] += 1;
      }
      for (const teamKey of match.blueTeamKeys) {
        const i = teamIndex.get(teamKey)!;
        rpSum[i] += blueRp;
        matchesPlayed[i] += 1;
      }
    }
    const order = baselines
      .map((b, i) => ({ teamKey: b.teamKey, avg: rpSum[i]! / matchesPlayed[i]! }))
      .sort((a, b) => b.avg - a.avg || (a.teamKey < b.teamKey ? -1 : 1)); // stable tie-break
    order.forEach((entry, rankIndex) => {
      rankHistograms.get(entry.teamKey)![rankIndex] += 1;
    });
  }
  return { rankHistograms };
}
```

This is directly unit-testable with plain Vitest (no jsdom, no Worker) — feed it a real event's
`redRpPmf`/`blueRpPmf` values pulled from a live artifact, a fixed seed, and assert the resulting
histogram sums to `draws` per team and the `continuousQuantile()` output matches sketch 005's own
worked examples (locked team, 95 vs 4564 cases) as a regression check.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| n/a — this is the first client-side compute surface in this app | Web Worker + `postMessage` progress | This phase | Establishes the pattern any future client-side compute (if ever needed) should follow |

No external "state of the art" shift applies here — Vite's Web Worker support (`new URL(...,
import.meta.url)` + `{ type: "module" }`) has been stable since Vite 2 and is unchanged in Vite 8
[CITED: vite.dev/guide/features.html#web-workers, fetched live 2026-08-31].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TypeScript's `DOM`/`WebWorker` lib conflict will actually manifest as described for this exact tsconfig, and option (a) (manual local typing, no `WebWorker` lib) resolves it cleanly | Common Pitfalls #2 | Low — worst case the planner discovers this at the first `typecheck` run (fast, cheap feedback) and switches to the project-references fallback also described |
| A2 | `EventArtifact.teams[]` is a complete roster (every team appearing in `matches[]`/`upcoming[]` redTeams/blueTeams also appears in `teams[]`) | Architecture Patterns (Compare page data shape is separate; this is about the Simulation tab's team roster) | Medium — if a team is missing from `teams[]` but appears in a match, the simulation's per-team baseline map would need a fallback (0 earned RP, 0 matches played) constructed on the fly rather than sourced from `teams[]`; the mock-before-build pass against real data should catch this quickly if it's ever untrue |
| A3 | 1000 draws × up to 135 matches × up to 78 teams is comfortably sub-100ms in a Web Worker with typed-array accumulation, not requiring further optimization | Summary, Pattern 2 | Low — this is a back-of-envelope estimate (roughly 1–2 million simple floating-point operations total), not a live benchmark in this research session; D-07's own planner note already requires capturing a real measured runtime in the phase SUMMARY, which will confirm or correct this |

## Open Questions

1. **What happens when a team has played qm matches but `EventTeamSchema.rp` is undefined for it?**
   - What we know: this is possible (259/1,581 corpus events have no TBA rankings at all;
     independently, `rank`/`record`/`rp` are each optional even within a ranked event).
   - What's unclear: neither 08-CONTEXT.md nor 08-UI-SPEC.md considered this case. There is no
     other source of already-earned RP anywhere on the event artifact (`EventMatchSchema` carries
     no actual-RP field, unlike the team-scoped schema).
   - Recommendation: surface this to the user during `/gsd-discuss-phase` follow-up or planning —
     candidate resolutions are (a) disable the Simulation tab entirely if any team on the roster
     has `matchesPlayed > 0 && rp === undefined`, treated the same plain-disabled way as D-04's
     OPR/EPA case, or (b) treat the missing baseline as 0 with a visible caveat. Do not silently
     default to 0 without a decision — that would misrepresent a team's true standing.

2. **Does the simulation need to exclude offseason/surrogate-affected/quarantined matches from the "remaining matches" list, and if so, by what signal?**
   - What we know: `EventMatchSchema`/`EventUpcomingMatchSchema` carry no `isOffseason` or
     surrogate flag directly (those live on the corpus `matches` table and the Compare artifact's
     `exclusionCounts`, not the event artifact). An event artifact is generally scoped to one real
     event, so offseason exclusion is more of a Compare-page/scoring concern than a per-event
     Simulation-tab concern.
   - What's unclear: whether a surrogate-affected remaining match should still be simulated as-is
     (the RP pmf already reflects the algorithm's best prediction including whatever surrogate
     handling happened upstream) or needs special treatment.
   - Recommendation: simulate every `compLevel === "qm"` row in `matches`/`upcoming` as-is — the
     RP pmfs already reflect the model's full knowledge; no additional filtering appears necessary,
     but flag this as a planner decision point rather than a settled fact.

3. **Where should the D-02 control-run script physically live — `scripts/` or `packages/harness/`?**
   - What we know: both directories host similar one-off measurement scripts today
     (`scripts/replayRig.ts` vs `packages/harness/tune.ts`/`promote.ts`).
   - What's unclear: no strong existing convention distinguishes the two locations by purpose.
   - Recommendation: `scripts/` — it's a one-off measurement script producing a document/number, not
     a reusable harness capability, matching `scripts/replayRig.ts`'s own category.

## Environment Availability

No external tool/service dependencies beyond what every prior phase already uses (Node, pnpm,
Cloudflare R2 via existing publish scripts, TBA API key via `.env`). Skipping the full audit table
— this phase adds no new external dependency.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`
[VERIFIED: .planning/config.json:24, read live] — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (`apps/web`), same version at repo root |
| Config file | `apps/web/vitest.config.ts` (jsdom environment, `src/test/setup.ts`) |
| Quick run command | `npx vitest run <specific-file>` (per this project's own logged lesson: `timeout <n> pnpm <cmd>` swallows output and false-greens — always run vitest directly, verify by printed output) |
| Full suite command | `pnpm --filter web test` (or `npx vitest run` from `apps/web`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVNT-07 | `redRpPmf`/`blueRpPmf` present + valid on played `EventMatchSchema` rows | unit (schema) | `npx vitest run packages/harness/pageArtifacts.test.ts` | ❌ new cases needed, file exists |
| EVNT-07 | `buildEventArtifact` populates the new fields from `prediction` | unit | `npx vitest run packages/harness/publish.test.ts` | ❌ new cases needed, file exists |
| EVNT-07 | Categorical draw + accumulate + rank produces a valid distribution (sums to `draws` per team) | unit | `npx vitest run packages/core/algorithms/simulation/rankSimulation.test.ts` | ❌ Wave 0 — new file |
| EVNT-07 | `continuousQuantile()` matches sketch 005's worked examples (locked team, 95 vs 4564) | unit (regression) | `npx vitest run apps/web/src/lib/simQuantile.test.ts` | ❌ Wave 0 — new file |
| EVNT-07 | Worker plumbing: progress messages, completion, forced-failure → error state (UI-SPEC S2 backstop) | component (mock `Worker`) | `npx vitest run apps/web/src/components/event/SimulationTab.test.tsx` | ❌ Wave 0 — new file |
| EVNT-07 | 78-team roster render/perf (UI-SPEC S3 backstop) | component or e2e | `npx vitest run` (component) or `npx playwright test` (e2e, real event data) | ❌ Wave 0 |
| COMP-01 | Compare page renders accuracy/Brier per algorithm per year | component | `npx vitest run apps/web/src/routes/compare.test.tsx` | ❌ new file, `compare.tsx` currently 21-line placeholder |
| EVAL-05 | Rendered Compare numbers equal a committed real artifact (D-10, SC-4) | component (fixture parity) | `npx vitest run apps/web/src/routes/compare.test.tsx` | ❌ new file + new committed fixture |
| EVAL-05 | `docs/publish-budget.md`'s committed budget block matches the post-D-03 republish | integration | `npx vitest run packages/harness/payloadBudget.test.ts` | ✅ file exists, committed doc needs updating |

### Sampling Rate

- **Per task commit:** the relevant file's own `npx vitest run <file>`.
- **Per wave merge:** `pnpm --filter web test` + `pnpm test` (repo root, covers `packages/harness`).
- **Phase gate:** full suite green, plus a real `pnpm publish:seasons` run (backgrounded) before
  claiming D-03/SC-4 done, plus `npx vitest run packages/harness/payloadBudget.test.ts` green
  against the updated committed budget doc.

### Wave 0 Gaps

- [ ] `packages/core/algorithms/simulation/rankSimulation.test.ts` — covers EVNT-07's core math
- [ ] `apps/web/src/lib/simQuantile.test.ts` — covers EVNT-07's band-edge math (port + regress
      against sketch 005's three worked examples)
- [ ] `apps/web/src/components/event/SimulationTab.test.tsx` (or wherever the Worker-hosting
      component lands) — needs the hand-rolled mock `Worker` class described in Pitfall 1
- [ ] `apps/web/src/routes/compare.test.tsx` + a committed `__fixtures__/compare-{year}.json` —
      covers COMP-01 and EVAL-05/SC-4/D-10
- [ ] `docs/publish-budget.md`'s machine-readable JSON block needs updating post-republish, or
      `payloadBudget.test.ts` will assert against stale numbers

## Security Domain

`security_enforcement` is `true` in `.planning/config.json`
[VERIFIED: .planning/config.json:47, read live] — this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth surface exists or is added this phase |
| V3 Session Management | No | Stateless SPA, no sessions |
| V4 Access Control | No | All data is public, precomputed, read-only |
| V5 Input Validation | Yes | `EventMatchSchema`'s new `.refine(isValidPmf, ...)` pair (mirrors the existing `EventUpcomingMatchSchema` pattern) — reused unchanged, not hand-rolled |
| V6 Cryptography | No | No crypto operations added |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A malformed/adversarial `redRpPmf` array (e.g. NaN, negative, doesn't sum to 1) reaching the browser and crashing or infinite-looping the Worker | Denial of Service (client-side, single-user impact only — no shared server resource) | Already mitigated upstream: `EventMatchSchema`'s `.refine(isValidPmf, ...)` rejects a malformed pmf at the **publish boundary** — a bad artifact can never be uploaded (this repo's established "assembly functions parse through their schema before returning" pattern). `drawCategorical`'s fallback `return pmf.length - 1` (Pattern 2) is defense-in-depth against floating-point residue, not a substitute for the schema gate |
| A Worker running indefinitely / not terminating on tab navigation | Denial of Service (client resource leak) | Call `worker.terminate()` on component unmount (React `useEffect` cleanup) — standard React+Worker lifecycle hygiene, not novel to this phase |
| `.env`/secret exposure while building/testing this phase | Information Disclosure | No new secret-touching code this phase (the D-02 control run and D-03 republish both reuse existing `tsx --env-file=.env` invocations) — CLAUDE.md's existing secrets-handling convention applies unchanged; no new risk surface |

No new ASVS-relevant surface is introduced by this phase beyond the existing pattern the schema
validation already covers — this phase is read-only public data plus client-side compute with no
network write path of its own.

## Sources

### Primary (HIGH confidence — read live this session)

- `packages/harness/pageArtifacts.ts` — `EventMatchSchema`, `EventUpcomingMatchSchema`,
  `TeamSeasonMatchSchema`, `CompareArtifactSchema`/`CompareSliceSchema`, `EventTeamSchema`
- `packages/harness/publish.ts` — `buildEventArtifact`, `eventTeamRankingFields`, the shared-state
  `predict()` call site, `buildCompareArtifact` region
- `packages/harness/rounding.ts` — `ROUNDING_RULE`, `roundPmf`
- `packages/harness/replay.ts` — `WalkForwardSimulator`, `buildSeasonStream`
- `packages/harness/browserSafeSchemas.test.ts` — the leaf-module entry-point precedent
- `packages/harness/payloadBudget.test.ts`, `docs/publish-budget.md` — budget test + committed block
- `packages/harness/score.ts` — `TUNE_SEASONS`/`HOLDOUT_SEASONS`/`seasonSplit`
- `packages/core/algorithms/types.ts`, `sigma1/rp/constants.ts`, `sigma1/rp/distribution.ts` —
  `redRpPmf` contract, `maxRp`, `mulberry32`, the joint win/RP Monte Carlo draw
- `packages/ingest/rankings.ts`, `packages/ingest/schemas.ts`, `packages/corpus/schema.sql` —
  confirms only `sort_orders[0]` is ever persisted
- `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`,
  `apps/web/tsconfig.json` — confirmed installed versions and existing config
- `apps/web/src/routes/event.$eventKey.test.tsx`, `apps/web/e2e/event-live-artifact.spec.ts` —
  existing component-test and e2e-fixture patterns
- `apps/web/src/routes/event.$eventKey.tsx`, `apps/web/src/lib/searchParams.ts` — tab-registration
  mechanics
- `apps/web/src/components/team/matchAxis.ts`, `apps/web/src/components/event/eventMatchAxis.ts`,
  `apps/web/src/components/team/MatchTable.tsx` — exact export locations for `PLOT_W`,
  `compareEventMatchRows`, `matchLabel()`
- `.claude/skills/sketch-findings-sigmascout/sources/005-rank-distribution/index.html` —
  `continuousQuantile()` reference implementation
- `.planning/STATE.md` — the Windows/Git-Bash background-process hazard, `timeout` false-green
  lesson

### Secondary (MEDIUM confidence)

- Vite official docs (`vite.dev/guide/features.html#web-workers`), fetched live 2026-08-31 —
  Web Worker constructor/query-suffix patterns, confirmed unchanged for Vite 8.2.2
- vitest-dev/vitest GitHub issue #7023, found via web search — `@vitest/web-worker` + jsdom
  `postMessage` scope collision, cross-checked against the general "jsdom has no Worker" claim
- TypeScript `lib: DOM` vs `lib: WebWorker` conflict — general, well-known TypeScript behavior from
  training knowledge, not reconfirmed by a live compile against this exact tsconfig in this session

### Tertiary (LOW confidence — flagged for planner/human confirmation)

- The back-of-envelope 1000×135×78 performance estimate (Assumption A3) — reasoning, not a
  measured benchmark

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency, every version read live from installed `package.json`
- Architecture (simulation math, publisher plumbing): HIGH — every claim traced to a specific,
  live-read source line
- Architecture (Web Worker + Vitest interaction): MEDIUM — cross-checked against a real GitHub
  issue, but this project's own first attempt is the actual confirmation
- Pitfalls: HIGH for the RP/ranking-formula gaps (read live), MEDIUM for the TypeScript lib
  conflict (general knowledge, not live-compiled)

**Research date:** 2026-08-31
**Valid until:** 30 days, or immediately upon the D-03 republish landing (several "current measured"
figures in this document — `event/{eventKey}` max bytes, run counts — will change and should be
re-read from `docs/publish-budget.md` at execution time rather than trusted from this document)
