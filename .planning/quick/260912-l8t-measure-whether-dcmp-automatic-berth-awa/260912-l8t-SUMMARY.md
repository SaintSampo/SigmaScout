---
id: 260912-l8t
slug: measure-whether-dcmp-automatic-berth-awa
kind: quick
status: complete
completed: 2026-09-12
subsystem: scripts
key-files:
  modified:
    - scripts/measureAwardPredictability.ts
    - scripts/measureAwardPredictability.test.ts
decisions:
  - "THE FEARED FAILURE MODE DID NOT MATERIALIZE. The worry was that the model predicts only DCMP awards going to already-qualified powerhouses and is useless on the ~50% that decide a berth. OUTSIDE is predictable, and it is also the LARGER stratum (52/61/78 vs 49/30/7), so it is not a thin corner of the data."
  - "Rookie All Star is the most predictable berth award by a distance: most-decorated-rookie-present takes the winner outright 62.8% of the time (49 of 78) and has them in its top 3 83.3% (65 of 78), against a random 3.8% / 11.2%."
  - "Impact on the OUTSIDE stratum: most-decorated-present gets 46.2% top-1 (24 of 52) and 67.3% top-3 (35 of 52) against a random 9.0% / 23.8%."
  - "Engineering Inspiration is the weak one and should not be carried by the other two: 21.3% top-3 against an 11.7% random on n=61, with the model and B1 tied at exactly 21.3%."
  - "THE CHAIN'S CENTRAL FINDING HELD A FOURTH TIME: the fitted model LOSES to the plain ordering on the stratum that matters. Impact -7.7pp on both R@1 and R@3; Rookie All Star -21.8pp R@1 and -12.8pp R@3 against RB1. The shippable capability is a sort, not a fit."
  - "Train wide, score narrow. Narrowing happens only at accumulation - input.instances, buildPriorHistory, trainPool, both fits and isThinPrior are untouched, guarded by a test that the fitted weights are bit-identical to the default run. DCMP-only training would have collapsed into the 30-instance thin-prior fallback and measured the fallback."
  - "The default output is byte-identical (md5 be54ed5ad41bc1f3edb909ef65690391) with no flag passed, re-verified after both commits. The DCMP block is gated behind --dcmp."
  - "The points cut is an APPROXIMATION and is labelled one in the output: automatic qualifiers consume Worlds slots, so the true cut sits higher and every OUTSIDE share here is CONSERVATIVE."
owed:
  - "Calibration on the DCMP strata was NOT measured. The existing calibration verdict (NEEDS RECALIBRATION, overconfident on all five flagship types) was measured on the full instance set, not on these ~50-80 instance strata. Do not assume it transfers in either direction."
  - "The winning orderings (B1, RB1) are SORTS and emit no probability at all, so they cannot state a berth likelihood to a user without a calibration layer built on top of them."
  - "A Worlds lock-probability surface is NOT authorized by this task. This measures whether the berths are predictable; it does not build, publish, or design anything."
  - "T3's planned script-printed DCMP BERTH ANSWER synthesis block was deliberately NOT added - the per-stratum READING blocks already print a pre-committed verdict per award type per stratum, and a second synthesis layer would restate them. Called out rather than silently dropped."
  - "Nothing published. No artifact, no R2 object, no corpus write, no network call."
---

# Are the Worlds berths that awards decide actually predictable?

**Yes — and by a one-line sort, not by the model.**

At a District Championship, Impact (0), Engineering Inspiration (9) and Rookie All Star
(10) carry **automatic Worlds berths**: the award *is* the qualification. 519 such awards
over 109 district-seasons, and **50.1% went to a team below the district points cut** —
for those, the award was the entire reason that team reached Worlds. That is ~9.3% of all
district Worlds berths, 11-14% in recent seasons.

The open question was whether those specific berths are predictable, or whether the model
only calls the awards that go to teams already safely qualified. **It is the former.**

## The answer, OUTSIDE stratum only (the award decided the berth)

| award | n | pool | best ordering | top-1 | top-3 | random top-3 |
|---|---|---|---|---|---|---|
| **10 Rookie All Star** | 78 | ~41 | RB1 most-decorated-rookie | **62.8%** (49/78) | **83.3%** (65/78) | 11.2% |
| **0 Impact** | 52 | ~40 | B1 most-decorated | **46.2%** (24/52) | **67.3%** (35/52) | 23.8% |
| **9 Eng. Inspiration** | 61 | ~45 | B1 / model (tied) | 11.5% (7/61) | 21.3% (13/61) | 11.7% |

Rookie All Star is the standout: **a sort over prior rookie decoration names the
berth-winning team outright 62.8% of the time**, and has it in a top-3 of ~41 teams 83.3%
of the time. Impact's B1 ordering also reaches 86.5% at top-5 and 98.1% at top-10 in
absolute terms (its *comparison* to the model at those k has no measured band and is
printed `CANNOT BE SCORED`, but the absolute figure against a 28.5% random is not in
doubt).

