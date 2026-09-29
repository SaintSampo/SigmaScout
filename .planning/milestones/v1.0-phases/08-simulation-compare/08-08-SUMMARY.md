---
phase: 08-simulation-compare
plan: 08
subsystem: pipeline
tags: [simulation, monte-carlo, walk-forward, measurement, rank-bands]

requires:
  - phase: 08-simulation-compare
    plan: 03
    provides: "packages/core/algorithms/simulation/rankSimulation.ts — simulateRanks/mulberry32, imported unchanged, never reimplemented"
  - phase: 08-simulation-compare
    plan: 04
    provides: "apps/web/src/lib/simQuantile.ts — continuousQuantile(), imported unchanged across the apps/web boundary from a tsx-run Node script (08-04's flagged assumption 2, now resolved: no relocation fallback needed)"
provides:
  - "scripts/measureRewindGap.ts — D-02's control run: threaded offseason-inclusive season replay, boundary snapshots taken inside onMatchComplete, paired frozen-vs-stored-vs-noise-control rank-band-width measurement at 3 start points across 5 events"
  - "docs/models/rewind-overconfidence-gap.md — the committed measurement doc: headline verdict (narrower, 10.85% mean), method, event sample, full per-event/per-start-point results table, limitations, sidecar-checkpoint recommendation, and the machine-readable json rewind-gap block"
  - "apps/web/src/lib/rewindGap.ts — REWIND_GAP_PERCENT/VERDICT/MEASURED_AT/EVENT_COUNT/MEASUREMENT_COUNT, zero imports, guarded against drift from the doc by a sync test"
  - "measure:rewind-gap package.json script, no --env-file flag"
affects: [08-11 (Simulation-tab rewind-honesty caption imports REWIND_GAP_PERCENT/REWIND_GAP_VERDICT from apps/web/src/lib/rewindGap.ts — must consult the verdict before asserting "narrower")]

actuals:
  tokens: 21331
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Local mirror of publishSeasons'/runSeasons' season-boundary carrySeason threading loop, built from the same buildSeasonStream/WalkForwardSimulator primitives (never a call into cli.ts/publish.ts's own orchestration functions, matching the plan's stated recipe)"
    - "A start-index-0 job's 'frozen state' is the season's own initial state (carried-in or cold initState) rather than an onMatchComplete snapshot — handled as an explicit SEASON_START_SENTINEL boundary key, never left to fall through"
    - "Union-of-both-arms pmf exclusion with an element-by-element paired match-key assertion (PairingMismatchError), proving the comparison stays paired by construction rather than by discipline"

key-files:
  created:
    - scripts/measureRewindGap.ts
    - scripts/measureRewindGap.test.ts
    - docs/models/rewind-overconfidence-gap.md
    - apps/web/src/lib/rewindGap.ts
  modified:
    - package.json

key-decisions:
  - "buildSeasonStream (imported from packages/harness/replay.ts) is called directly with { includeOffseason: true } rather than a local selectMatchesChronological wrapper — functionally identical (buildSeasonStream IS exactly that call), but using the real function keeps the literal `includeOffseason: true` string in the file (matching publish:seasons' own composition) and avoids a local duplicate of stream-ordering logic. Caught and fixed during Task 2's own grep-gate self-check, before commit."
  - "The unfired-boundary guard and the doc-to-constant sync guard were both proven non-vacuous by temporarily injecting a fabricated failure (a bogus boundary key; a one-digit REWIND_GAP_PERCENT perturbation), observing the named failure message, then reverting — neither guard was trusted on inspection alone."
  - "The measured verdict is 'narrower' (10.85% mean, clearing the 0.62% mean noise floor by ~17x) but the effect is NOT uniform: it is largest at the earliest rewind point (10.89%-44.18% across the 5 events' start=0 jobs) and shrinks toward, and in 2 of 5 events past, zero by the latest start point (2/3 through qualifications). This shape — not just the headline mean — is recorded in both the doc's Headline Verdict section and its sidecar-checkpoint recommendation, since a single mean would have hidden it."
  - "The sidecar-checkpoint recommendation (08-CONTEXT's deferred idea) is a recommendation for a future /gsd-discuss-phase, not a decision taken here, per the plan's own explicit instruction — it additionally suggests the deferred idea's ~10-checkpoints-per-event shape could be narrowed toward the early-event window where this measurement shows the effect concentrates, rather than accepting or rejecting the idea wholesale."

