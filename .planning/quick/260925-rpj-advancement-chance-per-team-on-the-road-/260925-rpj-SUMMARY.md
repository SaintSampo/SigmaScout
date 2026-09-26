---
quick_id: 260925-rpj
date: 2026-09-25
description: Advancement chance per team on the Road to District Champs tab
status: complete
---

# Advancement chance per team — summary

Every **In range** and **Out of range** team on the Road to District Champs tab now
prints its chance of qualifying on district points, one line under its status chip,
computed from ONE district wide run set inside the existing district Web Worker.

## What ships

- **`packages/core/districts/advancementChance.ts`** — `advancementChances(inputs, draws,
  seed)`. For 1,000 runs under the site's one shared seed, every team's season total is
  drawn from the grand total distribution the browser already holds for it (a finished
  team is a point mass at its earned total); the points race is ranked per run by a
  counting histogram and one suffix pass; the chance is the share of runs inside the
  slots. 520 teams by 1,000 runs measures **26.5 ms**, off the main thread.
- **`packages/core/districts/locks.ts`** — the private `qualifierPool` derivation is
  exported as `pointsRaceSlots` (on keys alone) and `qualifierPool` now delegates to it.
  One derivation, so the chance and the verdicts can never see different slot counts.
- **`apps/web/src/workers/districtSimulationProtocol.ts`** — a `chance` request joins the
  `run`, with its own validator, bounds, error name and terminal `chance-result`.
  `runDistrictWorkerJob` dispatches on the type string; the worker entry forwards into it.
- **`districtLedgerChances.ts`** (new, pure) — builds the run or refuses; reconciles the
  raw run set against the verdicts.
- **`useDistrictAdvancementChance.ts`** (new) — the second Worker lifecycle, mirroring
  `useDistrictSimulationRun` message for message.
- **`districtLedgerStatus.ts`** — exposes the `awardQualified` / `prequalified` sets it
  handed `locks.ts`.
- **`districtLedgerCopy.ts`** — `districtLedgerChanceLine`, the two thresholds, and the
  grand total drawer's new chance caption.
- **`methodology/districtLedgerContent.ts`** — one paragraph, three sentences, no dash
  characters, stating the quantity, the independence and that it never moves a status.

## The number, and why it agrees with the chip

The runs are ranked against `locks.ts`'s own reserved `lockSlots`: `dcmpSlots` minus the
consuming award qualifiers at this position minus one slot per Impact award still to come.
Ties at the last slot count as OUT, the lock rule's own tie philosophy read the other way
round. Two properties follow and are pinned by tests against `computeLocksWithQualifiers`
on the same fixture:

- a team the **ceiling** test locked reads exactly **1** in every run;
- a team the elimination test **locked out** reads exactly **0** in every run.

A team locked by the **pooled** argument alone can read below 1, because that argument
rests on points being conserved inside an event and these independent draws do not honour
that. The verdict wins: the disagreement is counted in `gaps` and nothing is printed.

## Consistency, printing, refusals

- Locked, `Locked · award`, Prequalified and Locked out print **no** number.
- Never above 99 (prints `99%`), never a number under 5 (prints `<5%`, tested against the
  chance itself rather than the rounded value), never the word eliminated.
- The whole district refuses — no chance for anybody — for an unpublished capacity, a
  district with nothing left to play, a per-event run still in flight, or **any single**
  team whose grand total could not be built. A chance is a ranking, so a missing rival
  inflates every other chance rather than degrading one.

## A sample, from a rewound fixture

The committed component fixture (24 teams, 12 slots, one live event and one finished one)
rendered at `?at=season-start`, which reopens every started event:

| Position | Team | Status | Printed |
|---|---|---|---|
| 1 | 100 | In range | 86% chance |
| 2 | 103 | In range | 79% chance |
| 4 | 102 | In range | 69% chance |
| 8 | 105 | In range | 58% chance |
| 11 | 110 | In range | 34% chance |
| 12 | 112 | In range | 33% chance |
| 13 | 111 | Out of range | 32% chance |
| 17 | 114 | Out of range | 23% chance |
| 24 | 123 | Out of range | 15% chance |

The gradient is monotone through the cut at 12 slots, and the two sides of the line differ
by one point of chance — which is the honest reading, since the status is a statement about
median projections and the chance is a probability over the whole distribution. At the
`now` position of the same fixture the range runs 98% down to 7%.

## Verification

- `npx vitest run` from the repo root: **292 files, 6,544 passed, 1 skipped**.
- `npx tsc --noEmit` at the root and for `apps/web`, `apps/worker` and
  `apps/web/tsconfig.e2e.json`: all clean.
- `npx tsx scripts/measureLedgerTenets.ts`: **both tenets still zero** over 4,022 positions
  and 921,658 team-positions (130,718 Locked displays, 190,854 Locked out, 0 violations).
  The chance touches no verdict.
- New coverage: 16 core tests, 14 protocol tests, 14 pure web tests, 6 component tests,
  4 narrowing tests, plus the copy and status-model additions.
- No `±` anywhere; colours are tokens only; every existing `data-testid` kept, two added
  (`district-ledger-chance`, `district-ledger-drawer-chance-caption`); `package.json`
  untouched; no network, no publish, no deploy.
- **UNVERIFIED: the look.** No local screenshot pass was run, so the one line under the
  chip has not been seen rendered.

## Notes for a deploy

Nothing to publish and no artifact shape changed: the chance is computed in the visitor's
browser from numbers already shipped. The tab now constructs a **second** Web Worker per
position on a district with something still to play, and posts a request carrying every
team's grand total array to it. A finished district still constructs none.
