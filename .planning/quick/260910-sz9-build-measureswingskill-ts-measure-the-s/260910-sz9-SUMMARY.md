---
id: 260910-sz9
slug: build-measureswingskill-ts-measure-the-s
description: "Build scripts/measureSwingSkill.ts — the missing evaluation harness for the shipped Swing Factor estimator (audit finding F1 / recommendation R1)"
created: 2026-09-10
completed: 2026-09-10
status: complete
---

# Quick task 260910-sz9 — `measureSwingSkill.ts`

Closes audit finding **F1** and recommendation **R1** from
`.planning/todos/pending/swing-score-audit.md`.

## What shipped

| File | Change |
|---|---|
| `scripts/measureSwingSkill.ts` | new — 640-line walk-forward skill harness |
| `scripts/measureSwingSkill.test.ts` | new — 42 unit tests over the pure statistics |
| `package.json` | `"measure:swing-skill": "tsx scripts/measureSwingSkill.ts"` |
| `.planning/todos/pending/swing-score-audit.md` | F1 marked closed; new §3.1 with measured results; R1 marked done with its effect on R2/R3/R5 |

**No production code changed.** The harness measures the shipped estimator; it does not alter it.

## Verification

- `npx vitest run scripts/measureSwingSkill.test.ts` — **42/42 passing** (invoked directly, never via
  `timeout … pnpm`, per the known false-green trap).
- `npx tsc --noEmit` clean.
- End-to-end run against the real corpus: 297,854 team-match observations from 53,309 matches across
  three algorithms and three seasons, exit 0.
- **Pairing control |r| ≤ 0.027 in every block**, far below every headline — the walk-forward pairing
  is sound.

## The measured answer

Spearman correlation, Swing as of matches 1..N−1 against actual |centred deviation| at N:

| algorithm | 2024 | 2025 | 2026 | pooled |
|---|---|---|---|---|
| opr | 0.135 | 0.134 | 0.236 | 0.193 |
| epa | 0.066 | 0.066 | 0.204 | 0.115 |
| bpr | 0.067 | 0.056 | 0.230 | 0.118 |

**Against the `r ≈ 0.59` ceiling everyone quotes, the shipped estimator achieves 0.06–0.24.**

Three further results, all in §3.1 of the audit doc:

1. **Calibration is a textbook no-shrinkage failure** — the swing/realized-spread ratio climbs
   monotonically 0.80 → 1.94 across deciles. Low-swing teams under-estimated, high-swing
   over-estimated.
2. **It does not beat a population constant** on median NLL for EPA (−0.015) or BPR (−0.006). Only
   OPR earns its per-team complexity (+0.645).
3. **A near-zero-swing tail of 0.06–0.35% of rows carries 83–100% of the total NLL.** Two
   near-identical deviations publish a confident `±0.4` that the next match misses by 40 points.

All three point at R2 (shrinkage toward the rating-local prior, which `swingMetric.ts` already
computes and currently uses only for the percentile).

Coverage: 88–91% against the 68.3% a "1σ" label implies; the scale that would deliver 68.3% is
0.889 / 1.026 / 1.101 against a shipped 1.92. This is the *per-team* reading, a different quantity
from the alliance-band figures in `SWING_FACTOR_SCALE`'s header — the script prints that warning
itself so the two cannot be conflated from its output.

## Four defects found in the harness while building it, and fixed

Recorded because each produced a plausible-looking number, which is the failure mode the audit is
about. All four are documented in-file at the site of the fix.

1. **Raw cross-season pooling inflated the headline correlation by ~4x.** BPR's per-season figures are
   0.079 / 0.073 / 0.264 but the naive pooled figure was **0.517** — and the mismatched-pairing control
   rose to 0.315 in lockstep, which is how the inflation announced itself. Seasons have different score
   scales, so both axes shared a per-season factor that a correlation read as skill. Fixed with
   `standardizeWithinGroups`; for a single season it is an affine transform, so per-season numbers are
   unchanged by it. **This is why the control exists, and it earned its place on the first run.**
2. **The first pairing control was invalid.** "Swing should not correlate with signed deviation" reads
   −0.145 — not because the pairing was broken but because each algorithm's bias is a *function of
   swing level* (BPR +2.48 → −4.12 across deciles). Replaced with the deterministic mismatched-pairing
   control, and the bias gradient promoted to a permanent column since it is a real finding about the
   algorithms.
3. **The standardization refactor silently broke coverage**, comparing deviations in points against
   z-scores and turning 88% into 0.25%. Caught by the number being absurd rather than by any test.
4. **The hindsight reference was mislabelled an upper bound.** It measurably loses to the walk-forward
   baseline for EPA and BPR, because the baseline's sigma adapts across the season while the reference
   is one constant per team — neither model class contains the other. Relabelled, with the "fraction of
   gap closed" line now suppressed when the gap is negative (it was printing readings like −97.4% and
   237.5%).

## Deliberately out of scope

R2 (shrinkage), R3 (variance solve), R4 (labels) and R5 (per-algorithm scale) are untouched. The
harness now exists to judge them, which was the whole point of doing R1 first.
