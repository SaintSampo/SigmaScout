---
id: rp-process-noise-own-scale
created: 2026-09-01
source: quick task 260901-trz Finding F3 — the dimensionally-correct alternative, deferred because it changes RP dynamics
resolves_phase:
priority: low
---

# Scale RP threshold-variable noise by each variable's OWN spread

## What changed, and what it left behind

Before `SIGMA1_CODE_VERSION` 4.0.0, `sigma1/rp/state.ts` read
`params.processNoiseWithinEvent` / `params.processNoiseEventBoundary` — the SCORE side's
parameters — for the RP threshold variables' Kalman step, and
`params.coldStartConsistencyVariance` for their cold-start belief.

D-T1 made all three of those **scale-relative to the alliance-SCORE variance**. Left as
they were, RP would have inherited that scaling — and RP threshold variables are **COUNTS**
(notes, links, cages, tower points) on roughly a 0–20 scale, not points. Multiplying a
count-scale variable's process noise by an alliance-score variance that reaches ~20,000 in
2026 would inject several hundred times the variable's own range as noise per match. That is
a category error, not a conservative choice.

So this task **split them off as three absolute fields** —
`rpProcessNoiseWithinEvent`, `rpProcessNoiseEventBoundary`, `rpColdStartVariance` — each
defaulted to exactly the absolute constant RP read before 4.0.0. That is what keeps RP's
Kalman step **bitwise unchanged** across the reparameterization, which D-T1's own
verification bar requires.

## The deferred alternative

Pinning them absolute is *dimensionally safe* but not *dimensionally principled*: an RP
threshold variable's plausible process noise should scale with **that variable's own
spread**, not be a fixed constant across seasons whose game pieces and scoring thresholds
change completely. `rp/state.ts` already maintains `rpVariableMean` per threshold variable,
so the principled form is available:

```
q_v = rpProcessNoiseRel * SD(v)^2      # per threshold variable v, from its own league stats
```

This is the same argument D-T1 makes for the score side, applied one level down.

## Why it was NOT done here

It **CHANGES RP DYNAMICS**, and quick task `260901-trz` had no mandate to do that. The task's
own verification bar is that RP is bitwise unchanged; a change that improves RP would have
been indistinguishable, in the measurement, from the reparameterization doing something
unintended. Keeping RP frozen is what made the score-side delta attributable.

## What "done" looks like

Three parameters RETIRE (`rpProcessNoiseWithinEvent`, `rpProcessNoiseEventBoundary`,
`rpColdStartVariance`) and are replaced by relative equivalents scaled off each threshold
variable's own league SD. That is another `SIGMA1_CODE_VERSION` major bump, with both
`vpr@*.json` files retired and re-promoted in the same commit per the established precedent.

Note the search-space consequence: all three currently sit in `SEARCH_EXCLUSIONS`
(D-01's objective — Brier over predicted win probability — is structurally blind to the RP
pmf, so searching them spends budget on a dimension the objective cannot see). Their
replacements inherit that argument unchanged and should be excluded too. **This work needs
its own objective** — an RP-pmf-sensitive one, e.g. RP-prediction log-loss — or it cannot be
evaluated at all. That is the real reason this is `low` priority rather than merely deferred:
the measurement does not exist yet.
