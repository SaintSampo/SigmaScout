---
id: 2018-anti-additivity-treatment
created: 2026-09-08
source: carried out of extend-corpus-2018-2017-2016 (closed 2026-09-07) so the decision is not orphaned in completed/
resolves_phase:
priority: low
---

# 2018's zero-sum Scale: nothing treats it, and the evidence now argues for leaving it that way

**Status: OPEN, but with a measured recommendation to DO NOTHING unless a specific
measurement says otherwise.** This file exists because the decision was recorded only inside
`.planning/todos/completed/extend-corpus-2018-2017-2016.md` once that job closed, and a live
modelling question sitting in a completed todo is a question nobody re-reads.

## What was actually done for 2018, and what was not

**Done — the option was preserved, nothing more.** `breakdown/2018.ts` SPLITS the Scale from
the Switch in both auto and teleop (seven own components, not the five a naive port would give),
a locked user decision of 2026-09-07. The split reconstructs TBA's own fused halves exactly,
0 mismatches in 28,312 official qual alliance-sides.

**NOT done — no treatment exists.** Verified 2026-09-08: `autoScaleOwnership` and
`teleopScaleOwnership` appear nowhere outside `breakdown/2018.ts` and `groups.ts`'s display
buckets. No algorithm, no season-conditional branch, nothing in Sigma1/VPR, EPA or OPR treats
them differently from any other component. The split keeps a treatment POSSIBLE; it is not
itself a treatment.

**Statbotics does have one and we deliberately do not.** `epa.ts`'s D-13 records it by name:
"Statbotics' 2018 switch/scale sigmoid and its per-year clamps have no equivalent here, and
this module runs no `post_process_breakdown` equivalent."

## The measurement that changes the recommendation

The full 2016-2026 walk-forward replay (2026-09-07, `vpr@10.0.0+rolling-2026-09e`) ranks VPR's
winner-accuracy deficit against Statbotics, combined view, worst first:

| season | deficit |
|---|---|
| 2019 | -4.61pp |
| 2017 | -4.19pp |
| 2022 | -3.17pp |
| 2020 | -3.13pp |
| 2016 | -2.96pp |
| 2024 | -2.92pp |
| **2018** | **-2.59pp** |
| 2023 | -2.24pp |
| 2025 | -1.77pp |
| 2026 | -0.88pp |

**2018 is the 4th-SMALLEST deficit of ten.** The one season that structurally violates the
additivity assumption every one of these models rests on is *not* where our models do worst —
and it is measured against a competitor that HAS the 2018-specific correction we lack. If the
missing sigmoid were costing us, 2018 should sit at the wrong end of that table. It does not.

The seasons that actually deserve attention on this evidence are 2019 and 2017, neither of
which has an additivity problem.

## What a treatment would look like, if one is ever justified

The lever is measured and real (2026-09-06, full-season official quals): removing Scale-derived
points moves `corr(red totalPoints, blue totalPoints)` from **-0.4567 to -0.0642** — essentially
restoring additivity. Scale-derived points averaged 65.5 per alliance-side, a mean 18.8% share of
an alliance's own total. `teleopScaleOwnershipSec` red-vs-blue correlation is **-0.9109**
(near-perfectly zero-sum) against `teleopSwitchOwnershipSec`'s -0.1362 (ordinary).

So a candidate treatment exists and the split already exposes exactly the components it would
target. What does NOT exist is any evidence it would help.

## Decision rule for whoever picks this up

Do not implement a 2018 normalization because the structure is unusual. Implement it only if a
walk-forward measurement shows it improves 2018 on **both** winner accuracy and Brier (the
project's Rule A), and confirm it does not degrade any other season — a per-season treatment is
a new season-conditional branch in a codebase that has deliberately avoided them (`epa.ts` D-13
is the standing precedent for NOT adding one).

Note also the second-order risk the corpus-extension job flagged and never resolved: parameters
selected on a window that includes 2018 may transfer worse to normal seasons. That comparison
(origin-2022 parameters selected with and without 2018) has still never been run. It is cheap
and would settle whether 2018's presence in a selection window is itself a problem, independent
of any treatment.

## Do not

- Do not treat the Scale split as "the fix". It is a data-shape decision that keeps a fix
  reachable.
- Do not port Statbotics' sigmoid on the grounds that they have one. This project's stated
  discipline is measured divergence, and `docs/models/epa-divergences.md` is where such a
  decision would have to be argued and recorded.
