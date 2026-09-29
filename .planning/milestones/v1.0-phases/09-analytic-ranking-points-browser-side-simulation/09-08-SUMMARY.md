---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 08
subsystem: live-worker
tags: [ranking-points, worker, d1, state-shape, parity]
status: complete
requires:
  - "09-04: analyticRpPmf, AnalyticRpPmfInput/Result"
  - "09-06: the RP layer config collapse (nothing left to thread)"
  - "09-07: the five decomposition Prediction fields and EventArtifact.rpOutcomeRp"
provides:
  - "readRpBeliefs / withRpBeliefs — the sigmascoutRp D1 passenger (shape 15)"
  - "RpVariableBelief / RpTeamBeliefs / RpMomentsAccumulator.beliefsByTeam() / .fromBeliefs()"
  - "SigmaScoutLayer.rpVariableBeliefs() — the seed-side accessor"
  - "RP on live PLAYED event rows, equal to the offline publisher's"
affects:
  - "09-10: owns the phase's one republish, which is the only source of shape-current seed files"
tech-stack:
  added: []
  patterns: ["D1 passenger key (09-RESEARCH.md Pattern 1)", "two-arm digest parity test"]
key-files:
  created:
    - apps/worker/test/scheduled.rp.test.ts
    - packages/harness/rpSeed.test.ts
    - .planning/todos/pending/sigma-beliefs-absent-from-d1-seed.md
  modified:
    - packages/core/rankingPoints/empiricalMoments.ts
    - packages/core/rankingPoints/empiricalMoments.test.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/stateSnapshot.test.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/publish.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/src/bundleSmoke.ts
    - docs/worker-operations.md
decisions:
  - "STATE_SNAPSHOT_SHAPE_VERSION bumped 14 -> 15, not the 12 -> 13 the plan assumed: HEAD had drifted twice more."
  - "The partial-roster gate is deliberately more conservative than the offline path — absent pmf over wrong pmf."
  - "The Sigma-belief seed gap was filed, not fixed: different feature, different verification."
  - "Task 4's seed-and-deploy is prepared and handed to the orchestrator — the executor sandbox denies all network Bash."
metrics:
  duration: ~75 min
  completed: 2026-09-11
actuals:
  tokens: 71000
  tasks: 4
  commits: 5
---

# Phase 09 Plan 08: Ranking Points in the Live Worker Summary

Live ticks now compute ranking points and write them onto **played** rows, priced from beliefs resumed out of D1 rather than cold-started — proven equal to an independent offline `SigmaScoutLayer` replay by a two-arm digest, at zero additional D1 subrequests.

## What shipped

| Piece | Where |
|---|---|
| `sigmascoutRp` passenger + shape bump 14 -> 15 | `packages/harness/stateSnapshot.ts` |
| `RpVariableBelief`/`RpTeamBeliefs`, `beliefsByTeam()`, `fromBeliefs()` | `packages/core/rankingPoints/empiricalMoments.ts` |
| Worker-resident RP accumulator, `rpFieldsFor`, observed-threshold fold, persistence | `apps/worker/src/scheduled.ts` |
| `redRpPmf`/`blueRpPmf` + 09-07's decomposition on `buildEventMatchRow`; `rpOutcomeRp` on the artifact | `apps/worker/src/scheduled.ts` |
| `rpVariableBeliefs()` seed accessor | `packages/harness/sigmaScoutLayer.ts` |
| **The D1 seed carries the RP beliefs** | `packages/harness/publish.ts` |
| Two-arm parity test, 8 cases | `apps/worker/test/scheduled.rp.test.ts` |
| Seed-chain test | `packages/harness/rpSeed.test.ts` |

## HEAD drift record — the plan's baseline was stale twice over

`09-RESEARCH.md` and the phase outline both say the bump is **11 -> 12**. `09-08-PLAN.md`
corrected that to **12 -> 13**, citing quick task `260911-3kc`.

**Both were wrong by execution time. At HEAD the constant read `14`.** Two further quick tasks
had landed between the plan being written and being executed:

