---
id: extend-corpus-to-2016
created: 2026-09-03
source: quick task 260903-230 — user named it as the reason D-5's coverage loss is acceptable
resolves_phase:
priority: medium
---

# Extend the corpus back to 2016

## Why this is filed

`rolling-origin-hyperparameter-tuning`'s **D-5** restricts the Compare page to seasons that
have an origin, which today means 2024/2025/2026 — three displayed seasons instead of five.
The user accepted that coverage loss on the explicit grounds that the corpus will extend back
to 2016, at which point the stranded seasons are the ancient ones rather than the recent ones.

That backfill **was not tracked anywhere** — no todo, no backlog entry, no roadmap phase — so
D-5's justification rested on an intention with no record. This file is that record. If this
job is never done, D-5 should be revisited, because a permanent three-season Compare page is a
materially weaker evidence base than the five-season one it replaced.

## What it buys

The corpus currently runs 2022–2026 (`eventScopeDiagnostic.ts`'s `DEFAULT_SEASONS =
"2022-2026"`, and `score.ts`'s season guard throws outside that range). Rolling origin spends
the earliest seasons as the first selection window and can never score them, so the corpus
start determines which seasons are permanently unscoreable:

| Corpus starts | Earliest selection window | First origin | Displayed seasons (through 2027) |
|---|---|---|---|
| 2022 (today) | 2022–2023 | 2024 | 4 |
| 2016 | 2016–2017 | 2018 | up to 10, minus whatever 2020/2021 costs |

The stranded pair moves from 2022–2023 to 2016–2017, which is the whole point: nobody's
headline claim depends on 2016.

## The 2020/2021 complication — read before scoping this

**2020** was cancelled a few weeks in; only a partial slate of events was ever played.
**2021** was the at-home/remote season, with no conventional alliance matches at all. Neither
is an ordinary season, and a backfill that treats them as ordinary will produce quietly wrong
numbers rather than loud failures.

Two distinct places this bites, and they need separate answers:

1. **Selection windows and origins (Channel A).** Straightforward to handle — a season can be
   excluded from the searchable set and from the origin list by exclusion, and rolling origin's
   "strictly before" rule does not require the selection seasons to be contiguous.
2. **The season-boundary carry (Channel B).** Harder, and currently untested.
   `sigma1CarryNormalizedRating` (`packages/core/algorithms/sigma1/carryover.ts:77-91`) blends
   a team's `lastYear` and `yearBefore` ratings. That assumes two consecutive prior seasons.
   Across a 2020/2021 gap the chain is broken: what is 2022's `lastYear` — 2021 (not
   comparable), 2019 (three years stale), or nothing? The single-season branch
   (`lastYear ?? yearBefore`) and the no-history branch (`EPA_ROOKIE_BASELINE`) both exist, so
   the code will not crash — it will silently pick one. **That is the risk: a defensible-looking
   number produced by an undecided rule.**

   This never arises today because the corpus starts at 2022 and is contiguous. Extending the
   corpus is what makes it real.

## Also worth checking before committing to this

- **RP rules coverage.** `RP_REGISTERED_SEASONS` (`packages/core/algorithms/sigma1/rp/rules.ts:56`)
  is derived from the registered per-season rule modules. Every backfilled season needs its own
  ranking-point rules module, or RP prediction has no rules to apply for it. This is per-season
  manual work and is probably the largest single cost in this job.
- **TBA data quality pre-2018.** Score breakdowns are less consistent in older seasons; the
  harness's `parseBreakdown` guard (quick task `260818-inm`) degrades a Zod failure to a counted
  skip, so bad seasons will show up as skip counts rather than crashes — check those counts
  rather than assuming a clean ingest.
- **Corpus size and ingest time.** Roughly doubling the season count doubles ingest and every
  full-replay cost downstream, including every tuning search.

## Relationship to other open todos

- `rolling-origin-hyperparameter-tuning` D-5 — the decision this justifies.
- `retune-sigma1-rolling-origin` — if the corpus grows before that job runs, its measured cost
  table and its origin list both change. Doing the backfill FIRST would mean tuning once on the
  full corpus rather than tuning now and re-tuning after. Sequencing is not decided here.
