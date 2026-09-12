---
id: 260912-7bp
slug: add-a-team-age-feature-to-the-award-pred
kind: quick
status: complete
completed: 2026-09-12
subsystem: packages/ingest, packages/corpus, scripts
key-files:
  added:
    - packages/ingest/schemas.test.ts
  modified:
    - packages/ingest/schemas.ts
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts
    - packages/ingest/cli.ts
    - package.json
    - scripts/measureAwardPredictability.ts
    - scripts/measureAwardPredictability.test.ts
decisions:
  - "Real rookie_year from TBA, not a first-seen-in-corpus proxy. The corpus starts at 2016 so a proxy is censored - a team first seen in 2016 could be a 1997 rookie. /teams/{year}/{page} carries the full Team model and the whole backfill cost 198 requests."
  - "An additive ALTER TABLE migration was mandatory, not optional. schema.sql is applied with CREATE TABLE IF NOT EXISTS, so the existing 6,432-row corpus would never have gained the column and upsertTeam would have thrown on its first write. The executor proved this by asserting the PRE-migration upsert genuinely throws, so the post-migration assertions cannot pass vacuously."
  - "CorpusTeam.rookieYear is OPTIONAL because publish.test.ts calls upsertTeam without it and that file was off-limits (a concurrent session was editing it earlier in the day)."
  - "ON CONFLICT uses plain assignment rather than COALESCE, so a team TBA reports as null reads back null instead of retaining a stale value."
  - "Rookie-aware baselines RB1/RB2 shipped IN THE SAME COMMIT as the age feature, and the verdict rule widened from 'beats B1 and B2' to 'beats max(B1,B2,RB1,RB2)'. This was the point of the task, not polish - see below."
  - "Both arms (f1-f4 and f1-f7) run in ONE pass over an identical instance set and denominator, with f1-f4 bit-identical across arms by construction, so the reported delta is a pure feature effect."
owed:
  - "Nothing published. No artifact written, no R2 object touched. The corpus gained rookie_year for 6,431 of 6,432 teams and is gitignored, so it does not travel via git - a fresh checkout must re-run `pnpm ingest:teams`."
---

# Quick task 260912-7bp: add a team age feature

**Age is decisive for rookie awards and irrelevant everywhere else — and on two of the
three rookie awards the age-aware model still loses to a rookie-aware heuristic.**

## What shipped

`acefe095` — `rookie_year` through the ingest. `tbaTeamSchema` was silently discarding it
(zod strips unknown keys), the `teams` table had no column, and `publishDistricts.ts:42`
already carried a standing "ROOKIE BONUS, A DOCUMENTED GAP" note about its absence. Now:
schema field, column, additive `ALTER TABLE` migration, and `pnpm ingest:teams`.

`e31ca62a` — the age features and the rookie-aware baselines. `f5 isRookie`,
`f6 log1p(age)`, `f7 ageKnown`, age computed as of the event's season. `f7` exists so a null
`rookie_year` can never be encoded as "rookie".

Backfill: **198 requests. 6,431 of 6,432 teams carry a `rookie_year`; of the 6,390 teams that
appear on any event roster, ZERO are null.** Range 1992-2026.

## The methodological change that produced the result

In 260912-5n8 the rookie awards showed large apparent model wins (+18.1, +14.4, +12.1pp).
Those were **artifacts**: B1 and B2 are *structurally pinned at exactly 0.0%* on rookie
awards, because B1 cannot pick a team with no prior wins and B2 cannot pick a team with no
rating. Beating a structural zero proves nothing.

Handing the model an age feature while leaving those baselines at zero would have
manufactured a far bigger fake win. So RB1 (most-decorated-rookie) and RB2
(strongest-rookie) shipped in the same commit, both abstaining on a rookie-free pool and
counting their abstentions, and the pre-committed verdict rule widened to **beat the best of
all four**.

**It mattered.** Had RB1/RB2 not shipped, this SUMMARY would be claiming a +25 to +34pp age
win on three award types against baselines of 0.0%.

## What age bought

Control first: the no-age arm reproduces 5n8 **exactly** — Impact 22.1 / B1 24.5, EI 9.6,
Safety 22.8, Winner 55.8. Nothing drifted, so the delta is purely the feature.

