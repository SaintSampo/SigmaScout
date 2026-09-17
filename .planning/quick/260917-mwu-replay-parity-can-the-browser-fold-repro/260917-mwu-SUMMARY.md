---
quick_id: 260917-mwu
status: complete
date: 2026-09-17
commits: [762c9237, d2ccd084, ac06ba98, 024f488f]
verdict_half_a: IT DID NOT WORK (INTERLEAVE, architectural)
verdict_half_b: INCONCLUSIVE (engines differ; rounding absorbed it, margin narrowing)
---

# 260917-mwu: Can a browser fold reproduce the publisher? No — and the reason is not the browser

The bar was committed at 16:46:58, the instrument's first commit at 17:05:18. The ordering is in
`git log`, which is the evidence the bar was not chosen after seeing a number.

## Half A — a one-event browser replay cannot reproduce published rows

Three events: `2026arc` (championship division, maximum interleave), `2026nyro` (week-1 regional,
least-converged state), `2026auwarp` (offseason, demo robots, RP-ineligible).

| Field | Rows differing (`2026arc`) | Max difference |
|---|---|---|
| predicted red score | 140/141 | **124.22 points** |
| `pRedWin` | 137/141 | 0.0379 (0.1628 on `2026nyro`) |
| match band variance | 140/141 | 16,449 |
| RP pmf | 124/141 | 0.0186 |
| **predicted winner** | 1/141 | **flips on 5 of 99 at `2026nyro`** |

Every difference survives rounding. Nothing was absorbed.

**The cause is measured, not inferred.** The state block is *perfect*: the error is exactly **zero at
match 1** on all three events. What breaks it is the 972–1,419 matches from *other events* that step
SPR's league-scoped quantities in between — `scale` drifts −19% by the last match at `2026arc` and
+26% (worst 51%) at `2026nyro`. The per-team filter state is not spared, because `spr.update`
normalises every observation by `scale`.

No passenger fixes this. The missing information is a thousand other matches.

## Half B — the engines do differ; rounding absorbs it, for now

All three engines ran (Chromium 151 / V8, WebKit 26.5 / JavaScriptCore, Firefox 153 / SpiderMonkey),
plus two Node arms to separate "esbuild moved a number" from "the engines differ" — the two Node arms
are bit-identical, so every difference below is the engines.

- **Node's V8 and SpiderMonkey agree bit for bit. Chrome's V8 does not agree with Node's.** The
  variable is the engine *build*, which the site does not control.
- Max ulp distance **grows with event length**: 190 over 99 matches, 512 over 141 — the fold's
  compounding, visible.
- **Every rounded digest is identical on every pair.** Rounding absorbed it.
- But the tightest margin (RP pmf, 5 dp) fell from **3,580x to 84x** between the 99-match and the
  141-match event. Both the divergence and the number of published values grow with event length
  while the rounding grid stays fixed.

Per the committed bar, rounding-absorbed is **INCONCLUSIVE, not a pass**.

## The validity gate earned its place

Arm C (an in-process control that must reproduce the publisher exactly) **failed on the first
three-event run**, and the pass was discarded rather than interpreted. The cause was in the harness:
the team list omitted the publisher's demo-key filter. Fixed; all three events then gate EXACT.
Without the gate, that event's numbers would have been published as a finding about demo events.

## A shipped defect found on the way

`seedStateRows` silently drops a level-2 Sigma or RP belief for any team with no level-1 SPR team row
— measured at 13 Sigma and 6 RP beliefs on `2026auwarp`, all demo robots. The same chain builds the
**D1 seed and every published event `state` block**, so live and offline match bands are not equal by
construction at an offseason demo event, contrary to that chain's own doc comment. Filed separately.

## Recommendation: do not build the relay on this evidence

Not because the browser cannot fold — it can, with the right code and a perfect starting state. It
fails because SPR's league-scoped quantities make a **one-event** replay structurally wrong.

Three shapes would be exact, and each costs something:

1. **Ship the league scalars per played row** (5 numbers). Exact by construction — but the browser is
   then re-evaluating a trajectory the server computed, not replaying, and should be described that
   way.
2. **Make the league scalars event-scoped in the model.** No passenger needed, but it changes
   published numbers: a new version, a walk-forward re-evaluation, and Rule A. Argue it on accuracy,
   never on making a relay convenient.
3. **Fold only since the last publish, not the whole event.** Drift is exactly 0 at match 1 and
   6.4e-4 at match 2. Nobody has measured where between one match and a whole event the error crosses
   the rounding grid. This is the only purely architectural option and is a small next experiment.

## What this does not say

Nothing about browser CPU cost, subrequests or artifact writes. It does **not** say the engines
agree — they demonstrably do not. It says nothing about another season or a future engine build, and
the one trend across two events points the wrong way. RP was tested on two events, not three
(`2026auwarp` publishes none; those 16 fields are reported VACUOUS, not passing).
