# Phase 9 — Plan Outline

**Phase:** 09 — Analytic Ranking Points & Browser-Side Simulation
**Granularity:** coarse · **TRACER_MODE:** true · **REVERSIBILITY_GATES:** true · **MVP_MODE:** false
**Traceability keys:** audit findings `F1`–`F13` (`.planning/todos/pending/ranking-points-audit.md`) and
CONTEXT decisions `D-01`–`D-21` (`09-CONTEXT.md`). There are **no requirement IDs** — see "Spec-less probe
fallback" below.

| Plan ID | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 09-01 | TRACER: RP calibration scorecard end-to-end (scorer → optional artifact key → Compare page), plus the two frozen "before" baselines every later measurement is scored against | 1 | — | F1, D-09, D-11, D-12 |
| 09-02 | Declarative bonus-predicate contract in `RpRuleModule` across `constants.ts` and all ten season modules; `predictThresholds` becomes a thin evaluator, conservative branches preserved byte-for-byte | 1 | — | D-02, D-07, F2 (groundwork), F6/F7 (groundwork) |
| 09-03 | `marginals.ts`: negative-binomial method-of-moments fit + exact discrete CDF, Poisson-binomial convolution, `erf`, `variance ≤ mean` fallback — plus the F3 mean-deficit re-measurement restricted to fully-warm 3/3 rosters | 2 | 09-02 | D-01, D-08, F2, F3 |
| 09-04 | `analyticPmf.ts` replaces the 4,000-draw Monte Carlo behind the same call site, `ml-matrix` dropped, `RpLayerConfig` introduced at inert defaults, D-12 level-1 byte-identity proven | 3 | 09-01, 09-02, 09-03 | D-05, D-06, D-07, D-08, D-10, D-12, F4 (partial) |
| 09-05 | The three model changes as independently selectable, inert-by-default config branches: win RP from `pRedWin`, discrete score-margin tie model, negative-binomial marginal | 4 | 09-04 | D-01, D-05, D-13, D-14, F6, F7 |
| 09-06 | Attribution measurement through the one published scorer, the D-09 per-bonus accept/revert call **[checkpoint:decision — one-way]**, and the D-06 collapse that deletes the losing branches | 5 | 09-05 | D-04, D-06, D-09, D-10, D-11, F2, F3, F10 (upstream) |
| 09-07 | Rank-simulation red/blue coupling fix: one match-outcome draw, then per-alliance bonus-only draws | 5 | 09-04, 09-05 | D-15 |
| 09-08 | Live Worker RP: state shape 11→12 `sigmascoutRp` passenger, Worker-resident RP accumulator, `redRpPmf`/`blueRpPmf` on played rows, live/offline parity test **[checkpoint:decision — one-way seed-then-deploy]** | 6 | 09-06 | F5, D-21, D-08 |
| 09-09 | Pre-schedule ladder rung 1: field-averaged analytic predictor, measured against the baked 20-schedule output on real events **[checkpoint:decision — one-way ship/no-ship]** | 6 | 09-04, 09-07 | D-16, D-17, D-18, D-19, F11 |
| 09-10 | Sidecar re-key/regeneration onto published algorithm ids, presim generation re-enabled, the phase's one republish, and the phase-closing D-12 re-proof **[checkpoint:decision — one-way R2 overwrite]** | 7 | 09-08, 09-09 | D-20, F11, D-12, D-16 |

---

## Answer to the open question — rung 1's pass/fail bar

**I choose option 1: a concrete statistic and tolerance, stated in plan 09-09 as a clearly-marked
planner assumption.** The criterion is *not* left as prose, and the human checkpoint required by
REVERSIBILITY_GATES is **not** a substitute for it — that checkpoint sits *after* the measurement and
presents the measured numbers for the one-way deletion call only.

Every per-plan agent must use this wording in 09-09's `<acceptance_criteria>`:

