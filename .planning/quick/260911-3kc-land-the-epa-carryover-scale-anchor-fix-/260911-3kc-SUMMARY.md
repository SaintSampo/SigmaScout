---
task: "Land the EPA carryover scale-anchor fix as the shipped default"
quick_id: 260911-3kc
date: 2026-09-11
status: complete
subsystem: models/epa
tags: [epa, statbotics, carryover, season-boundary, walk-forward, port-defect, snapshot-shape, republish-owed]
requires:
  - scripts/measureEpaDeviations.ts (quick task 260910-x09's harness)
  - packages/core/algorithms/carryover.ts (epaCarryover, unchanged)
  - packages/harness/stateSnapshot.ts (the shape-version gate)
provides:
  - packages/core/algorithms/epaCarryScale.ts
  - epa@8.0.0+baseline
  - STATE_SNAPSHOT_SHAPE_VERSION 12
  - docs/models/epa-divergences.md section 8
affects:
  - docs/models/epa-vs-statbotics.md
  - data/baselines/epa-vs-statbotics-2026-09.json
  - scripts/epaVsStatbotics.ts --check
  - every published EPA rating (republish owed)
tech-stack:
  added: []
  patterns: [lazy-per-team-materialization, pre-declared-candidate-set, frozen-decision-record, reproduction-gate]
key-files:
  created:
    - packages/core/algorithms/epaCarryScale.ts
    - packages/core/algorithms/epaCarryScale.test.ts
  modified:
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/epa.test.ts
    - packages/core/algorithms/carryover.ts
    - packages/core/algorithms/carryover.test.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/stateSnapshot.test.ts
    - scripts/measureEpaDeviations.ts
    - scripts/measureEpaDeviations.test.ts
    - docs/models/epa-divergences.md
    - data/diagnostics/epa-deviation-ablation.json
    - apps/web/src/components/methodology/epaComparisonContent.ts
    - apps/web/src/lib/api/epaComparison.test.ts
    - apps/web/src/lib/metricGroups.test.ts
decisions:
  - "ADOPTED the carryover scale-anchor fix as epa@8.0.0+baseline. A carried rating now enters the new season in the INCOMING season's point units, lazily, per team, on first sight. carryover.ts's epaCarryover is unchanged; the correction is composed on top."
  - "EPA_CARRY_RESCALE_MIN_OBS = 250, chosen from the pre-declared set {100, 250, 500} by the pre-declared rule. BOTH challengers passed, so the tie-break (smaller wins) selected 250. No threshold set was swept."
  - "The threshold's marginal gain over the plain minObs=100 fix was selected on the same nine seasons it was measured on and is NOT independently confirmed. The fix itself is."
  - "STATE_SNAPSHOT_SHAPE_VERSION bumped 11 -> 12. Load-bearing, not ceremony: readScopedState filters by algorithm_id only, so a stale shape-11 row would silently DISABLE the rescale on live traffic while the offline publisher applied it."
  - "The three carryover arms were DELETED from the harness. They wrapped the shipped module, so a wrapper over 8.0.0 would apply the rescale twice and report a double-apply as the fix. The measurement is preserved as data, not deleted with the arm."
  - "teamMetrics left untouched: a carried-but-not-yet-seen team still publishes in the outgoing season's units, exactly as the measured arm did. Correcting it would be an unmeasured change to a published number."
metrics:
  duration: ~1h10m
  completed: 2026-09-11
actuals:
  tokens: 136000
  tasks: 3
  commits: 5
---

# Quick Task 260911-3kc: Land the EPA carryover scale-anchor fix

Stage 2 of 4. Stage 1 (quick task 260910-x09) measured the fix as an arm; this task
measured the one open refinement it left on the table, landed the result as the shipped
default, and closed the deviation out of the harness.

## Task 1 — the deferral-threshold refinement

### The candidate set and the rule, as declared BEFORE the corpus was opened

Both were printed in `main()`'s preamble ahead of `openCorpusReadOnly` and serialized into
the artifact as `notes.thresholdSelection`, so neither can be reverse-engineered from the
answer it produced.

**Candidate set — the whole search, three values, no sweep:** `EPA_CARRY_RESCALE_MIN_OBS ∈
{100, 250, 500}` alliance scores. `100` was the INCUMBENT, the plain fix stage 1 already
proved. A fourth value or a scan over a range was forbidden: nine seasons of scoring include
2019, which carries essentially the entire effect, so a curve fitted over that population is
selection against one season wearing the clothes of a nine-season result.

**Rule, verbatim and in order:**

- **PRIMARY** — pooled ONSET Brier, each challenger measured against the **INCUMBENT** arm
  (not against the shipped baseline), paired and event-blocked. A challenger passes only if
  it is BETTER with a 95% interval EXCLUDING zero.
- **GUARD 1** — pooled SEASON winner accuracy vs the incumbent: reject if WORSE with an
  interval excluding zero.
- **GUARD 2** — pooled SEASON Brier vs the incumbent: reject if WORSE with an interval
  excluding zero.
- **TIE-BREAK** — if both challengers pass, take the SMALLER threshold.
- **DEFAULT** — if no challenger passes all three clauses, the shipped default is the
  incumbent at `minObs = 100`, reported as the OUTCOME rather than a failure.

### The measured numbers

Nine seasons (2016-2019, 2022-2026), 147,221 scored matches, 1,653 event blocks, three
carryover arms on one shared stream.

| challenger | pooled ONSET Brier vs incumbent (PRIMARY) | pooled season ACC (GUARD 1) | pooled season Brier (GUARD 2) | verdict |
|---|---|---|---|---|
| `minObs = 250` | **-0.00203** [-0.00339, -0.00068] BETTER | -0.00021 [-0.00055, +0.00011] indistinguishable | -0.00007 [-0.00013, -0.00001] better | **PASSES** |
| `minObs = 500` | **-0.00179** [-0.00350, -0.00007] BETTER | -0.00017 [-0.00054, +0.00018] indistinguishable | -0.00006 [-0.00014, +0.00001] indistinguishable | **PASSES** |

### Which variant WON

**`minObs = 250` won, by the tie-break.** Both challengers cleared the primary and neither
guard fired, so the pre-declared "take the SMALLER threshold" clause selected 250.

So: **a threshold DID beat the plain fix.** The plain `minObs = 100` fix is not what ships.

**What 250 bought, stated precisely.** The plain fix's honest weak spot was the ONSET window
(the first 500 scorable matches after each boundary, pooled): at `minObs = 100` it measured
**+0.00184 Brier [+0.00005, +0.00365] — WORSE than un-fixed EPA**. At `minObs = 250` that
same contrast is **-0.00020 [-0.00162, +0.00128] — INDISTINGUISHABLE**. The onset regression
is gone rather than merely smaller. That was the explicit question the refinement existed to
answer.

**What it cost.** Deferrals roughly double: 809 forfeited rescales at `minObs = 100`, **1,649
at 250**, out of 37,258 carried team-boundaries.

**THE HONEST LIMIT, and it is load-bearing.** The adopted variant is a **threshold challenger,
not the plain fix**, and *its marginal gain over the plain fix was selected on the same nine
seasons it was measured on, with no held-out confirmation.* That margin is therefore **NOT
independently validated**. Only the carryover fix itself is — pooled +0.01059 accuracy and
-0.00521 Brier against un-fixed EPA, measured before any threshold question was asked. Every
place this threshold is quoted carries that caveat: the constant's doc comment, the artifact's
`notes.thresholdSelection.reason`, `epa-divergences.md` §8, and the run's own log.

**Pooled effect of what actually ships (`minObs = 250`) against un-fixed EPA:** winner
accuracy **+0.01038** [+0.00823, +0.01265], Brier **-0.00528** [-0.00644, -0.00418].

## Task 2 — what shipped

### The new EPA version string

**`epa@8.0.0+baseline`** (was `7.0.0+baseline`). MAJOR, deliberately: every carried rating
changes at every boundary where the point scale moved, so every published EPA figure from the
second replayed season onward moves.

`carryover.ts`'s `epaCarryover` is **unchanged** — it still converts both directions with the
outgoing season's distribution, which keeps its round trip self-consistent. The correction is
composed on top, lazily, per team, on first sight, by `epa.carrySeason`/`predict`/`update`
reading the new `packages/core/algorithms/epaCarryScale.ts`. The five pure helpers were
**moved** out of the measurement harness rather than copied, and `EPA_SCORE_SD_SEED_COUNT`
moved with them (re-exported from `epa.ts`, so every existing import path is unchanged) because
`cleanSeasonMean` unwinds exactly that seed — one fact, one home, no import cycle.

### Was `STATE_SNAPSHOT_SHAPE_VERSION` bumped, and why

**Yes: 11 -> 12.** The reason is load-bearing, not ceremonial.

`EpaState` gained two fields: `carrySeedMean` (the outgoing season's alliance-score mean,
LEAGUE-scoped, one number) and `carryPending` (per team, serialized as a flag on that team's
own row and omitted when false — D-13 forbids a league row whose bytes grow with team count,
and a few thousand team keys would breach `MAX_LEAGUE_ROW_BYTES`).

`apps/worker/src/stateStore.ts`'s `readScopedState` filters rows by `algorithm_id` **only** and
never by version, so bumping `epa.version` to 8.0.0 does **not** by itself make a stale seeded
row unreachable. A shape-11 EPA league row would deserialize with `carrySeedMean` undefined and
`carryPending` absent, which makes the ratio unreadable and therefore **silently disables the
rescale on live traffic while the offline publisher applies it** — live and offline disagreeing
on every carried rating at every boundary, with no error, no NaN and no malformed row to find.
The shape check is the only thing that turns that into a loud `LeagueRowShapeVersionError`
naming the re-seed as the fix.

**Consequence: the Worker needs a re-seed from a fresh publish run. Seed first, deploy second.**

### The contract test

`epa.test.ts` pins incoming-season units and asserts the un-multiplied value is wrong
explicitly, so the test cannot pass against the old behaviour. It also pins: pinned-zero
`adjust` stays exactly 0; `predict` and `update` apply the same ratio (a divergence there is
precisely the live/offline split class the 10 -> 11 bump was written about); the ratio is never
applied twice; a deferral is a **forfeit, not a delay**; cold start is untouched; an empty
pending set changes no prediction. `stateSnapshot.test.ts` pins that a shape-11 EPA row throws.

Two pre-existing assertions had to move because they encoded the OLD threshold implicitly —
both used a literal fold count (200) that silently fell below the new 250. Both were rewritten
to DERIVE their fold count from `EPA_CARRY_RESCALE_MIN_OBS`, so a future re-measure cannot make
them pass on the old behaviour while asserting the new one. The shape-version test's stale-list
`[3..10]` was replaced with a range derived from the current version — the iteration-list trap.

## Task 3 — the reproduction gate

**PASSED. 19/19 scopes, to 6 decimal places, with identical scored counts.**

The gate compared the post-landing artifact's shipped `epa` baseline rows against the
**pre-landing** artifact's `epa-carryover-fix-min250` (winning arm) rows, season by season plus
onset and pooled, refusing any non-finite value on either side before comparing. The actual
comparison, not a summary of it:

| scope | pre (winning arm) ACC / Brier | post (shipped `epa`) ACC / Brier | n |
|---|---|---|---|
| season/2016 | 0.719533 / 0.185691 | 0.719533 / 0.185691 | 12,994 = 12,994 |
| season/2017 | 0.671832 / 0.204549 | 0.671832 / 0.204549 | 15,363 = 15,363 |
| season/2018 | 0.731511 / 0.180186 | 0.731511 / 0.180186 | 16,889 = 16,889 |
| season/2019 | 0.721298 / 0.188317 | 0.721298 / 0.188317 | 17,972 = 17,972 |
| season/2022 | 0.775698 / 0.156955 | 0.775698 / 0.156955 | 14,603 = 14,603 |
| season/2023 | 0.759477 / 0.163871 | 0.759477 / 0.163871 | 16,290 = 16,290 |
| season/2024 | 0.754653 / 0.169512 | 0.754653 / 0.169512 | 16,958 = 16,958 |
| season/2025 | 0.778148 / 0.158808 | 0.778148 / 0.158808 | 17,815 = 17,815 |
| season/2026 | 0.792915 / 0.153420 | 0.792915 / 0.153420 | 18,337 = 18,337 |
| onset/pooled | 0.691745 / 0.200932 | 0.691745 / 0.200932 | 4,000 = 4,000 |
| **pooled** | **0.746529 / 0.172947** | **0.746529 / 0.172947** | **147,221 = 147,221** |

(Eight per-season onset scopes also passed identically and are omitted for width.)

Independently, the per-boundary census reproduces exactly: **37,258 carried team-boundaries and
12,192 never-seen**, read off the shipped state's own `carrySeedMean`/`carryPending`, matching
the pre-landing arm's own bookkeeping. Nothing was reconciled, because nothing mismatched.

### The harness closeout

All three carryover arms were **deleted**, and the deletion is the point: they WRAPPED the
shipped module, so a wrapper over `epa@8.0.0` would apply the rescale a **second** time and the
harness would measure a double-apply while reporting it as the fix. `carryoverFixArm`,
`CarryoverFixState`, `ratioForState`, `selectThreshold` and the arm ids are gone. The
measurement is preserved as data: `deviationRegister()`'s `carryover-scale-anchor` is
`status: "closed"`, `armIds: []`, with the pooled deltas and intervals, the 2019 concentration,
the 2018 Brier regression, the onset cost and the frozen threshold selection in
`priorMeasurement`. The run now **throws** if the frozen record ever disagrees with the shipped
`EPA_CARRY_RESCALE_MIN_OBS`.

The per-boundary scale table survived the closeout by being repointed at the shipped state's own
`carrySeedMean`/`carryPending` — it now reports what production actually does. The
rescaled-vs-deferred split is no longer reported per run, because `EpaState` keeps no diagnostic
counters and adding them would put measurement bookkeeping into every published row; the split as
measured lives in `priorMeasurement`.

## What this change made stale

**EPA is the FROZEN BASELINE SigmaScout's "beats EPA" claim is measured against (D-04).**
Changing EPA means every prior "beats EPA" number was measured against the OLD EPA. **None of
these were re-run in this task, by design.** Each is listed with what re-establishes it.

| artifact | why it is stale | what re-establishes it |
|---|---|---|
| `docs/models/epa-vs-statbotics.md` | every agreement figure (OLS slope, Pearson, mean absolute difference, head-to-head accuracy/Brier) was measured under `epa@7.0.0+baseline` or earlier | a fresh `pnpm compare:epa-statbotics` run under 8.0.0, then rewriting the per-season tables and the version-status header |
| `scripts/epaVsStatbotics.ts --check` | it gates against tolerance bands established under 7.0.0. **It will now FAIL, and that failure is CORRECT, not a regression.** | a run **without** `--check` to rebuild the baseline, **reviewed before it is committed** — a regenerated gate that nobody read is not a gate |
| `data/baselines/epa-vs-statbotics-2026-09.json` | the committed tolerance bands themselves | the same rebuild above; treat the diff as evidence, not as a formality |
| `v1/methodology/epa-vs-statbotics.json` (published, R2) | generated under 7.0.0; the `/methodology/epa-vs-statbotics` page renders it live | the owed republish |
| `apps/web/src/components/methodology/epaComparisonContent.ts` | prose is fine and was deliberately NOT given a fourth difference entry (its locked decision pins the set at three ids), but the **numbers the page renders come from the stale published object above** | the republish; a doc-comment note recording this was added in this task |
| `docs/models/epa-divergences.md` §1-§7 | the header's version status now names 8.0.0; §4/§6's quoted agreement figures still date from earlier models | the `epa-vs-statbotics` rebuild above |
| `docs/publish-budget.md` | its latest entry describes the 7.0.0 generation (108,820 objects, generation `97342984`) | the owed republish's own budget transcription — note this is a MANUAL step; `publish:seasons` prints the summary but does not write the file |
| every published EPA rating in R2 and every seeded D1 row | 8.0.0 changes carried ratings, and shape 12 makes a shape-11 seed row throw at load | the owed republish plus a D1 re-seed; **seed first, deploy second** |

### A REPUBLISH IS OWED, AND IT WAS NOT RUN

No `pnpm publish:seasons`, no `publish:artifacts`, no `publish.ts --event`, no R2 write, no
`d1 execute`, no `wrangler deploy` was invoked at any point in this task. **Until that republish
runs, the site serves `epa@7.0.0+baseline` ratings while the repo ships 8.0.0** — the Teams list,
team pages, event pages, the compare surfaces, the algorithms manifest and the
`epa-vs-statbotics` methodology page are all still the old model. That divergence is a known,
deliberate state of this commit, not a defect introduced by it, and it closes only when the user
gates a republish.

**Note the ordering hazard when that republish happens:** a deploy carrying shape 12 against
un-re-seeded D1 rows takes live folding down until the seed runs, and a seed at 8.0.0 while the
site still serves 7.0.0 pages reproduces the ~4h live/offline divergence the 7.0.0 publish
already hit once.

## Guardrails held

- **BPR was never read, replayed, tuned or edited.** Nothing under `packages/bpr/` appears in
  any of this task's five commits, and BPR was not an arm in this harness. **Its sealed
  2016-2022/2023-2026 holdout is unspent.**
- **Nothing was tuned or swept.** The only selection performed anywhere was task 1's, from three
  pre-declared values by a pre-declared rule, both printed before the corpus was opened.
- **The frozen D-04 carry constants are untouched:** `EPA_MEAN_REVERSION` 0.4,
  `EPA_CARRY_LAST_YEAR_WEIGHT` 0.7, `EPA_CARRY_PRIOR_YEAR_WEIGHT` 0.3, `EPA_NORM_MEAN` 1500,
  `EPA_NORM_SD` 250, `EPA_INIT_PENALTY` 0.2. This change corrects the SCALE ANCHOR, not the carry
  parameters.
- **`sigma1/carryover.ts` was not touched** — its own copy of the carry math stays independent by
  D-04 design.
- **`.env` was never read, echoed or interpolated.** This task needed no secrets and the harness
  was never run with `--env-file`.
- **Another session was active in this checkout throughout.** Every commit staged explicit
  pathspecs via `git commit -- <paths>`; `git add -A` was never used, and `git show --stat` after
  each commit confirmed no foreign file landed.

## Verification

- Repo-root `npx vitest run packages/ scripts/`: **124 files, 2,729 passed, 4 skipped** (the
  167-file root scope, not the 77-file `apps/web` one).
- `npx vitest run apps/web`: **109 files, 1,717 passed.**
- `npx tsc --noEmit -p tsconfig.json`: clean. `npx tsc --noEmit -p apps/web/tsconfig.json`: clean
  — and it caught an `EpaState` fixture in `apps/web/src/lib/metricGroups.test.ts` that the root
  project does not cover.
- The reproduction gate: 19/19 PASS at 6 dp, above.

## Deviations from plan

- **Task 1's outcome was a challenger, not the incumbent.** The plan was written to accommodate
  either; `minObs = 250` ships, so `EPA_CARRY_RESCALE_MIN_OBS` is 250 rather than 100 and the
  not-independently-confirmed caveat applies throughout.
- **`EPA_SCORE_SD_SEED_COUNT` moved to `epaCarryScale.ts`** (re-exported from `epa.ts`) rather
  than staying put. Keeping it in `epa.ts` while `cleanSeasonMean` defaulted to it would have
  created exactly the circular import `carryover.ts`'s own header warns about. [Rule 3 -
  Blocking]
- **The per-boundary scale table was repointed at the shipped state rather than deleted.** The
  plan's closeout removed the arms that fed it; `epa@8.0.0` exposes `carrySeedMean`/`carryPending`
  itself, so the diagnostic survives and now measures production. [Rule 2 - Missing
  functionality]
- **`selectThreshold` was deleted and its outcome frozen as `THRESHOLD_SELECTION_OUTCOME`.** With
  the arms gone it could never be fed again; freezing the record preserves how the shipped
  constant was chosen, and a guard throws if the record and the constant ever disagree.
- **`apps/web/src/lib/metricGroups.test.ts` was modified** — not in the plan's file list, but it
  constructs an `EpaState` and only the web tsconfig sees it.

## Known stubs

None.

## Self-Check: PASSED

All five named artifacts exist on disk (`epaCarryScale.ts`, `epaCarryScale.test.ts`,
`data/diagnostics/epa-deviation-ablation.json`, `docs/models/epa-divergences.md`, this
SUMMARY). All five commit hashes resolve in git: `25601fba`, `ed99b85f`, `7bf84137`,
`8838a973`, `1e5b42d9`. No commit in this task's range mentions a publish, and no publish,
R2 write, D1 seed or deploy was executed.