| type | award | n | no-age | +age | delta | B1 | B2 | RB1 | RB2 |
|---|---|---|---|---|---|---|---|---|---|
| 14 | Highest Rookie Seed | 762 | 14.4% | **47.9%** | +33.5pp | 0.0% | 0.0% | 39.9% | 46.3% |
| 15 | Rookie Inspiration | 844 | 12.1% | 38.7% | +26.7pp | 0.0% | 0.0% | 38.7% | **38.9%** |
| 10 | Rookie All Star | 1114 | 18.1% | 42.9% | +24.8pp | 0.0% | 0.0% | **46.1%** | 42.5% |
| 83 | Rising All-Star | 402 | 3.7% | **6.2%** | +2.5pp | 1.2% | 0.0% | 2.0% | 3.0% |
| 3 | Woodie Flowers Finalist | 649 | 6.3% | **7.6%** | +1.2pp | 5.7% | 4.8% | 1.1% | 0.8% |
| 0 | Impact | 1538 | 22.1% | 21.6% | −0.5pp | **24.5%** | 6.8% | 0.0% | 0.0% |
| 9 | Engineering Inspiration | 1454 | 9.6% | 9.6% | +0.0pp | **12.1%** | 5.0% | 0.0% | 0.1% |
| 21 | Excellence in Engineering | 1492 | 14.3% | 13.9% | −0.4pp | 12.1% | **13.1%** | 0.2% | 0.4% |
| 18 | Safety | 557 | 22.8% | 23.5% | +0.7pp | **28.2%** | 4.8% | 0.0% | 0.2% |

**HELPS on 5 of 24 judged types. NO CHANGE on the other 19** — every flagship judged award
included, all inside the 1.0pp noise band.

## The three findings

**1. Age is decisive for rookie awards in raw terms, and still not enough.** +25 to +34pp is
the largest single-feature effect in either probe. But RB1/RB2 climb to 38-46% on exactly
those types, and against them:

- **Rookie All Star: the age arm LOSES**, 42.9% vs RB1 46.1%. NOT DEMONSTRATED.
- **Rookie Inspiration: the age arm LOSES**, 38.7% vs RB2 38.9%. NOT DEMONSTRATED.
- **Highest Rookie Seed passes, barely** — 47.9% vs RB2 46.3%, margin +1.6pp, only 0.6pp
  clear of the noise band.

All three were "PREDICTABLE" under 5n8's narrower rule. Two flip out entirely; the third
survives on a margin one coin-flip from noise.

**2. 5n8's headline survives untouched.** On Impact, Engineering Inspiration and Safety the
age arm moves nothing (−0.5, +0.0, +0.7pp) and **"pick the most decorated team in the room"
still beats every fitted model** — 24.5% vs 21.6%, 12.1% vs 9.6%, 28.2% vs 23.5%. Knowing a
team's age does not help you guess who wins Impact. Prior decoration remains the whole story.

**3. Two small real gains that only age unlocks.** Woodie Flowers Finalist (6.3 → 7.6%,
+1.8pp over best baseline) and Rising All-Star (3.7 → 6.2%, +3.2pp) cross from noise into
demonstrated. Both are age-inflected by construction, so this is a sanity check passing
rather than a surprise.

## Caveats worth carrying forward

- **Thin-prior dilution.** Both arms fall back to the B1 heuristic below 30 prior instances,
  so on thin types the pooled delta is diluted by forced-zero rows. Rising All-Star is 198
  thin-prior rows of 402, so its +2.5pp is really ≈+4.9pp over the 204 fitted rows. Same
  caveat on types 71, 82, 5.
- **RB1 and RB2 are near-duplicates on most rookie instances** — a first-event rookie is
  unrated, so RB2's ranking degenerates to RB1's team-number tie-break. They diverge only
  where a rookie has already played (type 14: 39.9 vs 46.3).
- **Type 69 (n=11) sits in the 24-type denominator** despite being THIN-n. Pre-existing 5n8
  behaviour, not introduced here, but it makes "19 of 24" slightly generous.

## Verification

Repo-root suite `npx vitest run`: **266 files / 5576 passed, 4 skipped**, from a 266/5541/4
baseline — +35 tests, zero regressions. Root `tsc --noEmit` and the `apps/web` tsconfig both
clean. Leak tests extended over the 7-wide vector, including one asserting the age columns
are identical on both sides of the leak boundary — evidence that `rookie_year` is a static
fact rather than an assertion that it is.