patterns-established:
  - "A Node control-run script that imports both a packages/core/ leaf module (rankSimulation.ts) and an apps/web/src/lib/ leaf module (simQuantile.ts) unchanged under tsx, with zero relocation needed — closes 08-04's flagged assumption 2 as confirmed working, not just assumed."

requirements-completed: [EVNT-07]

coverage:
  - id: D1
    description: "D-02's rewind-overconfidence gap exists as a measured number produced by committed code from committed inputs: docs/models/rewind-overconfidence-gap.md's json rewind-gap block, mirrored into apps/web/src/lib/rewindGap.ts, and recorded in this SUMMARY"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "scripts/measureRewindGap.test.ts — 33 tests (31 pure-helper + 2 doc<->constant sync guard), 0 skipped"
        status: pass
      - kind: other
        ref: "npx tsx scripts/measureRewindGap.ts --write-doc (full backgrounded run, ~2m24s wall clock, 98,598 matches replayed, 5 events, 15 measurements, verdict narrower)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both prediction sets pass through the SAME imported simulateRanks (08-03) and continuousQuantile (08-04), never reimplemented — proven by negative grep over code lines and by the smoke run's exact 0.8-rank-unit structural-floor test tying this script's arithmetic to 08-04's proven minimum"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "scripts/measureRewindGap.test.ts Test 14 (meanBandWidth exact 0.8 case) + grep gates (rankSimulation.js >=1, simQuantile.js >=1, 0 local function definitions of the four shared-math names)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The comparison is paired by construction: identical match-key sequence, identical baselines, identical draw count, two generators seeded from the same value, with a PairingMismatchError thrown on the first divergence"
    verification:
      - kind: unit
        ref: "scripts/measureRewindGap.ts's runMeasurement — element-by-element assertion, code-reading confirmed present"
      - kind: other
        ref: "Full run: excludedMatchCount 0 for every one of 15 jobs, 0 pairing divergences"
        status: pass
    human_judgment: false
  - id: D4
    description: "The frozen set is frozen structurally: collectFrozenPredictions' predictOnly parameter is a bare (match: MatchResult) => Prediction callback with no algorithm module or fold-in method in scope"
    verification:
      - kind: unit
        ref: "scripts/measureRewindGap.test.ts Test 13"
        status: pass
    human_judgment: false
  - id: D5
    description: "The measurement carries its own noise floor (re-simulating identical stored predictions under a different seed) and classifyVerdict derives narrower/wider/indistinguishable from a stated |narrowing|<=noiseFloor rule, never a judgement call"
    verification:
      - kind: unit
        ref: "scripts/measureRewindGap.test.ts Tests 21-24"
        status: pass
      - kind: other
        ref: "Full run: meanNoiseFloorPercent 0.619%, meanNarrowingPercent 10.848% -> verdict narrower, computed by the rule not asserted"
        status: pass
    human_judgment: false
  - id: D6
    description: "Neither outcome was presupposed — the measured figure and direction are published unchanged (including 2 of 5 events' negative/wider final-start-point findings), and REWIND_GAP_VERDICT is exported so 08-11 cannot assert a narrowing the measurement did not find"
    verification:
      - kind: other
        ref: "docs/models/rewind-overconfidence-gap.md Results table reports -8.55% and -3.70% exactly as measured; apps/web/src/lib/rewindGap.ts exports REWIND_GAP_VERDICT alongside REWIND_GAP_PERCENT"
        status: pass
    human_judgment: false
  - id: D7
    description: "The doc and the shipped constant cannot silently disagree — proven by a sync test observed failing once against a one-digit REWIND_GAP_PERCENT perturbation, then reverted"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "scripts/measureRewindGap.test.ts — sync guard describe block; failure message quoted in this SUMMARY's Verification section"
        status: pass
    human_judgment: false

