---
id: prequalified-backfill-2016-2019
created: 2026-09-07
source: row 9 of extend-corpus-2018-2017-2016 (closed 2026-09-07, quick task 260907-203)
resolves_phase:
priority: low
---

# Championship pre-qualified lists for 2016-2019

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
