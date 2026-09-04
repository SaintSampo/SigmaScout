---
phase: quick-260904-4aa
plan: 01
subsystem: prediction-models
tags: [epa, statbotics, evaluation-harness, zod, tolerance-baseline]

requires:
  - phase: 02-prediction-models-epa-sigma1
    provides: "epa.ts reimplementation, componentMapForSeason, demoTeams.ts"
provides:
  - "Re-runnable, committed per-team EPA-vs-Statbotics comparison (SC-2)"
  - "Corrected Statbotics year-level accuracy/Brier schema and fallback constants"
affects: [epa, statbotics-integration, evaluation-harness, project-status-docs]

actuals:
  tokens: 26500
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Pure statistics module (epaStatboticsCompare.ts) separated from the impure fetch+replay driver script, network-free and corpus-free, tested with hand-computed synthetic fixtures"
    - "Per-team tolerance-band baseline file (data/baselines/epa-vs-statbotics-2026-09.json) alongside the existing algorithm-fingerprint baseline family, explicitly distinguished from it in tests"

key-files:
  created:
    - scripts/epaVsStatbotics.ts
    - packages/harness/epaStatboticsCompare.ts
    - packages/harness/epaStatboticsCompare.test.ts
    - packages/harness/statbotics.test.ts
    - data/baselines/epa-vs-statbotics-2026-09.json
    - docs/models/epa-vs-statbotics.md
    - .planning/todos/pending/update-project-md-sc2-blocked-claim.md
  modified:
    - packages/harness/statbotics.ts
    - packages/core/algorithms/epa.ts
    - docs/models/epa-divergences.md
    - packages/harness/artifact.test.ts
    - packages/harness/baselineFingerprint.test.ts
    - package.json

key-decisions:
  - "Statbotics' /v3/year/{season} schema was silently broken independent of the endpoint's own 500s: it parsed a retired top-level epa_acc field, so every statboticsReference call fell back unconditionally even once the API came back. Fixed by repointing at metrics.win_prob.season.{acc,mse}."
  - "Tolerance baseline gates on the min-matches(>=12)-filtered arm, not the all-teams arm, since low-match teams are noisy on both sides and would dominate mean absolute difference."
  - "Offseason-inclusive vs offseason-excluded comparability was measured empirically (both arms run for real) rather than assumed: the delta is large (Pearson 0.90-0.93 vs 0.99+), not negligible."
  - "PROJECT.md's stale 'SC-2 blocked' claim was flagged via a pending todo rather than edited directly — out of this plan's declared file scope, and retracting a published claim is the developer's call per the plan's own instruction."

requirements-completed: [SC-2]

coverage:
  - id: D1
    description: "fetchStatboticsTeamYears pages /v3/team_years, Zod-validates each row, throws on failure (no silent partial series)"
    verification:
      - kind: unit
        ref: "manual run: npx tsx scripts/epaVsStatbotics.ts (Task 1 tracer) — joined=3687, pearson=0.9071"
        status: pass
    human_judgment: false
  - id: D2
    description: "epaStatboticsCompare.ts pure statistics module (OLS slope, Pearson, mean abs diff, sample SD, joinTeams, compareSeason, checkAgainstTolerance, selectSpotCheckTeams)"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "packages/harness/epaStatboticsCompare.test.ts (14 tests, no network)"
        status: pass
    human_judgment: false
  - id: D3
    description: "scripts/epaVsStatbotics.ts CLI (--seasons/--min-matches/--no-offseason/--out/--check), full 5-season run + offseason-excluded comparability arm"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "npx tsx scripts/epaVsStatbotics.ts --check (exit 0 against committed baseline)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Statbotics year-level schema fix (metrics.win_prob.season.{acc,mse}) and corrected fallback constants, live-verified 2026-09-04"
    verification:
      - kind: unit
        ref: "packages/harness/statbotics.test.ts (9 tests, no network)"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/models/epa-vs-statbotics.md verdict document: per-season tables, named spot-check teams, comparability boundary, tolerance, one-sentence SC-2 verdict"
    requirement: SC-2
    verification: []
    human_judgment: true
    rationale: "Whether the documented verdict and tolerance framing are an honest, sufficient record of SC-2 is an editorial judgment a human should confirm, not something a test can certify."

duration: ~40min
completed: 2026-09-04
status: complete
---

# Quick Task 260904-4aa: EPA vs. Statbotics Verification Summary

**Closed SC-2 with a committed, re-runnable per-team comparison, and found the Statbotics API outage was never the whole story — a schema bug meant the year-level fallback constants were 6-9 accuracy points too low even after the endpoint came back.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3/3 completed
- **Files modified:** 13 (7 created, 6 modified)
- **Commits:** 4 (3 task commits + this docs commit)

## Accomplishments