| Bump | Landed by | What it added |
|---|---|---|
| 11 -> 12 | `260911-3kc` | EPA's season-boundary carry scale |
| 12 -> 13 | `260911-j2w` | EPA's week-1 calibration |
| 13 -> 14 | `260911-l2k` | EPA's foul rate |
| **14 -> 15** | **this plan** | the live Worker's ranking-point beliefs |

The plan states the rule as an increment rather than a literal precisely for this case, so the
bump was taken from the value actually found. Task 1's `<precondition>` as written ("reads
exactly 12") was treated as *verify before bumping* rather than a literal pin — the orchestrator's
brief directed this explicitly, and the value asserted is the one read at HEAD.

**Operational consequence:** live D1 and the deployed Worker are still at **shape 11**, so
**four** unseeded bumps are now outstanding, not one. All four close in the same single
seed-and-deploy pass. This is recorded in `docs/worker-operations.md`.

## Baseline captures (verbatim)

**1. Shape version at HEAD**
```
14
```
Expected `12` per the plan. See the drift record above.

**2. `npx vitest run packages/harness/stateSnapshot.test.ts`**
```
 Test Files  1 passed (1)
      Tests  54 passed (54)
```
The equality shape-pin test's exact title at HEAD:
> `STATE_SNAPSHOT_SHAPE_VERSION is 14, and a league row declaring ANY earlier shape throws (shape 14 added EPA's foul rate, 2026-09-11)`

Rewritten in place (not duplicated) to name shape 15 and what it added. After: **62 passed**.

**3. `npx vitest run apps/worker`**
```
 Test Files  11 passed (11)
      Tests  125 passed (125)
```

**4. `npx vitest run` from the repo root**
```
 Test Files  257 passed (257)
      Tests  5001 passed | 4 skipped (5005)
```

> **A recorded trap.** The first attempt used `npx vitest run --reporter=basic`. That reporter
> does not exist in vitest 4: the run failed to start with `ERR_LOAD_URL` and **exited 0**. This
> is the "judge by output, not exit code" pitfall firing on the baseline capture itself. The
> figures above are from the re-run with the default reporter.

**5. Typecheck — `npx tsc --noEmit` (root): clean.**