duration: ~21min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 8: D-02's rewind-overconfidence control measurement Summary

**`scripts/measureRewindGap.ts` measures how much narrower the Simulation tab's rank distribution comes out when its rewind start match is already played, versus an honest from-here forecast — 10.85% narrower on average across 15 paired measurements over 5 events (verdict `narrower`, clearing the measurement's own 0.62% noise floor by ~17x), with the effect concentrated at the earliest rewind points (10.89%-44.18%) and shrinking to near-zero or slightly negative by two-thirds through an event's qualification schedule.**

## The measured figure (required by this plan's `<measurement_obligation>`)

**Headline: 10.848394210456348% mean narrowing, verdict `narrower`.**

| Field | Value |
|---|---|
| `meanNarrowingPercent` | 10.848394210456348 |
| `minNarrowingPercent` | -8.549486466710535 |
| `maxNarrowingPercent` | 44.18053864411849 |
| `meanNoiseFloorPercent` | 0.619378478203013 |
| `measurementCount` | 15 |
| `eventCount` | 5 |
| `excludedMatchCount` | 0 |
| `incompleteBaselineTeamCount` | 0 |
| `verdict` | `narrower` |
| `measuredAt` | 2026-08-31T21:30:31.398Z |
| `algorithmId` / `algorithmVersion` | `vpr` / `2.1.0+tuned-2026-08` |
| `corpusIdentity` / `corpusMatchCount` | `data\corpus.sqlite` / 98,598 |

**Both durable homes:**
1. `docs/models/rewind-overconfidence-gap.md`'s ```json rewind-gap``` block (source of truth).
2. `apps/web/src/lib/rewindGap.ts`'s five constants (mirror for 08-11's caption, guarded by a sync test).

**Full per-event, per-start-point table** (transcribed from the doc, all 15 measurements):

| Event | Start idx | Remaining | Teams | Frozen width | Stored width | Narrowing | Noise floor |
|---|---:|---:|---:|---:|---:|---:|---:|
| `2022tuis3` | 0 | 57 | 31 | 24.3528 | 13.5936 | **44.18%** | 1.10% |
| `2022tuis3` | 19 | 38 | 31 | 9.6524 | 8.3498 | 13.49% | 0.85% |
| `2022tuis3` | 38 | 19 | 31 | 5.9607 | 6.4703 | -8.55% | 0.55% |
| `2023ctwat` | 0 | 76 | 38 | 18.8316 | 12.8289 | 31.88% | 0.04% |
| `2023ctwat` | 25 | 51 | 38 | 10.0082 | 9.0219 | 9.86% | 0.29% |
| `2023ctwat` | 50 | 26 | 38 | 5.6647 | 5.8742 | -3.70% | 0.40% |
| `2024nysu` | 0 | 80 | 48 | 24.1768 | 21.5431 | 10.89% | 0.94% |
| `2024nysu` | 26 | 54 | 48 | 14.3806 | 13.2227 | 8.05% | 0.45% |
| `2024nysu` | 53 | 27 | 48 | 7.9835 | 7.6939 | 3.63% | 0.11% |
| `2025cur` | 0 | 127 | 76 | 12.7658 | 13.3064 | -4.23% | 0.16% |
| `2025cur` | 42 | 85 | 76 | 10.9503 | 9.9655 | 8.99% | 1.01% |
| `2025cur` | 84 | 43 | 76 | 6.1143 | 5.7197 | 6.45% | 1.51% |
| `2026sccmp` | 0 | 62 | 31 | 8.7512 | 6.6897 | 23.56% | 0.75% |
| `2026sccmp` | 20 | 42 | 31 | 5.8350 | 5.0793 | 12.95% | 0.52% |
| `2026sccmp` | 41 | 21 | 31 | 3.9893 | 3.7788 | 5.27% | 0.63% |