Engineering Inspiration is the weak case and must not be carried by the other two: 21.3%
top-3 against an 11.7% random, with the model and B1 tied to the decimal.

## The model lost again, on the stratum that matters

Fourth measurement in this chain, same result:

- **Impact OUTSIDE:** model 38.5% vs B1 46.2% at top-1 (−7.7pp), 59.6% vs 67.3% at top-3
  (−7.7pp). Both outside the 3.8pp stratum band. **WORSE.**
- **Rookie All Star OUTSIDE:** model 41.0% vs RB1 62.8% at top-1 (−21.8pp), 70.5% vs 83.3%
  at top-3 (−12.8pp). Both outside the 2.6pp band. **WORSE.**
- **Engineering Inspiration OUTSIDE:** −1.6pp / +0.0pp. **NO DIFFERENCE.**

So the capability worth having on berth-deciding awards is "the most decorated team in the
room" and "the most decorated rookie in the room" — sorts, not fits. Which also means the
best available predictor here **emits no probability at all**.

## One honest wrinkle

On Impact, the INSIDE stratum scores *higher* at top-3 (71.4%) than OUTSIDE (59.6%) — a
real gap, and directionally the concern that motivated the stratification. But both sit
far above random, so it does not reach "we can only predict the ones that don't matter".
The concern was legitimate and the data did not bear it out.

## How the narrowing was done

**Train wide, score narrow.** DCMP instances are thin (~100 per award type across 9 scored
seasons, split two ways), so restricting *training* to DCMP would have collapsed into the
30-instance thin-prior fallback and measured the fallback rather than the model. Narrowing
happens only at accumulation: `input.instances`, `buildPriorHistory`, `trainPool`, both
fits and `isThinPrior` are untouched, guarded by a test asserting the fitted weights are
**bit-identical** to the default run.

Small-n honesty: `RANK_NOISE_BANDS` measured *optimizer* variance over 1,100-1,500
instances per type, where one instance is a rounding error. At n≈52 one instance is
1.92pp, so the DCMP block scores on `max(measured band, 2 instances)` — wider, never
narrower. A null band stays null; a floor is not a band.

## Two traps caught

**The silent join.** `events.district_key` holds the bare abbreviation (`'chs'`);
`districts.district_key` is year-prefixed (`'2024chs'`). Joining those columns directly
matches **nothing and returns an empty result with no error** — a confident, wrong "no
data" answer. It cost one debug cycle before this task started. The loader now throws
below 100 joined DCMP events and names the trap in the message; 174 of 174 join.

**Two denominators, and the plan's control was written against the wrong one.** The plan
asserted ~519 and 45-55% OUTSIDE. But instances merge by `(event, award_type)` — Michigan
awards Impact to five teams under one event key — so 519 recipients become 301 instances
at 1.72 recipients each, and under the any-recipient rule the instance-level OUTSIDE share
is mechanically **68.4%**, not ~50%. A correct implementation *fails the plan's literal
check*. The assertion now runs on the recipient denominator the 519 / 49.9% figures were
measured on, with both counts and the arithmetic printed.

Also: `DCMP-ALL = OUTSIDE + INSIDE + UNKNOWN` cannot be exact for B0, which accumulates a
probability rather than a count — three stratum cells versus one pooled cell differ in the
last bit of IEEE-754 addition (~3e-15), which printed `STRUCTURAL INVARIANT BROKEN` on a
correct implementation. B0 now compares within 1e-9; every integer hit count still
compares exactly.

## Verification

- Repo-root `npx vitest run`: **266 files / 5753 passed / 4 skipped** (baseline 5685, +34
  T1, +34 T2 — exactly).
- Default-output diff vs the pre-edit baseline: **empty**, md5 identical, re-checked after
  both commits. The recall@1-equals-accuracy identity holds on all 156 pooled predictor
  rows and was re-asserted inside each stratum cell.
- `tsc --noEmit -p apps/web/tsconfig.json`: clean at both commit points.
- Root `tsc --noEmit`: clean for the two files this task touched. **7 pre-existing errors
  exist in other files** (`packages/harness/publish.ts`, `publish.test.ts`,
  `selectionProvenance.test.ts`, `scripts/replayRig.ts`, `replayRig.test.ts`,
  `deleteOrphanedDemoTeamObjects.test.ts`) from a **concurrent session's in-flight
  `260912-ivg` bpr→spr rename**. Not caused here, not fixed here, reported as found.

| commit | what |
|---|---|
| `e0184246` | T1 — the district points cut, and the stratum every DCMP award belongs to |
| `304cbc47` | T2 — score narrow, train wide, and report both DCMP strata |

## Out of scope, and stayed out

`packages/harness/publish.ts`, `publish.test.ts`, `packages/core/districts/*`,
`event_awards`, `normalizeEventAwards` and `QUALIFICATION_RELEVANT_AWARD_TYPES` were never
opened or staged. No ingest, no corpus write, no network, no publish, no R2, no deploy. No
site surface: nothing renders a berth probability.
