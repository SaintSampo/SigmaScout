---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 06
subsystem: api
tags: [ranking-points, attribution, measurement, decision-gate, collapse]

# Dependency graph
requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-01 frozen baseline and scorer infrastructure; 09-05 RpLayerConfig branches and tally"
provides:
  - "D-09 bar committed before measurement; full attribution record; decision gate; single RP model"
affects: [09-07, 09-08, 09-09, 09-10]

# Actuals
actuals:
  tokens: 0
  tasks: 4
  commits: 0

tech-stack:
  added: []
  patterns:
    - "D-09 bar committed BEFORE measurement code, proved by git criteria"
    - "One scorer, one process, one commit per season; D-11 executed structurally"
    - "Per-bonus equality gate on collapse: figures === equal pre and post"

key-files:
  created:
    - data/baselines/rp-attribution-2026-09.json
    - docs/models/rp-attribution.md
    - data/baselines/rp-calibration-2026-09b.json
  modified:
    - scripts/measureRpCalibration.ts
    - scripts/measureRpCalibration.test.ts
    - packages/core/rankingPoints/analyticPmf.ts
    - packages/core/rankingPoints/analyticPmf.test.ts
    - packages/core/rankingPoints/marginals.ts
    - packages/core/rankingPoints/constants.ts
    - packages/core/rankingPoints/rules.test.ts
    - packages/core/rankingPoints/{2016..2026}.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/publish.ts
    - package.json
    - apps/web/src/components/compare/RpCalibrationSection.tsx

duration: IN PROGRESS
completed: 2026-09-11
status: executing
---

# Phase 9 Plan 6: RP Attribution Measurement and Collapse

**EXECUTION IN PROGRESS**

Measures three RP layer config branches through published scorer, takes per-bonus decision gate, collapses config surface to single hardcoded path.

## Baseline (Pre-Execution)

- Worktrees disabled: `use_worktrees: false`
- Corpus: `data/corpus.sqlite` 556M (2026-09-09)
- Upstream: 09-01 frozen baseline, 09-05 three branches landed
- RpLayerConfig default: `{winSource:"score-draw", tieModel:"continuous-equality", marginal:"gaussian"}`
- Baseline suite: 255 files, 4965 tests pass, 6 skip

## Execution Progress

### Task 1: D-09 Bar (TRACER, TDD)
Status: In progress

Implement `evaluateD09Bar` and `decideRpShipConfig` with full synthetic test coverage.
Bar frozen BEFORE measurement code.

Commit: (pending)

### Task 2: Full Attribution Measurement
Status: Awaiting Task 1

Measure all 8 arms x 10 seasons x 3 algorithms through corpus.
Emit record and narrative document.

Commit: (pending)

### Task 3: Decision Gate (Checkpoint:Decision)
Status: Awaiting Task 2

Developer chooses per-field: ship or revert for each of three changes.
Pre-authorized per 09-CONTEXT.md.

Decision: (pending)

### Task 4: Config Collapse (Auto, TDD)
Status: Awaiting Task 3

Delete losing branches, remove RpLayerConfig, re-emit calibration.
Four commits: surface removal, field collapse, re-emission + equality gate, documents.

Commits: (pending)

## Recorded Skips

- Spec-less probe: Phase 9 post-v1.0, no SPEC.md, using D/F keys instead of REQ-*
- Package Legitimacy Gate: No packages installed, `pnpm-lock.yaml` unchanged
- Secrets: No `.env` read or printed anywhere

---

*Execution started 2026-09-11 from main branch*