> **PLANNER ASSUMPTION (not from CONTEXT.md — recorded because D-17 rung 1 states its bar in prose
> and RESEARCH.md Open Question 1 / assumption A4 leave the statistic open).** Rung 1 passes when,
> measured with the **same `continuousQuantile` p10 / median / p90 rank statistics the live rank-band
> display already uses**, across a sample of **at least six real finished events spanning the 6–100
> team template coverage range, with at least one event per season 2022–2026 where one exists**:
>
> 1. **Median rank:** `|median_rung1 − median_baked| ≤ 0.5` ranks for **≥ 95%** of teams, and
>    `≤ 1.0` ranks for **every** team (no single-team outlier worse than one rank).
> 2. **Band edges:** `|p10_rung1 − p10_baked| ≤ 1.0` **and** `|p90_rung1 − p90_baked| ≤ 1.0` ranks
>    for **≥ 90%** of teams.
> 3. **No systematic shift:** the **mean signed** median-rank difference across all sampled teams is
>    within `±0.25` ranks.
>
> Both arms must be produced by the **same imported `simulateRanks`** and the same quantile helper —
> the arms differ only in the pmf inputs, never in the scorer (the `measureRewindGap.ts` convention,
> and the same-scorer discipline D-11 imposes on the RP side).

Why these numbers, so a later agent does not re-litigate them: the settled display convention is a
10th–90th band printed to **one decimal place**, so `0.5` ranks is the smallest median difference the
rendered page can show as distinct; and the sketch measurements found the middle 80% of a real rank
distribution spans only **1–5 ranks of 17**, so a 1-rank band-edge error is already a material
fraction of a typical band rather than a rounding artefact. The tolerance is deliberately expressed in
**rank units, not probability units**, because that is the unit a human actually reads off the page —
an abstract distributional distance (Wasserstein/EMD) nobody will eyeball was considered and rejected.

---

## Assumption-delta checkpoint — recorded outcome

The deterministic detector's single signal (`chosen`, "…only needs answering if rung 1 fails and rung 2
is chosen") **is a prose false positive** — it describes picking a ladder rung, not a configuration
value hardening into a modelling decision. Recording that alone would have been the wrong call, so both
candidate deltas named in the planning context were evaluated on their merits. Two real deltas exist.
Each affected plan must carry them as an `<assumption_delta_decision>` block.

**Delta A — the sidecar's algorithm-key segment (owned by 09-10, unconditional).**
Noun that is now primary: **a member of `PUBLISHED_ALGORITHM_IDS` (`opr` / `epa` / `bpr`)**, not the
retired research id `vpr`. Decision: **promote**. Rationale: every presim sidecar in R2 is `vpr`-keyed
and `vpr` is retired, so the key names something no reader can resolve — keeping it alongside would
ship dead bytes under an unreachable name. Note explicitly in the plan that the BPR→SPR **display**
rename is another agent's work and must not be touched here: the key segment stays `bpr`.

