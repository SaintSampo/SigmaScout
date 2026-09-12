---
title: "seasonStats.metrics.total is offseason-inclusive while every display surface shows official-only"
created: 2026-09-08
source: quick task 260908-n5o
severity: medium
area: publish pipeline / team artifact
---

## The split

The published team artifact's `seasonStats.metrics` is the team's SEASON-FINAL state, which keeps
learning through offseason (eventType 99) and preseason Week 0 (eventType 100) play. Every surface
that shows a team's EPA to a visitor instead shows the team's rating as of its own LAST OFFICIAL
MATCH:

- Teams list: `packages/harness/publish.ts`'s `lastOfficialMetricsByTeam` (quick task 260904-586)
- Team page header: `apps/web/src/lib/officialSnapshot.ts`'s `officialSnapshotRow`, rendered with
  the label "As of last official match" (2026-09-01 user request)

So `seasonStats.metrics.total` is a number the UI never presents as the team's rating. It is not
dead: it renders as the end-of-event state inside an offseason event's own section on the team
page, and it feeds the metric-history chart, both of which are honest uses.

## Measured, live, on `epa@6.0.0+baseline`, season 2026

| Team | Teams list (`v1/teams/2026/...`) | `seasonStats.metrics.total` (`v1/team/{key}/2026/...`) | Gap |
|------|----------------------------------:|--------------------------------------------------------:|------:|
| frc7769 | 313.95 | 251.37 | 62.58 |
| frc88 | 155.96 | 182.75 | -26.79 |
| frc2056 | 302.03 | 277.79 | 24.24 |
| frc254 | 328.39 | 328.39 | 0.00 |
| frc4414 | 357.36 | 357.36 | 0.00 |
| frc1323 | 308.39 | 308.39 | 0.00 |

Teams with no offseason play agree exactly. Every team with offseason play splits. The gap is not
small and it is not signed consistently, so it cannot be reasoned about as a bias.

## Why this is worth fixing rather than living with

Any future consumer that reads `seasonStats.metrics.total` and assumes it is "the team's EPA" gets
a number the site does not show, with no field on the object saying so. That is the same shape as
this project's named defining failure: an artifact asserting something about the system that
stopped being true at the display layer. It already caused one real defect. The
`/methodology/epa-vs-statbotics` page shipped comparing that quantity against Statbotics and
reported slope 0.82-0.96 for a rating nobody is shown, when the displayed rating agrees at
0.97-1.01. That was corrected in the same quick task by measuring an `officialOnly` arm, but the
underlying artifact field is unchanged.

## Options

1. Publish the official-only snapshot as `seasonStats.metrics` and expose the season-final values
   under a separate, clearly named field if anything still needs them. Single number everywhere.
2. Keep both, but name them: `seasonStats.metricsOfficial` and `seasonStats.metricsSeasonFinal`, so
   no consumer can pick the wrong one by accident.
3. Leave the values alone and add a documented field on the artifact recording which basis
   `seasonStats.metrics` carries, mirroring the `basis: "last-official-match"` field the EPA
   comparison artifact now carries.

Option 3 is the cheapest and closes the "silently wrong" half without a data migration. Option 1 is
the cleanest end state.

## Cost

Any of these changes `packages/harness/publish.ts` and needs a full republish across every season,
plus a schema change in `packages/harness/pageArtifacts.ts` and a client update. Deliberately not
attempted inside a page-scoped quick task, and another session was editing `publish.ts` at the time
this was found.

## Verification recipe for whoever picks this up

```
node -e "(async()=>{const l=await (await fetch('https://data.sigmascout.org/v1/teams/2026/epa@6.0.0+baseline.json')).json();const i=l.metricKeys.indexOf('total');const r=l.teams.find(t=>t.teamKey==='frc7769');const p=await (await fetch('https://data.sigmascout.org/v1/team/frc7769/2026/epa@6.0.0+baseline.json')).json();console.log('list',r.metrics[i][0],'page',p.seasonStats.metrics.total.value);})()"
```

Prints two different numbers today. It should print one number when this is closed.

---

## CLOSED 2026-09-12 — shipped as option 3 then option 1, in that order

Closed as part of the 2026-09-12 backlog triage (`.planning/triage-2026-09-12.md` §3).

Both of this file's recommended options shipped, and the cheap one landed first exactly as the
"Options" section suggested it should:

- **`0afefc78`** "feat(260908-wpo): add `seasonStats.metricsBasis` to the team artifact schema" —
  option 3. The artifact now records which basis `seasonStats.metrics` carries, mirroring the
  `basis: "last-official-match"` field the EPA comparison artifact already had. This closed the
  "silently wrong" half with no data migration.
- **`4fc2225d`** "fix(260908-wpo): publish `seasonStats.metrics` as the last-official-match
  snapshot" — option 1, the clean end state. One number everywhere.

This file's own verification recipe is the test: it fetched the teams-list value and the team-page
`seasonStats.metrics.total` and printed two different numbers for `frc7769`. It now prints one
number for all six named teams.

**One thing to carry forward if that recipe is re-run.** The URLs in it are pinned to
`epa@6.0.0+baseline`, a generation that no longer exists in R2. Re-point them at whatever the live
manifest serves (`epa@10.0.0+baseline` as of 2026-09-12) before reading a 404 as a regression.