**Recommendation on the sidecar-checkpoint idea (not a decision — routed to a future `/gsd-discuss-phase`):** the effect is real and, at early rewind points, large enough to be worth the deferred idea's ~35 MB / ~38 KB-per-event cost — but it is strongest specifically at early-event rewinds, not uniform, so a future discussion should weigh a checkpoint density concentrated in the first third of an event against simply captioning the tab with this measured figure (already done, via `rewindGap.ts`).

## Baseline (recorded before Task 1)

```
npx vitest run packages/core/algorithms/simulation/rankSimulation.test.ts apps/web/src/lib/simQuantile.test.ts
Test Files  2 passed (2)
     Tests  32 passed (32)
```
Both 08-03/08-04 dependency suites green before Task 1 began, matching the plan's `<baseline>` requirement exactly.

## Observed RED steps (quoted, not claimed)

**Task 1**, stubbing `buildBaselines` and `narrowingPercent` to throw, then running Test 7 and Test 18 in isolation:

```
FAIL scripts/measureRewindGap.test.ts > buildBaselines(...) > Test 7: a match whose redRpEarned is null ...
Error: RED-STEP-TEMP: buildBaselines not implemented
 ❯ buildBaselines scripts/measureRewindGap.ts:234:9

FAIL scripts/measureRewindGap.test.ts > narrowingPercent(...) > Test 18: frozen 3.0, stored 4.0 returns exactly -33.333333...
Error: RED-STEP-TEMP: narrowingPercent not implemented
 ❯ narrowingPercent scripts/measureRewindGap.ts:350:9

Tests  2 failed | 29 skipped (31)
```
Reverted; full suite green (31 passed) immediately after.

**Task 2's unfired-boundary guard**, proven non-vacuous by temporarily adding a fabricated key to `unfiredBoundaries` and running the real smoke command:

```
measureRewindGap failed: measureRewindGap: season 2022: the following registered boundary key(s)
never fired — a missing measurement would otherwise be silently absorbed by a mean over fewer jobs:
__FABRICATED_BOUNDARY_KEY_FOR_GUARD_TEST__
```
Reverted; `git diff --stat scripts/measureRewindGap.ts` confirmed the revert left only the intended driver additions (no leftover fabricated-key line), and the smoke run reproduced identical output before and after.

**Task 3's doc-to-constant sync guard**, proven non-vacuous by perturbing `REWIND_GAP_PERCENT`'s first decimal digit:

```
FAIL scripts/measureRewindGap.test.ts > ... sync guard > every shipped constant ... equals the doc's committed block field
AssertionError: expected 10.948394210456348 to be 10.848394210456348 // Object.is equality
Tests  1 failed | 1 passed | 31 skipped (33)
```
Reverted; full suite green (33 passed) immediately after.

## Smoke run (Task 2, before the full run)

