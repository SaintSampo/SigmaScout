# The Swing-Factor cold-start chain gates RP pmfs — measured, confirmed, uniform

**Source:** 2026-09-10 investigation (session following the 2f1a8885 republish);
sim/swing rethink input Jacob requested when halting point-fixes 2026-09-09.

## The measurement

At `2024casf` (72 played qualification matches), exactly **57/72** rows carry
`redRpPmf`/`blueRpPmf` — identically for opr, epa, and bpr, because the gate
lives in the shared SigmaScout layer, not in any algorithm. The 15 pmf-less
rows are exactly **qm1–qm15**: every match until all six robots on the field
have played twice (min prior observations: 0 for qm1–8, 1 for qm9–15; qm16 is
the first match whose whole roster is on its third appearance). A corpus
walk-forward replay of the gating condition reproduces the artifact **72/72
rows, zero mismatches**.

An earlier claim (this session's first draft, and the pre-correction
publish-budget entry) that opr/epa had full 72/72 coverage was wrong — it
misread the old verify:subset either-field count, which included 15 degenerate
length-1 ELIMINATION pmf pairs. Corrected in fccb9483.

## The confirmed chain (code citations)

1. `packages/harness/sigmaScoutLayer.ts:197–199` — `#rpFieldsFor` returns `{}`
   (no pmf) when either alliance's band variance is `undefined`.
2. `packages/harness/swingFactor.ts:380–389` — `bandVarianceFor` is
   **all-or-nothing**: `undefined` if ANY of the 6 rostered teams lacks a
   Swing Factor.
3. `packages/harness/swingFactor.ts:225–230` — a Swing Factor needs **≥2
   folded observations** (the effective-sample denominator is exactly 0 after
   one observation). Season-wide accumulator, deliberately not reset between
   events.

**What is NOT involved:** the RP layer's own machinery is already
cold-start-tolerant. `RpMomentsAccumulator.momentsFor`
(`packages/core/rankingPoints/empiricalMoments.ts:138–194`) returns an honest
zero-history estimate rather than gating, and `rpPmfForMatch` needs only a
score mean and variance per alliance. The single missing input for a cold
roster is a score variance.

## Blast radius — one gate, three surfaces

The same `swingByTeam` map gates:
- **played-row pmfs** (the 57/72 above),
- **upcoming-row pmfs** (`enrichUpcoming`, sigmaScoutLayer.ts:168–182),
- **the presim sidecar, wholesale** (`makeRankingPointFiller`,
  packages/harness/publish.ts:692: ONE team without a Swing Score ⇒ no sidecar
  for the ENTIRE event ⇒ the Simulation tab is dark for that event).

This is the "5 further qualification matches carry no predicted ranking-point
distribution" message from 2026-09-09, now with its exact mechanism.

## Shape of a fix (for the rethink, not prescribed here)

A fix must change where a cold team's score variance comes from, not the RP
layer: a deliberately-WIDE fallback prior for sub-two-observation teams (season-
or event-level prior Swing Factor that a team's own observations replace), or
an explicitly-labeled fallback variance accepted by `#rpFieldsFor`. Fixing the
one input heals all three surfaces at once. The constraint to respect: the
all-or-nothing band rule exists because a partial variance produced 7–10σ
misses (sketch 003, swingFactor.ts:283–286) — a fallback must be wide by
design, not merely present.

---

## CONTRADICTED LIVE 2026-09-12 — presim is not gated by the cold-start chain

Measured against production after the Phase 9 republish (generation `b23d214d`): `v1/presim/2026mrcmp/`
returns **200 for all three published algorithm ids** (`opr@4.0.0`, `epa@10.0.0`, `bpr@3.0.0`), and
the run emitted **641 sidecars across all three** (213/214/214). Plan 09-10 expected 404s on
`opr`/`epa` on exactly the reasoning in this todo, and **no skip anywhere in the publish log cites a
cold-start gate.**

So whatever the cold-start chain gates, it is **not** presim sidecar production. This todo's
measurement needs re-deriving against current code before it is relied on — it may have been true
when written and been changed since, or the inference may not have held.

Separately confirmed as pre-existing and unrelated: offseason events (e.g. `2024auwarp`) carry
qualification matches but no RP pmfs. That is the self-reported-breakdown D-05 fallback, not a
cold-start effect — `2024mil` shows 125/125 qm rows with both pmfs and the full decomposition.