**Delta B — what the sidecar *is* (owned by 09-09, decided at its checkpoint; executed by 09-10).**
Noun that is now primary if rung 1 holds: **the per-team field-averaged season-total RP pmf**
(`{roster[], matchesPerTeam, perTeamPmf[]}`), replacing *priced concrete schedules* — a required input
becoming derived-and-optional, which is exactly the schedule-concreteness candidate the checkpoint
named. Decision: **promote, conditional on the rung-1 acceptance criterion above**. D-16 is explicit
that schedule generation is *deleted entirely*, not kept alongside, so `add-alongside` is not on the
table. If rung 1 fails the measurement, the decision degrades to **no-change** for Delta B (concrete
schedules remain primary, the ladder advances to rung 2, and D-19's licence question becomes live) —
Delta A still applies either way.

---

## Spec-less probe fallback — visible, recorded skip

No SPEC.md exists for Phase 9 and the phase has **no requirement IDs to probe**: all 38 v1 requirements
map to Phases 1–8 and this phase is post-v1.0. No probe-derived predicates were generated this run.
**Every plan must state this skip visibly** and use `F`-numbers and `D`-numbers as its `requirements`
frontmatter values instead. `must_haves.truths` are derived from the ROADMAP phase goal and those keys,
not from probe predicates.

---

## Cross-cutting requirements — every plan must carry these

- **"Artifacts this phase produces"** section listing every new symbol: types, functions, config keys,
  CLI flags, schema fields, file paths.
- **`<threat_model>`** with a STRIDE register, severity, and disposition per threat. The live surfaces
  this phase touches are: a published R2 artifact schema (09-01, 09-10), D1 per-team state (09-08), and
  a deployed Worker (09-08). Pure-math plans (09-02, 09-03, 09-04, 09-05, 09-07) will mostly register
  low-severity Tampering/Denial threats around NaN/Infinity propagation into a published pmf.
- **`<read_first>` on every task**, carrying the analog path 09-PATTERNS.md already named for that file.
- **`<acceptance_criteria>` on every task**, as a source assertion, behavior assertion, test command, or
  exact CLI output. Never "looks correct".
- **Test commands:** `npx vitest run packages/core/rankingPoints` scoped, `npx vitest run` **from repo
  root** for the full suite. Never from `apps/web` (collects 77 files instead of 167). Never wrapped in
  `timeout <n> pnpm <cmd>` (swallows output, exits 0). Judge by output, not exit code.
- **Corpus-reading plans must disable worktrees up front** — `data/corpus.sqlite` and `.env` are
  gitignored and do not merge back out of a worktree. This applies to **09-01, 09-03, 09-06, 09-09,
  09-10**.
- **Network-blocked in subagents:** R2 publishes, live-origin checks, D1 seeding, Worker deploys and
  pushes must run from the main context. This applies to **09-08** and **09-10**.
- **Secrets:** never `Read`/`cat`/`echo` `.env` or any value from it. Use `tsx --env-file=.env` or
  `set -a; . ./.env; set +a`. Applies to 09-08's D1 seed and 09-10's republish.
- **BPR/SPR rename is in flight and out of scope.** Treat every `SPR` encountered as `BPR` and continue;
  do not touch the rename in any plan.
- **Out of scope everywhere — do not plan tasks for:** F4 (dependence between threshold variables), F12
  (2019 `completeRocket`'s always-false branch), 2022 `cargoBonus`'s auto-vs-match independence flaw,
  F13, F8/F9's OPR/EPA cold-start gate, the F10 bonus-dot *display* threshold, and schedule-template
  redistribution licensing (conditional on reaching rung 2 only).

---

## Per-plan scope detail

### 09-01 — TRACER: RP calibration scorecard end-to-end, plus the frozen before-baselines

Owns **deliverable 5 (F1)** and the phase's measurement spine. The tracer task is one season × one
algorithm wired the whole way: `scripts/measureRpCalibration.ts` gains an artifact-emitting output mode
(`--emit-artifact` / `--json`, extend in place — **do not build a parallel computation**, D-11's
same-scorer rule) → a new **`.optional()`** RP calibration key on `CompareSliceSchema` in
`packages/harness/pageArtifacts.ts`, following `CompareExclusionCountsSchema.coldStart`'s precedent and
doc-comment discipline verbatim (absence means "predates the field" and must render as absent, never
coerced to zero) → a committed real-shaped fixture → a new `RpCalibrationSection.tsx` +
`rpCalibrationCards.ts` pair modelled on `CalibrationSection.tsx` + `calibrationCards.ts`. The display
form is **settled and must not be re-decided**: sentence-first, chart demoted to supporting evidence,
sample count mandatory, sparse bins flagged (`sketch-findings-sigmascout` →
`references/simulation-and-compare.md`, sketch 006 winner C). Extend
`apps/web/src/lib/api/compare.compat.test.ts`, do not create a parallel pin file.

Expansion tasks widen to every season and algorithm and then freeze the two **"before" instruments that
every later plan is scored against**: (a) a committed per-bonus baseline from the published scorer, which
is the left-hand side of D-09's bar; and (b) a **D-12 level-1 digest** capturing `pRedWin`, `redScore`
and `blueScore` over a bounded corpus slice, following `digest.test.ts`'s existing bounded-slice pattern.
This plan runs **before any accuracy change**, which is the ROADMAP's hard sequencing constraint —
without it deliverables 3 and 4 are unmeasurable. Reversibility: adding an `.optional()` key to a live
schema is **reversible**, so no decision gate here.

### 09-02 — Declarative bonus-predicate contract across all ten season modules

Owns **deliverable 1** (`D-02`, groundwork for `D-07`). Adds to `packages/core/rankingPoints/constants.ts`
a `BonusPredicate` discriminated union covering exactly the seven verified mechanism classes —
`singleThreshold`, `linearCombination`, `conjunctionDistinct` (with an optional untracked-conservative
branch), `nestedSameVariable`, `countOfIndicators`, `dataDependentMixture`, `constant` — plus a
`MarginalFamily` string union and a `marginalFamily` field on `RpThresholdVariable` alongside the
existing `unit`. **At this stage every variable declares `marginalFamily: "gaussian"`** — the current
behavior, inert at default; the flip to negative-binomial happens in 09-05 behind config, after 09-03's
F3 re-measurement. All ten season modules (`2016.ts`…`2026.ts`) then declare `bonusPredicates[]` and
`predictThresholds` is reimplemented as a thin evaluator over the declarations, keeping its exact
signature so `rpConservativeBranch.ts` and the existing equivalence tests keep working unchanged.

Two pitfalls are load-bearing and must appear as explicit acceptance criteria. **Pitfall 2:** derive
`bonusNames` *from* the predicate array, never maintain a second bonus-count literal — `maxRp` stays
`<winRp> + bonusNames.length` and `rules.test.ts` keeps asserting it. **Pitfall 4:** six bonuses across
five seasons gate on an untracked alliance-level signal and are evaluated at their less-likely-to-achieve
branch; the rewrite must reproduce that **byte-for-byte**, including 2018 `autoQuest`'s single documented
exception that over-fires rather than under-fires — a rewrite that "fixes" it is a regression.
`packages/harness/rpConservativeBranch.ts` is the regression oracle: its `overstatedRate` table must be
unchanged after the rewrite. Read `2026.ts` (the nested-threshold case) and `2018.ts` (the exception) in
full before writing the contract shape. Copy the modules' existing header/citation discipline — manual
citation, "deliberately never read" field list, verification-method sentence — onto every new declaration.

### 09-03 — `marginals.ts` numerics, plus the F3 warm-roster re-measurement

Owns `D-01` and `D-08`, and the **gating measurement for deliverable 4**. Task one is the ROADMAP's
second hard sequencing constraint: re-measure F3's mean deficit **restricted to fully-warm 3/3 rosters**
and commit the result as a measurement record. The original probe (predicted means low in 33 of 34
season-variables) included partially-cold rosters, which the RP-producing population largely excludes —
so this number, not the original probe, is what 09-05 and 09-06 act on. Model the script on
`scripts/measureRewindGap.ts`'s two-named-arms convention.

The rest of the plan builds `packages/core/rankingPoints/marginals.ts` as a **zero-import browser-safe
leaf** (D-08's whole point; model the shape on `rankSimulation.ts`): negative-binomial method-of-moments
fit — pin the exact parameterization in the file, `r = mean² / (variance − mean)`, `p = mean / (mean + r)`
— an exact discrete NB CDF evaluated at integer thresholds, the existing Gaussian family retained as the
inert default, Poisson-binomial convolution for count-of-indicators (2016 `breach`, and the strict branch
of 2025 `coralBonus`), and `erf` **copied from `packages/core/algorithms/sigma1/linkFunctions.ts:41-49`**
citing Abramowitz-Stegun 7.1.26 — same-package copy, not a cross-package import, and not a rederivation.
**Pitfall 3 is mandatory coverage:** method-of-moments is undefined when `variance ≤ mean`, which cold
in-season teams can hit by chance even though every real threshold variable is overdispersed at the
population level (measured var/mean 1.27–102.3). Ship an explicit documented fallback and a test that a
1–2-observation team produces a well-formed marginal rather than NaN or Infinity. `marginals.test.ts` is
a **Wave 0 gap** — hand-computed expectations, per D-07's mandatory mitigation for having declined the
Monte Carlo equivalence check.

### 09-04 — `analyticPmf.ts` replaces the Monte Carlo, behind `RpLayerConfig`, with D-12 proven

Owns **deliverable 2** and the `D-05` config skeleton. `packages/core/rankingPoints/analyticPmf.ts` is a
new zero-import leaf replacing `distribution.ts` behind the **same call site** (`#rpFieldsFor` in
`packages/harness/sigmaScoutLayer.ts`): group bonuses by shared threshold variable, enumerate joint
outcomes per group from marginal CDFs, convolve groups, convolve with outcome RP. Deletes
`CHOLESKY_RIDGES`, `clampCrossCovariance`, `CROSS_COVARIANCE_SAFETY_FACTOR`, `buildJointModel`, the
module-local `mulberry32`/`boxMullerPair`/`fnv1a32`, the `rpMonteCarloSeed`/`rpMonteCarloDraws` config,
and the `ml-matrix` import (`opr.ts` keeps the package for SVD — the dependency stays in `package.json`).
`Math.min(maxRp, …)` is a proven no-op since `maxRp === winRp + bonusCount` in every season; no mass
folding is needed. **Export the win/tie and bonus-only halves of the decomposition separately** — 09-07
consumes the bonus-only marginal and must not have to re-derive it.

`RpLayerConfig = {winSource, tieModel, marginal}` is introduced here **at inert defaults that reproduce
today's behavior exactly** and threaded to both `publishSeasons` and `runEventMode`. PATTERNS.md flags a
real idiom conflict: `WinProbMode` is the structural analog but is **permanent** multi-valued scaffolding,
while D-05/D-06's toggles are **planned-temporary**. Do not model them identically — the plan must name
the removal in the same file that introduces the config (a header comment stating that 09-06 collapses
this to one hardcoded path and deletes the losing branches), so the temporary surface cannot quietly
become permanent.

`analyticPmf.test.ts` is a **Wave 0 gap** and carries D-07's full mitigation burden: hand-computed
expected values for **each of the seven mechanisms**, a dedicated case for the **2026 nested-threshold
trap** (`P(both) = P(supercharged)`, `P(only energized) = P(energized) − P(supercharged)`, and
`P(supercharged ∧ ¬energized) = 0` structurally — never a product of independents), pmf sums to 1, and
the all-variance-zero case degenerating to `predictThresholds`'s own boolean flags. The plan closes by
proving **D-12**: `pRedWin`/`redScore`/`blueScore` byte-identical against 09-01's frozen digest. Per
D-10 the closed form ships unconditionally, so no decision gate; reversibility is **costly** (published
pmfs change, reverting means a republish) but not one-way — the schema is unchanged.

### 09-05 — The three model changes as inert-by-default config branches

Owns **deliverables 3 and 4's implementations** (`D-13`, `D-14`, `D-01`), each as an independently
selectable `RpLayerConfig` value with the legacy path still the production default, so **nothing ships
from this plan** — attribution stays measurable even though the changes ship together (D-05, and the
ROADMAP's third ordering constraint).

`winSource: "p-red-win"` (D-13) takes win RP from the **published `pRedWin`**, closing F6's coherence gap
(the pmf-implied win probability differs from the displayed one by 0.12 at p90, max 0.34). `tieModel:
"discrete-margin"` (D-14) replaces a branch that can never fire — today `tied` requires exact float
equality of two continuous draws while 1.09% of quals actually tie; the exact formulation is **Claude's
discretion**, the approach is not. `marginal: "negative-binomial"` (D-01) flips the per-variable
declarations 09-02 planted as `"gaussian"`, informed by 09-03's warm-roster measurement.

Test obligations: the tie branch is reachable and the predicted tie rate lands near the measured 1.09%
base rate; the pmf-implied win probability equals the published `pRedWin` **exactly**. One thing to
record rather than fix: RESEARCH.md Open Question 3 notes that D-13 bypasses the Swing/Sigma band
variance for the win half, so `#rpFieldsFor`'s `redBandVariance`/`blueBandVariance` undefined-gate may
become partly vestigial. **Record what changed; do not opportunistically fix F8/F9's cold-start
match-dropping — it is out of scope.**

### 09-06 — Attribution measurement, the D-09 call, and the D-06 collapse

Owns the **decision** half of deliverables 3 and 4. Measures every arm through **the one published
scorer** (`scripts/measureRpCalibration.ts` driving the real `SigmaScoutLayer`) — D-11's required
mitigation for having declined confidence intervals, because a scorer mismatch has previously
manufactured a ~0.003 phantom regression in this project. Both arms must be the same published
generation; never compare a published number against a scratch script.

Split the two slices precisely, because D-04 and D-09 read as being in tension and are not:
**the marginal family is *chosen* on 2016–2020 + 2022**, and **D-09's ship bar is evaluated, and the
calibration published, on 2023–2026** — a slice that had no say in the family choice, which is what makes
the published number out-of-sample and caveat-free. D-09's bar is **per-bonus, not pooled**: a majority of
individual bonuses must improve on Brier and **no single bonus may get worse at all**. D-11: any
improvement in the right direction counts, no minimum effect size. D-10: a failed marginal swap reverts
to Gaussian while win source and tie model still land — each is its own config field, so each reverts
independently.

**This plan carries a `checkpoint:decision` rated `one-way`** before the accept/revert call: D-04 is
explicitly one-way, because once the 2023–2026 slice informs a choice it stops being a clean reporting
slice and no replacement exists (the 2026 holdout was already spent once). The checkpoint presents the
measured per-bonus table and takes the ship/revert decision per change. Afterwards, **D-06 collapses the
toggles**: delete the losing branches, leave one path, remove the temporary config surface entirely —
no permanent combinatorial flag surface survives this plan. Publish the attribution result and refresh
the scorecard 09-01 built. F10's *upstream* cause is closed here; the dot display threshold is not.

### 09-07 — Rank-simulation red/blue coupling fix

Owns **deliverable 7** (`D-15`). Monte Carlo **stays** for the rank step — the trade reverses between the
two uses, and the developer confirmed it. The bug is narrow and in-place at
`packages/core/algorithms/simulation/rankSimulation.ts:264-274`: `drawCategorical(match.redRpPmf, rng)`
and `drawCategorical(match.blueRpPmf, rng)` are two fully independent draws, so both alliances can "win"
the same draw. Implement **approach (b)** — RESEARCH.md assumption A3 names both options and this outline
picks one so the plan does not have to: draw the match winner from `pRedWin` once from the shared `rng`
stream, then draw each alliance's bonus RP independently from its own bonus-only marginal (09-04 exports
it), then add the deterministic-given-winner win/tie RP. The existing `drawCategorical(pmf, rng)`
primitive and the existing `rng` threading stay; only the *shape* of what is drawn from changes.

Must not disturb Phase 8's shipped contracts: `rankSimulation.ts` stays the one zero-import
implementation both the browser Web Worker and the offline baked path call, the Worker protocol and run
control are unchanged, and the near-ties-render-as-ties and interpolated continuous band-edge rules stay
exactly as settled. Verify with `npx vitest run packages/core/algorithms/simulation` plus a new case
asserting red and blue can no longer both win the same draw.

### 09-08 — Live Worker RP (D-21)

Owns **deliverable 6 / F5**. Scope it precisely — **Pitfall 5**: `buildEventUpcomingRow` already emits
`redRpPmf`/`blueRpPmf` correctly; only `buildEventMatchRow` (played rows, `apps/worker/src/scheduled.ts`
~530) omits them, and the deeper gap is that `prediction.redRpPmf` is **never set at all** on the Worker's
`Prediction` object, because nothing in `apps/worker/src/` constructs an RP accumulator today. Four
pieces, in order: (1) `packages/harness/stateSnapshot.ts` bumps `STATE_SNAPSHOT_SHAPE_VERSION` 11→12 and
gains a `sigmascoutRp` passenger pair `readRpBeliefs`/`withRpBeliefs`, copied from
`readSigmaBeliefs`/`withSigmaBeliefs` (lines 914-962) including its all-or-nothing read rule, its
`undefined`-is-a-valid-answer rule, and its non-mutating `.map` — **the existing `rpBeliefs` field at
line 357 belongs to retired VPR and must NOT be reused**; (2) a Worker-resident RP accumulator per
algorithm/event, threaded the way `swingByTeam`/`newBands` already are through `PerAlgorithmFold` in the
same file, resumed from D1; (3) `analyticRpPmf` called to populate both alliances' pmfs **before either
row builder runs**; (4) the two field lines added to `buildEventMatchRow`, copied from its sibling
verbatim. This costs **zero additional D1 subrequests** — the Worker already reads and writes one row per
touched team and RP is a new JSON key inside that same row. Add the **live/offline row-shape parity
test** D-21 explicitly calls for, beside `apps/worker/test/scheduled.replay.test.ts`, and extend
`stateSnapshot.test.ts` with shape-12 round-trips.

Measure Worker CPU on the real tick rather than asserting it. **Do not cite "~1000× cheaper" as a
verified figure** — RESEARCH.md assumption A1 marks it an unbenchmarked order-of-magnitude inference. Read
CLAUDE.md's corrected framing: the 10 ms limit is a *sustained-cost* budget, and one healthy over-budget
tick is not evidence the budget is safe.

**This plan carries a `checkpoint:decision` rated `one-way`**: a state-shape bump requires seeding D1
**before** deploying the new Worker (seed-first, deploy-second), and the D1 seed import trips a 100k
row-write cap at roughly four passes per day. The seed and the deploy must run **from the main context**
— subagent sandboxes deny all network Bash — and must never render `.env` into a transcript.

### 09-09 — Pre-schedule ladder rung 1

Owns **deliverable 8's measurement** (`D-16`, `D-17`, `D-18`, `D-19`). This is a **laddered spike, not a
fixed build**: build rung 1, measure it, and only build rung 2 if rung 1 fails. PATTERNS.md found **no
analog** for the rung-1 math — treat it as new design composed from cited building blocks
(`RpMomentsAccumulator`, `analyticPmf`'s convolution machinery, `simulateRanks`'s zero-baseline mode),
not copied from one file.

Rung 1: per event, compute field-level summary statistics — the mean and variance of per-team
contributions **across that event's roster**, capturing both match-to-match noise and partner-quality
spread (recompute **per event**, not season-wide, per RESEARCH.md Open Question 2: rosters are 20–100
teams, the publish pipeline already iterates per event, and a season-wide average would degrade an
unusually strong or weak field). Build each team's field-averaged per-match pmf from its own belief plus
those statistics, then convolve N copies for the season total. Target artifact
`{roster[], matchesPerTeam, perTeamPmf[]}` at ~2–3 KB against ~265 KB today, with schedule generation
deleted if rung 1 holds. State the honest caveats wherever this ships: it assumes a team's matches are
near-independent, and it washes out coupling from teams sharing specific matches — **though the
20-schedule approach washes that out by design too**, which is the fair comparison to make.

The measurement script mirrors `scripts/measureRewindGap.ts` and encodes **the acceptance criterion given
above**. **This plan carries a `checkpoint:decision` rated `one-way`** presenting the measured table and
taking the ship/no-ship call: D-16 is one-way because deleting schedule generation and the template
dependency breaks the published sidecar shape, and restoring it means a schema change plus a republish.
If rung 1 fails, the checkpoint routes to rung 2 (self-generated random schedules, ~20 KB, testing
whether cheesy-arena's balanced-grid structure matters to final rank bands or is merely tradition) and
**only then** does D-19's template-licence question become live — it is conditional, not blocking, and
the licence judgement is the developer's, not an agent's. Carries **Delta B** of the assumption-delta
record.

### 09-10 — Sidecars, presim re-enable, the republish, and the phase close

Owns **D-20 / F11** and closes the phase. Three things, in this order.

First, **re-key/regenerate the presim sidecars**: every one in R2 belongs to retired `vpr`, so the
pre-schedule stop is dark regardless of which rung ships. Keys must name a `PUBLISHED_ALGORITHM_IDS`
member; the orphaned `vpr` objects are deleted, not aliased. Carries **Delta A** of the assumption-delta
record, and must state that the BPR→SPR display rename is out of scope — the key segment stays `bpr`.

Second, **re-enable presim generation**. **Pitfall 1 matters here and will waste an executor's time if
missed:** there is no `9999` literal in the tree to delete. `DEFAULT_PRESCHEDULE_FROM_SEASON` is `2026`
in `packages/harness/publish.ts`; a single past invocation passed `--presim-from-season 9999` as a CLI
override. Re-enabling is **a republish command, not a code change** — run the next publish without the
flag, or pass a chosen value (Claude's discretion). Plan the command, not a code hunt.

Third, the republish itself, through the `sigmascout-retune-republish` skill's ordering — **artifacts
before manifest**, always. Run it from the **main context** (subagent sandboxes block all network Bash)
and never render `.env` into a transcript. Afterwards, re-measure the payload budget and **transcribe
the summary into `docs/publish-budget.md` by hand** — `publish:seasons` prints it but does not write it,
and the budget tests stay red until it is transcribed. Never run `publish.ts --event` on an event that
matters: it replays its season cold and produces different `pRedWin` values.

**This plan carries a `checkpoint:decision` rated `one-way`** before the R2 write: overwriting and
deleting published sidecars is not undoable without another republish. The plan closes the phase by
re-proving **D-12** — `pRedWin`/`redScore`/`blueScore` still byte-identical against 09-01's frozen
baseline after the whole phase, since the RP layer does not feed back into level 1 and any difference is
a real cross-level leak rather than a tolerance question.

## OUTLINE COMPLETE