- Closed SC-2 ("EPA runs walk-forward at any point in a season, and spot-checked teams land within
  a documented tolerance of published Statbotics numbers") — moved from
  blocked-on-external-dependency (recorded 2026-08-13/14) to measured-and-closed, with committed
  evidence rather than an un-re-runnable one-off script.
- `packages/harness/epaStatboticsCompare.ts`: a pure, network-free, corpus-free statistics module
  (OLS slope, Pearson, mean absolute difference, sample SD, `joinTeams`, `compareSeason`,
  `checkAgainstTolerance`, `selectSpotCheckTeams`), driven by 14 hand-computed synthetic-fixture
  tests.
- `scripts/epaVsStatbotics.ts`: fetches Statbotics team-years, replays `epa` across the requested
  season range on the established `WalkForwardSimulator`/`seasonBoundaryFor` shape, joins on
  `frc{team}` excluding demo keys, and gates the result against a committed baseline via `--check`.
- **Fixed a real, independent bug**: `StatboticsYearResponseSchema` parsed a top-level `epa_acc`
  field the live v3 endpoint has never returned in its current form — every `statboticsReference`
  call had been silently catching its own parse failure and returning the fallback constant
  unconditionally, meaning the Statbotics API coming back up on 2026-09-04 changed nothing on its
  own. Fixed to read `metrics.win_prob.season.{acc,mse}`.
- Corrected `STATBOTICS_REFERENCE_FALLBACK`: every value replaced with a live-fetched,
  individually-verified 2026-09-04 figure, 6-9 accuracy points higher than the retired
  0.70/0.71 estimates — making the target SigmaScout is measured against materially harder.
- Measured, rather than assumed, that offseason inclusion materially widens the gap from
  Statbotics' team-year EPA (Pearson 0.90-0.93 offseason-inclusive vs. 0.99+ offseason-excluded).
- `docs/models/epa-vs-statbotics.md`: the full verdict — per-season tables (both arms), all five
  seasons' named spot-check teams (top 15 + deterministic sample of 15, seed 20260904), the
  comparability boundary, the tolerance, and EPA's own honest standing against Statbotics'
  win-probability model (EPA trails in 4/5 seasons, wins Brier in 2026 only).

## Measured results (headline)

**Offseason-inclusive (production arm, 2022-2026), min-matches(≥12)-filtered:**

| Season | Joined | OLS slope | Pearson | Mean abs diff |
|--------|--------|-----------|---------|----------------|
| 2022 | 2,574 | 0.875 | 0.925 | 2.54 pts |
| 2023 | 2,796 | 0.845 | 0.911 | 3.47 pts |
| 2024 | 2,895 | 0.818 | 0.904 | 3.09 pts |
| 2025 | 3,051 | 0.861 | 0.898 | 5.87 pts |
| 2026 | 3,100 | 0.941 | 0.968 | 6.67 pts |

**Offseason-excluded comparability arm (2022-2025)** lands materially tighter: Pearson 0.99+,
slope 0.95-1.02, mean abs diff 0.9-3.1 pts — see the doc for the full side-by-side table.

**`--check` result: PASSED** — all 25 gated statistics (5 seasons × 5 statistics) fall inside the
committed baseline band (`data/baselines/epa-vs-statbotics-2026-09.json`).

**Statbotics fallback correction** (`STATBOTICS_REFERENCE_FALLBACK`, live-verified 2026-09-04):

| Season | Old estimate | New (verified) | Delta |
|--------|--------------|------------------|-------|
| 2022 | 0.70 | 0.7815 | +8.15 pts |
| 2023 | 0.70 | 0.7647 | +6.47 pts |
| 2024 | 0.71 | 0.7627 | +5.27 pts |
| 2025 | 0.71 | 0.7839 | +7.39 pts |
| 2026 | 0.71 | 0.7978 | +8.78 pts |

**EPA vs. Statbotics' own win-probability model** (offseason-inclusive combined slice):
Statbotics beats our EPA reimplementation on both accuracy and Brier in 2022-2025; our EPA wins on
Brier in 2026 (0.1430 vs. 0.1483) while trailing very slightly on accuracy. Reported honestly, in
both directions — EPA is the project's variance-free baseline, not the algorithm meant to beat
Statbotics (Sigma1 is).

## Task Commits

1. **Task 1: End-to-end "one season compared"** — `a238a5cd` (feat) — wired `fetchStatboticsTeamYears`
   and a hardcoded-2025 tracer script end to end; proved the join/statistics path with a real run
   (joined=3687, pearson=0.9071) before building on it.
2. **Task 2: Expand to every season, tested statistics, tolerance gate** — `f78e09d1` (feat) —
   `epaStatboticsCompare.ts`/`.test.ts`, the full CLI, both comparability arms run for real, and the
   committed baseline built from the measured min-matches arm.
3. **Task 3: Correct the year-level reference row, record the verdict** — `733bcc05` (fix) — schema
   fix, fallback correction, `statbotics.test.ts`, the verdict document, cross-references, and two
   Rule 1 fixes to pre-existing tests this change broke (see Deviations).

**Plan metadata:** this commit (docs: complete plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `artifact.test.ts`'s two `statboticsReference` fixtures encoded the retired, broken response shape as if it were live**
- **Found during:** Task 3, running `npx vitest run packages/harness/artifact.test.ts` after the schema fix.
- **Issue:** Two tests built mock `fetch` responses shaped `{ epa_acc: <number> }` — the exact shape the OLD (buggy) schema expected — and asserted a successful live-fetch parse against them. Once the schema was corrected to the real live shape, these fixtures correctly started failing to parse and falling back, breaking both tests' assertions (`ref.fetched === true`, `ref.value === <fixture number>`).
- **Fix:** Updated both fixtures to the live shape (`{ metrics: { win_prob: { season: { acc, mse } } } }`).
- **Files modified:** `packages/harness/artifact.test.ts`
- **Commit:** `733bcc05`

**2. [Rule 1 - Bug] `baselineFingerprint.test.ts` assumed every file in `data/baselines/` is a `BaselineFingerprintSchema`-shaped algorithm fingerprint**
- **Found during:** Task 3, after committing `data/baselines/epa-vs-statbotics-2026-09.json` (a plan-mandated artifact) and running the harness test suite.
- **Issue:** Three tests broke: a blanket `BaselineFingerprintSchema.parse()` scan over every `.json` file in the directory, a "retired-implementation" loop with the same blanket scan, and a hardcoded "exactly 5 files" count. The new SC-2 tolerance baseline is a genuinely different kind of file (per-team tolerance bands, not an algorithm-version Brier/accuracy fingerprint) sharing the directory only because it is this repo's general home for "a committed, re-runnable measurement's tolerance record."
- **Fix:** Added an `EPA_VS_STATBOTICS_BASELINE_FILE` exclusion constant (matching the existing pattern for three other named exceptions), excluded it from both scans, and updated the count assertion from 5 to 6.
- **Files modified:** `packages/harness/baselineFingerprint.test.ts`
- **Commit:** `733bcc05`

**3. [Rule 3 - Blocking] Statbotics API transient 503 mid-page during Task 1's tracer run**
- **Found during:** Task 1, first real run of `fetchStatboticsTeamYears` against 2025's ~3,690 rows.
- **Issue:** One page (offset 3000) returned HTTP 503; a manual re-request 5 seconds later succeeded, confirming a transient hiccup rather than a real outage.
- **Fix:** Added a page-level retry (3 attempts, 2s fixed delay) for non-2xx responses only — never retried on a schema-validation failure, since retrying cannot fix a shape mismatch. This matters more for Task 2's multi-season, multi-arm runs, where a single flaky page would otherwise cost an entire long replay.
- **Files modified:** `packages/harness/statbotics.ts`
- **Commit:** `a238a5cd`

### Flagged, not silently rewritten

Per the plan's explicit instruction ("If the corrected accuracy figures contradict a comparative
claim made anywhere in the repo ... do NOT quietly restate that claim to fit"):
`.planning/PROJECT.md`'s Success Metrics table still records SC-2's spot-check mitigation as
"blocked," which is now false. `PROJECT.md` was not in this plan's declared file scope, so it was
not edited — a pending todo was filed instead:
`.planning/todos/pending/update-project-md-sc2-blocked-claim.md`.

## Known Stubs

None. No stub patterns (hardcoded empty values reaching UI rendering, placeholder text, unwired
data sources) were introduced by this plan — it is a pipeline/measurement task with no UI surface.

## Self-Check: PASSED

- All 7 created files verified present on disk (`scripts/epaVsStatbotics.ts`,
  `packages/harness/epaStatboticsCompare.ts`, `.test.ts`, `packages/harness/statbotics.test.ts`,
  `data/baselines/epa-vs-statbotics-2026-09.json`, `docs/models/epa-vs-statbotics.md`,
  `.planning/todos/pending/update-project-md-sc2-blocked-claim.md`).
- All 3 task commit hashes (`a238a5cd`, `f78e09d1`, `733bcc05`) verified present in `git log`.
- `npx vitest run packages/harness/epaStatboticsCompare.test.ts packages/harness/statbotics.test.ts` — 23/23 passed, no network access.
- `npx vitest run packages/harness packages/core/algorithms/epa.test.ts` — 894/894 passed (full collateral-breakage check).
- `npx tsc --noEmit` — clean.
- `npx tsx scripts/epaVsStatbotics.ts --check` — exit 0, PASSED against the committed baseline.