```
npx tsx scripts/measureRewindGap.ts --events 2022tuis3 --draws 50
```
Completed in **~3 seconds** (real 0m2.992s). `events` length 1, exactly 3 `startPoints`. `startPoints[0].remainingMatchCount` = 57 (matches the event's full played qual count), `startPoints[2].remainingMatchCount` = 19 (= 57 − 38, matches `57 − Math.floor(2/3*57)`). `startPoints[0].teamCount` = 31, matching the roster size pinned in the plan. Printed 1 per-season line, 3 per-boundary lines, 3 per-job lines — boundary count equals job count, confirming no registered boundary silently failed to fire.

## Full backgrounded run (Task 3)

```
npx tsx scripts/measureRewindGap.ts --write-doc
```
Run via `run_in_background: true` from the first attempt (per this plan's own binding instruction and this project's own logged Windows/Git-Bash timeout-kills-outer-wrapper-not-tsx-child lesson), output redirected to a log file, polled by tailing the log and checking its `mtime` rather than trusting a quiet interval as evidence of anything.

- **Wall clock:** ~2m24s (process launch ~17:28:08 EDT, doc write completion 17:30:31.4 EDT / `measuredAt` 2026-08-31T21:30:31.398Z UTC).
- **Corpus replayed:** 98,598 matches across 5 threaded seasons (2022 full 18,012; 2023 full 20,194; 2024 full 22,099; 2025 full 23,792; 2026 truncated to 14,501 immediately after `2026sccmp`'s last qual match).
- Every one of the 5 target events' boundary count (3 each, 15 total) matched its job count — no silent misses.
- `excludedMatchCount` was 0 in every job (no match anywhere lacked either RP pmf) and `incompleteBaselineTeamCount` was 0 (no team's already-earned-RP baseline was built from a `null` actual RP) — so this run's own limitations sections about exclusion/incompleteness describe a real capability that happened not to fire, not an untested path.

## Doc <-> parsed-object spot-check (required by acceptance criteria)

```
verdict: narrower measurementCount: 15 events.length: 5
spot-check 2022tuis3 start=0 narrowingPercent: 44.18053864411849 (doc table: 44.18%)
spot-check 2025cur start=42 storedMeanBandWidth: 9.965548500552476 (doc table: 9.9655)
spot-check headline.meanNarrowingPercent: 10.848394210456348 (doc: 10.85%)
```
All three spot-checked cells match the parsed `json rewind-gap` block exactly. The temporary verification script was created, run, and deleted (not committed).

## Grep gates (printed counts, not summarized)

| Gate | Result |
|---|---|
| `rankSimulation.js` referenced | 1 |
| `simQuantile.js` referenced | 1 |
| Local `function (simulateRanks\|drawCategorical\|mulberry32\|continuousQuantile)` over code lines | 0 |
| Credential markers (`process.env`, `r2Client`, `tbaClient`, `.env`, `TBA_API_KEY`, `R2_`) over code lines | 0 |
| `openCorpusReadOnly` referenced | 2 |
| `openCorpus(` (read-write) over code lines | 0 |
| `applyPromotedOverrides` referenced | 3 |
| `includeOffseason: true` referenced | 2 |
| `measure:rewind-gap` in package.json | 1, no `--env-file` |
| `git diff package.json pnpm-lock.yaml` after Task 1 | empty |
| `git diff pnpm-lock.yaml` after Task 2/3 | empty |
| `rewindGap.ts` zero import statements | 0 `from '...'` over code lines |
| `REWIND_GAP_VERDICT` present in `rewindGap.ts` | 3 |
| `measured}` / `TODO` / `TBD` in doc or constants file | none |
| `±` in doc or constants file | 0, 0 |

`pnpm typecheck` (repo root) exits 0. `pnpm --filter web typecheck` exits 0. `apps/web/src/lib/simQuantile.ts` resolved across the `apps/web` boundary from the `tsx`-run script with **no relocation needed** — 08-04's flagged assumption 2 is confirmed working, not just assumed.

## Full-repo verification

```
npx vitest run
Test Files  1 failed | 136 passed (137)
     Tests  2 failed | 2364 passed | 1 skipped (2367)
```
The 2 failures are exactly this phase's known-baseline accepted `payloadBudget.test.ts` overrides (WINDOWS.md ledger #11 `teams/{year}` and ledger #15 team page) — zero new failures introduced by this plan.

## Task Commits

1. **Task 1: The corpus-free core — every pure helper, test-first** — `8ee7e6fe` (test)
2. **Task 2: The measurement driver — one threaded season pass, boundary snapshots, three simulations per job** — `6040cc80` (feat)
3. **Task 3: Run it for real, write the doc, land the guarded constant** — `b6c6290e` (docs)

## Files Created/Modified

- `scripts/measureRewindGap.ts` — the control script: pure helpers (Task 1), the driver (Task 2), the CLI/entry point (Task 2)
- `scripts/measureRewindGap.test.ts` — 33 tests: 30 behavior-block pure-helper cases (31 `it()` blocks, Test 3 split into 3a/3b) + 2 doc-to-constant sync guard cases
- `docs/models/rewind-overconfidence-gap.md` — the committed measurement document
- `apps/web/src/lib/rewindGap.ts` — the five mirrored constants, zero imports
- `package.json` — one added line, `measure:rewind-gap`, no `--env-file` flag

## Decisions Made

See `key-decisions` in frontmatter: (1) `buildSeasonStream` used directly instead of a local wrapper, to keep the literal `includeOffseason: true` traceable and avoid duplicating stream-ordering logic — caught during Task 2's own gate self-check before commit, not a deviation from a green state. (2) Both non-vacuity guards (unfired-boundary, doc-sync) were proven by injecting and reverting a real failure, never trusted on inspection. (3) The measured effect's shape (concentrated early, shrinking/reversing late) is recorded explicitly rather than flattened into the single headline mean. (4) The sidecar-checkpoint section is written as a recommendation, explicitly not a decision, per the plan's own instruction.

## Deviations from Plan

None requiring a Rule 1/2/3 fix. One in-flight correction, caught and fixed before any commit: Task 2's first draft used a local `selectMatchesChronological(db, { year, excludeOffseason: false })` wrapper instead of the imported `buildSeasonStream(db, season, { includeOffseason: true })`; both are semantically identical (`buildSeasonStream`'s own body is exactly that call), but the local wrapper failed the acceptance criteria's literal `grep -c 'includeOffseason: true'` gate and duplicated ordering logic the plan explicitly wanted reused. Replaced with the real import; smoke-run output was verified byte-identical before and after the swap.

---

**Total deviations:** 0 auto-fixed; 1 in-flight self-correction (not shipped in any commit).
**Impact on plan:** None on scope or correctness — all `must_haves.truths`, prohibitions, and the full `<verification>` block are satisfied as written.

## Issues Encountered

None. The run completed on its first attempt (no crash, no re-run) — this plan's own prohibition against re-running "in search of a different answer" was never tested because no re-run was needed.

## Known Stubs

None. Every artifact this plan promised (`scripts/measureRewindGap.ts`, its test suite, the doc, the mirrored constants, the `package.json` entry) is complete and non-placeholder.

## Threat Flags

None beyond this plan's own `<threat_model>` register (T-08-08-01 through T-08-08-08), all of which were mitigated as designed: the block is written only by `--write-doc`, the sync test caught a real perturbation, no credential was ever in scope (verified by grep, not just by intent), and the corpus was opened read-only throughout (`openCorpusReadOnly` only, `openCorpus(` absent).

## User Setup Required

None — no external service configuration required. No network request was made, no R2 object was read or written, no publish command was run, and no credential was in scope at any point during this plan's execution.

## Next Phase Readiness

- **08-11 is unblocked.** Its Simulation-tab rewind-honesty caption can `import { REWIND_GAP_PERCENT, REWIND_GAP_VERDICT } from "apps/web/src/lib/rewindGap.js"` and render a real measured figure with a real direction — never a `{measured}` placeholder. The verdict is `narrower`, so a caption using that word is earned by this measurement, not asserted ahead of it. 08-11's caption should still branch on `REWIND_GAP_VERDICT` rather than hard-coding "narrower," per this file's own header comment, since a future re-measurement could land differently.
- **08-CONTEXT's deferred sidecar-checkpoint idea has the evidence it was waiting for.** `docs/models/rewind-overconfidence-gap.md`'s "Does this trigger the sidecar-checkpoint phase?" section is the recorded trigger output D-02 required, ready for a future `/gsd-discuss-phase` to pick up.
- No published byte was touched, no artifact contract changed, and no republish was authorized or run by this plan — the next plan that needs a republish starts from exactly the same published state 08-05 left it in.

## Self-Check: PASSED

All 5 files confirmed present on disk with the expected changes (`scripts/measureRewindGap.ts`, `scripts/measureRewindGap.test.ts`, `docs/models/rewind-overconfidence-gap.md`, `apps/web/src/lib/rewindGap.ts`, `package.json`); all 3 task commits (`8ee7e6fe`, `6040cc80`, `b6c6290e`) confirmed in `git log --oneline`.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