`npx tsc --noEmit -p apps/worker/tsconfig.json` was **RED at HEAD with three errors**:
```
apps/worker/src/bundleSmoke.ts(38,25): error TS2305: Module '".../analyticPmf.js"' has no exported member 'RP_LAYER_CONFIG_DEFAULT'.
apps/worker/src/bundleSmoke.ts(127,5): error TS2353: Object literal may only specify known properties, and 'config' does not exist in type 'AnalyticRpPmfInput'.
packages/corpus/db.ts(28,35): error TS2345: Argument of type 'URL' is not assignable to parameter of type 'string | URL'.
```
Triaged individually rather than batch-dismissed — see Deviations. The first two were repaired
(they are in this plan's own critical path); the third is inherited and untouched.

**6. Exported names actually present at HEAD**

```
packages/core/rankingPoints/analyticPmf.ts:644:export interface AnalyticRpPmfInput
packages/core/rankingPoints/analyticPmf.ts:660:export interface AnalyticRpPmfResult
packages/core/rankingPoints/analyticPmf.ts:715:export function analyticRpPmf(input: AnalyticRpPmfInput): AnalyticRpPmfResult
```

**`RpLayerConfig` and `RP_LAYER_CONFIG_DEFAULT` do not exist.** 09-06's D-06 collapse deleted the
entire selectable surface along with the branches it selected between. `AnalyticRpPmfInput` is
now `{ red, blue, ruleModule, eventType, compLevel, tally? }` — **no `config`, no `pRedWin`**. The
Worker therefore calls `analyticRpPmf` with no config parameter at all, which is what "thread
what survives the collapse, not the full config union" resolves to: nothing survives.

09-07's fields are all present on `Prediction`: `matchOutcomePmf`, `redOutcomeRp`,
`blueOutcomeRp`, `redBonusRpPmf`, `blueBonusRpPmf`, plus artifact-level
`EventArtifactSchema.rpOutcomeRp`. No conditional skip was needed.

## The two hand-verified non-vacuity checks

Both performed once, observed failing, and reverted. **Exact messages:**

**Check 1 — remove the two pmf lines from `buildEventMatchRow`:**
```
× a PLAYED qualification row on a live tick carries a well-formed redRpPmf and blueRpPmf
AssertionError: the fixture produced NO played row carrying an RP pmf at all, so every
assertion below would be vacuous: expected 0 to be greater than 0

× the LIVE pmf stream EQUALS an independent offline SigmaScoutLayer replay ...
AssertionError: algorithm "opr": the live (deployed-tick) and offline (SigmaScoutLayer) RP pmf
streams diverged — the live Worker priced these matches from a different history:
expected 'cf697c7f07c21796bf6d55ead5d8c8de67633…' to be '658e74d936c3424263295986da40acaca36f6…'
```

**Check 2 — cold-start the Worker's accumulator (`new RpMomentsAccumulator(...)` instead of `fromBeliefs`):**
```
× the LIVE pmf stream EQUALS an independent offline SigmaScoutLayer replay ...
AssertionError: algorithm "opr": the live (deployed-tick) and offline (SigmaScoutLayer) RP pmf
streams diverged — the live Worker priced these matches from a different history:
expected '0486d21f1ce6e97f95f27f043a0bcab084b4c…' to be '658e74d936c3424263295986da40acaca36f6…'
```

**Check 2 is the one that matters, and it is worth stating what it showed.** With a cold-started
accumulator, every published pmf was still **well-formed** — finite, length `maxRp + 1`, summing
to 1 within tolerance — and every presence assertion still passed. Only the digest caught that
the numbers were wrong. That is exactly the failure mode the state-shape bump exists to prevent,
reproduced and observed rather than argued.

## CPU measurement — measured, with its limits attached

**Command:** `npx tsx rpbench.scratch.ts` (a scratch script at the repo root, deleted after the
run; not committed).

**Method:** a 2026 rule module; a three-team alliance per side whose beliefs come from folding 12
synthetic matches through `RpMomentsAccumulator`; a band variance of 400, in the range the Sigma
Score path actually produces. 5,000 warm-up calls to get past JIT tiering, then 20,000 timed
calls via `process.hrtime.bigint()`. **Median and IQR reported, never the mean** — one GC pause
in the middle of a mean is how a benchmark lies (the `max` below is that pause).

**Raw output:**
```
node           v24.15.0
calls          20000
median         5.500 us
p25            5.100 us
p75            6.000 us
IQR            0.900 us
p99            12.100 us
min            4.600 us
max            140.800 us
```

**Median per call: 5.5 µs. IQR: 0.9 µs.**

**Derived per-tick figure.** Calls per tick = (newly-folded matches + still-upcoming matches) ×
live algorithm count, and the live count is **one** (`LIVE_ALGORITHM_IDS = "bpr"`, confirmed in
the deploy dry-run output). A full ~80-match qualification schedule with a handful newly folded
is therefore ~85 calls ≈ **0.47 ms** added per tick.

**Three limits, stated because the number is worthless without them:**

1. **Node on this machine is not the Workers isolate.** This is an order-of-magnitude bound on
   the added *work*, not a prediction of `cpuTime`.
2. **It is a per-call figure.** The 10 ms budget is a sustained per-invocation one, so the number
   that matters is the per-tick total *against the tick's existing measured cost* — not this
   figure in isolation.
3. **It resolves nothing about the sustained budget.** That question stays **OPEN** until
   observed on real ticks across a live event, which `09-VALIDATION.md` already carries as a
   manual-only verification. Per CLAUDE.md's corrected framing, the 10 ms limit is a
   **sustained-cost** budget: verified against production 2026-08-29, the same Worker version
   returned `ok` at `cpuTime:38` and was then killed pinned at `10` sixty seconds later on the
   same code and the same data. **A single healthy tick would not close this question either.**

**Against assumption A1.** 09-RESEARCH.md's "~1000x cheaper" is an unbenchmarked
order-of-magnitude inference and is **not** restated here as a finding. Measured against it as an
*expectation to test*: a median of 5.5 µs per call is **consistent** with the claim that the
closed form is dramatically cheaper than the deleted Monte Carlo — a 1,000-draw simulation per
match could not plausibly land in single-digit microseconds. The measurement neither confirms the
specific multiplier nor needs to; A1 remains an inference.

## Bundle proof — used, not duplicated

09-04 repointed `apps/worker/src/bundleSmoke.ts` at `analyticRpPmf` specifically so it is the
standing proof this path runs in the real runtime. **Confirmed still naming the analytic path**
(`import { analyticRpPmf }`, `rpRuleModuleForSeason(2026)`, a real `analyticRpPmf({...})` call).
No second smoke test was written.

`npx wrangler deploy --dry-run --outdir …` from `apps/worker` **succeeded offline** (no network,
no auth needed):
```
Total Upload: 1140.29 KiB / gzip: 206.22 KiB
env.LIVE_ALGORITHM_IDS ("bpr")
--dry-run: exiting now.
```
This proves the season-module dispatch table — all ten season files plus their schema library —
**builds** for the Workers runtime. Per `wrangler.toml`'s own `nodejs_compat` comment, it is
**not** evidence that the RP path is Node-free.

## Deviations from plan

### Auto-fixed

**1. [Rule 3 — Blocking] `bundleSmoke.ts` did not typecheck; repaired.**
- **Found during:** baseline capture 5, before any edit.
- **Issue:** 09-06's config collapse deleted `RP_LAYER_CONFIG_DEFAULT` and the `config`/`pRedWin`
  inputs, but left this call site importing the deleted export and passing both. Two TS errors.
- **Why in scope:** this file is 09-04's standing proof that the RP path bundles for Workers, and
  Task 3 depends on that proof; Task 1's acceptance criterion also requires the Worker typecheck
  program to be clean.
- **Fix:** dropped the dead import and the two deleted arguments, with a comment recording that
  they were removed by 09-06 rather than accidentally omitted.
- **Commit:** `eb588019` (landed ahead of the plan's own work, as its own commit).

**2. [Rule 1 — Bug, in this plan's own test fixture] The event-detail stub omitted `name`.**
- **Found during:** Task 1, when every played row came back with no pmf.
- **Issue:** `tbaEventSchema` requires `name`. `processEvent` parses the event detail inside a
  `try/catch` that degrades to `eventType = -1`, which `isRpEligibleEventType` then rejects — so
  RP was silently gated off on every row with nothing reporting a problem.
- **Fix:** added `name` to the stub, with a comment naming the silent-degradation path.
- **Note for a future reader:** `scheduled.replay.test.ts`'s stub has the same omission and is
  therefore also running at `eventType -1`. It does not matter there (that fixture carries no
  breakdowns and its offline layer has no rule module, so neither arm produces RP, and bands do
  not depend on event type). **Left untouched — out of this plan's scope**, but recorded because
  it is a latent fixture weakness.

### Scope decisions taken deliberately

**3. The "RP-ineligible event type yields no pmf" end-to-end case is unreachable; asserted
directly instead.** The Worker only processes **official** event types
(`isOfficialEventType`: not 99, not 100), and every official type (0,1,2,3,4,5) is present in
`EVENT_TYPE_TIERS` and therefore RP-eligible. No live tick can reach `rpFieldsFor`'s eventType
gate with an ineligible value. Rather than write a test asserting on an event the Worker never
folds, the test asserts the **relationship** — that the processed set is a subset of the eligible
set, and that 99 is excluded by both. Recorded rather than silently dropped.

**4. The "2021 season takes the tick down" end-to-end case is likewise unreachable.** 2021 has no
score-component map either (`componentMapForSeason` throws for it), so a 2021 fixture fails inside
`bpr` before RP is consulted — the driven test failed with
`componentMapForSeason: no component map registered for season 2021`. The registered RP seasons
and the registered component-map seasons are the **same set**, so no season can exercise
"component map present, RP rules absent". Replaced with a unit-level assertion that
`RP_RULE_MODULES[2021]` is `undefined` while `rpRuleModuleForSeason(2021)` **throws** — which is
precisely why the Worker indexes the registry instead of calling the throwing accessor.

**5. `rpSeed.test.ts` uses `bpr`, not `opr`.** `opr.initState` with no folded matches emits no
`scopeKind: "team"` rows at all (its team rows are `lastEventByTeam` bookkeeping), so
`withRpBeliefs` had nothing to attach to and the round-trip recovered an empty map. Switched to
the team-scoped `bpr`. Not a product bug: `publish.ts` seeds from real final states, which do
have team rows.

### Not fixed, by design

**The D1 seed has never carried the Sigma Score beliefs.** Filed as
`.planning/todos/pending/sigma-beliefs-absent-from-d1-seed.md` with its full evidence:
`withSigmaBeliefs`/`withSigmaPopulation` are called in exactly one place in the repo (the Worker's
own tick write path), and `SigmaScoutLayer` exposes no Sigma accessor at all, so `publish.ts`
could not seed them if it tried. Left behind by quick task `260910-wg8`, whose SUMMARY describes
the remainder as "seed-and-deploy" — phrasing that reads as purely operational, which is why it
went unnoticed.

**Consequence:** a Worker resumed from a fresh seed computes BPR's bands from the flat prior (and
falls back to the flat *talent* prior, the population being absent too) and disagrees with the
publisher while looking healthy. The shape check cannot catch it — the row declares the current
shape and is structurally valid, merely missing an optional passenger.

**Why not fixed here:** different feature, different verification. Its proof is the **band**
digest, not the RP digest. **It is urgent in one specific way:** 09-10's republish plus this
plan's seed-and-deploy is exactly the event that takes it from latent to live, so it is surfaced
below rather than left quiet.

## Verification

| Check | Result |
|---|---|
| `npx vitest run` (repo root) | **259 files, 5025 passed, 4 skipped** (baseline 257 / 5001 / 4) |
| `npx tsc --noEmit` (root) | clean |
| `npx tsc --noEmit -p apps/worker/tsconfig.json` | clean except the inherited `packages/corpus/db.ts` URL error |
| `npx vitest run apps/worker/test/scheduled.rp.test.ts` | 8 passed |
| `npx vitest run apps/worker/test/scheduled.replay.test.ts` | green and unchanged, as required |
| `npx vitest run packages/harness/stateSnapshot.test.ts` | 62 passed (baseline 54) |
| `npx vitest run packages/core/rankingPoints/empiricalMoments.test.ts` | 21 passed |
| `wrangler deploy --dry-run` | succeeds, 1140.29 KiB / gzip 206.22 KiB |
| `subrequestsUsed` unchanged | **measured: 64 with RP forced off, 64 with RP live** |

The subrequest result is a measurement, not an argument: the same fixture was driven twice, once
with the accumulator forced to `undefined` (every gate closed, no belief read or written) and once
live. Identical counts. The constant is pinned in the test with that method in its doc comment.

**No dependency was installed.** There is no `npm`/`pnpm add`, no `pnpm remove`, no `pip` and no
`cargo` invocation anywhere in this plan — every import added is to a first-party file already in
this repository. **The Package Legitimacy Gate therefore does not apply** and no
`[ASSUMED]`/`[SUS]` legitimacy checkpoint was required. Stated explicitly so a later audit can
tell a deliberate absence from a missed step.

## Task 4 — the one-way seed-then-deploy: PREPARED, NOT EXECUTED

**Pre-authorized.** Jacob granted standing authorization on 2026-09-11, recorded in
`09-CONTEXT.md`'s `<approvals>` block: *"D1 work approved"*, covering "the D1 seed-then-deploy
pair … seed-first and deploy-second (D-21)". The checkpoint did **not** stop to re-ask.

**Not executed here, and not worked around.** This executor's sandbox denies all network Bash.
The publish, the three `d1 execute --remote` invocations and the deploy all belong to the main
context. See the handoff section below.

**The recorded obligation, if it is deferred to 09-10's republish (the plan's recommended
option-a):** deliverable 6 is **code-complete and unreleased**. Live rows carry no RP until the
seed-and-deploy runs. `docs/worker-operations.md` now records this, including the fact that
**four** shape bumps are outstanding and close in one pass.

---

## Operational steps for the orchestrator

**All of these require network and must run from the main context.** Nothing below was run by
this executor.

**Secrets rule, restated because these are the commands someone types:** load `.env` with
`set -a; . ./.env; set +a` and reference variables unexpanded. **Never** `cat`, `echo`, `head`,
`Read`, or otherwise render `.env` or any value from it into any output stream — not a terminal,
a log, a commit message, or a planning document. This rule exists because it was broken on this
project once and a live R2 key had to be rotated.

### Order is load-bearing: publish → seed (×3) → deploy

```bash
# 0. Load credentials without rendering them.
set -a; . ./.env; set +a

# 1. PUBLISH — the ONLY source of shape-current seed files. They are a
#    byproduct of this command; no standalone command produces them.
pnpm publish:seasons

# 2. SEED — all three, before any deploy.
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-bpr.sql

# 3. DEPLOY — only after all three seeds succeed.
pnpm worker:deploy
```

### What each should print on success

| Step | Expect |
|---|---|
| `pnpm publish:seasons` | a run summary and three files under `reports/publish/`: `seed-opr.sql`, `seed-epa.sql`, `seed-bpr.sql`. **Not** `seed-vpr.sql` — VPR is retired. |
| each `d1 execute` | a row-count summary and no error. **Error code 10000 means OAuth was used** — the account id must come from the loaded environment. |
| `pnpm worker:deploy` | an upload line and a bindings list including `env.LIVE_ALGORITHM_IDS ("bpr")`. The dry-run measured 1140.29 KiB / gzip 206.22 KiB. |

### How to verify afterwards

1. Tail the Worker and confirm **no** `LeagueRowShapeVersionError` on the first ticks.
2. Confirm a played qualification row in a live event artifact carries `redRpPmf`/`blueRpPmf`.
3. Watch `cpuTime` across **many** ticks, not one. Per CLAUDE.md's corrected framing and the
   2026-08-29 production episode, a single healthy over-budget tick is **not** evidence the
   budget is safe. This is `09-VALIDATION.md`'s manual-only verification and it closes during a
   real event, not here.

### Four things to weigh before opening the window

1. **Four shape bumps are outstanding, not one** (11→12, 12→13, 13→14, 14→15). One pass closes
   all four. Live D1 and the deployed Worker are both still at **shape 11**.
2. **Seeding without deploying breaks live folding exactly as badly as deploying without
   seeding.** No safe intermediate state; the recovery from either is the other command.
3. **~4 seed passes exhaust D1's 100k daily row-write cap** (hit once, 2026-09-10). Benign today
   — nothing is live, it is September — and decidedly not benign during an event.
4. **The Sigma-seed defect (filed above) is cheap to fix first, and this is the event that makes
   it live.** If a seed is happening anyway, consider landing that three-line mirror before
   running it; otherwise BPR's live bands compute from the flat prior until the Worker's own
   ticks catch up.

### Handed to 09-10

- **The seed-and-deploy obligation**, if deferred. 09-10 owns the phase's one republish, and that
  republish is the **only** source of shape-current seed files.
- **The Sigma-seed defect**, as a decision to take alongside it.
- Assumption deltas **A** and **B** are *not* carried by this plan (A is 09-10's unconditionally;
  B was decided `no-ship` at 09-09) — stated so their absence reads as deliberate.

## Known stubs

None. No stub, placeholder, TODO or unwired component was introduced.

## Self-Check: PASSED

Files verified present on disk: `apps/worker/test/scheduled.rp.test.ts`,
`packages/harness/rpSeed.test.ts`,
`.planning/todos/pending/sigma-beliefs-absent-from-d1-seed.md`.

Commits verified in `git log`: `eb588019`, `dc30636e`, `04aa8ded`, `aa803473`.
