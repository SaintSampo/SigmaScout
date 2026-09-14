---
phase: 260913-tw1-f4-f10-of-ranking-points-audit-bonus-gap
plan: 01
subsystem: ranking-points / measurement / bonus-dot display
tags: [rp, f4, f10, calibration, attribution, walk-forward, sketch]
provides: [docs/models/rp-bonus-gap-attribution.md, F4 decision, sketch 012, F10 decision]
affects: [.planning/todos/pending/ranking-points-audit.md (F4 and F10 only), .planning/sketches/MANIFEST.md]
key-files:
  created:
    - docs/models/rp-bonus-gap-attribution.md
    - .planning/sketches/012-predicted-bonus-dots/ (README, index.html, data.js, previews)
    - experiments/260913-tw1/bonusGapAttribution.ts (gitignored)
  modified:
    - .planning/todos/pending/ranking-points-audit.md
    - .planning/sketches/MANIFEST.md
decisions:
  - "F4: the integer shape of the threshold variables dominates the multi-variable bonus gap (70.9% closed, Brier -0.0928). Independence explains none of it (-1.0%, Brier +0.0006). Jacob chose lattice marginals plus a walk-forward mean shift, as two inert knobs."
  - "F10: sketch 012 variant C, predicted bonus dots fill to the odds (Jacob first picked B, then changed to C). Not built; ship with or after the F4 fix."
metrics: {completed: 2026-09-14, tasks: 4, commits: 4}
status: complete
---

# Quick task 260913-tw1: F4 bonus-gap attribution and F10 bonus-dot sketch

## F4: why multi-variable bonuses under-predict

The walk-forward probe covers 2016-2020 and 2022, running SPR through `SigmaScoutLayer` built the way
the publisher builds it. It never read 2023 or later. Its baseline reproduces the published bonus
probabilities exactly: 0 mismatches at 1e-9 over 267,324 observations, and all 11 `-09c` cells
identical. Each suspect was removed on its own:

| Suspect removed | Multi-variable gap closed | Brier delta | Single-variable controls |
|---|---:|---:|---:|
| Independence (walk-forward residual correlation) | -1.0% | +0.0006 | 0% |
| Gate/selector oracle (coop analogue) | -2.1% | -0.0082 | 0% |
| Integer shape (bounded lattice marginals) | **70.9%** | **-0.0928** | 35.2% |
| Mean deficit (fully-warm rosters) | 16.1% | -0.0198 | 26.9% |

This contradicts the audit's framing. The within-bonus correlations have mixed signs, so putting
them back cancels out. Coopertition does not exist before 2023, so it was not measured; the gated
2018 and 2022 bonuses stood in for it.

**Decision (Jacob):** build lattice marginals, with ranges declared from the game rules, and the
walk-forward mean shift as two separate knobs. Each starts inert and must earn promotion on 2016-2022.
Build after the F6/F7 session's `marginals.ts`/`analyticPmf.ts` changes land. Check 2017 `rotor`'s
overshoot first.

## F10: how predicted bonus dots should render

A dump mode added to the probe (`TW1_DUMP=1`) produced real per-alliance odds, today's and post-fix,
for sketch 012. The sketch compared four designs on 2016necmp and 2022chcmp. Post-fix, up to 45% of
alliances are true toss-ups, earned 52-59% of the time, and the ⅓/⅔ bands come out ordered and roughly
calibrated. The shipped 30% tint turned out too faint at 14px to carry three states, so "likely" gets
full ink.

**Decision (Jacob):** variant C, fill to the odds. He first picked B, then changed to C. Not built. Its build
needs a stronger fill tint than today's 30%, because at 14px 40% and 60% look alike.

## Commits

- `2c4e5ec8` attribution doc and F4 audit section
- `6e26c03c` F4 fix decision
- sketch 012 commit, plus the decision and summary commit that follows this file

## Deviations and notes

- The executor built the probe's beta-binomial from exact rising-factorial products, because Lanczos
  failed the 1e-12 selftest.
- The -09c file is found by a suffix regex.
- The per-season provenance check tripped during the F10 dump runs, because another session edited
  `packages/ingest/schemas.ts` mid-run. Every per-cell figure still matched the committed record
  exactly, and the committed season JSONs were restored from backup.
- `experiments/` is gitignored, so the probe and its dumps are not in git. The doc carries the
  reproduce commands.
- No publish, no network, and no edits to `packages/`, the Compare files or `measureRpCalibration.ts`.
