---
id: seed-state-rows-drops-demo-beliefs
created: 2026-09-17
source: found incidentally by the replay-parity experiment (quick task 260917-mwu), measured on 2026auwarp
priority: medium
---

# `seedStateRows` silently drops Sigma and RP beliefs for teams with no level-1 row

> **RESOLVED 2026-09-18 by quick task 260918-wfc: the beliefs are CARRIED, in a passenger-only team
> row.** Dropping them on both sides would have changed published offseason bands and RP odds. A
> second defect with the same cause was found and fixed with it: the live tick never read the demo
> keys or SPR's pseudo-team row, so it priced a demo alliance from a fresh pseudo team. Live in
> generation `e96213ff`, the SPR D1 seed (28 demo rows) and Worker `d9cd475f`. See the task's
> SUMMARY for the reproduced failures.


`withSigmaBeliefs` / `withRpBeliefs` inject a level-2 belief into an **existing** level-1 team row and
return the rows unchanged when there is none. Demo robots have no SPR team row — `publish.ts` filters
`frc9970`–`frc9999` and `remapDemoTeams` folds them into `DEMO_PSEUDO_TEAM_KEY` — yet
`SigmaScoreAccumulator` keeps a belief under each raw demo key, because a partly-demo alliance still
folds.

**Measured on `2026auwarp` (offseason, 65 played matches): 13 Sigma beliefs and 6 RP beliefs dropped.**

## Why it matters beyond the experiment that found it

The same chain builds **the D1 seed and every published event `state` block**. So a live tick resumes
an offseason demo robot from the flat prior where the offline publisher had a real belief, and the
live and offline match bands for such an event are **not equal by construction** — contrary to
`seedStateRows`'s own doc comment, which says they are.

Detected because the replay-parity instrument's validity gate failed: `2026auwarp`'s match band was
wrong on 65/65 rows **from match 1**, before any interleaving could have moved it.

## Scope

Offseason demo events only, which `pnpm publish:seasons` does include (`--include-offseason`). No
official event has demo robots. Nothing visible is known to be wrong today, because no live window
has opened.

## Fix direction

Decide where a demo robot's level-2 belief belongs: dropped deliberately (and then the doc comment and
the equal-by-construction claim must change), or carried under the pseudo-team key the level-1 state
already uses. Whichever is chosen, pin it with a test on an offseason event with a partly-demo
alliance — the shape that exposed it.

Related: [[rp-fold-exceeds-worker-cpu-budget]], and the demo-key known gap recorded in
`260915-4p9-SUMMARY.md`.
