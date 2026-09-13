---
id: prequalified-backfill-2016-2019
created: 2026-09-07
source: row 9 of extend-corpus-2018-2017-2016 (closed 2026-09-07, quick task 260907-203)
resolves_phase:
priority: low
reverified: 2026-09-13
---

# Championship pre-qualified lists for 2016-2019

> **RE-VERIFIED 2026-09-13 against HEAD `886fbe19`. Still accurate, still open.** `prequalified.ts`
> is unchanged since `f103efa1` (2026-09-05): `HALL_OF_FAME_BY_SEASON` covers 2022-2026, 2019
> carries only the original & sustaining list, and 2016-2018 carry nothing. The lists still reach
> the site through `scripts/publishDistricts.ts:282`. The file header (lines 17-25) still says 2018
> predates the corpus, which is the stale claim this todo already describes.

`packages/core/districts/prequalified.ts` carries curated Championship pre-qualifier lists
for 2022-2026 and a partial 2019 (original & sustaining teams only). 2016, 2017 and 2018
carry none, and 2020 carries none by deliberate rule.

This is the last open row of the corpus backfill. It is **not a red and not a correctness
bug** — it is under-population in the SAFE direction, and that safety is structural rather
than incidental.

## Why an absent list cannot produce a wrong answer

`prequalifiedTeams(season)` feeds `locks.ts`'s `computeLocksWithQualifiers` as the
NON-CONSUMING set: listed teams are removed from the champ points pool but do not reduce the
district's slot allocation. An unlisted prequalified team is therefore treated as an ordinary
points-competing team, which can only ever:

- make that team's OWN status less favorable (shown "contending" when it is really already
  qualified), and
- make a genuine rival's status MORE conservative (one extra competitor in the pool).

It can never fabricate a false "locked" guarantee for anyone. That is the one direction this
math must never err in, and the absent list errs the other way.

## What changed on 2026-09-07, and why this is now merely undone rather than infeasible

`prequalified.ts`'s own header records that the 2019 list could not be completed **because
2018 was not in the corpus** — the prior-year Championship winner / EI / Chairman's-Finalist
teams had to be derived from TBA award data that had never been ingested.

That blocker is gone. The corpus now holds `event_awards` for 2016 (449 rows), 2017 (559) and
2018 (586). So the prior-year-qualifier half of the 2017, 2018 and 2019 lists is now
derivable from local data, the same way TBA's own `prior_year_cmp_teams()` does it.

Still NOT derivable from the corpus, and still needing a curated source: the Hall of Fame
roster per season, and (for 2019) the original & sustaining list, which is already present.

## Work

1. Derive prior-year CMP qualifiers for 2017/2018/2019 from `event_awards` (winner,
   Engineering Inspiration, Chairman's/Impact finalist), following TBA's own rule set.
2. Source the Hall of Fame roster for 2016-2019 from TBA's `cmp_qualification.py` list, the
   same provenance the 2022-2026 rows already cite — do NOT hand-assemble it.
3. Add the seasons to `HALL_OF_FAME_BY_SEASON` / the per-season branches, and extend
   whatever pin `prequalified.test.ts` carries. Check whether that test is an ITERATION LIST
   (fails silently on a new season) or an EQUALITY PIN — see [[iteration-list-trap]]; this
   class has now been found in four files across four packages during this backfill.
4. Leave 2020 alone: TBA's own `ORIGINAL_AND_SUSTAINING` rule ends at `year_end=2019` and the
   2020 manual text is disputed. The existing file already records that decision.

## Do not

- Do not guess a roster to make a season "complete". The file's standing rule is never to
  guess a value, and the safe-direction argument above is what makes leaving it empty
  acceptable indefinitely.
- Do not treat this as blocking anything. 2016-2018 are live on the site as of `24887c4d`
  with these lists absent.

## RESOLVED 2026-09-13 — 2016-2020 backfilled from sources

`packages/core/districts/prequalified.ts` now carries full lists for 2016, 2017, 2018, 2019 and 2020.
Everything was read from a source, never assumed, because OVER-population is the unsafe direction for
the lock math.

- **Categories per season, verbatim from the manuals.** 2016 (Admin Manual §7.2) and 2017 (Game Manual
  §10.12): Hall of Fame, original & sustaining, prior-year CMP winners, prior-year CMP EI. **No
  Chairman's Finalist category** in either. 2018 (T16) adds prior-year Chairman's Finalists. 2019 and
  2020 as 2018, per the 260905-lic research.
- **Hall of Fame: the whole roster, no window,** per every 2016-2020 manual. Transcribed from
  firsthalloffame.org and cross-checked against TBA's own `hall_of_fame_teams()` derivation over its
  CMP_FINALS Chairman's rows. Agreement on every season 1995-2019. Two TBA data artifacts: 191 credited
  with 1992/1994 wins the Hall of Fame does not list, and 1993's team 7 missing. The official roster
  wins both.
- **Prior-year teams** use the event/award types TBA's `prior_year_cmp_teams()` reads. 2016-2019 rows
  from `event_awards_all` matched TBA's API 75/75. 2015 (for the 2016 season) came from the API.
- **Correction to the Work section above:** `event_awards` holds district events only, so it never
  carried Championship awards. The source is `event_awards_all`.
- **2020** carries every category except the disputed original & sustaining one (TBA's `year_end=2019`).
  The previous "no list at all" rested on infeasibility plus that dispute. The infeasibility is gone,
  and omitting only the disputed category is the safe direction.
- **Original & sustaining** uses TBA's static nine for 2016-2019. The only other 1992-rookie teams in
  TBA are 19 (inactive since 2004) and 131 (missed 1993-1994), so neither would qualify.
- Tests are equality pins with hand-counted sizes (38/38/49/50/46), not read back from the implementation.

**Not done here:** the published district artifacts for 2016-2020 still reflect the old lists until
`publish:districts` runs for those years.

**Found in passing, not acted on:** TBA's current `main` `HALL_OF_FAME_TEAMS_BY_YEAR[2022]` lists 9 teams.
This file's 2022 list has 13, matching FIRST's "last 10 years" rule (2012-2021 winners) exactly.
